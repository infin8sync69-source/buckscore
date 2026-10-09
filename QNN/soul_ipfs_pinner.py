#!/usr/bin/env python3
"""
Soul of the World — IPFS Corpus Pinner
Pins the corpus DAG to IPFS via local Kubo daemon or Bucks IPFS bridge.
Falls back to local sha256 CID map if no IPFS node is available.
"""
import json, requests, sys
from pathlib import Path

BASE     = Path(__file__).parent
KUBO_API  = 'http://127.0.0.1:5001/api/v0'
BUCKS_API = 'http://127.0.0.1:3939/api/v0'


def detect_ipfs() -> tuple[str, str | None]:
    """Detect available IPFS endpoint. Returns (method, base_url)."""
    for name, base in [('kubo', KUBO_API), ('bucks', BUCKS_API)]:
        try:
            r = requests.post(f'{base}/version', timeout=2)
            if r.status_code == 200:
                return name, base
        except Exception:
            pass
    return 'offline', None


def add_to_ipfs(content: bytes, endpoint: str) -> str | None:
    """Add raw bytes to IPFS. Returns real CID or None on failure."""
    try:
        r = requests.post(
            f'{endpoint}/add',
            files={'file': ('data.json', content, 'application/json')},
            timeout=15,
        )
        if r.status_code == 200:
            return r.json().get('Hash')
    except Exception as e:
        print(f"  IPFS add error: {e}", flush=True)
    return None


def main():
    dag_path = BASE / 'soul_corpus_dag.json'
    if not dag_path.exists():
        print("ERROR: soul_corpus_dag.json not found. Run soul_corpus_builder.py first.")
        sys.exit(1)

    print("Soul of the World — IPFS Pinner")
    print("=" * 50)
    print("Loading DAG...")
    dag = json.loads(dag_path.read_text(encoding='utf-8'))

    method, endpoint = detect_ipfs()
    print(f"IPFS method: {method}" + (f"  endpoint: {endpoint}" if endpoint else "  (offline)"))

    cid_map: dict[str, str] = {}

    if method == 'offline':
        # No live IPFS node — record sha256 CIDs locally
        print("No IPFS daemon found. Recording local sha256 CIDs.")
        cid_map['root'] = dag['root']['cid']
        for seg in dag['segments']:
            cid_map[f"segment:{seg['id']}"] = seg['cid']
        for layer in dag['layers']:
            cid_map[f"layer:{layer['id']}"] = layer['cid']
        for unit in dag['units']:
            cid_map[f"unit:{unit['id']}"] = unit['cid']
        print("Note: Run with a live Kubo or Bucks IPFS node to get bafybei… CIDs.")

    else:
        # Pin units
        total = len(dag['units'])
        print(f"Pinning {total} units...", flush=True)
        for i, unit in enumerate(dag['units']):
            content  = json.dumps(unit, ensure_ascii=False).encode('utf-8')
            real_cid = add_to_ipfs(content, endpoint)
            cid_map[f"unit:{unit['id']}"] = real_cid or unit['cid']
            if (i + 1) % 500 == 0:
                print(f"  {i+1}/{total} units...", flush=True)

        # Pin layers
        print(f"Pinning {len(dag['layers'])} layers...", flush=True)
        for layer in dag['layers']:
            content  = json.dumps(layer, ensure_ascii=False).encode('utf-8')
            real_cid = add_to_ipfs(content, endpoint)
            cid_map[f"layer:{layer['id']}"] = real_cid or layer['cid']

        # Pin segments
        print(f"Pinning {len(dag['segments'])} segments...", flush=True)
        for seg in dag['segments']:
            content  = json.dumps(seg, ensure_ascii=False).encode('utf-8')
            real_cid = add_to_ipfs(content, endpoint)
            cid_map[f"segment:{seg['id']}"] = real_cid or seg['cid']

        # Pin root
        root_bytes = json.dumps(dag['root'], ensure_ascii=False).encode('utf-8')
        real_root  = add_to_ipfs(root_bytes, endpoint)
        cid_map['root'] = real_root or dag['root']['cid']
        print(f"Root CID: {cid_map['root']}")

    # Persist CID map
    out_path = BASE / 'soul_cid_map.json'
    out_path.write_text(json.dumps(cid_map, indent=2, ensure_ascii=False), encoding='utf-8')

    print()
    print(f"CID map saved: {out_path}")
    print(f"Total entries: {len(cid_map):,}")
    print(f"  root:     1")
    print(f"  segments: {sum(1 for k in cid_map if k.startswith('segment:'))}")
    print(f"  layers:   {sum(1 for k in cid_map if k.startswith('layer:'))}")
    print(f"  units:    {sum(1 for k in cid_map if k.startswith('unit:'))}")


if __name__ == '__main__':
    main()
