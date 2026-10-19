"""Generates the PNG app icons (pure Python, no dependencies)."""
import struct, zlib, os

SEGS = {'a': (0, 0, 1, 0), 'b': (1, 0, 0, 1), 'c': (1, 1, 0, 1), 'd': (0, 2, 1, 0),
        'e': (0, 1, 0, 1), 'f': (0, 0, 0, 1), 'g': (0, 1, 1, 0)}
# (col, row, horizontal?, vertical?) in a 1x2 grid of segment cells

def rects(ox, oy, w, h, t):
    """Return {seg: (x0,y0,x1,y1)} for one 7-segment digit."""
    g = t * 0.22
    return {
        'a': (ox + t + g, oy, ox + w - t - g, oy + t),
        'g': (ox + t + g, oy + h / 2 - t / 2, ox + w - t - g, oy + h / 2 + t / 2),
        'd': (ox + t + g, oy + h - t, ox + w - t - g, oy + h),
        'f': (ox, oy + t + g, ox + t, oy + h / 2 - g),
        'b': (ox + w - t, oy + t + g, ox + w, oy + h / 2 - g),
        'e': (ox, oy + h / 2 + g, ox + t, oy + h - t - g),
        'c': (ox + w - t, oy + h / 2 + g, ox + w, oy + h - t - g),
    }

def render(size, content=0.62):
    px = bytearray(size * size * 3)
    def fill(x0, y0, x1, y1, col):
        for y in range(max(0, int(y0)), min(size, int(y1))):
            row = y * size * 3
            for x in range(max(0, int(x0)), min(size, int(x1))):
                px[row + x * 3: row + x * 3 + 3] = bytes(col)
    span = size * content
    dw = span * 0.43
    dh = dw * 1.8
    t = dw * 0.22
    gap = span - 2 * dw
    x0 = (size - span) / 2
    y0 = (size - dh) / 2
    lit, ghost = (255, 176, 0), (38, 27, 0)
    for i in range(2):
        r = rects(x0 + i * (dw + gap), y0, dw, dh, t)
        for k, rc in r.items():
            fill(*rc, ghost if k == 'g' else lit)
    return bytes(px)

def png(size, data):
    raw = b''.join(b'\x00' + data[y * size * 3:(y + 1) * size * 3] for y in range(size))
    def chunk(tag, body):
        c = struct.pack('>I', len(body)) + tag + body
        return c + struct.pack('>I', zlib.crc32(tag + body) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

here = os.path.dirname(os.path.abspath(__file__))
for name, size, content in [('icon-192.png', 192, .62), ('icon-512.png', 512, .62),
                            ('icon-maskable-512.png', 512, .5), ('apple-touch-icon.png', 180, .62)]:
    with open(os.path.join(here, name), 'wb') as f:
        f.write(png(size, render(size, content)))
print('icons ok')
