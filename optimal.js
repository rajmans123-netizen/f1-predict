// The optimal lap vs the drivers: a chase camera rides along with the optimal lap (the best sector 1 + 2 + 3 of anyone)
// while the drivers you pick (one by default) run their own laps as dots on the same track, with live gaps.
// Trail coloured by speed, kerbs on the corners. ?race=<slug>&drivers=VER,NOR&clean=1
// window.__render(t) draws one exact frame (for recording).
const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const SLUG = Q.get('race') || 'mexico-city';
if (Q.get('clean')) document.body.classList.add('clean');
const DATA = await fetch(`data/optimal/${SLUG}.json`).then((r) => r.json());
for (let i = 0; i < 60 && !document.fonts.check('900 20px "Titillium Web"'); i++) { document.fonts.load('900 20px "Titillium Web"'); await new Promise((r) => setTimeout(r, 50)); }
await Promise.all(['900 20px "Titillium Web"', '700 20px "Titillium Web"', '600 20px "Titillium Web"', '700 20px "JetBrains Mono"', '500 20px "JetBrains Mono"'].map((f) => document.fonts.load(f)));
const TITLE = Q.get('title') || DATA.title || `${DATA.location} Grand Prix`.toUpperCase();
const DRV = DATA.drivers;

// ---- per-driver arrays + distance along the lap
const smooth = (a, w) => a.map((_, i) => { let s = 0; for (let k = i - w; k <= i + w; k++) s += a[(k + a.length) % a.length]; return s / (2 * w + 1); });   // wraps: a lap is a loop
for (const d of DRV) {
  const T = d.trace;
  T.x = smooth(smooth(T.x, 4), 4); T.y = smooth(smooth(T.y, 4), 4);   // positions come ~4x a second: smooth out the kinks
  d.s = [0];
  for (let i = 1; i < T.t.length; i++) d.s.push(d.s[i - 1] + Math.hypot(T.x[i] - T.x[i - 1], T.y[i] - T.y[i - 1]));
  d.L = d.s[d.s.length - 1];
}
const lerpAt = (arr, key, t) => {           // value of trace[key] at time t (arrays sorted by t)
  const T = arr.t; if (t <= T[0]) return key === 's' ? 0 : arr[key][0];
  let lo = 0, hi = T.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
  const k = Math.min(1, (t - T[lo]) / (T[hi] - T[lo] || 1)), A = arr[key];
  return A[lo] + (A[hi] - A[lo]) * k;
};
const at = (d, t) => {
  const tt = t < 0 ? d.total + t : Math.min(t, d.total);   // before the line: the end of the lap, arriving at speed
  const T = d.trace, S = { t: T.t, s: d.s };
  return { x: lerpAt(T, 'x', tt), y: lerpAt(T, 'y', tt), v: lerpAt(T, 'v', tt), thr: lerpAt(T, 'thr', tt), brk: lerpAt(T, 'brk', tt), gear: Math.round(lerpAt(T, 'gear', tt)), s: lerpAt(S, 's', tt) };
};
const timeAtFrac = (d, f) => {              // when driver d reaches fraction f of their lap
  const target = f * d.L, s = d.s; let lo = 0, hi = s.length - 1;
  if (target <= 0) return 0; if (target >= d.L) return d.total;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= target) lo = m; else hi = m; }
  const k = (target - s[lo]) / (s[hi] - s[lo] || 1); return d.trace.t[lo] + (d.trace.t[hi] - d.trace.t[lo]) * k;
};

