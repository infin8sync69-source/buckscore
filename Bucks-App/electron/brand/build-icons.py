#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
#  Bucks icon pipeline — one master image in, every platform artefact out.
#
#  The app shipped with no icon at all (electron-builder had "icon": null for
#  Windows and no icon key for mac or linux), so this builds the whole set from
#  a single square master rather than patching a half-existing one.
#
#  Two things here are not obvious and are the reason this is a script and not
#  a one-liner call to `sips`:
#
#  1. macOS does NOT mask app icons for you. Unlike iOS, whatever pixels you
#     hand it are drawn verbatim, so the squircle and the surrounding padding
#     have to be baked in. Apple's Big Sur grid puts the icon body in an
#     824x824 squircle on a 1024 canvas — that ~10% margin per side is what
#     makes an icon sit correctly next to Finder and Safari in the Dock.
#
#  2. A squircle is a superellipse, not a rounded rectangle. Pillow's
#     rounded_rectangle() has visible curvature breaks where the arc meets the
#     straight edge; at 1024px next to Apple's own icons that reads as slightly
#     wrong in a way people notice without being able to name. So the mask is
#     plotted from the superellipse equation directly.
#
#  Usage:
#      python3 build-icons.py master.png                    # squircle, macOS grid
#      python3 build-icons.py master.png --shape square     # full-bleed tile
#      python3 build-icons.py master.png --shape none       # pre-shaped master
#      python3 build-icons.py master.png --out ../assets
# ─────────────────────────────────────────────────────────────────────────────

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("Pillow is required:  python3 -m pip install pillow")


# Apple's Big Sur icon grid, expressed against a 1024 canvas.
MACOS_CANVAS = 1024
MACOS_BODY = 824          # the squircle's bounding box
MACOS_RADIUS_HINT = 185.4  # Apple's published corner radius, for reference only

# .icns wants each logical size at 1x and 2x. iconutil is strict about these
# exact filenames — a typo silently yields an .icns missing that resolution.
ICNS_VARIANTS = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]

# Windows .ico. 256 is the largest Explorer uses; the small end matters most
# because that is the taskbar and the Alt-Tab switcher.
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

# Linux/AppImage and the in-app favicon set.
PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]


def superellipse_mask(size, exponent=5.0, supersample=4):
    """
    An anti-aliased squircle mask of `size`x`size`.

    Plots |x|^n + |y|^n = 1 across the full width for each row rather than
    approximating with four arcs, then downsamples. n=5 is the usual fit for
    Apple's corner; n=4 is rounder, n=8 approaches a square.
    """
    hi = size * supersample
    mask = Image.new("L", (hi, hi), 0)
    draw = ImageDraw.Draw(mask)
    r = hi / 2.0

    for row in range(hi):
        # Sample the pixel centre, normalised to [-1, 1].
        y = (row + 0.5 - r) / r
        ay = abs(y)
        if ay >= 1.0:
            continue
        # Solve for x on the superellipse boundary at this y.
        half = r * (1.0 - ay ** exponent) ** (1.0 / exponent)
        if half <= 0:
            continue
        draw.line([(r - half, row), (r + half, row)], fill=255)

    return mask.resize((size, size), Image.LANCZOS)


# Apple has never published the curve, only the 185.4 corner radius, and the
# two are not convertible in closed form — a superellipse has no constant-radius
# arc to equate to. n=5 is the value the icon-design community converged on by
# visual match, and side-by-side against the system icons it holds up. Exposed
# as a flag rather than fitted, because "fitted" here would be false precision.
SQUIRCLE_EXPONENT = 5.0


def shape_master(master, mode, exponent=SQUIRCLE_EXPONENT):
    """Return a 1024x1024 RGBA canvas with the master placed per `mode`."""
    if mode == "none":
        return master.resize((MACOS_CANVAS, MACOS_CANVAS), Image.LANCZOS)

    if mode == "square":
        # Full-bleed: the artwork is the tile, no padding, no corner shaping.
        return master.resize((MACOS_CANVAS, MACOS_CANVAS), Image.LANCZOS)

    # squircle: inset to the macOS body box and mask.
    body = master.resize((MACOS_BODY, MACOS_BODY), Image.LANCZOS)
    mask = superellipse_mask(MACOS_BODY, exponent=exponent)

    # Respect any alpha already in the master instead of overwriting it.
    if body.mode == "RGBA":
        existing = body.split()[3]
        mask = Image.composite(mask, Image.new("L", mask.size, 0), existing)

    body.putalpha(mask)

    canvas = Image.new("RGBA", (MACOS_CANVAS, MACOS_CANVAS), (0, 0, 0, 0))
    offset = (MACOS_CANVAS - MACOS_BODY) // 2
    canvas.paste(body, (offset, offset), body)
    return canvas


