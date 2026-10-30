// Pit Wall prediction: the order predict.py made after each session of a race weekend (data/predict/<slug>.json).
const $ = (id) => document.getElementById(id);
const fmt = (s) => s == null ? '–' : s >= 60 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}` : s.toFixed(3);
const NAMES = { form: 'season form', one: 'one-lap pace (optimal lap)', long: 'long-run pace', grid: 'grid position' };
const slug = new URLSearchParams(location.search).get('race') || 'mexico-city';
const P = await fetch(`data/predict/${slug}.json`).then((r) => r.json());
$('title').textContent = `${P.name}: predicted finish`;
$('sub').textContent = `Race: ${new Date(P.race_start).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} IST · updated after every session`;
let cur = P.stages.length - 1;
function show(k) {
  cur = k; const st = P.stages[k];
  [...$('stages').children].forEach((b, i) => b.classList.toggle('on', i === k));
  $('how').innerHTML = 'Blend: ' + Object.entries(st.weights).map(([w, v]) => `<b>${Math.round(v * 100)}%</b> ${NAMES[w]}`).join(' · ');
  $('rows').innerHTML = st.rows.map((r) => {
    const mv = r.prev == null ? '' : r.prev - r.pos;
    const cls = mv === '' ? 'eq' : mv > 0 ? 'up' : mv < 0 ? 'dn' : 'eq';
    const arrow = mv === '' ? '' : mv > 0 ? `▲${mv}` : mv < 0 ? `▼${-mv}` : '–';
    return `<div class="row ${r.pos <= 3 ? 'top3' : ''}"><div class="pos">P${r.pos}</div><div class="mv ${cls}">${arrow}</div>
      <div class="drv"><b style="background:${r.color}"></b><div><div class="c">${r.code}${r.grid ? ` <span class="t">· grid P${r.grid}</span>` : ''}</div><div class="t">${r.team}</div></div></div>
      <div class="num ${r.gap === 0 ? 'p' : ''}">${fmt(r.optimal)}</div><div class="num y">${r.left != null ? '-' + r.left.toFixed(3) : '–'}</div>
      <div class="num">${fmt(r.longrun)}</div><div class="num m">${r.form != null ? 'P' + r.form.toFixed(1) : '–'}</div></div>`;
  }).join('');
}
$('stages').innerHTML = P.stages.map((s) => `<button>${s.label}</button>`).join('');
[...$('stages').children].forEach((b, i) => (b.onclick = () => show(i)));
show(cur);