// ---- the track: the fastest optimal lap's line; units → metres from the lap length
const REF = DRV[0], TR = REF.trace;
const UNITS_PER_M = REF.L / (Number(Q.get('km')) * 1000 || DATA.lap_km * 1000 || REF.L / 10);
const TW = 13 * UNITS_PER_M;                                  // track width ~13 m
// curvature for kerbs
const KX = [], KY = [], KC = [];
for (let i = 0; i < TR.x.length; i += 2) { KX.push(TR.x[i]); KY.push(TR.y[i]); }
for (let i = 0; i < KX.length; i++) {
  const a = Math.max(0, i - 3), b = Math.min(KX.length - 1, i + 3);
  const h1 = Math.atan2(KY[i] - KY[a], KX[i] - KX[a]), h2 = Math.atan2(KY[b] - KY[i], KX[b] - KX[i]);
  let dh = h2 - h1; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
  const ds = Math.hypot(KX[b] - KX[a], KY[b] - KY[a]) || 1; KC.push(dh / ds);
}

// ---- drawing
const cv = $('cv'), g = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
const resize = () => { DPR = devicePixelRatio || 1; W = innerWidth; H = innerHeight; cv.width = W * DPR; cv.height = H * DPR; };
addEventListener('resize', resize); resize();
const speedColor = (v) => {                                   // red (slow) → orange → yellow → green → cyan (fast)
  const stops = [[80, [255, 59, 48]], [140, [255, 140, 0]], [190, [255, 214, 10]], [250, [124, 255, 91]], [300, [59, 240, 255]]];
  if (v <= stops[0][0]) return `rgb(${stops[0][1]})`;
  for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) {
    const [v0, c0] = stops[i - 1], [v1, c1] = stops[i], k = (v - v0) / (v1 - v0);
    return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * k))})`;
  }
  return `rgb(${stops[stops.length - 1][1]})`;
};
const mix = (rgb, k) => { const c = rgb.match(/\d+/g).map(Number), b = [38, 38, 43]; return `rgb(${c.map((v, i) => Math.round(v + (b[i] - v) * k))})`; };
const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`;
const FOLLOW = DRV.find((d) => d.optimal) || REF;                  // the camera rides the optimal lap
const FIELD = DRV.filter((d) => d !== FOLLOW);
let SEL = new Set((Q.get('drivers') || FIELD[0].code).toUpperCase().split(',').filter((c) => FIELD.some((d) => d.code === c)));

