# F1 Predict: optimal laps and a predicted finishing order for a race weekend, updated after each session.
#   optimal lap  = a driver's best sector 1 + best sector 2 + best sector 3 in the session (the lap the car has already
#                  shown it can do); "left on the table" = best actual lap - optimal lap
#   long-run pace = median lap of each driver's longest clean run (5+ laps, no pit, within 107% of their best)
#   season form   = recent-weighted average finishing position over the 2026 races so far (raw_season/)
#   car race pace = each team's clean race-lap pace over the 2026 races so far, % off the best car (recent races count more)
#   grid          = qualifying result, once there is one
# v2 (Raj: "Gasly P4 after FP1?"): every signal is a "position-equivalent" built from real gaps (a second off the best lap
# ~ K places, 1% race pace ~ 8 places), not a rank; a driver with no laps in a session (FP1 rookie runs) is judged on the
# other signals instead of being ranked last. Stage weights come from backtest.py (8 weekends, Hungary to Austin).
# usage: python3 predict.py <meeting_key> <slug>      -> web/data/predict/<slug>.json (one entry per stage run so far)
# (refresh the season first: ../pitwall/fetch_season.py)
import json, os, sys, glob, time, statistics, urllib.request, urllib.error
HERE = os.path.dirname(os.path.abspath(__file__)); RAW = f'{HERE}/../pitwall/raw_season'   # the season results Pit Wall already downloads
MEETING, SLUG = int(sys.argv[1]), sys.argv[2]
CACHE = f'{HERE}/raw_weekend/{MEETING}'; os.makedirs(CACHE, exist_ok=True)
OUT = f'{HERE}/web/data/predict'; os.makedirs(OUT, exist_ok=True)

def get(path, cache=None, fresh=False):
    p = f'{CACHE}/{cache}.json' if cache else None
    if p and os.path.exists(p) and not fresh: return json.load(open(p))
    for attempt in range(8):
        try:
            with urllib.request.urlopen(f'https://api.openf1.org/v1/{path}', timeout=60) as r: data = json.load(r)
            time.sleep(2.2)
            if p: json.dump(data, open(p, 'w'))
            return data
        except urllib.error.HTTPError as e:
            if e.code == 404: time.sleep(2.2); return []
            if e.code == 429: time.sleep(20 + 10 * attempt); continue
            raise
    raise RuntimeError(path)

sessions = sorted(get(f'sessions?meeting_key={MEETING}', 'sessions', fresh=True), key=lambda s: s['date_start'])
now = time.strftime('%Y-%m-%dT%H:%M:%S+00:00', time.gmtime())
done = [s for s in sessions if s['date_end'] < now and s['session_name'] != 'Race']
drivers = {d['driver_number']: d for d in get(f"drivers?session_key={sessions[-1]['session_key']}", 'drivers')} or \
          {d['driver_number']: d for d in get(f"drivers?session_key={done[-1]['session_key']}", 'drivers_last')}

# ---- season form: recent-weighted average finish (DNF counts as 20th), races before this weekend only
form = {}
races = sorted(((json.load(open(d + 'session.json')), json.load(open(d + 'result.json'))) for d in glob.glob(f'{RAW}/*/')), key=lambda x: x[0]['date_start'])
races = [(s, r) for s, r in races if r and s['date_start'] < sessions[0]['date_start']]
for k, (s, res) in enumerate(races):
    w = 1 + 2 * k / max(1, len(races) - 1)                                   # the latest races count 3x the first
    for r in res:
        pos = r['position'] if r.get('position') and not (r.get('dnf') or r.get('dns') or r.get('dsq')) else 20
        form.setdefault(r['driver_number'], []).append((pos, w))
form = {n: sum(p * w for p, w in v) / sum(w for _, w in v) for n, v in form.items()}

