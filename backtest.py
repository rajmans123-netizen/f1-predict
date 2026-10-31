# Backtests the prediction blend on past 2026 weekends (cached in raw_weekend/ by predict.py, results in pitwall/raw_season).
# Compares the old blend (ranks; a driver with no laps ranked last) with the new one (real time gaps turned into
# "positions", a missing signal simply left out) after FP1, after all practice, and after qualifying.
# usage: python3 backtest.py
import json, glob, os, statistics, itertools
HERE = os.path.dirname(os.path.abspath(__file__)); RAW = f'{HERE}/../pitwall/raw_season'
races = sorted(((json.load(open(d + 'session.json')), json.load(open(d + 'result.json'))) for d in glob.glob(f'{RAW}/*/')), key=lambda x: x[0]['date_start'])

def form_before(date):
    f = {}; past = [(s, r) for s, r in races if r and s['date_start'] < date]
    for k, (s, res) in enumerate(past):
        w = 1 + 2 * k / max(1, len(past) - 1)
        for r in res:
            pos = r['position'] if r.get('position') and not (r.get('dnf') or r.get('dns') or r.get('dsq')) else 20
            f.setdefault(r['driver_number'], []).append((pos, w))
    return {n: sum(p * w for p, w in v) / sum(w for _, w in v) for n, v in f.items()}

def race_pace(d):
    """each team's race pace in one race: the mean of its cars' median clean laps (no lap 1, no pit in/out laps,
    no slow laps such as safety cars: within 107% of the car's own median), as % off the fastest team"""
    laps = json.load(open(d + 'laps.json')); team = {x['driver_number']: x['team_name'] for x in json.load(open(d + 'drivers.json'))}
    pits = {(p['driver_number'], p.get('lap_number')) for p in json.load(open(d + 'pit.json'))}
    med = {}
    for n in team:
        ts = [l['lap_duration'] for l in laps if l['driver_number'] == n and l.get('lap_duration') and l['lap_number'] > 1
              and not l.get('is_pit_out_lap') and (n, l['lap_number']) not in pits]
        if len(ts) < 10: continue
        m = statistics.median(ts); ts = [t for t in ts if t < m * 1.07]
        med[n] = statistics.median(ts)
    tm = {}
    for n, m in med.items(): tm.setdefault(team[n], []).append(m)
    tm = {k: statistics.mean(v) for k, v in tm.items()}
    if not tm: return {}
    best = min(tm.values()); return {k: 100 * (v / best - 1) for k, v in tm.items()}
RACE_DIRS = sorted(glob.glob(f'{RAW}/*/'), key=lambda d: json.load(open(d + 'session.json'))['date_start'])
PACE = [(json.load(open(d + 'session.json'))['date_start'], race_pace(d)) for d in RACE_DIRS if json.load(open(d + 'laps.json'))]
def car_before(date):
    past = [(t, p) for t, p in PACE if t < date and p]
    out = {}
    for k, (t, p) in enumerate(past):
        w = 1 + 3 * k / max(1, len(past) - 1)                      # upgrades: recent races count up to 4x
        for team, g in p.items(): out.setdefault(team, []).append((g, w))
    return {k: sum(g * w for g, w in v) / sum(w for _, w in v) for k, v in out.items()}

def stats(laps, drivers):
    out = {}
    for n in drivers:
        mine = sorted((l for l in laps if l['driver_number'] == n and l.get('lap_duration')), key=lambda l: l['lap_number'])
        if not mine: continue
        best = min(l['lap_duration'] for l in mine)
        secs = [[l.get(f'duration_sector_{i}') for l in mine if not l.get('is_pit_out_lap') and l.get(f'duration_sector_{i}')] for i in (1, 2, 3)]
        opt = min(sum(min(x) for x in secs), best) if all(secs) else best
        runs, cur = [], []
        for l in mine:
            ok = not l.get('is_pit_out_lap') and l['lap_duration'] < best * 1.07
            if ok and cur and l['lap_number'] == cur[-1]['lap_number'] + 1: cur.append(l)
            else:
                if len(cur) >= 5: runs.append(cur)
                cur = [l] if ok else []
        if len(cur) >= 5: runs.append(cur)
        out[n] = dict(opt=opt, long=statistics.median(l['lap_duration'] for l in max(runs, key=len)) if runs else None)
    return out

weekends = []
for m in sorted(os.listdir(f'{HERE}/raw_weekend')):
    d = f'{HERE}/raw_weekend/{m}'
    sess = json.load(open(f'{d}/sessions.json')); race = next((s for s in sess if s['session_name'] == 'Race'), None)
    res = next((r for s, r in races if race and s['session_key'] == race['session_key']), None)
    if not res: continue
    actual = {r['driver_number']: r['position'] for r in res if r.get('position')}
    drivers = list({r['driver_number'] for r in res})
    prac = [s for s in sorted(sess, key=lambda s: s['date_start']) if s['session_name'].startswith('Practice') and os.path.exists(f"{d}/laps_{s['session_key']}.json")]
    st = [stats(json.load(open(f"{d}/laps_{s['session_key']}.json")), drivers) for s in prac]
    q = f'{d}/quali_result.json'
    grid = {r['driver_number']: r['position'] for r in json.load(open(q)) if isinstance(r.get('position'), int)} if os.path.exists(q) else {}
    teams = {x['driver_number']: x['team_name'] for x in json.load(open(f'{d}/drivers.json'))}
    car = car_before(sess[0]['date_start'])
    weekends.append(dict(m=m, actual=actual, drivers=drivers, form=form_before(sess[0]['date_start']), prac=st, grid=grid,
                         car={n: car.get(teams.get(n)) for n in drivers}))

