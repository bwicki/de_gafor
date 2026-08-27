#!/usr/bin/env python3
"""Final step: grow the identified area cores across the printed map by
watershed, so every point inside Germany belongs to exactly one GAFOR area,
then write data/gafor-areas.geojson.

Segmentation alone leaves gaps where a boundary line is broken; watershed uses
the same lines as ridges but always fills the whole map, which is what a lookup
needs — no holes, no overlaps.
"""
import json
import numpy as np, cv2

MAP = 'maps/dfs.jpg'
THR = 130

# blob (from extract_dfs.py, THR=130, MIN_AREA=1800) -> GAFOR area number,
# read off the printed numbers in /tmp/montage.png
BLOB2ID = {
    1: '14', 2: '07', 3: '00', 4: '43', 5: '06', 6: '74', 7: '05', 8: '13',
    9: '22', 10: '10', 11: '24', 12: '72', 13: '44', 14: '61', 15: '62',
    16: '03', 17: '56', 18: '04', 19: '37', 20: '82', 21: '54', 22: '15',
    23: '11', 24: '17', 25: '32', 26: '20', 27: '36', 28: '01', 29: '55',
    30: '02', 32: '23', 33: '28', 34: '19', 35: '46', 37: '53', 38: '57',
    39: '58', 40: '27', 41: '45', 42: '33', 44: '25', 45: '08', 46: '18',
    47: '12', 48: '76', 49: '39', 50: '26', 51: '41', 52: '63', 53: '21',
    54: '75', 55: '16', 56: '47', 57: '73', 58: '09', 59: '84', 60: '81',
    61: '42', 62: '51', 63: '35', 64: '64', 68: '50', 70: '34',
}
# areas whose core the segmentation lost (a broken boundary let them leak into
# the surround): seeded by hand at a point that is unambiguously inside them
EXTRA_SEED = {
    '31': (51.33, 6.57),    # Krefeld
    '38': (50.38, 7.55),    # Koblenz, im Neuwieder Becken
    '52': (49.22, 8.80),    # Kraichgau bei Sinsheim
    '71': (47.78, 9.61),    # Ravensburg
    '83': (47.41, 10.28),   # Oberstdorf
}

im = cv2.imread(MAP)
g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
L, R, T, B = 96, 1048, 106, 1528
M = json.load(open('/home/claude/conic.json'))
x0, y0, r50, k, n, lon0 = (M['x0'], M['y0'], M['r50'], M['k'], M['n'], M['lon0'])
nr = n * np.pi / 180


def to_px(lon, lat):
    r = r50 + k * (50 - lat)
    th = nr * (lon - lon0)
    return x0 + r * np.sin(th), y0 + r * np.cos(th)


def to_geo(px, py):
    r = np.hypot(px - x0, py - y0)
    return (float(np.degrees(np.arctan2(px - x0, py - y0)) / n + lon0),
            float(50 - (r - r50) / k))


# --- the domain: German land plus the four offshore boxes ----------------
ref = json.load(open('/tmp/deutschlandGeoJSON/1_deutschland/2_hoch.geo.json'))
geom = ref['features'][0]['geometry']
polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
land = np.zeros_like(g)
borderline = np.zeros_like(g)
for poly in polys:
    for j, ring in enumerate(poly):
        pts = np.array([to_px(lo, la) for lo, la in ring], np.int32)
        cv2.fillPoly(land, [pts], 255 if j == 0 else 0)
        cv2.polylines(borderline, [pts], True, 255, 2)

