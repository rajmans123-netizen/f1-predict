# Forecasts every driver's Mexico 2026 optimal lap before a car has run, from data:
#   1. Mexico history: the qualifying optimal lap (best S1 + S2 + S3 of anyone) in 2023, 2024 and 2025.
#   2. The 2026 rules (new power units, active aero, smaller cars): measured, not guessed. At every circuit raced in both
#      2025 and 2026, era factor = 2026 qualifying optimal / 2025 qualifying optimal.
#   3. Upgrades: a straight-line fit of that factor against the date through 2026, projected to the Mexico weekend.
#   4. Each driver: their recent-weighted 2026 qualifying gap to the fastest optimal lap (in %).
#   5. The trace: the real 2025 Mexico pole lap (position + speed), time-scaled per sector to each driver's forecast.
# usage: python3 forecast_optimal.py      -> web/data/optimal/mexico-city.json (+ web/data/forecast/mexico-city.json)
import json, os, time, statistics, urllib.request, urllib.error
from datetime import datetime
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); CACHE = f'{HERE}/raw/forecast'; os.makedirs(CACHE, exist_ok=True)
os.makedirs(f'{HERE}/web/data/optimal', exist_ok=True); os.makedirs(f'{HERE}/web/data/forecast', exist_ok=True)
CIRCUIT, SLUG, MEETING, YEAR_NOW, LAP_KM = 'Mexico City', 'mexico-city', 1298, 2026, 4.304

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

def optimal(laps, n=None):
    """best S1 + best S2 + best S3 (of driver n, or of anyone), and the laps they came from"""
    ok = [l for l in laps if (n is None or l['driver_number'] == n) and not l.get('is_pit_out_lap') and all(l.get(f'duration_sector_{i}') for i in (1, 2, 3))]
    if not ok: return None, None
    pick = [min(ok, key=lambda l: l[f'duration_sector_{i}']) for i in (1, 2, 3)]
    return [p[f'duration_sector_{i + 1}'] for i, p in enumerate(pick)], pick

quali = {y: get(f'sessions?year={y}&session_name=Qualifying', f'quali_{y}') for y in (2023, 2024, 2025, 2026)}
key = lambda s: s['circuit_short_name']
# ---- 1. Mexico history
hist = {}
for y in (2023, 2024, 2025):
    s = next((s for s in quali[y] if key(s) == CIRCUIT), None)
    if not s: continue
    sec, _ = optimal(get(f"laps?session_key={s['session_key']}", f"laps_{s['session_key']}"))
    hist[y] = dict(sectors=[round(x, 3) for x in sec], total=round(sum(sec), 3))
    print('Mexico', y, 'quali optimal', round(sum(sec), 3), [round(x, 3) for x in sec])
# ---- 2+3. the 2026 era factor at shared circuits, and its trend through the season
now = time.strftime('%Y-%m-%dT%H:%M:%S+00:00', time.gmtime())
pairs = []
for s26 in sorted(quali[2026], key=lambda s: s['date_start']):
    if s26['date_end'] > now or key(s26) == CIRCUIT: continue
    s25 = next((s for s in quali[2025] if key(s) == key(s26)), None)
    if not s25: continue
    a, _ = optimal(get(f"laps?session_key={s26['session_key']}", f"laps_{s26['session_key']}"))
    b, _ = optimal(get(f"laps?session_key={s25['session_key']}", f"laps_{s25['session_key']}"))
    if not a or not b: continue
    pairs.append((datetime.fromisoformat(s26['date_start']).timestamp(), key(s26), sum(a) / sum(b), [x / y for x, y in zip(a, b)]))
    print(f'{key(s26):<20} 2026/2025 = {sum(a) / sum(b):.4f}')
ts = np.array([p[0] for p in pairs]); fac = np.array([p[2] for p in pairs])
keep = np.abs(fac - np.median(fac)) < 3 * np.median(np.abs(fac - np.median(fac))) + 1e-9   # drop wet/odd sessions
slope, icpt = np.polyfit(ts[keep], fac[keep], 1)
t_mex = datetime.fromisoformat(next(s for s in quali[2026] if key(s) == CIRCUIT)['date_start']).timestamp()
era = float(slope * t_mex + icpt)
print(f'era factor: season median {np.median(fac[keep]):.4f}, trend projected to Mexico {era:.4f} ({len(fac[keep])} circuits)')
base = hist[2025]
pole = [x * era for x in base['sectors']]
# ---- 4. each driver's recent-weighted 2026 qualifying gap (%), from the same qualifying sessions
gaps = {}
q26 = [s for s in sorted(quali[2026], key=lambda s: s['date_start']) if s['date_end'] < now and key(s) != CIRCUIT]
for k, s in enumerate(q26):
    laps = get(f"laps?session_key={s['session_key']}", f"laps_{s['session_key']}")
    best_all, _ = optimal(laps)
    if not best_all: continue
    w = 1 + 3 * k / max(1, len(q26) - 1)                     # the latest qualifying counts 4x the first (upgrades)
    for n in {l['driver_number'] for l in laps}:
        sec, _ = optimal(laps, n)
        if sec and sum(sec) < sum(best_all) * 1.05:          # ignore laps ruined by traffic, rain, crashes
            gaps.setdefault(n, []).append((sum(sec) / sum(best_all) - 1, w))
