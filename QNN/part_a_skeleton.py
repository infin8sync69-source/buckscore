#!/usr/bin/env python3
"""Part A: Quran Neural Net — 114-layer architecture skeleton.

Each layer's width = number of Arabic letters in the corresponding Quran chapter.
"""

import json
import os
import time
import unicodedata

import matplotlib.patches as mpatches
import matplotlib.pyplot as plt
import numpy as np
import requests
import torch
import torch.nn as nn


# ── helpers ───────────────────────────────────────────────────────────────────

def fetch_with_retry(url, max_retries=4, backoff=2):
    for attempt in range(max_retries):
        try:
            r = requests.get(url, timeout=90)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if attempt < max_retries - 1:
                wait = backoff ** attempt
                print(f"    retry {attempt + 1} in {wait}s … ({e})")
                time.sleep(wait)
            else:
                raise


def count_arabic_letters(text):
    """Count Arabic letters in U+0600–U+06FF, skipping diacritics (category Mn)."""
    return sum(
        1 for c in text
        if 0x0600 <= ord(c) <= 0x06FF
        and unicodedata.category(c).startswith("L")
    )


class QuranNet(nn.Module):
    def __init__(self, widths):
        super().__init__()
        self.layers = nn.ModuleList(
            nn.Linear(widths[i], widths[i + 1]) for i in range(len(widths) - 1)
        )
        self.activations = nn.ModuleList(nn.ReLU() for _ in range(len(widths) - 1))

    def forward(self, x):
        for layer, act in zip(self.layers, self.activations):
            x = act(layer(x))
        return x


# ── 1. Download ───────────────────────────────────────────────────────────────

print("=" * 60)
print("PART A — Quran Neural Net Skeleton")
print("=" * 60)
print("\n[1/5] Downloading Quran text (Uthmani) …")

CACHE = "quran_uthmani_raw.json"
if os.path.exists(CACHE):
    with open(CACHE) as fh:
        surahs = json.load(fh)
    print(f"  ✓ Loaded from cache ({len(surahs)} surahs)")
else:
    data = fetch_with_retry("https://api.alquran.cloud/v1/quran/quran-uthmani")
    surahs = data["data"]["surahs"]
    with open(CACHE, "w", encoding="utf-8") as fh:
        json.dump(surahs, fh, ensure_ascii=False)
    print(f"  ✓ Downloaded {len(surahs)} surahs")

# ── 2. Count letters ──────────────────────────────────────────────────────────

print("\n[2/5] Counting Arabic letters per surah …")

chapter_data = []
for s in surahs:
    full_text = " ".join(a["text"] for a in s["ayahs"])
    chapter_data.append(dict(
        number=s["number"],
        name=s["englishName"],
        arabic_name=s["name"],
        verse_count=len(s["ayahs"]),
        letter_count=count_arabic_letters(full_text),
    ))

widths = [c["letter_count"] for c in chapter_data]
sorted_ch = sorted(chapter_data, key=lambda x: x["letter_count"], reverse=True)

header = f"\n  {'#':>4}  {'Name':<28} {'Verses':>6}  {'Letters':>9}"
sep    = "  " + "─" * 52

print("\n  TOP 10 surahs by letter count:")
print(header); print(sep)
for c in sorted_ch[:10]:
    print(f"  {c['number']:>4}.  {c['name']:<28} {c['verse_count']:>6}  {c['letter_count']:>9,}")

print("\n  BOTTOM 10 surahs by letter count:")
print(header); print(sep)
for c in sorted_ch[-10:]:
    print(f"  {c['number']:>4}.  {c['name']:<28} {c['verse_count']:>6}  {c['letter_count']:>9,}")

print(f"\n  Width range  : {min(widths):,} – {max(widths):,}")
print(f"  Total letters: {sum(widths):,}")

# Save for Part B
with open("chapter_data.json", "w", encoding="utf-8") as fh:
    json.dump(chapter_data, fh, ensure_ascii=False, indent=2)

# ── 3. Build architecture ─────────────────────────────────────────────────────

print("\n[3/5] Building QuranNet (114 layers) …")

# meta device: build the graph without allocating RAM for billion-param weights
try:
    with torch.device("meta"):
        model = QuranNet(widths)
    total_params = sum(p.numel() for p in model.parameters())
except Exception:
    # analytical fallback: Linear(in, out) has in*out weights + out biases
    total_params = sum(
        widths[i] * widths[i + 1] + widths[i + 1]
        for i in range(len(widths) - 1)
    )

