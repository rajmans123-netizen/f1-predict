# Builds every driver's optimal lap as a real, drivable trace: for each sector, the lap where they were quickest through
# it, with that lap's car position and speed/throttle/brake (OpenF1 location + car_data, ~3.7 Hz), cut at the sector
# times and stitched into one lap, resampled to 20 Hz.
#   web/data/optimal/<slug>.json : drivers sorted by optimal lap, each with sectors, total, best real lap and the trace
# usage: python3 optimal_lap.py <slug> <session_key> [<session_key> ...]
import json, os, sys, time, urllib.request, urllib.error
from datetime import datetime, timedelta
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
SLUG, KEYS = sys.argv[1], [int(k) for k in sys.argv[2:]]
CACHE = f'{HERE}/raw/optimal/{SLUG}'; os.makedirs(CACHE, exist_ok=True)
OUT = f'{HERE}/web/data/optimal'; os.makedirs(OUT, exist_ok=True)
HZ = 20

def get(path, cache):
    p = f'{CACHE}/{cache}.json'
    if os.path.exists(p): return json.load(open(p))
    for attempt in range(10):
        try:
            with urllib.request.urlopen(f'https://api.openf1.org/v1/{path}', timeout=90) as r: data = json.load(r)
            time.sleep(2.2); json.dump(data, open(p, 'w')); return data
        except urllib.error.HTTPError as e:
            if e.code == 404: time.sleep(2.2); return []
            if e.code == 429: time.sleep(20 + 10 * attempt); continue
            raise
        except Exception: time.sleep(10)
    raise RuntimeError(path)

ts = lambda s: datetime.fromisoformat(s).timestamp()
q = lambda t: datetime.utcfromtimestamp(t).strftime('%Y-%m-%dT%H:%M:%S.%f')
laps = [l for k in KEYS for l in get(f'laps?session_key={k}', f'laps_{k}')]
drivers = {d['driver_number']: d for d in get(f'drivers?session_key={KEYS[-1]}', f'drivers_{KEYS[-1]}')}
out = []
for n, d in drivers.items():
    mine = [l for l in laps if l['driver_number'] == n and l.get('date_start') and not l.get('is_pit_out_lap')
            and all(l.get(f'duration_sector_{i}') for i in (1, 2, 3))]
    if not mine: continue
    pick = [min(mine, key=lambda l: l[f'duration_sector_{i}']) for i in (1, 2, 3)]
    segs, t_off = [], 0.0
    for i, l in enumerate(pick):
        a = ts(l['date_start']) + sum(l[f'duration_sector_{j}'] for j in range(1, i + 1))
        b = a + l[f'duration_sector_{i + 1}']
        tag = f"{l['session_key']}_{n}_{l['lap_number']}"
        lo, hi = q(ts(l['date_start']) - 1), q(ts(l['date_start']) + l['lap_duration'] + 1) if l.get('lap_duration') else q(b + 1)
        loc = get(f"location?session_key={l['session_key']}&driver_number={n}&date%3E={lo}&date%3C={hi}", f'loc_{tag}')
        car = get(f"car_data?session_key={l['session_key']}&driver_number={n}&date%3E={lo}&date%3C={hi}", f'car_{tag}')
        if len(loc) < 10 or len(car) < 10: segs = None; break
        grid = np.arange(a, b, 1 / HZ)
        lt = np.array([ts(p['date']) for p in loc]); ct = np.array([ts(p['date']) for p in car])
        seg = dict(t=grid - a + t_off,
                   x=np.interp(grid, lt, [p['x'] for p in loc]), y=np.interp(grid, lt, [p['y'] for p in loc]),
                   v=np.interp(grid, ct, [p['speed'] for p in car]), thr=np.interp(grid, ct, [p['throttle'] for p in car]),
                   brk=np.interp(grid, ct, [p['brake'] for p in car]), gear=np.interp(grid, ct, [p['n_gear'] for p in car]))
        segs.append(seg); t_off += b - a
    if not segs: continue
    tr = {k: np.concatenate([s[k] for s in segs]) for k in segs[0]}
    best = min(l['lap_duration'] for l in mine if l.get('lap_duration'))
    out.append(dict(n=n, code=d['name_acronym'], name=d['full_name'].title(), team=d['team_name'], color='#' + (d.get('team_colour') or '888888'),
                    sectors=[round(p[f'duration_sector_{i + 1}'], 3) for i, p in enumerate(pick)], total=round(t_off, 3), best=round(best, 3),
                    trace=dict(t=[round(v, 2) for v in tr['t']], x=[int(v) for v in tr['x']], y=[int(v) for v in tr['y']], v=[int(v) for v in tr['v']],
                               thr=[int(v) for v in tr['thr']], brk=[int(v > 0) for v in tr['brk']], gear=[int(round(v)) for v in tr['gear']])))
    print(f"{d['name_acronym']}  optimal {t_off:.3f}  best {best:.3f}  left {best - t_off:+.3f}", flush=True)
out.sort(key=lambda r: r['total'])
s0 = get(f'sessions?session_key={KEYS[0]}', f'session_{KEYS[0]}')[0]
json.dump(dict(slug=SLUG, sessions=KEYS, location=s0['location'], drivers=out), open(f'{OUT}/{SLUG}.json', 'w'), separators=(',', ':'))
print('saved', len(out), 'drivers')
