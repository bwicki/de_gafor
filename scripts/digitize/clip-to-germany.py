#!/usr/bin/env python3
"""GAFOR-Gebiete auf Deutschland (plus offene See) zuschneiden.

Die Polygone sind von der DFS-Karte abdigitalisiert. Deren Gebietsgrenzen sind
grosszügig gezeichnet und laufen stellenweise über die Staatsgrenze hinaus — im
Oberrheingraben etwa bis Strassburg und Basel. Für die App ist das falsch: sie
behauptet, nur Deutschland abzudecken, und die Karte graut alles ausserhalb der
Gebiete ab. Also wird geschnitten.

Erlaubt bleibt:
  * Deutschland laut Natural Earth, um 2,5 km nach aussen gepuffert (die
    Digitalisierung ist auf etwa ±2 km genau, ein Startplatz direkt an der
    Grenze soll nicht herausfallen)
  * offene See — alles, was in keinem Landpolygon liegt. Sonst verlöre Gebiet 00
    "Deutsche Bucht" seine Fläche.

Eingabe   data/gafor-areas.geojson  (wird überschrieben)
          ein Natural-Earth-Länderdatensatz, Pfad als Argument
Ausgabe   dieselbe Datei, zugeschnitten; danach build-boundaries.py laufen lassen

  python3 scripts/digitize/clip-to-germany.py /tmp/ne_10m_admin_0_countries.geojson

Natural Earth ist gemeinfrei (public domain), es wird ohnehin nichts davon
mitgeliefert — nur das Schnittergebnis.
"""
import json
import sys
from pathlib import Path

from shapely.geometry import shape, mapping, box
from shapely.ops import unary_union

AREAS = Path("data/gafor-areas.geojson")
BBOX = box(3.0, 44.5, 18.0, 58.0)      # Deutschland mit reichlich Rand
BUFFER_DEG = 0.025                      # ~2,5 km in der Breite, ~1,7 km in der Länge
ROUND = 4


def load_countries(path):
    fc = json.loads(Path(path).read_text())
    germany, land = None, []
    for f in fc["features"]:
        p = f["properties"]
        iso = p.get("ISO_A3") or p.get("ADM0_A3") or ""
        g = shape(f["geometry"])
        if not g.intersects(BBOX):
            continue
        g = g.intersection(BBOX)
        if g.is_empty:
            continue
        land.append(g)
        if iso == "DEU" or p.get("NAME") == "Germany":
            germany = g
    if germany is None:
        sys.exit("Deutschland im Länderdatensatz nicht gefunden")
    return germany, unary_union(land)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    germany, land = load_countries(sys.argv[1])
    sea = BBOX.difference(land)
    allowed = unary_union([germany.buffer(BUFFER_DEG), sea]).buffer(0)

    fc = json.loads(AREAS.read_text())
    kept, changed, dropped = 0, 0, []
    for f in fc["features"]:
        g = shape(f["geometry"])
        before = g.area
        clipped = g.intersection(allowed).buffer(0)
        if clipped.is_empty or clipped.area < before * 0.02:
            dropped.append(f["properties"]["id"])
            continue
        if clipped.geom_type == "GeometryCollection":
            polys = [p for p in clipped.geoms if p.geom_type in ("Polygon", "MultiPolygon")]
            clipped = unary_union(polys)
        # Splitter wegwerfen: Inseln unter 1 % der Gebietsfläche sind Schnittartefakte
        if clipped.geom_type == "MultiPolygon":
            parts = [p for p in clipped.geoms if p.area > clipped.area * 0.01]
            if parts:
                clipped = unary_union(parts)
        clipped = clipped.simplify(0.0004)
        if abs(clipped.area - before) > before * 0.001:
            changed += 1
        f["geometry"] = json.loads(json.dumps(mapping(clipped)))
        kept += 1

    if dropped:
        print(f"! ganz entfallen: {', '.join(dropped)}")
    txt = json.dumps(fc)
    # Koordinaten auf vier Nachkommastellen, das sind gut 10 m
    import re
    txt = re.sub(r"(-?\d+\.\d{5,})", lambda m: f"{float(m.group(1)):.{ROUND}f}", txt)
    AREAS.write_text(txt)
    print(f"{kept} Gebiete geschrieben, {changed} davon beschnitten, "
          f"{AREAS.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
