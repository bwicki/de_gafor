#!/usr/bin/env python3
"""Fit the DFS GAFOR map's conic projection to its printed graticule.

Start from the crossings measured on the frame (parallels 167.19 px apart on the
left edge, meridians 114.5 px apart on the bottom edge), then refine the six
parameters by sliding the rendered graticule until it sits on the printed one.
"""
import json
import numpy as np, cv2
from scipy.optimize import minimize

im = cv2.imread('maps/dfs.jpg')
g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32)
H, W = g.shape
L, R, T, B = 96, 1048, 106, 1528

# --- where the printed graticule is: grey stroke on a bright ground -------
score = np.zeros_like(g)
band = (g >= 140) & (g <= 232)
score[band] = 1.0 - np.abs(g[band] - 190) / 60.0
bright = cv2.blur((g > 236).astype(np.float32), (7, 7))
score *= (bright > 0.25)
score[:T + 2] = 0; score[B - 2:] = 0; score[:, :L + 2] = 0; score[:, R - 2:] = 0
score = cv2.GaussianBlur(score, (0, 0), 1.4)
score /= score.max()
cv2.imwrite('/tmp/stroke.png', (score * 255).astype(np.uint8))

# --- initial guess from the frame measurements ---------------------------
K0 = 167.19                       # px per degree of latitude (left edge ladder)
N0 = 0.79279                      # cone constant
LON0 = 10.5
X0 = 575.75
R50 = 114.5 / (N0 * np.pi / 180) - 3 * K0
Y0 = 1010.6 - R50
p0 = np.array([X0, Y0, R50, K0, N0, LON0])


def sample(p):
    x0, y0, r50, k, n, lon0 = p
    nr = n * np.pi / 180
    tot, cnt = 0.0, 0
    for lat in range(47, 56):
        r = r50 + k * (50 - lat)
        th = nr * (np.arange(62, 149, 1.0) / 10 - lon0)
        xs = x0 + r * np.sin(th); ys = y0 + r * np.cos(th)
        tot += bilinear(xs, ys); cnt += len(xs)
    for lon in range(7, 15):
        th = nr * (lon - lon0)
        r = r50 + k * (50 - np.arange(472, 549, 1.0) / 10)
        xs = x0 + r * np.sin(th); ys = y0 + r * np.cos(th)
        tot += bilinear(xs, ys); cnt += len(xs)
    return tot / cnt


def bilinear(xs, ys):
    xs = np.clip(xs, 0, W - 2); ys = np.clip(ys, 0, H - 2)
    x0i = xs.astype(int); y0i = ys.astype(int)
    fx = xs - x0i; fy = ys - y0i
    v = (g[y0i, x0i] * 0)  # placeholder to keep dtype
    s = score
    return float(np.sum(s[y0i, x0i] * (1 - fx) * (1 - fy) +
                        s[y0i, x0i + 1] * fx * (1 - fy) +
                        s[y0i + 1, x0i] * (1 - fx) * fy +
                        s[y0i + 1, x0i + 1] * fx * fy))


scale = np.array([6.0, 60.0, 60.0, 1.5, 0.02, 0.25])
print(f'Start  Score {sample(p0):.4f}')
res = minimize(lambda q: -sample(p0 + q * scale), np.zeros(6), method='Powell',
               options={'maxiter': 20000, 'xtol': 1e-4, 'ftol': 1e-6})
p = p0 + res.x * scale
print(f'Fit    Score {sample(p):.4f}')
x0, y0, r50, k, n, lon0 = p
print(f'  Apex ({x0:.1f}, {y0:.1f})  r(50°) {r50:.1f}  k {k:.3f} px/°  '
      f'n {n:.5f}  Zentralmeridian {lon0:.4f}°')

nr = n * np.pi / 180
model = {'x0': float(x0), 'y0': float(y0), 'r50': float(r50), 'k': float(k),
         'n': float(n), 'lon0': float(lon0), 'lat0': 50.0,
         'image': 'dfs.jpg', 'size': [W, H], 'score': float(sample(p))}
json.dump(model, open('/home/claude/conic.json', 'w'), indent=1)


def to_px(lon, lat):
    r = r50 + k * (50 - lat)
    th = nr * (lon - lon0)
    return x0 + r * np.sin(th), y0 + r * np.cos(th)


def to_geo(px, py):
    r = np.hypot(px - x0, py - y0)
    lat = 50 - (r - r50) / k
    lon = np.degrees(np.arctan2(px - x0, py - y0)) / n + lon0
    return lon, lat


vis = im.copy()
for lat in range(47, 56):
    q = [to_px(lo / 10, lat) for lo in range(62, 149)]
    cv2.polylines(vis, [np.array(q, np.int32)], False, (0, 0, 255), 1, cv2.LINE_AA)
for lon in range(7, 15):
    q = [to_px(lon, la / 10) for la in range(472, 549)]
    cv2.polylines(vis, [np.array(q, np.int32)], False, (255, 0, 0), 1, cv2.LINE_AA)

CITIES = {'Hamburg': (9.9937, 53.5511), 'Bremen': (8.8017, 53.0793),
          'Hannover': (9.7320, 52.3759), 'Berlin-Schoenefeld': (13.5033, 52.3800),
          'Dresden': (13.7673, 51.1328), 'Leipzig-Halle': (12.2364, 51.4239),
          'Erfurt': (10.9581, 50.9798), 'Frankfurt': (8.5706, 50.0333),
          'Koeln-Bonn': (7.1427, 50.8659), 'Duesseldorf': (6.7668, 51.2895),
          'Saarbruecken': (7.1095, 49.2146), 'Stuttgart': (9.2219, 48.6899),
          'Nuernberg': (11.0780, 49.4987), 'Muenchen': (11.7861, 48.3538),
          'Muenster-Osnabrueck': (7.6848, 52.1346)}
for nme, (lo, la) in CITIES.items():
    x, y = to_px(lo, la)
    cv2.drawMarker(vis, (int(x), int(y)), (0, 170, 0), cv2.MARKER_TILTED_CROSS, 18, 2)
    cv2.putText(vis, nme, (int(x) + 9, int(y) - 6), cv2.FONT_HERSHEY_SIMPLEX,
                0.42, (0, 140, 0), 1, cv2.LINE_AA)
cv2.imwrite('/tmp/grid_fit.png', vis)
print('Kontrollbild /tmp/grid_fit.png')
