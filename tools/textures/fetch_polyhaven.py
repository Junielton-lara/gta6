"""Baixa texturas CC0 do Poly Haven e reduz para 512 px (orçamento de memória da Android TV).

Uso: python tools/textures/fetch_polyhaven.py
Licença das texturas: CC0 (https://polyhaven.com/license). Créditos em apps/game/public/ATTRIBUTION.txt.
"""

import io
import pathlib
import urllib.request

from PIL import Image

OUT = pathlib.Path(__file__).resolve().parents[2] / "apps/game/public/textures"
SIZE = 512

# slug Poly Haven -> nome local
SET = {
    "asphalt_02": "asphalt",
    "concrete_pavement": "sidewalk",
    "plastered_wall_02": "plaster",
    "leafy_grass": "grass",
    "concrete_tile_facade": "facade_tiles",
    "brick_pavement_02": "brick",
}
MAPS = {"diff": "diff", "nor_gl": "nor"}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "CuritibaOpenWorld/0.1"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for slug, name in SET.items():
        for remote, local in MAPS.items():
            url = f"https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/{slug}/{slug}_{remote}_1k.jpg"
            img = Image.open(io.BytesIO(fetch(url))).convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
            dest = OUT / f"{name}_{local}.jpg"
            img.save(dest, "JPEG", quality=82, optimize=True, progressive=False)
            print(f"{slug:24s} {remote:7s} -> {dest.name} ({dest.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
