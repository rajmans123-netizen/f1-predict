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
const smooth = (a, w) => a.map((_, i) => { let s = 0, n = 0; for (let k = Math.max(0, i - w); k <= Math.min(a.length - 1, i + w); k++) { s += a[k]; n++; } return s / n; });
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
  const tt = Math.min(t, d.total);
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
  const me = at(FOLLOW, t), ahead = at(FOLLOW, Math.min(FOLLOW.total, t + 0.5)), behind = at(FOLLOW, Math.max(0, t - 0.5));
  const head = Math.atan2(ahead.y - behind.y, ahead.x - behind.x);
  const cx = W / 2, cy = H * 0.4;
  // track ~46% of the width; zoom out (down to a third of that) so the picked drivers stay in frame above the readout,
  // averaged over 4 s so the zoom eases instead of pulsing
  const base = (Math.min(W, H * 0.62) * 0.46) / TW, room = H * 0.66 - cy;
  const need = (tt) => {
    const m = at(FOLLOW, tt); let sc = base;
    for (const d of FIELD) { if (!SEL.has(d.code)) continue; const p = at(d, tt), dist = Math.hypot(p.x - m.x, p.y - m.y) + 2 * UNITS_PER_M; if (dist * sc > room) sc = Math.max(base / 3, room / dist); }
    return sc;
  };
  let scale = 0; for (let k = -8; k <= 8; k++) scale += need(Math.max(0, t + k * 0.25)); scale /= 17;
  // world → screen: car at (cx, cy), heading up (data y is up)
  const rot = Math.PI / 2 - head;
  const P = (x, y) => { const dx = x - me.x, dy = y - me.y; const rx = dx * Math.cos(rot) - dy * Math.sin(rot), ry = dx * Math.sin(rot) + dy * Math.cos(rot); return [cx + rx * scale, cy - ry * scale]; };
  const path = (xs, ys, step = 1) => { g.beginPath(); for (let i = 0; i < xs.length; i += step) { const [px, py] = P(xs[i], ys[i]); i ? g.lineTo(px, py) : g.moveTo(px, py); } };
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
  // trail: the last 3.5 s, coloured by speed
  const T = FOLLOW.trace; let i1 = 0; { let lo = 0, hi = T.t.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (T.t[m] <= t) lo = m; else hi = m - 1; } i1 = lo; }
  let i0 = i1; while (i0 > 0 && T.t[i0] > t - 3.5) i0--;
  // one continuous line: short overlapping runs, each in its speed colour, older parts fading into the tarmac
  g.lineWidth = 7;
  for (let i = i0; i < i1; i += 2) {
    const j = Math.min(i1, i + 3), age = (i1 - i) / Math.max(1, i1 - i0);
    g.beginPath(); for (let k = i; k <= j; k++) { const [px, py] = P(T.x[k], T.y[k]); k === i ? g.moveTo(px, py) : g.lineTo(px, py); }
    if (j === i1) g.lineTo(cx, cy);
    g.strokeStyle = mix(speedColor(T.v[j]), age * 0.75); g.stroke();
  }
  // ghosts: the top 10's optimal laps at the same moment; a label only where it won't overlap another
  const ghosts = FIELD.filter((d) => SEL.has(d.code)).map((d) => { const p = at(d, t); const [px, py] = P(p.x, p.y); return { d, px, py }; })
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

  // ---- HUD
  const fade = (y0, y1, a) => { const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, `rgba(5,5,6,${a})`); gr.addColorStop(1, 'rgba(5,5,6,0)'); return gr; };
  g.fillStyle = fade(0, H * 0.2, 0.92); g.fillRect(0, 0, W, H * 0.2);
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff'; g.font = `900 ${Math.round(W * 0.062)}px "Titillium Web"`; g.fillText('THE OPTIMAL LAP', W / 2, H * 0.085);
  g.fillStyle = '#8A8F9E'; g.font = `700 ${Math.round(W * 0.032)}px "Titillium Web"`; g.fillText(TITLE, W / 2, H * 0.085 + W * 0.05);
  // bottom readout
  const gr = g.createLinearGradient(0, H * 0.72, 0, H); gr.addColorStop(0, 'rgba(5,5,6,0)'); gr.addColorStop(0.35, 'rgba(5,5,6,.85)'); gr.addColorStop(1, 'rgba(5,5,6,.96)');
  g.fillStyle = gr; g.fillRect(0, H * 0.72, W, H * 0.28);
  const status = me.brk > 0.5 ? ['BRAKING', '#FF3B30'] : me.thr > 95 ? ['FULL THROTTLE', '#7CFF5B'] : ['LIFT', '#FFD60A'];
  const yb = H * 0.835;
  g.fillStyle = status[1]; g.font = `900 ${Math.round(W * 0.024)}px "Titillium Web"`; g.fillText(status[0], W / 2, yb - W * 0.085);
  g.fillStyle = '#fff'; g.font = `900 ${Math.round(W * 0.095)}px "Titillium Web"`; g.fillText(Math.round(me.v), W / 2, yb);
  g.fillStyle = '#8A8F9E'; g.font = `700 ${Math.round(W * 0.024)}px "Titillium Web"`; g.fillText(`KM/H · GEAR ${me.gear}`, W / 2, yb + W * 0.04);
  g.fillStyle = '#fff'; g.font = `700 ${Math.round(W * 0.03)}px "JetBrains Mono"`; g.fillText(fmt(Math.min(t, FOLLOW.total)), W / 2, yb + W * 0.09);
  g.fillStyle = '#8A8F9E'; g.font = `600 ${Math.round(W * 0.028)}px "Titillium Web"`;
  g.fillText(DATA.kind === 'forecast' ? `Optimal lap forecast ${fmt(FOLLOW.total)} · 2025 optimal ${fmt(DATA.meta.history[2025].total)}`
    : `${FOLLOW.name} · optimal ${fmt(FOLLOW.total)} · best real lap ${fmt(FOLLOW.best)}`, W / 2, yb + W * 0.13);
  // sector pill
  const sEnds = [FOLLOW.sectors[0], FOLLOW.sectors[0] + FOLLOW.sectors[1], FOLLOW.total];
  sEnds.forEach((e, k) => {
    const dt = t - e; if (dt < 0 || dt > 1.8) return;
    const txt = `S${k + 1}  ${FOLLOW.sectors[k].toFixed(3)}`; g.font = `900 ${Math.round(W * 0.036)}px "Titillium Web"`;
    const tw = g.measureText(txt).width + 32, x = W / 2 - tw / 2, y = H * 0.2;
    g.globalAlpha = Math.min(1, (1.8 - dt) * 3); g.fillStyle = '#A855F7'; g.beginPath(); g.roundRect(x, y, tw, W * 0.06, 10); g.fill();
    g.fillStyle = '#fff'; g.fillText(txt, W / 2, y + W * 0.043); g.globalAlpha = 1;
  });
  // mini-map, top right
  const mm = W * 0.2, mx = W - mm - W * 0.04, my = H * 0.12;
  const xs = TR.x, ys = TR.y, x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const ms = mm / Math.max(x1 - x0, y1 - y0), M = (x, y) => [mx + (x - x0) * ms, my + (y1 - y) * ms];
  g.beginPath(); for (let i = 0; i < xs.length; i += 4) { const [px, py] = M(xs[i], ys[i]); i ? g.lineTo(px, py) : g.moveTo(px, py); }
  g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 2; g.stroke();
  const [mpx, mpy] = M(me.x, me.y); g.beginPath(); g.arc(mpx, mpy, 5, 0, Math.PI * 2); g.fillStyle = col; g.fill();
  // live gaps to the camera car, left side
  const f = me.s / FOLLOW.L, rows = FIELD.filter((d) => SEL.has(d.code)).map((d) => ({ d, gap: timeAtFrac(d, f) - timeAtFrac(FOLLOW, f) })).sort((a, b) => a.gap - b.gap);
  if (rows.length === 1) {                                     // one driver: their gap, big, under the speed
    const { d, gap } = rows[0];
    g.textAlign = 'center'; g.font = `900 ${Math.round(W * 0.05)}px "Titillium Web"`; g.fillStyle = d.color;
    g.fillText(`${d.code}  +${Math.max(0, gap).toFixed(3)}`, W / 2, H * 0.085 + W * 0.15); g.font = `700 ${Math.round(W * 0.026)}px "Titillium Web"`; g.fillStyle = '#8A8F9E';
    g.fillText('BEHIND THE OPTIMAL LAP', W / 2, H * 0.085 + W * 0.19); g.textAlign = 'left';
  }
  const lx = W * 0.04, ly0 = H * 0.27, lh = W * 0.052;
  g.textAlign = 'left'; g.font = `700 ${Math.round(W * 0.026)}px "Titillium Web"`; g.fillStyle = '#8A8F9E'; if (rows.length) g.fillText('VS OPTIMAL LAP', lx, ly0 - lh * 0.95);
  rows.forEach(({ d, gap }, k) => {
    const y = ly0 + k * lh; g.fillStyle = d.color; g.fillRect(lx, y - lh * 0.55, 4, lh * 0.7);
    g.fillStyle = d === FOLLOW ? '#fff' : '#C9CCD4'; g.font = `900 ${Math.round(W * 0.03)}px "Titillium Web"`; g.fillText(d.code, lx + 10, y);
    g.font = `500 ${Math.round(W * 0.026)}px "JetBrains Mono"`; g.fillStyle = Math.abs(gap) < 0.0005 ? '#A855F7' : gap < 0 ? '#7CFF5B' : '#C9CCD4';
    g.fillText(d === FOLLOW ? 'ref' : (gap < 0 ? '−' : '+') + Math.abs(gap).toFixed(3), lx + W * 0.1, y);
  });
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
let t = Number(Q.get('t')) || 0, playing = !Q.get('paused'), last = performance.now();
$('play').onclick = () => { playing = !playing; $('play').textContent = playing ? '❚❚' : '▶'; };
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (playing) { t += dt; if (t > FOLLOW.total + 2) t = 0; }
  render(t); requestAnimationFrame(frame);
}
if (!Q.get('paused')) requestAnimationFrame(frame); else render(t);
