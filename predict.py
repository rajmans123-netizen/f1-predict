# F1 Predict: optimal laps and a predicted finishing order for a race weekend, updated after each session.
#   optimal lap  = a driver's best sector 1 + best sector 2 + best sector 3 in the session (the lap the car has already
#                  shown it can do); "left on the table" = best actual lap - optimal lap
#   long-run pace = median lap of each driver's longest clean run (5+ laps, no pit, within 107% of their best)
#   season form   = recent-weighted average finishing position over the 2026 races so far (raw_season/)
#   grid          = qualifying result, once there is one
# Each is turned into a rank 1-22 and blended with stage weights, so the order is easy to explain.
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
    R = dict(form=ranks({n: form.get(n) for n in ns}), one=ranks({n: st.get(n, {}).get('optimal') for n in ns}),
             long=ranks({n: st.get(n, {}).get('longrun') for n in ns}), grid=ranks({n: grid.get(n) for n in ns}))
    # weights tuned on the 2026 season (backtest over 7 weekends, Hungary to Austin): season form and the grid carry
    # most of it, practice long runs are mostly noise. After practice: podium right ~49% of the time; after quali ~71%.
    W = dict(form=1.0) if not used else dict(grid=0.6, form=0.3, long=0.1) if grid else dict(form=0.6, one=0.3, long=0.1)
    score = {n: sum(w * R[k][n] for k, w in W.items()) for n in ns}
    order = sorted(ns, key=lambda n: (score[n], R['form'][n]))
    fastest_opt = min((v['optimal'] for v in st.values() if v.get('optimal')), default=None)
    rows = []
    for i, n in enumerate(order):
        d = drivers[n]; v = st.get(n, {})
        rows.append(dict(n=n, code=d['name_acronym'], name=d['full_name'].title(), team=d['team_name'], color='#' + (d.get('team_colour') or '888888'),
                         pos=i + 1, prev=prev.index(n) + 1 if prev else None, form=round(form[n], 1) if n in form else None,
                         best=round(v['best'], 3) if v.get('best') else None, optimal=round(v['optimal'], 3) if v.get('optimal') else None,
                         left=round(v['best'] - v['optimal'], 3) if v.get('best') and v.get('optimal') else None,
                         gap=round(v['optimal'] - fastest_opt, 3) if v.get('optimal') and fastest_opt else None,
                         longrun=round(v['longrun'], 3) if v.get('longrun') else None, grid=grid.get(n)))
    result['stages'].append(dict(label=label, weights=W, rows=rows))
    prev = order
    print(label, ' '.join(r['code'] for r in rows[:10]), '…')
json.dump(result, open(f'{OUT}/{SLUG}.json', 'w'), separators=(',', ':'))
