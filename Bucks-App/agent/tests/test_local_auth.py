"""
Token auth and CORS on the local agent servers (local_auth.py).

Loopback is reachable from any web page on the machine, so the engines must
refuse requests that lack the shared token, refuse foreign Host headers (DNS
rebinding) and only grant CORS to the file:// shell.
"""
import os
import stat

import pytest
from httpx import AsyncClient, ASGITransport

import local_auth
from mcp_server import app as mcp_app
from soul_engine import app as engine_app

TOKEN = os.environ['BUCKS_AGENT_TOKEN']
AUTH = {'Authorization': f'Bearer {TOKEN}'}


def _client(app, base_url='http://127.0.0.1:8765') -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url=base_url)


# ── Token gate ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_health_is_public():
    async with _client(engine_app) as client:
        r = await client.get('/health')
    assert r.status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize('method,path', [
    ('GET', '/agent/goals'),
    ('POST', '/agent/approve/some-session'),
    ('POST', '/agent/tool_result'),
    ('POST', '/agent'),
    ('POST', '/api/v1/soul/sign'),
])
async def test_engine_routes_need_token(method, path):
    async with _client(engine_app) as client:
        r = await client.request(method, path, json={})
    assert r.status_code == 401
    assert r.headers.get('www-authenticate') == 'Bearer'


@pytest.mark.asyncio
async def test_wrong_token_is_refused():
    async with _client(engine_app) as client:
        r = await client.get('/agent/goals', headers={'Authorization': 'Bearer ' + 'x' * 43})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_correct_token_is_accepted():
    async with _client(engine_app) as client:
        r = await client.get('/agent/goals', headers=AUTH)
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_localhost_host_is_accepted():
    async with _client(engine_app, base_url='http://localhost:8765') as client:
        r = await client.get('/agent/goals', headers=AUTH)
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_foreign_host_is_refused_even_with_token():
    # A DNS-rebinding page reaches 127.0.0.1 but still sends its own name.
    async with _client(engine_app, base_url='http://attacker.example:8765') as client:
        r = await client.get('/agent/goals', headers=AUTH)
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_mcp_server_needs_token():
    async with _client(mcp_app, base_url='http://127.0.0.1:9999') as client:
        refused = await client.get('/tools')
        allowed = await client.get('/tools', headers=AUTH)
        health = await client.get('/health')
    assert refused.status_code == 401
    assert allowed.status_code == 200
    assert health.status_code == 200


# ── CORS ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_preflight_from_shell_is_allowed():
    async with _client(engine_app) as client:
        r = await client.options('/agent', headers={
            'Origin': 'null',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'authorization,content-type',
        })
    assert r.status_code == 200
    assert r.headers.get('access-control-allow-origin') == 'null'


@pytest.mark.asyncio
async def test_preflight_from_web_page_is_refused():
    async with _client(engine_app) as client:
        r = await client.options('/agent', headers={
            'Origin': 'https://attacker.example',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'authorization,content-type',
        })
    assert r.status_code == 400
    assert 'access-control-allow-origin' not in r.headers


@pytest.mark.asyncio
async def test_unauthorised_response_is_readable_by_shell():
    # The shell needs to see the 401 to report "engine token mismatch".
    async with _client(engine_app) as client:
        r = await client.get('/agent/goals', headers={'Origin': 'null'})
    assert r.status_code == 401
    assert r.headers.get('access-control-allow-origin') == 'null'


@pytest.mark.asyncio
async def test_session_header_is_exposed_to_shell():
    async with _client(engine_app) as client:
        r = await client.get('/agent/goals', headers={**AUTH, 'Origin': 'null'})
    assert 'x-session-id' in r.headers.get('access-control-expose-headers', '').lower()


# ── Token file ────────────────────────────────────────────────────────────────

def test_token_file_is_created_private_and_reused(tmp_path, monkeypatch):
    path = tmp_path / 'nested' / 'agent.token'
    monkeypatch.delenv('BUCKS_AGENT_TOKEN', raising=False)
    monkeypatch.setenv('BUCKS_AGENT_TOKEN_FILE', str(path))

    first = local_auth.load_or_create_token()
    assert path.read_text().strip() == first
    assert len(first) >= 32
    if os.name == 'posix':
        assert stat.S_IMODE(path.stat().st_mode) == 0o600

    assert local_auth.load_or_create_token() == first


def test_env_token_wins_over_file(tmp_path, monkeypatch):
    path = tmp_path / 'agent.token'
    path.write_text('f' * 43 + '\n')
    monkeypatch.setenv('BUCKS_AGENT_TOKEN_FILE', str(path))
    monkeypatch.setenv('BUCKS_AGENT_TOKEN', 'e' * 43)
    assert local_auth.load_or_create_token() == 'e' * 43


def test_corrupt_token_file_is_an_error_not_a_silent_bypass(tmp_path, monkeypatch):
    path = tmp_path / 'agent.token'
    path.write_text('short\n')
    monkeypatch.delenv('BUCKS_AGENT_TOKEN', raising=False)
    monkeypatch.setenv('BUCKS_AGENT_TOKEN_FILE', str(path))
    with pytest.raises(RuntimeError):
        local_auth.load_or_create_token()