def build_icns(canvas, out_dir, work_dir):
    """iconutil is macOS-only; skip cleanly elsewhere so the rest still builds."""
    if not shutil.which("iconutil"):
        print("  .icns   skipped (iconutil not found — macOS only)")
        return None

    iconset = work_dir / "icon.iconset"
    if iconset.exists():
        shutil.rmtree(iconset)
    iconset.mkdir(parents=True)

    for name, px in ICNS_VARIANTS:
        canvas.resize((px, px), Image.LANCZOS).save(iconset / name)

    dest = out_dir / "icon.icns"
    subprocess.run(
        ["iconutil", "-c", "icns", str(iconset), "-o", str(dest)],
        check=True,
    )
    shutil.rmtree(iconset)
    print(f"  .icns   {dest.name}  ({len(ICNS_VARIANTS)} representations)")
    return dest


def build_ico(canvas, out_dir):
    dest = out_dir / "icon.ico"
    # Pillow's ICO writer derives every frame from the base image by
    # downscaling, so the base must be the LARGEST size requested. Handing it
    # the 16px frame instead silently produces a one-frame file whose other
    # entries would be upscaled from 16px — which is how this was first written
    # and why the frame count is asserted below rather than trusted.
    largest = max(ICO_SIZES)
    base = canvas.resize((largest, largest), Image.LANCZOS)
    base.save(dest, format="ICO", sizes=[(s, s) for s in ICO_SIZES])

    # The ICO directory count lives in a 2-byte LE field at offset 4.
    with open(dest, "rb") as fh:
        count = int.from_bytes(fh.read(6)[4:6], "little")
    if count != len(ICO_SIZES):
        raise RuntimeError(
            f"icon.ico wrote {count} frame(s), expected {len(ICO_SIZES)}"
        )

    print(f"  .ico    {dest.name}  ({', '.join(str(s) for s in ICO_SIZES)})")
    return dest


def build_pngs(canvas, out_dir):
    png_dir = out_dir / "icons"
    png_dir.mkdir(parents=True, exist_ok=True)
    for s in PNG_SIZES:
        canvas.resize((s, s), Image.LANCZOS).save(png_dir / f"{s}x{s}.png")
    # electron-builder's linux target wants a 512 named icon.png at the root.
    canvas.resize((512, 512), Image.LANCZOS).save(out_dir / "icon.png")
    print(f"  .png    icon.png + icons/ ({', '.join(str(s) for s in PNG_SIZES)})")


def main():
    ap = argparse.ArgumentParser(description="Build Bucks platform icons.")
    ap.add_argument("master", type=Path, help="square master image (>=1024px)")
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "dist",
                    help="output directory (default: brand/dist)")
    ap.add_argument("--shape", choices=["squircle", "square", "none"],
                    default="squircle",
                    help="squircle applies Apple's grid + mask (default)")
    ap.add_argument("--exponent", type=float, default=SQUIRCLE_EXPONENT,
                    help="superellipse exponent; higher = squarer (default 5.0)")
    args = ap.parse_args()

    if not args.master.exists():
        sys.exit(f"master not found: {args.master}")

    master = Image.open(args.master).convert("RGBA")
    if master.width != master.height:
        print(f"  warning: master is {master.width}x{master.height}, not square")
    if master.width < 1024:
        print(f"  warning: master is only {master.width}px; 1024+ recommended")

    out_dir = args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    canvas = shape_master(master, args.shape, args.exponent)
    canvas.save(out_dir / "icon-1024.png")

    print(f"\nBucks icons  ({args.shape}, from {args.master.name})")
    build_icns(canvas, out_dir, out_dir)
    build_ico(canvas, out_dir)
    build_pngs(canvas, out_dir)
    print(f"\n  -> {out_dir}\n")


if __name__ == "__main__":
    main()