function render(t) {
  g.setTransform(DPR, 0, 0, DPR, 0, 0); g.fillStyle = '#050506'; g.fillRect(0, 0, W, H);
  const U = Math.min(W, H * 0.5625);   // text and panels are sized for a phone-shaped frame, whatever the window
  const WIDE = W - U > 2 * 300;           // room for side panels
  const me = at(FOLLOW, t), ahead = at(FOLLOW, Math.min(FOLLOW.total, t + 0.5)), behind = at(FOLLOW, t - 0.5);   // before the line, t < 0 wraps to the lap's end
  const head = Math.atan2(ahead.y - behind.y, ahead.x - behind.x);
  const cx = W / 2, cy = WIDE ? H * 0.42 : H * 0.4;
  // track ~46% of the width; zoom out (down to a third of that) so the picked drivers stay in frame above the readout,
  // averaged over 4 s so the zoom eases instead of pulsing
  const base = (Math.min(W, H * 0.62) * 0.46) / TW, room = (WIDE ? H * 0.93 : H * 0.66) - cy;
  const need = (tt) => {
    const m = at(FOLLOW, tt); let sc = base;
    for (const d of FIELD) { if (!SEL.has(d.code)) continue; const p = at(d, tt), dist = Math.hypot(p.x - m.x, p.y - m.y) + 2 * UNITS_PER_M; if (dist * sc > room) sc = Math.max(base / 3, room / dist); }
    return sc;
  };
  let scale = 0; for (let k = -8; k <= 8; k++) scale += need(Math.min(FOLLOW.total, t + k * 0.25)); scale /= 17;
  // world → screen: car at (cx, cy), heading up (data y is up)
  const rot = Math.PI / 2 - head;
  const P = (x, y) => { const dx = x - me.x, dy = y - me.y; const rx = dx * Math.cos(rot) - dy * Math.sin(rot), ry = dx * Math.sin(rot) + dy * Math.cos(rot); return [cx + rx * scale, cy - ry * scale]; };
  const path = (xs, ys, step = 1) => { g.beginPath(); for (let i = 0; i < xs.length; i += step) { const [px, py] = P(xs[i], ys[i]); i ? g.lineTo(px, py) : g.moveTo(px, py); } g.closePath(); };   // a full loop
  g.lineCap = g.lineJoin = 'round';
  // track: white edges, dark tarmac, faint centre line
  path(TR.x, TR.y, 2); g.strokeStyle = '#E8E8EA'; g.lineWidth = TW * scale + 8; g.stroke();
  path(TR.x, TR.y, 2); g.strokeStyle = '#26262B'; g.lineWidth = TW * scale; g.stroke();
  path(TR.x, TR.y, 2); g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1.5; g.stroke();
  // kerbs: dashed white on the outside of corners
  g.setLineDash([12, 12]); g.lineWidth = 8; g.lineCap = 'butt'; g.strokeStyle = '#F5F5F7';
  let on = false;
  for (let i = 1; i < KX.length; i++) {
    const c = KC[i]; const corner = Math.abs(c) > 0.0016 / UNITS_PER_M * 10;
    if (!corner) { if (on) { g.stroke(); on = false; } continue; }
    const dx = KX[i] - KX[i - 1], dy = KY[i] - KY[i - 1], l = Math.hypot(dx, dy) || 1;
    const side = c > 0 ? -1 : 1, off = TW / 2 + 0.9 * UNITS_PER_M;   // outside of the turn
    const ox = KX[i] + (-dy / l) * off * side, oy = KY[i] + (dx / l) * off * side;
    const [px, py] = P(ox, oy);
    if (!on) { g.beginPath(); g.moveTo(px, py); on = true; } else g.lineTo(px, py);
  }
  if (on) g.stroke(); g.setLineDash([]); g.lineCap = 'round';
  // the chequered start/finish line across the track
  {
    const dx = TR.x[4] - TR.x[0], dy = TR.y[4] - TR.y[0], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, nx = -uy, ny = ux;
    const sq = TW / 8;
    for (let row = 0; row < 2; row++) for (let k = 0; k < 8; k++) {
      const a = -TW / 2 + k * sq, b = row * sq, q = [[a, b], [a + sq, b], [a + sq, b + sq], [a, b + sq]].map(([u, v]) => P(TR.x[0] + nx * u + ux * v, TR.y[0] + ny * u + uy * v));
      g.beginPath(); q.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath();
      g.fillStyle = (row + k) % 2 ? '#111' : '#F5F5F7'; g.fill();
    }
  }
  // trail: the last 3.5 s, coloured by speed
  // the trail's samples for the last 3.5 s (wrapping round the end of the lap before the line)
  const T = FOLLOW.trace, N = T.t.length, idxAt = (tt) => { let lo = 0, hi = N - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (T.t[m] <= tt) lo = m; else hi = m - 1; } return lo; };
  const pts = [];
  for (let tt = t - 3.5; tt <= t + 1e-6; tt += 0.05) { const w = tt < 0 ? FOLLOW.total + tt : Math.min(tt, FOLLOW.total); const i = idxAt(w); if (pts[pts.length - 1] !== i) pts.push(i); }
  // one continuous line: short overlapping runs, each in its speed colour, older parts fading into the tarmac
  g.lineWidth = 7;
  for (let a = 0; a < pts.length - 1; a += 2) {
    const b = Math.min(pts.length - 1, a + 3), age = (pts.length - 1 - a) / Math.max(1, pts.length - 1);
    g.beginPath(); for (let k = a; k <= b; k++) { const [px, py] = P(T.x[pts[k]], T.y[pts[k]]); k === a ? g.moveTo(px, py) : g.lineTo(px, py); }
    if (b === pts.length - 1) g.lineTo(cx, cy);
    g.strokeStyle = mix(speedColor(T.v[pts[b]]), age * 0.75); g.stroke();
  }
  // ghosts: the top 10's optimal laps at the same moment; a label only where it won't overlap another
  const ghosts = FIELD.filter((d) => t >= 0 && SEL.has(d.code)).map((d) => { const p = at(d, t); const [px, py] = P(p.x, p.y); return { d, px, py }; })
    .filter(({ px, py }) => px > -40 && px < W + 40 && py > -40 && py < H + 40).sort((a, b) => a.py - b.py);
  let lastLabel = -1e9;
  for (const { d, px, py } of ghosts) {
    g.beginPath(); g.arc(px, py, 8, 0, Math.PI * 2); g.fillStyle = d.color; g.fill();
    g.lineWidth = 2; g.strokeStyle = '#050506'; g.stroke();
    if (py - lastLabel > 16 && Math.hypot(px - cx, py - cy) > 20) {
      g.font = '700 12px "Titillium Web"'; g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(d.code, px + 11, py); lastLabel = py;
    }
  }
  // the car
  const col = speedColor(me.v);
  g.beginPath(); g.arc(cx, cy, 13, 0, Math.PI * 2); g.fillStyle = col; g.fill(); g.lineWidth = 3; g.strokeStyle = '#050506'; g.stroke();
  g.font = '900 14px "Titillium Web"'; g.fillStyle = '#C084FC'; g.textAlign = 'left'; g.fillText(FOLLOW.optimal ? 'OPTIMAL' : FOLLOW.code, cx + 18, cy - 14);

  // ---- HUD. Wide screens: the centre is just the track; title, gaps and board on the left, map and readout on the right.
  const status = me.brk > 0.5 ? ['BRAKING', '#FF3B30'] : me.thr > 95 ? ['FULL THROTTLE', '#7CFF5B'] : ['LIFT', '#FFD60A'];
  const f = me.s / FOLLOW.L, rows = t < 0 ? [] : FIELD.filter((d) => SEL.has(d.code)).map((d) => ({ d, gap: timeAtFrac(d, f) - timeAtFrac(FOLLOW, f) })).sort((a, b) => a.gap - b.gap);
  const foot = DATA.kind === 'forecast' ? [`Optimal lap forecast ${fmt(FOLLOW.total)}`, `2025 optimal ${fmt(DATA.meta.history[2025].total)}`]
    : [`${FOLLOW.name} · optimal ${fmt(FOLLOW.total)}`, `best real lap ${fmt(FOLLOW.best)}`];
  g.textBaseline = 'alphabetic';
  const txt = (s, x, y, size, color, weight = 900, font = 'Titillium Web', align = 'left') => { g.textAlign = align; g.fillStyle = color; g.font = `${weight} ${Math.round(size)}px "${font}"`; g.fillText(s, x, y); };
  const single = rows.length === 1 ? rows[0] : null;
  const metres = single ? (me.s - at(single.d, t).s) / UNITS_PER_M : 0;
  const minimap = (mx, my, mm, lw, dot) => {
    const xs = TR.x, ys = TR.y, x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const ms = mm / Math.max(x1 - x0, y1 - y0), M = (x, y) => [mx + (x - x0) * ms, my + (y1 - y) * ms];
    g.beginPath(); for (let i = 0; i < xs.length; i += 4) { const [px, py] = M(xs[i], ys[i]); i ? g.lineTo(px, py) : g.moveTo(px, py); } g.closePath();
    g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = lw; g.stroke();
    for (const { d } of rows) { const p = at(d, t), [px, py] = M(p.x, p.y); g.beginPath(); g.arc(px, py, dot * 0.75, 0, Math.PI * 2); g.fillStyle = d.color; g.fill(); }
    const [mpx, mpy] = M(me.x, me.y); g.beginPath(); g.arc(mpx, mpy, dot, 0, Math.PI * 2); g.fillStyle = col; g.fill(); g.lineWidth = 2; g.strokeStyle = '#050506'; g.stroke();
  };
  const board = (lx, ly0, lh, size) => {
    if (!rows.length) return;
    txt('VS OPTIMAL LAP', lx, ly0 - lh * 0.95, size * 0.85, '#8A8F9E', 700);
    rows.forEach(({ d, gap }, k) => {
      const y = ly0 + k * lh; g.fillStyle = d.color; g.fillRect(lx, y - lh * 0.55, 4, lh * 0.7);
      txt(d.code, lx + 12, y, size, '#E6E7EA');
      txt('+' + Math.max(0, gap).toFixed(3), lx + size * 3.6, y, size * 0.9, '#C9CCD4', 500, 'JetBrains Mono');
    });
  };
  const sectorPill = (x, y, size) => {
    const ends = [FOLLOW.sectors[0], FOLLOW.sectors[0] + FOLLOW.sectors[1], FOLLOW.total];
    ends.forEach((e, k) => {
      const dt = t - e; if (dt < 0 || dt > 1.8) return;
      const label = `S${k + 1}  ${FOLLOW.sectors[k].toFixed(3)}`; g.font = `900 ${Math.round(size)}px "Titillium Web"`;
      const tw = g.measureText(label).width + 32;
      g.globalAlpha = Math.min(1, (1.8 - dt) * 3); g.fillStyle = '#A855F7'; g.beginPath(); g.roundRect(x - tw / 2, y, tw, size * 1.7, 10); g.fill();
      txt(label, x, y + size * 1.2, size, '#fff', 900, 'Titillium Web', 'center'); g.globalAlpha = 1;
    });
  };
  if (WIDE) {
    const PW = Math.min(420, (W - U) / 2 - 80), L = 56, R = W - 56;
    txt('THE OPTIMAL LAP', L, H * 0.13, U * 0.075, '#fff');
    txt(TITLE, L, H * 0.13 + U * 0.055, U * 0.032, '#8A8F9E', 700);
    let y = H * 0.13 + U * 0.17;
    if (single) {
      txt(`${single.d.code}  +${Math.max(0, single.gap).toFixed(3)}`, L, y, U * 0.08, single.d.color); y += U * 0.05;
      txt('BEHIND THE OPTIMAL LAP', L, y, U * 0.028, '#8A8F9E', 700); y += U * 0.04;
      if (metres / 5.6 >= 0.5) txt(`${Math.round(metres)} m · ≈ ${(metres / 5.6).toFixed(1)} car lengths`, L, y, U * 0.03, '#C9CCD4', 600);
      y += U * 0.1;
    } else y += U * 0.04;
    if (!single) board(L, y + U * 0.05, U * 0.058, U * 0.034);
    const mm = Math.min(PW, H * 0.4); minimap(R - mm, H * 0.1, mm, 3, 7);
    let yb = H * 0.78;
    txt(status[0], R, yb - U * 0.12, U * 0.03, status[1], 900, 'Titillium Web', 'right');
    txt(Math.round(me.v), R, yb, U * 0.13, '#fff', 900, 'Titillium Web', 'right');
    txt(`KM/H · GEAR ${me.gear}`, R, yb + U * 0.05, U * 0.03, '#8A8F9E', 700, 'Titillium Web', 'right');
    txt(fmt(Math.max(0, Math.min(t, FOLLOW.total))), R, yb + U * 0.11, U * 0.042, '#fff', 700, 'JetBrains Mono', 'right');
    txt(foot[0], R, yb + U * 0.16, U * 0.027, '#8A8F9E', 600, 'Titillium Web', 'right');
    txt(foot[1], R, yb + U * 0.2, U * 0.027, '#8A8F9E', 600, 'Titillium Web', 'right');
    sectorPill(W / 2, H * 0.05, U * 0.034);
  } else {
    const fade = (y0, y1, a) => { const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, `rgba(5,5,6,${a})`); gr.addColorStop(1, 'rgba(5,5,6,0)'); return gr; };
    g.fillStyle = fade(0, H * 0.24, 0.92); g.fillRect(0, 0, W, H * 0.24);
    g.textBaseline = 'alphabetic';
    txt('THE OPTIMAL LAP', W / 2, H * 0.085, U * 0.062, '#fff', 900, 'Titillium Web', 'center');
    txt(TITLE, W / 2, H * 0.085 + U * 0.05, U * 0.032, '#8A8F9E', 700, 'Titillium Web', 'center');
    const gr = g.createLinearGradient(0, H * 0.72, 0, H); gr.addColorStop(0, 'rgba(5,5,6,0)'); gr.addColorStop(0.35, 'rgba(5,5,6,.85)'); gr.addColorStop(1, 'rgba(5,5,6,.96)');
    g.fillStyle = gr; g.fillRect(0, H * 0.72, W, H * 0.28);
    const yb = H * 0.835;
    txt(status[0], W / 2, yb - U * 0.085, U * 0.024, status[1], 900, 'Titillium Web', 'center');
    txt(Math.round(me.v), W / 2, yb, U * 0.095, '#fff', 900, 'Titillium Web', 'center');
    txt(`KM/H · GEAR ${me.gear}`, W / 2, yb + U * 0.04, U * 0.024, '#8A8F9E', 700, 'Titillium Web', 'center');
    txt(fmt(Math.max(0, Math.min(t, FOLLOW.total))), W / 2, yb + U * 0.09, U * 0.03, '#fff', 700, 'JetBrains Mono', 'center');
    txt(foot.join(' · '), W / 2, yb + U * 0.13, U * 0.028, '#8A8F9E', 600, 'Titillium Web', 'center');
    sectorPill(W / 2, H * 0.2, U * 0.036);
    const mm = U * 0.22; minimap(W - mm - U * 0.04, H * 0.25, mm, 2, 5);     // right side, opposite the gap board
    if (single) {
      txt(`${single.d.code}  +${Math.max(0, single.gap).toFixed(3)}`, W / 2, H * 0.085 + U * 0.15, U * 0.05, single.d.color, 900, 'Titillium Web', 'center');
      txt('BEHIND THE OPTIMAL LAP', W / 2, H * 0.085 + U * 0.19, U * 0.026, '#8A8F9E', 700, 'Titillium Web', 'center');
      if (metres / 5.6 >= 0.5) txt(`${Math.round(metres)} m · ≈ ${(metres / 5.6).toFixed(1)} car lengths`, W / 2, H * 0.085 + U * 0.23, U * 0.026, '#C9CCD4', 600, 'Titillium Web', 'center');
    } else board(W / 2 - U / 2 + U * 0.04, H * 0.27, U * 0.052, U * 0.03);
  }
}
window.__render = render;

