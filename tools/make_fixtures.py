"""Test photos: test/fixtures/kyoto.jpg (EXIF location: Kyoto, taken 2026-04-03) and plain.jpg (no EXIF).
Run: python3 tools/make_fixtures.py   (needs pillow)"""
from pathlib import Path

from PIL import Image, ImageDraw
from PIL.TiffImagePlugin import IFDRational

OUT = Path(__file__).resolve().parent.parent / "test" / "fixtures"


def dms(x):
    d = int(x); m = int((x - d) * 60); s = round(((x - d) * 60 - m) * 60 * 100)
    return (IFDRational(d, 1), IFDRational(m, 1), IFDRational(s, 100))


def picture(color):
    im = Image.new("RGB", (640, 427), color)
    d = ImageDraw.Draw(im)
    for i in range(0, 640, 40):
        d.line([(i, 0), (i + 160, 427)], fill=(255, 255, 255), width=4)
    return im


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    im = picture((176, 92, 60))
    exif = Image.Exif()
    exif[0x0132] = "2026:04:03 09:12:00"
    exif.get_ifd(0x8769)[0x9003] = "2026:04:03 09:12:00"
    gps = exif.get_ifd(0x8825)
    gps[1], gps[2], gps[3], gps[4] = "N", dms(35.0116), "E", dms(135.7681)
    im.save(OUT / "kyoto.jpg", quality=70, exif=exif)
    picture((70, 100, 140)).save(OUT / "plain.jpg", quality=70)
    print([(f.name, f.stat().st_size) for f in OUT.iterdir()])