drivers = {d['driver_number']: d for d in get(f"drivers?session_key={q26[-1]['session_key']}", 'drivers_now')}
# ---- 5. the trace: the 2025 Mexico pole lap
s25 = next(s for s in quali[2025] if key(s) == CIRCUIT)
laps25 = get(f"laps?session_key={s25['session_key']}", f"laps_{s25['session_key']}")
pl = min((l for l in laps25 if l.get('lap_duration') and all(l.get(f'duration_sector_{i}') for i in (1, 2, 3))), key=lambda l: l['lap_duration'])
q = lambda t: datetime.utcfromtimestamp(t).strftime('%Y-%m-%dT%H:%M:%S.%f')
a = datetime.fromisoformat(pl['date_start']).timestamp(); b = a + pl['lap_duration']
loc = get(f"location?session_key={s25['session_key']}&driver_number={pl['driver_number']}&date%3E={q(a - 1)}&date%3C={q(b + 1)}", 'pole25_loc')
car = get(f"car_data?session_key={s25['session_key']}&driver_number={pl['driver_number']}&date%3E={q(a - 1)}&date%3C={q(b + 1)}", 'pole25_car')
lt = np.array([datetime.fromisoformat(p['date']).timestamp() for p in loc]); ct = np.array([datetime.fromisoformat(p['date']).timestamp() for p in car])
real = [pl[f'duration_sector_{i}'] for i in (1, 2, 3)]
grid = np.arange(a, b, 1 / 20)
X = np.interp(grid, lt, [p['x'] for p in loc]); Y = np.interp(grid, lt, [p['y'] for p in loc])
V = np.interp(grid, ct, [p['speed'] for p in car]); THR = np.interp(grid, ct, [p['throttle'] for p in car])
BRK = np.interp(grid, ct, [p['brake'] for p in car]); GEAR = np.interp(grid, ct, [p['n_gear'] for p in car])
u = grid - a; edges = np.cumsum([0] + real)
out = []
entries = [(n, d, sum(x * w for x, w in gaps[n]) / sum(w for _, w in gaps[n])) for n, d in drivers.items() if n in gaps]
# the optimal lap itself: everyone's best sectors, i.e. the forecast pole sectors (gap 0), drawn in purple
entries.append((0, dict(name_acronym='OPT', full_name='The optimal lap', team_name='best S1 + S2 + S3 of anyone', team_colour='A855F7'), 0.0))
for n, d, g in entries:
    sec = [x * (1 + g) for x in pole]
    new_edges = np.cumsum([0] + sec)
    # time-warp the pole lap sector by sector onto this driver's forecast sectors; speeds scale the other way
    tt = np.interp(u, edges, new_edges); vs = np.interp(u, edges[1:].tolist() + [edges[-1] + 1], [r / s for r, s in zip(real, sec)] + [real[-1] / sec[-1]])
    vs = np.interp(u, [(edges[i] + edges[i + 1]) / 2 for i in range(3)], [r / s for r, s in zip(real, sec)])
    out.append(dict(n=n, optimal=n == 0, code=d['name_acronym'], name=d['full_name'].title(), team=d['team_name'], color='#' + (d.get('team_colour') or '888888'),
                    sectors=[round(x, 3) for x in sec], total=round(sum(sec), 3), best=round(sum(sec), 3), gap_pct=round(100 * g, 3),
                    trace=dict(t=[round(v, 2) for v in tt], x=[int(v) for v in X], y=[int(v) for v in Y], v=[int(v) for v in V * vs],
                               thr=[int(v) for v in THR], brk=[int(v > 0) for v in BRK], gear=[int(round(v)) for v in GEAR])))
out.sort(key=lambda r: r['total'])
for r in out[:11]: print(f"{r['code']}  {r['total']:.3f}  (+{r['gap_pct']:.2f}%)")
meta = dict(history=hist, era_factor=round(era, 4), era_median=round(float(np.median(fac[keep])), 4), circuits=[p[1] for p, k in zip(pairs, keep) if k],
            pole_forecast=round(sum(pole), 3), pole_2025_driver=pl['driver_number'], pole_2025_lap=round(pl['lap_duration'], 3))
json.dump(dict(slug=SLUG, kind='forecast', title='MEXICO CITY GP · FORECAST', location=CIRCUIT, lap_km=LAP_KM, meta=meta, drivers=out),
          open(f'{HERE}/web/data/optimal/{SLUG}.json', 'w'), separators=(',', ':'))
json.dump(meta | dict(drivers=[{k: r[k] for k in ('code', 'team', 'color', 'sectors', 'total', 'gap_pct')} for r in out if not r['optimal']]),
          open(f'{HERE}/web/data/forecast/{SLUG}.json', 'w'), indent=1)
print('pole forecast', round(sum(pole), 3), 'from 2025 Mexico optimal', base['total'])
