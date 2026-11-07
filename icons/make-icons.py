#!/usr/bin/env python3
"""App-Icons erzeugen: icon-192.png, icon-512.png, icon-maskable-512.png.

Aufruf im Projektordner:  python3 icons/make-icons.py
Braucht Pillow:           pip install --break-system-packages pillow

Gleiches Aussehen für alle Apps:
- Hintergrund #1B1B1B über die ganze Fläche (das Grau der einheitlichen
  dunklen Icons auf dem Android-Homescreen), kein Verlauf, kein Schatten.
- Motiv weiß, schlicht und flächig wie ein Symbol, keine Akzentfarbe.
- Motivbreite: 45 % im any-Icon, 32 % im maskable-Icon (Android zeigt davon
  einen Kreis mit 40 % Radius, das Motiv bleibt so sicher darin).
- Groß zeichnen und verkleinern, sonst werden die Kanten stufig.

Nur draw_motif() an die App anpassen. Alle Koordinaten und Strichbreiten
stehen in einem Raster von 0 bis 1000, das Programm rechnet sie um.
"""
from pathlib import Path
from PIL import Image, ImageDraw

BG = "#1B1B1B"
FG = "#FFFFFF"
SS = 4  # Überabtastung
OUT = Path(__file__).resolve().parent


def draw_motif(p) -> None:
    """Turm (Rochade-Figur): Zinnenkranz, schmale Taille, breiter Fuß.
    Ein Zug, eine Fläche — als Silhouette auch bei 48 px noch erkennbar."""
    p.polygon([
        (140, 120), (300, 120), (300, 240), (420, 240), (420, 120),
        (580, 120), (580, 240), (700, 240), (700, 120), (860, 120),
        (860, 340), (740, 410), (780, 650), (880, 720), (880, 890),
        (120, 890), (120, 720), (220, 650), (260, 410), (140, 340),
    ], fill=FG)


class Pen:
    """Zeichnet im Raster 0..1000 in das Motiv-Feld der Kantenlänge box."""

    def __init__(self, d, off, box):
        self.d, self.off, self.box = d, off, box

    def _p(self, v):
        return self.off + v / 1000 * self.box

    def _w(self, v):
        return max(1, int(round(v / 1000 * self.box)))

    def ellipse(self, xy, width=None, **kw):
        if width is not None:
            kw["width"] = self._w(width)
        self.d.ellipse([self._p(v) for v in xy], **kw)

    def rounded_rectangle(self, xy, radius=0, width=None, **kw):
        if width is not None:
            kw["width"] = self._w(width)
        self.d.rounded_rectangle([self._p(v) for v in xy], radius=radius / 1000 * self.box, **kw)

    def polygon(self, pts, **kw):
        self.d.polygon([(self._p(x), self._p(y)) for x, y in pts], **kw)

    def line(self, pts, width=40, **kw):
        self.d.line([(self._p(x), self._p(y)) for x, y in pts], width=self._w(width), **kw)


def make(size: int, share: float, name: str) -> None:
    big = size * SS
    img = Image.new("RGB", (big, big), BG)
    box = big * share
    draw_motif(Pen(ImageDraw.Draw(img), (big - box) / 2, box))
    img.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
    print("geschrieben:", OUT / name)


if __name__ == "__main__":
    make(192, 0.45, "icon-192.png")
    make(512, 0.45, "icon-512.png")
    make(512, 0.32, "icon-maskable-512.png")
