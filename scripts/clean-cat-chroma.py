#!/usr/bin/env python3
"""Remove green-screen fringe from already-extracted Poker Cats sprite frames."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def clean_pixel(red: int, green: int, blue: int, alpha: int) -> tuple[int, int, int, int]:
    if alpha == 0:
        return red, green, blue, alpha

    # The generated cats intentionally contain no green. Remove both the key and
    # darker antialiased key pixels that a plain RGB-distance threshold leaves.
    green_key_pixel = green > 20 and green > red + 14 and green > blue + 14
    if green_key_pixel:
        return 0, 0, 0, 0

    # Neutralize a tiny remaining green spill without changing orange, white,
    # black, amber, blue, or teal character colors.
    if green > max(red, blue):
        green = max(red, blue)
    return red, green, blue, alpha


def clean_image(path: Path) -> None:
    with Image.open(path) as opened:
        image = opened.convert("RGBA")
    image.putdata([clean_pixel(*pixel) for pixel in image.getdata()])
    image.save(path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path, help="Directory containing PNG sprite frames")
    args = parser.parse_args()

    paths = sorted(args.root.rglob("*.png"))
    if not paths:
        raise SystemExit(f"no PNG files found below {args.root}")
    for path in paths:
        clean_image(path)
    print(f"cleaned {len(paths)} sprite frame(s) below {args.root}")


if __name__ == "__main__":
    main()