# ---- car race pace: each team's median clean race lap, % off the best team, recent races weighted up to 4x (upgrades)
def race_pace(d):
    laps = json.load(open(d + 'laps.json')); team = {x['driver_number']: x['team_name'] for x in json.load(open(d + 'drivers.json'))}
    pits = {(p['driver_number'], p.get('lap_number')) for p in json.load(open(d + 'pit.json'))}
    med = {}
    for n in team:
        ts = [l['lap_duration'] for l in laps if l['driver_number'] == n and l.get('lap_duration') and l['lap_number'] > 1
              and not l.get('is_pit_out_lap') and (n, l['lap_number']) not in pits]
        if len(ts) < 10: continue
        m = statistics.median(ts); med[n] = statistics.median([t for t in ts if t < m * 1.07])     # no safety-car laps
    tm = {}
    for n, m in med.items(): tm.setdefault(team[n], []).append(m)
    tm = {k: statistics.mean(v) for k, v in tm.items()}
    best = min(tm.values()) if tm else 1
    return {k: 100 * (v / best - 1) for k, v in tm.items()}
pace = [race_pace(d) for d in sorted(glob.glob(f'{RAW}/*/'), key=lambda d: json.load(open(d + 'session.json'))['date_start'])
        if json.load(open(d + 'session.json'))['date_start'] < sessions[0]['date_start'] and json.load(open(d + 'laps.json'))]
car = {}
for k, p in enumerate(pace):
    w = 1 + 3 * k / max(1, len(pace) - 1)
    for team, g in p.items(): car.setdefault(team, []).append((g, w))
car = {k: sum(g * w for g, w in v) / sum(w for _, w in v) for k, v in car.items()}

def session_stats(s):
    laps = get(f"laps?session_key={s['session_key']}", f"laps_{s['session_key']}")
    out = {}
    for n in drivers:
        mine = sorted((l for l in laps if l['driver_number'] == n and l.get('lap_duration')), key=lambda l: l['lap_number'])
        if not mine: continue
        best = min(l['lap_duration'] for l in mine)
        secs = [[l.get(f'duration_sector_{i}') for l in mine if not l.get('is_pit_out_lap') and l.get(f'duration_sector_{i}')] for i in (1, 2, 3)]
        optimal = sum(min(x) for x in secs) if all(secs) else None
        # long runs: consecutive clean laps within 107% of the best
        runs, cur = [], []
        for l in mine:
            ok = not l.get('is_pit_out_lap') and l['lap_duration'] < best * 1.07
            if ok and cur and l['lap_number'] == cur[-1]['lap_number'] + 1: cur.append(l)
            else:
                if len(cur) >= 5: runs.append(cur)
                cur = [l] if ok else []
        if len(cur) >= 5: runs.append(cur)
        longrun = statistics.median(l['lap_duration'] for l in max(runs, key=len)) if runs else None
        out[n] = dict(best=best, optimal=min(optimal, best) if optimal else best, longrun=longrun, laps=len(mine))
    return out

def ranks(vals):            # {n: value or None} -> {n: rank}; missing values rank last
    have = sorted((float(v), n) for n, v in vals.items() if isinstance(v, (int, float)))
    r = {n: i + 1 for i, (v, n) in enumerate(have)}
    for n in vals:
        r.setdefault(n, len(vals))
    return r

STAGES = []                 # (label, sessions included)
practice = [s for s in done if s['session_name'].startswith('Practice')]
STAGES.append(('Before the weekend', []))
for i in range(len(practice)): STAGES.append((f"After {practice[i]['session_name'].replace('Practice ', 'FP')}", practice[: i + 1]))
quali = next((s for s in done if s['session_name'] == 'Qualifying'), None)
if quali: STAGES.append(('After qualifying', practice + [quali]))