trainable_params = total_params  # all params trainable by default

print(f"  ✓ Layers      : {len(widths) - 1} (113 Linear+ReLU blocks)")
print(f"  ✓ Input  dim  : {widths[0]:,}  ({chapter_data[0]['name']})")
print(f"  ✓ Output dim  : {widths[-1]:,}  ({chapter_data[-1]['name']})")
print()
print(f"  ╔══════════════════════════════════════════╗")
print(f"  ║  Total parameters : {total_params:>18,}  ║")
print(f"  ║  Trainable params : {trainable_params:>18,}  ║")
print(f"  ╚══════════════════════════════════════════╝")

# ── 4. Visualize ──────────────────────────────────────────────────────────────

print("\n[4/5] Generating visualizations …")

chs   = [c["number"]       for c in chapter_data]
lts   = [c["letter_count"] for c in chapter_data]
names = [c["name"]         for c in chapter_data]
top7  = set(sorted(range(len(lts)), key=lambda i: lts[i], reverse=True)[:7])

bar_colors = ["#C0392B" if i in top7 else "#2980B9" for i in range(len(chs))]

# ── Bar chart ─────────────────────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(18, 7))
ax.bar(chs, lts, color=bar_colors, edgecolor="none", alpha=0.85)

for i in top7:
    ax.text(chs[i], lts[i] + 180, names[i],
            ha="center", va="bottom", fontsize=6.5, rotation=45,
            color="#C0392B", fontweight="bold")

ax.set_xlabel("Chapter (Surah) Number", fontsize=12)
ax.set_ylabel("Arabic Letter Count", fontsize=12)
ax.set_title(
    "Quran Neural Net: Layer Widths by Chapter\n"
    f"(Total parameters: {total_params:,}  |  Red = 7 largest surahs)",
    fontsize=13, fontweight="bold",
)
ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f"{int(x):,}"))
ax.set_xlim(0.5, 114.5)
ax.grid(axis="y", alpha=0.3, linestyle="--")
ax.legend(handles=[
    mpatches.Patch(color="#C0392B", label="Top 7 surahs"),
    mpatches.Patch(color="#2980B9", label="Other surahs"),
], loc="upper right")

plt.tight_layout()
plt.savefig("layer_widths_bar.png", dpi=150, bbox_inches="tight")
plt.close()
print("  ✓ layer_widths_bar.png")

# ── Line chart ────────────────────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(18, 7))
ax.plot(chs, lts, color="#2980B9", linewidth=1.5, alpha=0.7)
ax.fill_between(chs, lts, alpha=0.15, color="#2980B9")

for i in top7:
    ax.scatter(chs[i], lts[i], color="#C0392B", s=130, zorder=5)
    ax.annotate(
        names[i], (chs[i], lts[i]),
        textcoords="offset points", xytext=(6, 5),
        fontsize=8, color="#C0392B", fontweight="bold",
    )

ax.set_xlabel("Chapter (Surah) Number", fontsize=12)
ax.set_ylabel("Arabic Letter Count (= Layer Width)", fontsize=12)
ax.set_title(
    "Quran Neural Net: Layer Widths — Line View\n(Red = 7 largest surahs)",
    fontsize=13, fontweight="bold",
)
ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f"{int(x):,}"))
ax.set_xlim(1, 114)
ax.grid(alpha=0.3, linestyle="--")
ax.legend(handles=[
    mpatches.Patch(color="#C0392B", label="Top 7 surahs"),
    mpatches.Patch(color="#2980B9", label="Other chapters"),
], loc="upper right")

plt.tight_layout()
plt.savefig("layer_widths_line.png", dpi=150, bbox_inches="tight")
plt.close()
print("  ✓ layer_widths_line.png")

# ── 5. Summary ────────────────────────────────────────────────────────────────

print("\n[5/5] Summary")
print("=" * 60)
print(f"  Architecture  : 114 layers (113 Linear+ReLU blocks)")
print(f"  Largest surah : {sorted_ch[0]['name']} ({sorted_ch[0]['letter_count']:,} letters)")
print(f"  Smallest surah: {sorted_ch[-1]['name']} ({sorted_ch[-1]['letter_count']:,} letters)")
print(f"  Total params  : {total_params:,}")
print(f"  Saved         : chapter_data.json, layer_widths_bar.png, layer_widths_line.png")
print("=" * 60)

# Write param count to file so README can pick it up
with open("param_count.txt", "w") as fh:
    fh.write(str(total_params))
