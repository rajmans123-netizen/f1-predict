// Pit Wall prediction: the order predict.py made after each session of a race weekend (data/predict/<slug>.json).
const $ = (id) => document.getElementById(id);
const fmt = (s) => s == null ? '–' : s >= 60 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}` : s.toFixed(3);
const NAMES = { form: 'season form', one: 'one-lap pace (optimal lap)', long: 'long-run pace', grid: 'grid position' };
const slug = new URLSearchParams(location.search).get('race') || 'mexico-city';
const P = await fetch(`data/predict/${slug}.json`).then((r) => r.json());
$('sub').textContent = `Race: ${new Date(P.race_start).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} IST · prediction updated after every session`;
// countdown to lights out
const tick = () => {
  const s = Math.max(0, (new Date(P.race_start) - Date.now()) / 1000);
  $('count').textContent = s ? `Lights out in ${Math.floor(s / 86400)}d ${Math.floor(s / 3600) % 24}h ${Math.floor(s / 60) % 60}m ${Math.floor(s) % 60}s` : 'Race day';
};
tick(); setInterval(tick, 1000);
// the circuit, drawn from its real outline, with corner numbers
fetch(`data/circuit/${slug}.json`).then((r) => r.json()).then((c) => {
  const a = (c.rotation * Math.PI) / 180, rot = (x, y) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  const pts = c.x.map((x, i) => rot(x, c.y[i])), cs = c.corners.map((k) => [k.n, ...rot(k.x, k.y)]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), pad = 900;
  const [x0, x1, y0, y1] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - pad, Math.max(...ys) + pad];
  const T = (x, y) => `${(x - x0).toFixed(0)},${(y1 - y).toFixed(0)}`;
  const d = 'M' + pts.map((p) => T(...p)).join('L') + 'Z';
  $('track').setAttribute('viewBox', `0 0 ${(x1 - x0).toFixed(0)} ${(y1 - y0).toFixed(0)}`);
  $('track').innerHTML = `<path d="${d}" fill="none" stroke="#2A2E3B" stroke-width="700" stroke-linejoin="round"/>
    <path d="${d}" fill="none" stroke="#fff" stroke-width="160" stroke-linejoin="round"/>
    ${cs.map(([n, x, y]) => { const [px, py] = T(x, y).split(','); return `<circle cx="${px}" cy="${py}" r="330" fill="#00A859"/><text x="${px}" y="${py}" font-size="380" font-weight="900" fill="#fff" text-anchor="middle" dominant-baseline="central" font-family="Titillium Web">${n}</text>`; }).join('')}`;
});
const F = await fetch(`data/forecast/${slug}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const FC = F ? Object.fromEntries(F.drivers.map((d) => [d.code, d])) : {};
if (F) {
  const h = F.history, best = F.drivers[0];
  $('fc').innerHTML = `<h3>The optimal lap, forecast before a car has run</h3>
    <div class="big">${fmt(best.total)} <span style="font-size:16px;color:var(--muted)">${best.code}, best S1 + S2 + S3</span></div>
    <div class="steps">
      <div><b>${fmt(h[2023].total)} → ${fmt(h[2024].total)} → ${fmt(h[2025].total)}</b>Mexico's optimal lap in qualifying, 2023 to 2025</div>
      <div><b>+${((F.era_factor - 1) * 100).toFixed(1)}% slower</b>2026 rules (new engines, active aero, smaller cars), measured at ${F.circuits.length} tracks raced in both 2025 and 2026, with this season's upgrade trend</div>
      <div><b>Each driver's gap</b>their 2026 qualifying pace vs the fastest, recent races weighted more</div>
    </div>`;
} else $('fc').remove();
let cur = P.stages.length - 1;
function show(k) {
  cur = k; const st = P.stages[k];
  [...$('stages').children].forEach((b, i) => b.classList.toggle('on', i === k));
  $('how').innerHTML = (st.rows.some((r) => r.optimal == null) && F ? '* forecast optimal lap (no running yet) · ' : '') + 'Blend: ' + Object.entries(st.weights).map(([w, v]) => `<b>${Math.round(v * 100)}%</b> ${NAMES[w]}`).join(' · ');
  $('rows').innerHTML = st.rows.map((r) => {
    const mv = r.prev == null ? '' : r.prev - r.pos;
    const cls = mv === '' ? 'eq' : mv > 0 ? 'up' : mv < 0 ? 'dn' : 'eq';
    const arrow = mv === '' ? '' : mv > 0 ? `▲${mv}` : mv < 0 ? `▼${-mv}` : '–';
    return `<div class="row ${r.pos <= 3 ? 'top3' : ''}"><div class="pos">P${r.pos}</div><div class="mv ${cls}">${arrow}</div>
      <div class="drv"><b style="background:${r.color}"></b><div><div class="c">${r.code}${r.grid ? ` <span class="t">· grid P${r.grid}</span>` : ''}</div><div class="t">${r.team}</div></div></div>
      ${r.optimal == null && FC[r.code] ? `<div class="num f" title="forecast">${fmt(FC[r.code].total)}*</div>` : `<div class="num ${r.gap === 0 ? 'p' : ''}">${fmt(r.optimal)}</div>`}<div class="num y">${r.left != null ? '-' + r.left.toFixed(3) : '–'}</div>
      <div class="num">${fmt(r.longrun)}</div><div class="num m">${r.form != null ? 'P' + r.form.toFixed(1) : '–'}</div></div>`;
  }).join('');
}
$('stages').innerHTML = P.stages.map((s) => `<button>${s.label}</button>`).join('');
[...$('stages').children].forEach((b, i) => (b.onclick = () => show(i)));
show(cur);
