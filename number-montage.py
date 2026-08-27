#!/usr/bin/env python3
"""Montage of the printed area number of every blob, tagged with its blob index.
Reading this one sheet gives the blob -> GAFOR number table without guessing."""
import json
import numpy as np, cv2

im = cv2.imread('maps/dfs.jpg')
g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
regs = json.load(open('/tmp/dfs_regions.json'))
lab = np.load('/tmp/dfs_labels.npy')

mx = im.max(2).astype(int); mn = im.min(2).astype(int)
black = ((g < 115) & (mx - mn < 55)).astype(np.uint8)
nc, cl, st, cc = cv2.connectedComponentsWithStats(black, 8)
glyphs = [{'i': i, 'x': st[i, 0], 'y': st[i, 1], 'w': st[i, 2], 'h': st[i, 3], 'c': cc[i]}
          for i in range(1, nc)
          if 16 <= st[i, 3] <= 34 and 6 <= st[i, 2] <= 30
          and 60 < st[i, 4] < st[i, 2] * st[i, 3] * 0.92 and st[i, 4] > 0.30 * st[i, 2] * st[i, 3]
          and 0.28 <= st[i, 2] / st[i, 3] <= 0.92]

cells = []
for o in regs:
    raw = (lab == o['label']).astype(np.uint8)
    cnts, _ = cv2.findContours(raw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    m = np.zeros_like(raw); cv2.drawContours(m, cnts, -1, 1, cv2.FILLED)
    ins = [gl for gl in glyphs if m[int(gl['c'][1]), int(gl['c'][0])]]
    if ins:
        hmax = max(gl['h'] for gl in ins)
        line = [gl for gl in ins if gl['h'] >= hmax - 3]
        ymed = np.median([gl['y'] for gl in line])
        line = [gl for gl in line if abs(gl['y'] - ymed) < 12] or line
        x0 = min(gl['x'] for gl in line) - 6; x1 = max(gl['x'] + gl['w'] for gl in line) + 6
        y0 = min(gl['y'] for gl in line) - 6; y1 = max(gl['y'] + gl['h'] for gl in line) + 6
    else:
        cx, cy = o['center_px']
        x0, x1, y0, y1 = int(cx) - 46, int(cx) + 46, int(cy) - 26, int(cy) + 26
    x0, y0 = max(0, x0), max(0, y0)
    crop = im[y0:y1, x0:x1]
    if crop.size == 0:
        crop = np.full((30, 60, 3), 255, np.uint8)
    h = 46
    crop = cv2.resize(crop, (max(20, int(crop.shape[1] * h / crop.shape[0])), h),
                      interpolation=cv2.INTER_CUBIC)
    cells.append((o['blob'], crop, bool(ins)))

COLS = 7
CW, CH = 190, 82
rows = (len(cells) + COLS - 1) // COLS
sheet = np.full((rows * CH + 10, COLS * CW + 10, 3), 255, np.uint8)
for idx, (bid, crop, has) in enumerate(cells):
    r, c = divmod(idx, COLS)
    ox, oy = 5 + c * CW, 5 + r * CH
    cv2.putText(sheet, f'#{bid}' + ('' if has else ' ?'), (ox + 4, oy + 22),
                cv2.FONT_HERSHEY_SIMPLEX, 0.62, (200, 0, 200), 2, cv2.LINE_AA)
    ch, cw = crop.shape[:2]
    cw = min(cw, CW - 70)
    sheet[oy + 28:oy + 28 + ch, ox + 4:ox + 4 + cw] = crop[:, :cw]
    cv2.rectangle(sheet, (ox, oy), (ox + CW - 8, oy + CH - 8), (210, 210, 210), 1)
cv2.imwrite('/tmp/montage.png', sheet)
print(f'{len(cells)} Zellen, {rows} Reihen -> /tmp/montage.png  {sheet.shape}')