def merged(ws, k):
    out = {}
    for s in ws['prac'][:k]:
        for n, v in s.items():
            a = out.setdefault(n, dict(opt=None, long=None))
            for key in ('opt', 'long'):
                if v[key] and (a[key] is None or v[key] < a[key]): a[key] = v[key]
    return out

def predict_old(ws, k, use_grid, W):
    st = merged(ws, k); ns = ws['drivers']
    def ranks(vals):
        have = sorted((float(v), n) for n, v in vals.items() if isinstance(v, (int, float))); r = {n: i + 1 for i, (v, n) in enumerate(have)}
        for n in vals: r.setdefault(n, len(vals))
        return r
    R = dict(form=ranks({n: ws['form'].get(n) for n in ns}), one=ranks({n: st.get(n, {}).get('opt') for n in ns}),
             long=ranks({n: st.get(n, {}).get('long') for n in ns}), grid=ranks({n: ws['grid'].get(n) for n in ns}))
    return sorted(ns, key=lambda n: sum(w * R[c][n] for c, w in W.items()))

def predict_new(ws, k, use_grid, W, K1, K2, KC=6):
    st = merged(ws, k); ns = ws['drivers']
    o = [v['opt'] for v in st.values() if v['opt']]; l = [v['long'] for v in st.values() if v['long']]
    b1, b2 = (min(o) if o else None), (min(l) if l else None)
    def score(n):
        sig = {'form': ws['form'].get(n, 15)}
        if ws['car'].get(n) is not None: sig['car'] = 1 + ws['car'][n] * KC              # 1% race pace off the best car ~ KC places
        v = st.get(n, {})
        if v.get('opt') and b1: sig['one'] = 1 + min(2.0, v['opt'] - b1) * K1          # a second off the best ~ K1 places
        if v.get('long') and b2: sig['long'] = 1 + min(3.0, v['long'] - b2) * K2
        if use_grid and n in ws['grid']: sig['grid'] = ws['grid'][n]
        ww = {c: w for c, w in W.items() if c in sig and w > 0}
        return sum(ww[c] * sig[c] for c in ww) / sum(ww.values()) if ww else sig['form']
    return sorted(ns, key=score)

def evaluate(fn):
    err, pod, win, n = [], 0, 0, 0
    for ws in weekends:
        order = fn(ws)
        if order is None: continue
        real = sorted(ws['actual'], key=ws['actual'].get)
        err += [abs(i + 1 - ws['actual'][d]) for i, d in enumerate(order) if d in ws['actual']]
        pod += len(set(order[:3]) & set(real[:3])); win += order[0] == real[0]; n += 1
    return round(sum(err) / len(err), 2), win, pod, n

print('weekends:', [w['m'] for w in weekends])
print('car race pace before Mexico (% off the best):', {k: round(v, 2) for k, v in sorted(car_before('2026-10-30').items(), key=lambda x: x[1])})
print('form only               ', evaluate(lambda ws: sorted(ws['drivers'], key=lambda n: ws['form'].get(n, 15))))
for KC in (4, 6, 8):
    for wf, wc in [(0.5, 0.5), (0.6, 0.4), (0.4, 0.6), (0.7, 0.3)]:
        print(f'before weekend: form {wf} car {wc} KC {KC}', evaluate(lambda ws: predict_new(ws, 0, False, dict(form=wf, car=wc), 8, 3, KC)))
for k, label in [(1, 'after FP1'), (3, 'after all practice')]:
    print(f'-- {label}')
    print('  old (ranks, missing = last) ', evaluate(lambda ws: predict_old(ws, k, False, dict(form=0.6, one=0.3, long=0.1)) if len(ws['prac']) >= k else None))
    best = []
    for wf, wc, wo, wl, K1 in itertools.product([0.3, 0.4, 0.5, 0.6], [0, 0.2, 0.3, 0.4], [0.1, 0.2, 0.3], [0, 0.1], [5, 8, 12]):
        W = dict(form=wf, car=wc, one=wo, long=wl)
        e = evaluate(lambda ws: predict_new(ws, k, False, W, K1, 3, 6) if len(ws['prac']) >= k else None)
        best.append((e[0], -e[2], (wf, wc, wo, wl, K1), e))
    best.sort()
    for b in best[:3]: print('  new', b[2], b[3])
print('-- after qualifying')
print('  old                         ', evaluate(lambda ws: predict_old(ws, 3, True, dict(grid=0.6, form=0.3, long=0.1)) if ws['grid'] else None))
print('  grid only                   ', evaluate(lambda ws: sorted(ws['drivers'], key=lambda n: ws['grid'].get(n, 22)) if ws['grid'] else None))
best = []
for wg, wf, wc in itertools.product([0.4, 0.5, 0.6, 0.7], [0, 0.1, 0.2, 0.3], [0, 0.1, 0.2, 0.3]):
    W = dict(grid=wg, form=wf, car=wc)
    e = evaluate(lambda ws: predict_new(ws, 3, True, W, 8, 3, 6) if ws['grid'] else None)
    best.append((e[0], -e[2], (wg, wf, wc), e))
best.sort()
for b in best[:3]: print('  new', b[2], b[3])
