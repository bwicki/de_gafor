#!/usr/bin/env python3
"""Cut the GAFOR areas out of the DFS map and turn them into WGS84 polygons.

Two things close the area outlines: the black lines printed on the map, and the
real German border rasterised through the fitted projection. The map draws the
national border and the coast in light grey, so without that second barrier the
border areas leak into the neighbours and the sea.
"""
import json, sys
import numpy as np, cv2

im = cv2.imread('maps/dfs.jpg')
g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
H, W = g.shape
L, R, T, B = 96, 1048, 106, 1528
M = json.load(open('/home/claude/conic.json'))
x0, y0, r50, k, n, lon0 = (M['x0'], M['y0'], M['r50'], M['k'], M['n'], M['lon0'])
nr = n * np.pi / 180

THR = int(sys.argv[1]) if len(sys.argv) > 1 else 110
MIN_AREA = int(sys.argv[2]) if len(sys.argv) > 2 else 300


def to_px(lon, lat):
    r = r50 + k * (50 - lat)
    th = nr * (lon - lon0)
    return x0 + r * np.sin(th), y0 + r * np.cos(th)


def to_geo(px, py):
    r = np.hypot(px - x0, py - y0)
    lat = 50 - (r - r50) / k
    lon = np.degrees(np.arctan2(px - x0, py - y0)) / n + lon0
    return float(lon), float(lat)


# --- barrier: the real German border, drawn through the same projection ---
ref = json.load(open('/tmp/deutschlandGeoJSON/1_deutschland/2_hoch.geo.json'))
geom = ref['features'][0]['geometry']
polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
border = np.zeros_like(g, np.uint8)
land = np.zeros_like(g, np.uint8)
for poly in polys:
    for j, ring in enumerate(poly):
        pts = np.array([to_px(lo, la) for lo, la in ring], np.int32)
        cv2.polylines(border, [pts], True, 255, 2, cv2.LINE_8)
        cv2.fillPoly(land, [pts], 255 if j == 0 else 0)

inside = np.zeros_like(g, np.uint8)
inside[T + 3:B - 2, L + 3:R - 2] = 1

black = ((g < THR) & (inside > 0)).astype(np.uint8)
black = cv2.morphologyEx(black, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
black = np.maximum(black, (border > 0).astype(np.uint8) * (inside > 0))

free = ((inside > 0) & (black == 0)).astype(np.uint8)
nlab, lab, st, cc = cv2.connectedComponentsWithStats(free, 4)
regs = [(i, cc[i], int(st[i, cv2.CC_STAT_AREA])) for i in range(1, nlab)
        if st[i, cv2.CC_STAT_AREA] >= MIN_AREA]


def touches(i):
    m = lab == i
    return bool(m[T + 4, :].any() or m[B - 4, :].any() or m[:, L + 4].any() or m[:, R - 4].any())


kept = [r for r in regs if not touches(r[0])]
kept.sort(key=lambda r: -r[2])
print(f'Schwelle {THR}, Mindestfläche {MIN_AREA}: {len(regs)} Flächen, {len(kept)} nach Randfilter')
print('Grössen:', [r[2] for r in kept])

vis = im.copy()
rng = np.random.default_rng(3)
out = []
for idx, (i, c, a) in enumerate(kept, 1):
    m = (lab == i).astype(np.uint8) * 255
    m = cv2.dilate(m, np.ones((3, 3), np.uint8))
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cnt = max(cnts, key=cv2.contourArea)
    poly = cv2.approxPolyDP(cnt, 1.5, True).reshape(-1, 2)
    out.append({'blob': idx, 'label': int(i), 'pixelArea': a,
                'center_px': [float(c[0]), float(c[1])],
                'center': list(to_geo(float(c[0]), float(c[1])))[::-1],
                'ring': [to_geo(float(x), float(y)) for x, y in poly]})
    col = rng.integers(40, 235, 3)
    vis[lab == i] = (0.42 * col + 0.58 * vis[lab == i]).astype(np.uint8)

for o in out:
    x, y = o['center_px']
    for th, col in ((4, (255, 255, 255)), (1, (0, 0, 200))):
        cv2.putText(vis, str(o['blob']), (int(x) - 11, int(y) + 23),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, col, th, cv2.LINE_AA)

cv2.imwrite('/tmp/dfs_seg.png', vis)
json.dump(out, open('/tmp/dfs_regions.json', 'w'))
np.save('/tmp/dfs_labels.npy', lab)
print('Kontrollbild /tmp/dfs_seg.png')
