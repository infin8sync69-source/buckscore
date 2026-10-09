#!/usr/bin/env python3
"""
Soul of the World — Corpus Hierarchy Builder
Structures the corpus into a 4-level content-addressed DAG.
Levels: segments (30) → layers (114) → units (6236) → root_tokens
"""
import json, hashlib
from pathlib import Path

BASE = Path(__file__).parent

# Standard 30-segment boundary start positions: (layer_number, unit_number)
SEGMENT_STARTS = [
    (1, 1),    # Segment  1
    (2, 142),  # Segment  2
    (2, 253),  # Segment  3
    (3, 92),   # Segment  4
    (4, 24),   # Segment  5
    (4, 148),  # Segment  6
    (5, 82),   # Segment  7
    (6, 111),  # Segment  8
    (7, 88),   # Segment  9
    (8, 41),   # Segment 10
    (9, 93),   # Segment 11
    (11, 6),   # Segment 12
    (12, 53),  # Segment 13
    (15, 1),   # Segment 14
    (17, 1),   # Segment 15
    (18, 75),  # Segment 16
    (21, 1),   # Segment 17
    (23, 1),   # Segment 18
    (25, 21),  # Segment 19
    (27, 56),  # Segment 20
    (29, 46),  # Segment 21
    (33, 31),  # Segment 22
    (36, 28),  # Segment 23
    (39, 32),  # Segment 24
    (41, 47),  # Segment 25
    (46, 1),   # Segment 26
    (51, 31),  # Segment 27
    (58, 1),   # Segment 28
    (67, 1),   # Segment 29
    (78, 1),   # Segment 30
]


def sha256_cid(obj: dict) -> str:
    """Deterministic CID: sha256 of canonical JSON."""
    raw = json.dumps(obj, sort_keys=True, ensure_ascii=False)
    return 'sha256:' + hashlib.sha256(raw.encode('utf-8')).hexdigest()


def get_segment_id(layer: int, unit: int) -> int:
    """Return 1-indexed segment number for a given layer/unit position."""
    seg = 1
    for i, (sl, sv) in enumerate(SEGMENT_STARTS):
        if (layer, unit) >= (sl, sv):
            seg = i + 1
        else:
            break
    return seg


def main():
    print("Soul of the World — Corpus Builder")
    print("=" * 50)
    print("Loading corpus data...")

    verses = json.loads((BASE / 'quran_verses.json').read_text(encoding='utf-8'))
    chapters = json.loads((BASE / 'chapter_data.json').read_text(encoding='utf-8'))

    # Layer metadata lookup
    layer_meta = {c['number']: c for c in chapters}

    # ── Level 3: Unit nodes ──────────────────────────────────────────────────
    print(f"Building {len(verses)} unit nodes...")
    units = []
    for v in verses:
        layer_id = v['surah']
        unit_id  = v['verse']
        seg_id   = get_segment_id(layer_id, unit_id)
        root_toks = v['arabic'].split()

        node = {
            'id':               f'{layer_id}:{unit_id}',
            'layer':            layer_id,
            'segment':          seg_id,
            'text_ar':          v['arabic'],
            'text_en':          v['translation'],
            'root_tokens':      root_toks,
            'root_token_count': len(root_toks),
        }
        node['cid'] = sha256_cid(node)
        units.append(node)

    # ── Level 2: Layer nodes ─────────────────────────────────────────────────
    print(f"Building {len(chapters)} layer nodes...")
    layers = []
    for ch in chapters:
        ch_units = [u for u in units if u['layer'] == ch['number']]
        seg_ids  = sorted(set(u['segment'] for u in ch_units))

        node = {
            'id':          ch['number'],
            'name':        ch['name'],
            'name_ar':     ch['arabic_name'],
            'letter_count': ch['letter_count'],
            'unit_count':  ch['verse_count'],
            'segments':    seg_ids,
            'unit_cids':   [u['cid'] for u in ch_units],
        }
        node['cid'] = sha256_cid(node)
        layers.append(node)

    layer_map = {l['id']: l for l in layers}

    # ── Level 1: Segment nodes ───────────────────────────────────────────────
    print("Building 30 segment nodes...")
    segments = []
    for seg_idx in range(1, 31):
        seg_units    = [u for u in units if u['segment'] == seg_idx]
        seg_layer_ids = sorted(set(u['layer'] for u in seg_units))

        node = {
            'id':         seg_idx,
            'layer_ids':  seg_layer_ids,
            'unit_count': len(seg_units),
            'layer_cids': [layer_map[lid]['cid'] for lid in seg_layer_ids],
            'unit_cids':  [u['cid'] for u in seg_units],
        }
        node['cid'] = sha256_cid(node)
        segments.append(node)

    # ── Level 0: Root ────────────────────────────────────────────────────────
    root = {
        'type':          'soul_corpus_root',
        'version':       '1.0.0',
        'segment_count': 30,
        'layer_count':   len(layers),
        'unit_count':    len(units),
        'segment_cids':  [s['cid'] for s in segments],
    }
    root['cid'] = sha256_cid(root)

    dag = {
        'root':     root,
        'segments': segments,
        'layers':   layers,
        'units':    units,
    }

    out_path = BASE / 'soul_corpus_dag.json'
    out_path.write_text(json.dumps(dag, ensure_ascii=False, indent=2), encoding='utf-8')

    total_nodes = 1 + len(segments) + len(layers) + len(units)
    size_mb     = out_path.stat().st_size / (1024 * 1024)

    print()
    print(f"Root CID:    {root['cid']}")
    print(f"Segments:    {len(segments)}")
    print(f"Layers:      {len(layers)}")
    print(f"Units:       {len(units)}")
    print(f"Total nodes: {total_nodes:,}")
    print(f"Output size: {size_mb:.2f} MB")
    print(f"Saved:       {out_path}")


if __name__ == '__main__':
    main()