// ---- playback
const chips = () => {
  $('chips').innerHTML = FIELD.map((d) => `<button style="--c:${d.color}" class="${SEL.has(d.code) ? 'on' : ''}" data-c="${d.code}">${d.code} <small style="font-weight:600;opacity:.7">${fmt(d.total)}</small></button>`).join('');
  history.replaceState(null, '', `?race=${SLUG}&drivers=${[...SEL].join(',')}`);
};
$('chips').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; const c = b.dataset.c; SEL.has(c) ? SEL.delete(c) : SEL.add(c); chips(); if (!playing) render(t); };
$('all').onclick = () => { SEL = new Set(FIELD.map((d) => d.code)); chips(); };
$('none').onclick = () => { SEL = new Set(); chips(); };
$('pickBtn').onclick = () => $('picker').classList.toggle('on');
chips();
let t = Q.get('t') != null ? Number(Q.get('t')) : -2, playing = !Q.get('paused'), last = performance.now();
$('play').onclick = () => { playing = !playing; $('play').textContent = playing ? '❚❚' : '▶'; };
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (playing) { t += dt; if (t > FOLLOW.total + 2) t = -2; }
  render(t); requestAnimationFrame(frame);
}
if (!Q.get('paused')) requestAnimationFrame(frame); else render(t);
