"""Draws the Android launcher icons, splash images and the 512 px store icon for the app.

The design is the game's favicon (index.html): a red block castle with a door and a blue flag on a
yellow tile. usage (from the repository root):  python _dev/tools/app_icons.py
"""
import os, glob
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RES = os.path.join(ROOT, 'app', 'android', 'app', 'src', 'main', 'res')
YELLOW, RED, BLUE, INK = (255, 201, 60), (226, 59, 46), (47, 111, 224), (31, 26, 23)
SS = 4  # supersampling

# the favicon in its 64-unit design space
CASTLE = [(12, 54), (12, 26), (20, 26), (20, 32), (26, 32), (26, 26), (38, 26), (38, 32), (44, 32), (44, 26), (52, 26), (52, 54)]
FLAG = [(32.5, 9), (45, 14), (32.5, 19)]


def castle(d, s, ox, oy):
    """Castle in the 64-unit design space, scaled by s and offset by (ox, oy) pixels."""
    P = lambda pts: [(ox + x * s, oy + y * s) for x, y in pts]
    line = max(1, round(1.8 * s))
    # the pole, then the flag on it (PIL draws outlines inwards, so they stay thin)
    d.line(P([(32, 27), (32, 8)]), fill=INK, width=max(1, round(2.2 * s)))
    d.polygon(P(FLAG), fill=BLUE, outline=INK, width=max(1, round(1.3 * s)))
    d.polygon(P(CASTLE), fill=RED, outline=INK, width=line)
    # the door: an arch
    d.rounded_rectangle([ox + 27 * s, oy + 40 * s, ox + 37 * s, oy + 54 * s], radius=5 * s, fill=INK)
    # a little window either side
    for cx in (18, 46):
        d.rounded_rectangle([ox + (cx - 2.2) * s, oy + 36 * s, ox + (cx + 2.2) * s, oy + 42 * s], radius=1.6 * s, fill=INK)


def tile(px, shape):
    """Yellow tile with the castle. shape: 'square' (rounded), 'round' or 'full' (store icon, no rounding)."""
    n = px * SS
    im = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if shape == 'round':
        d.ellipse([0, 0, n - 1, n - 1], fill=YELLOW)
        s = n / 64 * 0.8
    else:
        if shape == 'square':
            d.rounded_rectangle([0, 0, n - 1, n - 1], radius=n * 14 / 64, fill=YELLOW)
        else:
            d.rectangle([0, 0, n, n], fill=YELLOW)
        s = n / 64 * 0.92
    # the drawing spans x 12..52 and y 9..54 of its design space: centre it
    ox, oy = n / 2 - 32 * s, n / 2 - 31.5 * s
    castle(d, s, ox, oy)
    return im.resize((px, px), Image.LANCZOS)


def foreground(px):
    """Adaptive-icon foreground: 108 units, the castle inside the 66-unit safe zone, transparent around it."""
    n = px * SS
    im = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    u = n / 108
    s = 1.05 * u                         # the castle's corners stay inside the 33-unit safe circle
    ox, oy = n / 2 - 32 * s, n / 2 - 31.5 * s
    castle(d, s, ox, oy)
    return im.resize((px, px), Image.LANCZOS)


DENS = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for name, k in DENS.items():
    folder = os.path.join(RES, f'mipmap-{name}')
    os.makedirs(folder, exist_ok=True)
    tile(round(48 * k), 'square').save(os.path.join(folder, 'ic_launcher.png'))
    tile(round(48 * k), 'round').save(os.path.join(folder, 'ic_launcher_round.png'))
    foreground(round(108 * k)).save(os.path.join(folder, 'ic_launcher_foreground.png'))

# splash images (Android 11 and older): dark background, icon in the middle, at each existing size
for path in glob.glob(os.path.join(RES, 'drawable*', 'splash.png')):
    w, h = Image.open(path).size
    im = Image.new('RGB', (w, h), INK)
    ic = tile(max(48, round(min(w, h) * 0.28)), 'square')
    im.paste(ic, ((w - ic.width) // 2, (h - ic.height) // 2), ic)
    im.save(path)

store = os.path.join(ROOT, 'app', 'store')
os.makedirs(store, exist_ok=True)
tile(512, 'full').convert('RGB').save(os.path.join(store, 'icon-512.png'))
print('icons, splash images and app/store/icon-512.png written')
