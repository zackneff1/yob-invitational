#!/usr/bin/env python3
"""
Draw the app icons in client/public/ (home-screen icon, favicon).

Committed so the icons are reproducible rather than mystery binaries: run
`python3 client/scripts/make-icons.py` after changing the design below.
There is no image library in the toolchain, so this writes the PNGs directly
and antialiases by supersampling each pixel.

The artwork is a flagstick on a putting green, drawn in unit coordinates
(0..1) and kept inside the centre 80% so it survives Android's maskable
crop.
"""
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'public'

BG = (20, 83, 45)  # #14532d — same dark green as the app's top bar
GREEN = (26, 127, 74)  # putting surface
WHITE = (248, 250, 252)  # flagstick and ball
PENNANT = (34, 197, 94)  # #22c55e — the app's accent green
HOLE = (12, 58, 31)

SUPERSAMPLE = 4


def in_ellipse(u, v, cx, cy, rx, ry):
    return ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1.0


def in_triangle(u, v, a, b, c):
    def side(p, q):
        return (q[0] - p[0]) * (v - p[1]) - (q[1] - p[1]) * (u - p[0])

    d1, d2, d3 = side(a, b), side(b, c), side(c, a)
    return (d1 >= 0 and d2 >= 0 and d3 >= 0) or (d1 <= 0 and d2 <= 0 and d3 <= 0)


def sample(u, v):
    """Colour at a point, topmost layer first."""
    # Ball resting on the green
    if in_ellipse(u, v, 0.630, 0.752, 0.034, 0.034):
        return WHITE
    # Pennant, attached to the right of the stick
    if in_triangle(u, v, (0.492, 0.215), (0.492, 0.435), (0.755, 0.325)):
        return PENNANT
    # Flagstick
    if 0.455 <= u <= 0.492 and 0.200 <= v <= 0.792:
        return WHITE
    # Cup shadow at the base of the stick
    if in_ellipse(u, v, 0.4735, 0.777, 0.042, 0.014):
        return HOLE
    # Putting surface
    if in_ellipse(u, v, 0.5, 0.780, 0.250, 0.075):
        return GREEN
    return BG


def render(size):
    rows = []
    step = 1.0 / (size * SUPERSAMPLE)
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r = g = b = 0
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    u = (x * SUPERSAMPLE + sx + 0.5) * step
                    v = (y * SUPERSAMPLE + sy + 0.5) * step
                    cr, cg, cb = sample(u, v)
                    r += cr
                    g += cg
                    b += cb
            n = SUPERSAMPLE * SUPERSAMPLE
            row += bytes((r // n, g // n, b // n, 255))
        rows.append(bytes(row))
    return rows


def write_png(path, size):
    rows = render(size)
    raw = b''.join(b'\x00' + row for row in rows)

    def chunk(kind, data):
        return (
            struct.pack('>I', len(data))
            + kind
            + data
            + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    png = (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(raw, 9))
        + chunk(b'IEND', b'')
    )
    path.write_bytes(png)
    print(f'{path.name}: {size}x{size}, {len(png):,} bytes')


if __name__ == '__main__':
    write_png(OUT / 'icon-512.png', 512)
    write_png(OUT / 'icon-192.png', 192)
    write_png(OUT / 'apple-touch-icon.png', 180)
    write_png(OUT / 'favicon-32.png', 32)