inside = np.zeros_like(g)
inside[T + 3:B - 2, L + 3:R - 2] = 1
black = ((g < THR) & (inside > 0)).astype(np.uint8)
black = cv2.morphologyEx(black, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
barrier = np.maximum(black, (borderline > 0).astype(np.uint8) * (inside > 0))

free = ((inside > 0) & (barrier == 0)).astype(np.uint8)
nl, lab, st, cc = cv2.connectedComponentsWithStats(free, 4)
regs = [(i, cc[i], int(st[i, cv2.CC_STAT_AREA])) for i in range(1, nl)
        if st[i, cv2.CC_STAT_AREA] >= 1800]


def touches(i):
    m = lab == i
    return bool(m[T + 4, :].any() or m[B - 4, :].any() or m[:, L + 4].any() or m[:, R - 4].any())


kept = sorted([r for r in regs if not touches(r[0])], key=lambda r: -r[2])
print(f'{len(kept)} Kerne aus der Segmentierung')

# --- domain for the watershed: land + offshore boxes ---------------------
# every kept region belongs to the map (offshore boxes and the coastal strips
# between the drawn coastline and the real one included), so the domain is the
# real land plus all of them
domain = (land > 0).astype(np.uint8)
for i, c, a in kept:
    domain = np.maximum(domain, (lab == i).astype(np.uint8))
domain = cv2.morphologyEx(domain, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
domain[inside == 0] = 0

# --- markers -------------------------------------------------------------
markers = np.zeros(g.shape, np.int32)
ids = sorted(set(BLOB2ID.values()) | set(EXTRA_SEED))
index = {a: i + 2 for i, a in enumerate(ids)}          # 1 = background
for bid, (i, c, a) in enumerate(kept, 1):
    aid = BLOB2ID.get(bid)
    if not aid:
        continue
    core = cv2.erode((lab == i).astype(np.uint8), np.ones((3, 3), np.uint8))
    if core.sum() < 50:
        core = (lab == i).astype(np.uint8)
    markers[core > 0] = index[aid]
def snap_free(px, py, rmax=24):
    """Nearest pixel that is not on a printed line — a seed on a line would let
    the region flood straight through it."""
    px, py = int(px), int(py)
    if barrier[py, px] == 0:
        return px, py
    for r in range(1, rmax):
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if max(abs(dx), abs(dy)) != r:
                    continue
                x, y = px + dx, py + dy
                if 0 <= y < barrier.shape[0] and 0 <= x < barrier.shape[1] and barrier[y, x] == 0:
                    return x, y
    return px, py


for aid, (la, lo) in EXTRA_SEED.items():
    px, py = snap_free(*to_px(lo, la))
    l = lab[py, px]
    if l > 0 and not touches(l) and st[l, cv2.CC_STAT_AREA] < 20000:
        markers[lab == l] = index[aid]          # the area's own (undersized) region
        print(f'  Gebiet {aid}: Segment mit {st[l, cv2.CC_STAT_AREA]} px als Marker')
    else:
        cv2.circle(markers, (px, py), 4, index[aid], -1)
        print(f'  Gebiet {aid}: Punktmarke bei px({px},{py})')
markers[domain == 0] = 1                                # everything outside is background
markers[barrier > 0] = np.where(markers[barrier > 0] == 1, 1, 0)   # no marker sits on a ridge

print(f'{len(ids)} Gebiete, {len(EXTRA_SEED)} davon von Hand gesetzt')

# --- watershed: the printed lines are the ridges -------------------------
relief = cv2.GaussianBlur(im, (0, 0), 0.7)
ws = markers.copy()
cv2.watershed(relief, ws)

out = {'type': 'FeatureCollection', 'name': 'GAFOR-Gebiete Deutschland',
       'source': 'digitalisiert aus der DFS-Karte "GAFOR-Gebiete / GAFOR Areas", 11 FEB 2021',
       'note': 'Naeherung, nicht fuer navigatorische Zwecke.',
       'features': []}
meta = {a['id']: a for a in json.load(open('gafor/data/gafor-meta.json'))['areas']}
vis = im.copy()
rng = np.random.default_rng(11)
sizes = {}
for aid in ids:
    m = (ws == index[aid]).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    m = cv2.dilate(m, np.ones((3, 3), np.uint8), iterations=2)
    cnts, hier = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        print(f'  ! Gebiet {aid} leer'); continue
    hier = hier[0]
    outer = [(i, c) for i, c in enumerate(cnts) if hier[i][3] < 0]
    outer.sort(key=lambda t: -cv2.contourArea(t[1]))
    big = cv2.contourArea(outer[0][1])
    outer = [t for t in outer if cv2.contourArea(t[1]) >= 200]
    sizes[aid] = int(m.sum())

    def ring_of(c, eps=1.6):
        p = cv2.approxPolyDP(c, eps, True).reshape(-1, 2)
        if len(p) < 3:
            return None
        r = [list(to_geo(float(x), float(y))) for x, y in p]
        r.append(r[0][:])
        return r

    polys_out = []
    for i, c in outer:
        r = ring_of(c)
        if r is None:
            continue
        rings = [r]
        h = hier[i][2]                                   # first child = hole
        while h >= 0:
            if cv2.contourArea(cnts[h]) >= 300:
                rh = ring_of(cnts[h])
                if rh:
                    rings.append(rh)
            h = hier[h][0]
        polys_out.append(rings)
    parts = [c for _, c in outer]
    if not polys_out:
        continue
    md = meta.get(aid, {})
    cx, cy = np.mean(np.vstack(parts).reshape(-1, 2), axis=0)
    lon_c, lat_c = to_geo(float(cx), float(cy))
    out['features'].append({
        'type': 'Feature',
        'properties': {'id': aid, 'name': md.get('name', ''), 'region': md.get('region', ''),
                       'refAltFt': md.get('refAltFt'),
                       'center': [round(lat_c, 4), round(lon_c, 4)]},
        'geometry': ({'type': 'Polygon', 'coordinates': polys_out[0]} if len(polys_out) == 1
                     else {'type': 'MultiPolygon', 'coordinates': polys_out}),
    })
    col = rng.integers(40, 235, 3)
    vis[ws == index[aid]] = (0.45 * col + 0.55 * vis[ws == index[aid]]).astype(np.uint8)
    for th, c2 in ((4, (255, 255, 255)), (1, (0, 0, 190))):
        cv2.putText(vis, aid, (int(cx) - 12, int(cy) + 24), cv2.FONT_HERSHEY_SIMPLEX,
                    0.55, c2, th, cv2.LINE_AA)

json.dump(out, open('gafor/data/gafor-areas.geojson', 'w'), ensure_ascii=False, indent=1)
cv2.imwrite('/tmp/ws.png', vis)
print(f"{len(out['features'])} Gebiete geschrieben")
print('kleinste:', sorted(sizes.items(), key=lambda t: t[1])[:6])
