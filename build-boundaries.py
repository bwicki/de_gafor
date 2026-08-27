#!/usr/bin/env python3
"""Aus den Gebietspolygonen die beiden übergeordneten Umrisse ableiten:

    data/gafor-regions.geojson   die fünf GAFOR-Bereiche (Vereinigung ihrer Gebiete)
    data/germany.geojson         die Landesgrenze, vereinfacht

Beides nur für die Darstellung — die Gebietszuordnung rechnet weiter mit
gafor-areas.geojson.

    python3 scripts/digitize/build-boundaries.py
"""
import json
from pathlib import Path

from shapely.geometry import shape, mapping
from shapely.ops import unary_union

AREAS = Path('data/gafor-areas.geojson')
META = Path('data/gafor-meta.json')
REF = Path('/tmp/deutschlandGeoJSON/1_deutschland/3_mittel.geo.json')
OUT_REGIONS = Path('data/gafor-regions.geojson')
OUT_GERMANY = Path('data/germany.geojson')

TOL = 0.004          # ≈ 300 m — genug fürs Zeichnen, spart Dateigrösse


def rounded(geom, nd=4):
    def r(c):
        if isinstance(c[0], (int, float)):
            return [round(c[0], nd), round(c[1], nd)]
        return [r(x) for x in c]
    g = mapping(geom)
    g['coordinates'] = r(g['coordinates'])
    return g


def main():
    fc = json.loads(AREAS.read_text('utf8'))
    meta = json.loads(META.read_text('utf8'))
    names = {k: v.get('name', k) for k, v in meta['regions'].items()}

    groups = {}
    for f in fc['features']:
        reg = f['properties'].get('region') or 'ohne'
        groups.setdefault(reg, []).append(shape(f['geometry']).buffer(0))

    feats = []
    for reg, geoms in groups.items():
        merged = unary_union(geoms).buffer(0.002).buffer(-0.002)   # Fugen schliessen
        merged = merged.simplify(TOL, preserve_topology=True)
        feats.append({
            'type': 'Feature',
            'properties': {'region': reg, 'name': names.get(reg, reg),
                           'areas': sorted(f['properties']['id'] for f in fc['features']
                                           if f['properties'].get('region') == reg)},
            'geometry': rounded(merged),
        })
        print(f'  Bereich {names.get(reg, reg):6s} {len(geoms):2d} Gebiete')

    OUT_REGIONS.write_text(json.dumps(
        {'type': 'FeatureCollection', 'name': 'GAFOR-Bereiche',
         'note': 'Vereinigung der Gebiete je Bereich, nur zur Darstellung',
         'features': feats}, ensure_ascii=False, separators=(',', ':')), 'utf8')
    print(f'{OUT_REGIONS} — {OUT_REGIONS.stat().st_size // 1024} KB')

    ref = json.loads(REF.read_text('utf8'))
    land = unary_union([shape(f['geometry']).buffer(0) for f in ref['features']])
    land = land.simplify(TOL, preserve_topology=True)
    OUT_GERMANY.write_text(json.dumps(
        {'type': 'FeatureCollection', 'name': 'Deutschland',
         'source': 'https://github.com/isellsoap/deutschlandGeoJSON (3_mittel), vereinfacht',
         'features': [{'type': 'Feature', 'properties': {'name': 'Deutschland'},
                       'geometry': rounded(land)}]}, ensure_ascii=False, separators=(',', ':')), 'utf8')
    print(f'{OUT_GERMANY} — {OUT_GERMANY.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