result = dict(slug=SLUG, meeting=MEETING, name=f"{sessions[0]['country_name']} GP {sessions[0]['year']}", race_start=sessions[-1]['date_start'], stages=[])
prev = None
for label, used in STAGES:
    ns = list(drivers)
    st = {}
    for s in used:
        if s['session_name'] == 'Qualifying': continue
        for n, v in session_stats(s).items():
            a = st.setdefault(n, dict(best=None, optimal=None, longrun=None))
            for k in ('best', 'optimal'):
                if v[k] and (a[k] is None or v[k] < a[k]): a[k] = v[k]
            if v['longrun'] and (a['longrun'] is None or v['longrun'] < a['longrun']): a['longrun'] = v['longrun']
    grid = {}
    if quali and quali in used:
        grid = {r['driver_number']: r['position'] for r in get(f"session_result?session_key={quali['session_key']}", 'quali_result') if r.get('position')}
    o = [v['optimal'] for v in st.values() if v.get('optimal')]; l = [v['longrun'] for v in st.values() if v.get('longrun')]
    b1, b2 = (min(o) if o else None), (min(l) if l else None)
    practice_runs = len([s for s in used if s['session_name'] != 'Qualifying'])
    if grid: W, K1 = dict(grid=0.7, form=0.3), 8                                   # backtest: winner right 6 of 8
    elif practice_runs >= 2: W, K1 = dict(form=0.6, one=0.4), 12                    # practice already shows the cars
    elif practice_runs == 1: W, K1 = dict(form=0.3, car=0.3, one=0.3, long=0.1), 5  # one session: lean on car race pace
    else: W, K1 = dict(form=0.6, car=0.4), 8
    def signals(n):
        sig = {'form': form.get(n, 15)}
        tm = drivers[n]['team_name']
        if tm in car: sig['car'] = 1 + car[tm] * 8                                 # 1% race pace off the best car ~ 8 places
        v = st.get(n, {})
        if v.get('optimal') and b1: sig['one'] = 1 + min(2.0, v['optimal'] - b1) * K1
        if v.get('longrun') and b2: sig['long'] = 1 + min(3.0, v['longrun'] - b2) * 3
        if n in grid: sig['grid'] = grid[n]
        return sig
    def score(n):
        sig = signals(n); ww = {c: w for c, w in W.items() if c in sig}
        return sum(ww[c] * sig[c] for c in ww) / sum(ww.values())
    order = sorted(ns, key=lambda n: (score(n), form.get(n, 15)))
    fastest_opt = min((v['optimal'] for v in st.values() if v.get('optimal')), default=None)
    rows = []
    for i, n in enumerate(order):
        d = drivers[n]; v = st.get(n, {})
        rows.append(dict(n=n, code=d['name_acronym'], name=d['full_name'].title(), team=d['team_name'], color='#' + (d.get('team_colour') or '888888'),
                         pos=i + 1, prev=prev.index(n) + 1 if prev else None, form=round(form[n], 1) if n in form else None,
                         best=round(v['best'], 3) if v.get('best') else None, optimal=round(v['optimal'], 3) if v.get('optimal') else None,
                         left=round(v['best'] - v['optimal'], 3) if v.get('best') and v.get('optimal') else None,
                         gap=round(v['optimal'] - fastest_opt, 3) if v.get('optimal') and fastest_opt else None,
                         longrun=round(v['longrun'], 3) if v.get('longrun') else None, grid=grid.get(n),
                         car=round(car[d['team_name']], 2) if d['team_name'] in car else None))
    result['stages'].append(dict(label=label, weights=W, rows=rows))
    prev = order
    print(label, ' '.join(r['code'] for r in rows[:10]), '…')
# a prediction, once published, is history: keep frozen stages exactly as they were (the video quotes "before the weekend")
old_path = f'{OUT}/{SLUG}.json'
if os.path.exists(old_path):
    frozen = {st['label']: st for st in json.load(open(old_path))['stages'] if st.get('frozen')}
    result['stages'] = [frozen.get(st['label'], st) for st in result['stages']]
    for i in range(1, len(result['stages'])):                                   # arrows against the stage before
        prev_order = [r['code'] for r in result['stages'][i - 1]['rows']]
        for r in result['stages'][i]['rows']: r['prev'] = prev_order.index(r['code']) + 1 if r['code'] in prev_order else None
for st in result['stages']: st['frozen'] = True
json.dump(result, open(f'{OUT}/{SLUG}.json', 'w'), separators=(',', ':'))
