"""
Project NEXUS — Soul Engine Endpoint Tests

Tests the new NEXUS-specific endpoints:
  POST /agent          — session_id in response headers + typed SSE events
  POST /agent/approve  — approval gate
  POST /agent/deny     — denial gate
  POST /agent/cancel   — cancel running session
  GET  /agent/goals    — list persisted goals
  POST /agent/goals    — create goal
"""
import json
import time
import pytest
import asyncio
from httpx import AsyncClient, ASGITransport

# Import the NEXUS-enhanced soul engine
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from soul_engine import app


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _collect_sse(response) -> list[dict]:
    """Parse SSE stream into a list of event dicts."""
    events = []
    content = response.content.decode()
    for line in content.splitlines():
        if line.startswith('data:'):
            raw = line[5:].strip()
            if raw == '[DONE]':
                break
            try:
                events.append(json.loads(raw))
            except json.JSONDecodeError:
                pass
    return events


# ── /health ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_health():
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        r = await client.get('/health')
    assert r.status_code == 200
    data = r.json()
    assert 'model' in data
    assert 'online' in data
    assert data['online'] is True


# ── /router/classify ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_router_classify_agent():
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        r = await client.get('/router/classify', params={'q': 'search the web for Python tutorials'})
    assert r.status_code == 200
    data = r.json()
    assert data['use_agent'] is True
    assert data['domain'] == 'agent'


@pytest.mark.asyncio
async def test_router_classify_wallet():
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        r = await client.get('/router/classify', params={'q': 'show my wallet balance'})
    assert r.status_code == 200
    data = r.json()
    assert data['domain'] == 'wallet'


@pytest.mark.asyncio
async def test_router_classify_chat():
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        r = await client.get('/router/classify', params={'q': 'hello how are you'})
    assert r.status_code == 200
    data = r.json()
    assert data['domain'] == 'chat'
    assert data['use_agent'] is False


# ── /agent/goals ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_and_list_goals():
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        # Create a goal
        session_id = f'test-{int(time.time())}'
        r = await client.post('/agent/goals', json={
            'session_id': session_id,
            'goal': 'Test: search for NEXUS info',
            'status': 'completed',
        })
        assert r.status_code == 200
        data = r.json()
        assert data['ok'] is True
        assert data['session_id'] == session_id

        # List goals — our goal should appear
        r = await client.get('/agent/goals')
        assert r.status_code == 200
        goals = r.json().get('goals', [])
        found = [g for g in goals if g['session_id'] == session_id]
        assert len(found) == 1
        assert found[0]['goal'] == 'Test: search for NEXUS info'
        assert found[0]['status'] == 'completed'


@pytest.mark.asyncio
async def test_create_goal_auto_session_id():
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        r = await client.post('/agent/goals', json={'goal': 'Auto ID goal'})
    assert r.status_code == 200
    data = r.json()
    assert data['ok'] is True
    assert len(data['session_id']) > 0  # auto-generated


# ── /agent/cancel ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cancel_nonexistent_session():
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        r = await client.post('/agent/cancel/nonexistent-session-id')
    assert r.status_code == 200
    data = r.json()
    assert data['ok'] is False
    assert 'error' in data


# ── /agent/approve + /agent/deny — unknown action_id ─────────────────────────

@pytest.mark.asyncio
async def test_approve_unknown_action():
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        r = await client.post('/agent/approve/test-session', json={'action_id': 'unknown-abc'})
    assert r.status_code == 200
    data = r.json()
    assert data['ok'] is False


@pytest.mark.asyncio
async def test_deny_unknown_action():
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        r = await client.post('/agent/deny/test-session', json={'action_id': 'unknown-xyz'})
    assert r.status_code == 200
    data = r.json()
    assert data['ok'] is False


# ── /agent/tool_result — unknown request id ───────────────────────────────────

@pytest.mark.asyncio
async def test_tool_result_unknown():
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        r = await client.post('/agent/tool_result', json={'id': 'bad-id', 'result': 'test'})
    assert r.status_code == 200
    data = r.json()
    assert data['ok'] is False
