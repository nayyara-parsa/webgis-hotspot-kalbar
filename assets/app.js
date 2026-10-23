/* WebGIS Hotspot Kalbar — data/grid.geojson, data/hasil.json, data/batas.geojson */
const KELAS = { 3: ['Klaster panas, kepercayaan 99%', '#b91c1c'], 2: ['Klaster panas, kepercayaan 95%', '#ea580c'], 1: ['Klaster panas, kepercayaan 90%', '#fbbf24'],
                0: ['Tidak signifikan', '#cbd5e1'], '-1': ['Klaster dingin (≥90%)', '#60a5fa'] };
const RAMP = ['#fff7bc', '#fec44f', '#fe9929', '#d95f0e', '#993404'];
const LAYERS = { k: 'Klaster Gi*', s: 'Skor prioritas', p: 'Persistensi', d: 'Intensitas (titik/100 km²/tahun)', st: 'Stabilitas (seluruh periode)', n: 'Jumlah hotspot' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '-').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (x, d = 0) => Number(x).toLocaleString('id-ID', { maximumFractionDigits: d });
const sum = a => a.reduce((x, y) => x + y, 0);

/* ---------- Peta dasar ---------- */
const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const sat = L.tileLayer(esri + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 17, attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics' });
const lab = L.tileLayer(esri + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 17 });
const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' });
const BASES = {
  'OpenStreetMap': osm, 'Satelit (Esri)': sat, 'Satelit + label': L.layerGroup([sat, lab]),
  'Topografi (OpenTopoMap)': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '&copy; OpenTopoMap, OSM' }),
  'Terang (CARTO)': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '&copy; OSM, CARTO' }),
  'Gelap (CARTO)': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '&copy; OSM, CARTO' }),
};
const map = L.map('map', { layers: [BASES['Satelit + label']] }).setView([-0.3, 111.0], 7);
L.control.scale({ imperial: false }).addTo(map);
const coord = L.control({ position: 'bottomright' });
coord.onAdd = () => (coord.el = L.DomUtil.create('div', 'coord', undefined)); coord.addTo(map); coord.el.textContent = 'Arahkan kursor ke peta';
map.on('mousemove', e => coord.el.textContent = e.latlng.lat.toFixed(4) + ', ' + e.latlng.lng.toFixed(4));

let H, G, gridLayer, batasLayer, labelLayer, legend, charts = {}, cellLayers = {}, kabBounds = {}, R = new Map(), TOP = [], playT = null;
const st = { lyr: 'k', i0: 0, i1: 0, op: 0.75 };  // st.i0/i1 = periode yang SUDAH diterapkan

/* <compute> — hitung ulang indikator untuk rentang indeks tahun [i0, i1] (sama dengan analisis.py) */
function compute(i0, i1) {
  const M = H.meta, nc = M.nc, nr = M.nr, c = M.ukuran_kisi_derajat, r = M.radius_gi, ny = i1 - i0 + 1;
  const tot = new Float64Array(nr * nc), pers = new Float64Array(nr * nc), m = new Uint8Array(nr * nc);
  M.mask_ids.forEach(q => m[q] = 1);
  G.features.forEach(f => { const p = f.properties; let t = 0, k = 0; for (let i = i0; i <= i1; i++) { t += p.y[i]; if (p.y[i] > 0) k++; } tot[p.id] = t; pers[p.id] = k / ny; });
  const ids = M.mask_ids, n = ids.length; let sx = 0, sxx = 0;
  ids.forEach(q => { sx += tot[q]; sxx += tot[q] * tot[q]; });
  const xb = sx / n, s = Math.sqrt(Math.max(sxx / n - xb * xb, 0)), tmp = []; let mb = 1e-9;
  ids.forEach(q => {
    const row = Math.floor(q / nc), col = q % nc; let W = 0, S1 = 0;
    for (let dr = -r; dr <= r; dr++) { const rr = row + dr; if (rr < 0 || rr >= nr) continue;
      for (let dc = -r; dc <= r; dc++) { const cc = col + dc; if (cc < 0 || cc >= nc) continue; const qq = rr * nc + cc; if (m[qq]) { W++; S1 += tot[qq]; } } }
    const den = s * Math.sqrt(Math.max(n * W - W * W, 0) / (n - 1)), z = den > 0 ? (S1 - xb * W) / den : 0;
    const area = Math.pow(c * 111.32, 2) * Math.cos((H.meta.y0 + (row + .5) * c) * Math.PI / 180), d = tot[q] / ny / area * 100;
    mb = Math.max(mb, Math.log1p(d)); tmp.push([q, z, d]);
  });
  const out = new Map();
  tmp.forEach(([q, z, d]) => {
    if (tot[q] <= 0) return;
    const sc = (pers[q] + Math.log1p(d) / mb + Math.min(Math.max(z, 0), 2.576) / 2.576) / 3;
    out.set(q, { n: tot[q], p: pers[q], d, z, k: z >= 2.576 ? 3 : z >= 1.96 ? 2 : z >= 1.645 ? 1 : z <= -1.645 ? -1 : 0, s: sc });
  });
  [...out.entries()].sort((a, b) => b[1].s - a[1].s || b[1].n - a[1].n).forEach(([, v], i) => v.rk = i + 1);
  return out;
}
/* </compute> */

const ramp = t => RAMP[Math.min(4, Math.max(0, Math.floor(t * 5)))];
function cur(p) { return R.get(p.id); }
function val(p) { const c = cur(p); return st.lyr === 'st' ? p.st : c ? c[st.lyr] : 0; }
function cellStyle(f, mx) {
  const p = f.properties, c = cur(p);
  if (!c) return { stroke: false, fill: false };
  let col;
  if (st.lyr === 'k') col = KELAS[c.k][1];
  else { const v = val(p); col = (st.lyr === 'd' || st.lyr === 'n') ? ramp(Math.log1p(v) / Math.log1p(mx)) : ramp(v); }
  return { fillColor: col, fillOpacity: st.op, color: '#333', weight: .3, stroke: true, fill: true };
}
const periode = () => H.meta.tahun[st.i0] === H.meta.tahun[st.i1] ? '' + H.meta.tahun[st.i0] : H.meta.tahun[st.i0] + '–' + H.meta.tahun[st.i1];

function popup(p) {
  const c = cur(p); if (!c) return '';
  const rows = [['Kab/kota', p.kab], ['Hotspot (' + periode() + ')', fmt(c.n)], ['Persistensi', fmt(c.p * 100) + '% tahun'], ['Intensitas', fmt(c.d, 2) + ' titik/100 km²/thn'],
    ['Gi* (z)', c.z.toFixed(2)], ['Kelas', KELAS[c.k][0]], ['Skor prioritas', c.s.toFixed(3)], ['Peringkat', c.rk + ' dari ' + fmt(R.size)],
    ['Stabilitas (seluruh periode)', fmt(p.st * 100) + '% masuk 10% teratas']];
  const mini = '<div style="display:flex;align-items:flex-end;gap:2px;height:40px;margin-top:6px">' + (() => { const mx = Math.max(...p.y, 1);
    return p.y.map((v, i) => `<div title="${H.meta.tahun[i]}: ${v}" style="flex:1;background:${i >= st.i0 && i <= st.i1 ? '#d95f0e' : '#bbb'};height:${Math.max(v / mx * 100, 2)}%"></div>`).join(''); })() + '</div><small>Hotspot per tahun ' + H.meta.tahun[0] + '–' + H.meta.tahun.at(-1) + '</small>';
  return '<table>' + rows.map(r => `<tr><th>${r[0]}</th><td>${esc(r[1])}</td></tr>`).join('') + '</table>' + mini;
}

function draw() {
  const feats = G.features.filter(f => cur(f.properties));
  const mx = st.lyr === 'd' ? Math.max(...feats.map(f => cur(f.properties).d)) : st.lyr === 'n' ? Math.max(...feats.map(f => cur(f.properties).n)) : 1;
  if (!gridLayer) {
    gridLayer = L.geoJSON(G, { style: f => cellStyle(f, mx), onEachFeature: (f, l) => { cellLayers[f.properties.id] = l; l.bindPopup(() => popup(f.properties), { minWidth: 240 }); } }).addTo(map);
    layersCtl.addOverlay(gridLayer, 'Grid hotspot');
  } else gridLayer.setStyle(f => cellStyle(f, mx));
  drawLegend(mx);
}
function drawLegend(mx) {
  if (legend) map.removeControl(legend);
  legend = L.control({ position: 'bottomleft' });
  legend.onAdd = () => {
    const d = L.DomUtil.create('div', 'legend'); let h = `<b>${LAYERS[st.lyr]}</b><br><small>Periode ${periode()}</small><br>`;
    if (st.lyr === 'k') h += Object.values(KELAS).map(k => `<i style="background:${k[1]}"></i>${k[0]}`).join('<br>');
    else { const lab = (st.lyr === 'd' || st.lyr === 'n') ? [1, 2, 3, 4, 5].map(i => '≤ ' + fmt(Math.expm1(Math.log1p(mx) * i / 5), 1)) : ['0–0,2', '0,2–0,4', '0,4–0,6', '0,6–0,8', '0,8–1'];
      h += RAMP.map((c, i) => `<i style="background:${c}"></i>${lab[i]}`).join('<br>'); }
    d.innerHTML = h; return d;
  };
  legend.addTo(map);
}

/* ---------- Tabel ---------- */
function renderTop() {
  TOP = G.features.filter(f => cur(f.properties)).sort((a, b) => cur(a.properties).rk - cur(b.properties).rk).slice(0, 10);
  $('top').innerHTML = '<table><tr><th>#</th><th>Kab/kota</th><th>Skor</th><th>Gi* z</th><th>Hotspot</th></tr>' +
    TOP.map(f => { const p = f.properties, c = cur(p); return `<tr class="klik" data-id="${p.id}"><td>${c.rk}</td><td>${esc(p.kab)}</td><td>${c.s.toFixed(3)}</td><td>${c.z.toFixed(2)}</td><td>${fmt(c.n)}</td></tr>`; }).join('') + '</table>';
  $('top').querySelectorAll('tr.klik').forEach(tr => tr.onclick = () => { const l = cellLayers[tr.dataset.id]; map.fitBounds(l.getBounds(), { maxZoom: 10 }); l.openPopup(); });
}
function kabPeriode() {
  return H.kabupaten.map(k => ({ nama: k.nama, total: sum(k.y.slice(st.i0, st.i1 + 1)), y: k.y,
    k95: G.features.filter(f => f.properties.kab === k.nama && cur(f.properties) && cur(f.properties).k >= 2).length })).sort((a, b) => b.total - a.total);
}
function renderKab() {
  if (!H.kabupaten) return; $('kabH').hidden = false;
  $('kab').innerHTML = '<table><tr><th>Kab/kota</th><th>Hotspot</th><th>Sel klaster ≥95%</th></tr>' +
    kabPeriode().map(x => `<tr><td>${esc(x.nama)}</td><td>${fmt(x.total)}</td><td>${x.k95}</td></tr>`).join('') + '</table>';
}

/* ---------- Grafik ---------- */
Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue('--mut').trim() || '#667085';
Chart.defaults.maintainAspectRatio = false;
function mk(id, cfg) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart($(id), cfg); }
function renderCharts() {
  const T = H.tahunan, Y = T.tahun, sel = Y.map((_, i) => i >= st.i0 && i <= st.i1), months = Array(12).fill(0);
  H.bulanan.m.slice(st.i0, st.i1 + 1).forEach(r => r.forEach((v, i) => months[i] += v));
  const total = sum(T.jumlah.slice(st.i0, st.i1 + 1)), ny = st.i1 - st.i0 + 1, pk = T.jumlah.indexOf(Math.max(...T.jumlah.slice(st.i0, st.i1 + 1).map((v, i) => v)) , st.i0);
  const pkBulan = months.indexOf(Math.max(...months)), siang = sum(T.siang.slice(st.i0, st.i1 + 1)), malam = sum(T.malam.slice(st.i0, st.i1 + 1));
  $('cards').innerHTML = [[fmt(total), 'Total hotspot ' + periode()], [fmt(total / ny), 'Rata-rata per tahun'], [Y[pk] + ' (' + fmt(T.jumlah[pk]) + ')', 'Tahun puncak dalam periode'], [MONTHS[pkBulan], 'Bulan puncak (' + fmt(months[pkBulan] / Math.max(total, 1) * 100, 0) + '% dari total)']]
    .map(x => `<div><b>${x[0]}</b><span>${x[1]}</span></div>`).join('');
  mk('cTh', { data: { labels: Y, datasets: [
    { type: 'bar', label: 'Hotspot', data: T.jumlah, backgroundColor: sel.map(s => s ? '#d95f0e' : '#d95f0e44'), yAxisID: 'y' },
    { type: 'line', label: 'FRP rata-rata (MW)', data: T.frp_rata2, borderColor: '#2563eb', backgroundColor: '#2563eb', yAxisID: 'y2', tension: .25, pointRadius: 3 }] },
    options: { scales: { y: { beginAtZero: true, title: { display: true, text: 'Jumlah hotspot' } }, y2: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'FRP (MW)' } } } } });
  mk('cBl', { type: 'bar', data: { labels: MONTHS, datasets: [{ label: 'Total hotspot', data: months, backgroundColor: '#993404' }] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmt(c.raw) + ' (' + fmt(c.raw / Math.max(total, 1) * 100, 1) + '%)' } } }, scales: { y: { beginAtZero: true } } } });
  // peta panas tahun x bulan
  const mx = Math.log1p(Math.max(...H.bulanan.m.flat()));
  $('heat').innerHTML = '<table class="heat"><tr><th></th>' + MONTHS.map(m => `<th>${m}</th>`).join('') + '</tr>' +
    H.bulanan.m.map((r, i) => `<tr class="${sel[i] ? 'sel' : ''}"><th>${Y[i]}</th>` + r.map(v => `<td title="${Y[i]} ${fmt(v)}" style="background:${v ? ramp(Math.log1p(v) / mx) : 'transparent'};color:#000;opacity:${sel[i] ? 1 : .45}">${v ? (v >= 1000 ? Math.round(v / 1000) + 'k' : v) : ''}</td>`).join('') + '</tr>').join('') + '</table>';
  if (H.kabupaten) {
    const kp = kabPeriode(); mk('cKab', { type: 'bar', data: { labels: kp.map(k => k.nama), datasets: [{ label: 'Hotspot', data: kp.map(k => k.total), backgroundColor: '#d95f0e' }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false } } } });
    const opt = $('tk'); if (!opt.options.length) opt.innerHTML = '<option value="">Seluruh Kalimantan Barat</option>' + H.kabupaten.map(k => `<option>${esc(k.nama)}</option>`).join('');
    const ser = opt.value ? H.kabupaten.find(k => k.nama === opt.value).y : T.jumlah;
    mk('cTr', { type: 'line', data: { labels: Y, datasets: [{ label: opt.value || 'Kalbar', data: ser, borderColor: '#d95f0e', backgroundColor: '#d95f0e', pointBackgroundColor: sel.map(s => s ? '#d95f0e' : '#bbb'), tension: .2 }] }, options: { scales: { y: { beginAtZero: true } } } });
  }
  mk('cDn', { type: 'doughnut', data: { labels: ['Siang', 'Malam'], datasets: [{ data: [siang, malam], backgroundColor: ['#f59e0b', '#1e3a8a'] }] },
    options: { plugins: { tooltip: { callbacks: { label: c => c.label + ': ' + fmt(c.raw) + ' (' + fmt(c.raw / Math.max(siang + malam, 1) * 100, 1) + '%)' } } } } });
}

/* ---------- Metode ---------- */
function renderMetode() {
  const m = H.meta, v = H.validasi, ho = v.holdout;
  const P = ho.presisi.map(p => `<tr><td>${p.top * 100}% teratas (${p.k} sel)</td><td>${fmt(p.komposit * 100, 1)}%</td><td>${fmt(p.baseline * 100, 1)}%</td></tr>`).join('');
  const loyo = Object.entries(v.loyo_jaccard_top).map(([y, j]) => `<tr><td>${y}</td><td>${j}</td></tr>`).join('');
  $('met').innerHTML = `
  ${m.batas_dipakai ? '' : '<div class="note" style="border:1px solid #dc2626"><b>Peringatan:</b> batas administrasi belum dipakai; hasil hanya untuk uji tampilan.</div>'}
  <h3>Data dan penyaringan</h3>
  <table><tr><th>Sumber</th><td>${esc(m.sumber)}</td></tr><tr><th>Periode</th><td>${m.tahun[0]}–${m.tahun.at(-1)}</td></tr>
  <tr><th>Baris mentah</th><td>${fmt(m.baris_mentah)}</td></tr><tr><th>Setelah buang type ≠ 0</th><td>${fmt(m.setelah_filter_type)}</td></tr>
  <tr><th>Setelah buang confidence ${esc(m.konfidensi_dibuang.join(', ') || '(tidak ada)')}</th><td>${fmt(m.setelah_filter_konfidensi)}</td></tr>
  <tr><th>Dipakai (setelah clip batas)</th><td>${fmt(m.baris_final)}</td></tr>
  <tr><th>Ukuran kisi</th><td>${m.ukuran_kisi_derajat}° (≈ ${fmt(m.ukuran_kisi_derajat * 111.32, 1)} km)</td></tr>
  <tr><th>Ketetanggaan Gi*</th><td>jendela persegi radius ${m.radius_gi} sel</td></tr>
  <tr><th>Sel dalam wilayah / berhotspot</th><td>${fmt(m.mask_ids.length)} / ${fmt(m.sel_aktif)}</td></tr></table>
  <h3>Skor prioritas</h3>
  <p>Skor = rata-rata tertimbang persistensi (proporsi tahun dengan hotspot), intensitas (log kepadatan, dinormalkan), dan Gi* (z dipotong 0–2,576). Bobot baseline sama. Kelas peta mengikuti signifikansi Gi* (z ≥ 1,645; 1,960; 2,576). Saat periode diubah, ketiga indikator dihitung ulang untuk periode itu.</p>
  <h3>Sensitivitas dan kestabilan (seluruh periode)</h3>
  <p>Monte Carlo ${fmt(m.mc)} kombinasi bobot: ${fmt(v.mc_stab_sel_top)} dari ${fmt(v.mc_k_top)} sel teratas masuk 10% teratas pada ≥90% simulasi. Leave-one-year-out (Jaccard 10% teratas; rata-rata ${v.loyo_rata2}):</p>
  <table><tr><th>Tahun dikeluarkan</th><th>Jaccard</th></tr>${loyo}</table>
  <h3>Validasi hold-out temporal</h3>
  <p>Prioritas dihitung dari ${ho.train}, dibandingkan dengan sel teratas menurut jumlah hotspot ${ho.test}. Baseline: peringkat jumlah hotspot ${ho.train}. Nilai = irisan sel teratas (presisi).</p>
  <table><tr><th>Kelompok</th><th>Komposit</th><th>Baseline</th></tr>${P}</table>
  <p>Spearman terhadap jumlah hotspot ${ho.test}: komposit ${ho.spearman_komposit}; baseline ${ho.spearman_baseline}.</p>
  <h3>Batas interpretasi</h3>
  <div class="note">Hotspot adalah anomali termal yang terdeteksi satelit, bukan bukti kebakaran terkonfirmasi. Peta ini menunjukkan <b>wilayah prioritas pemantauan berbasis riwayat hotspot</b>, bukan peta risiko kebakaran. Validasi hold-out menguji konsistensi pola historis, bukan prediksi.</div>
  <h3>Acknowledgement</h3>
  <p style="font-size:12px;color:var(--mut)">We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Earth Science Data and Information System (ESDIS). Periksa teks sitasi terbaru di situs FIRMS.</p>
  <p><a href="data/grid.geojson" download>Unduh grid.geojson</a> · <a href="data/hasil.json" download>Unduh hasil.json</a></p>`;
}

/* ---------- Kontrol ---------- */
let layersCtl;
function apply(i0, i1) {
  if (i0 > i1) [i0, i1] = [i1, i0];
  st.i0 = i0; st.i1 = i1; $('y0').value = i0; $('y1').value = i1;
  R = compute(i0, i1);
  $('badge').textContent = 'Periode aktif: ' + periode() + ' · ' + fmt(R.size) + ' sel berhotspot';
  draw(); renderTop(); renderKab(); renderCharts();
}
function csv() {
  const M = H.meta, c = M.ukuran_kisi_derajat, rows = ['id,kab_kota,lon,lat,hotspot,persistensi,intensitas,gi_z,kelas,skor,peringkat'];
  G.features.filter(f => cur(f.properties)).sort((a, b) => cur(a.properties).rk - cur(b.properties).rk).forEach(f => {
    const p = f.properties, v = cur(p), row = Math.floor(p.id / M.nc), col = p.id % M.nc;
    rows.push([p.id, '"' + (p.kab || '') + '"', (M.x0 + (col + .5) * c).toFixed(4), (M.y0 + (row + .5) * c).toFixed(4), v.n, v.p.toFixed(3), v.d.toFixed(3), v.z.toFixed(2), v.k, v.s.toFixed(3), v.rk].join(','));
  });
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' })); a.download = `peringkat_sel_${periode()}.csv`; a.click();
}
function init() {
  const ys = H.meta.tahun, opts = ys.map((y, i) => `<option value="${i}">${y}</option>`).join('');
  $('y0').innerHTML = opts; $('y1').innerHTML = opts; $('y1').value = ys.length - 1;
  $('apply').onclick = () => apply(+$('y0').value, +$('y1').value);
  $('reset').onclick = () => { stopPlay(); apply(0, ys.length - 1); };
  $('lyr').onchange = e => { st.lyr = e.target.value; draw(); };
  $('op').oninput = e => { st.op = +e.target.value; draw(); };
  $('tk').onchange = renderCharts; $('csv').onclick = csv;
  function stopPlay() { clearInterval(playT); playT = null; $('play').textContent = '▶ Putar'; }
  $('play').onclick = () => {
    if (playT) return stopPlay(); let i = 0; $('play').textContent = '■ Berhenti';
    const step = () => { apply(i, i); if (++i >= ys.length) stopPlay(); }; step(); playT = setInterval(step, 1600);
  };
  const ov = {};
  if (batasLayer) { ov['Batas kab/kota'] = batasLayer; labelLayer = L.layerGroup(); ov['Label kabupaten'] = labelLayer; }
  layersCtl = L.control.layers(BASES, ov, { collapsed: true }).addTo(map);
  if (H.kabupaten) {
    $('zk').innerHTML += H.kabupaten.map(k => `<option>${esc(k.nama)}</option>`).join('');
    $('zk').onchange = e => e.target.value ? map.fitBounds(kabBounds[e.target.value]) : map.fitBounds(gridLayer.getBounds());
  }
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button, .tab').forEach(e => e.classList.remove('on'));
  b.classList.add('on'); $(b.dataset.t).classList.add('on'); setTimeout(() => Object.values(charts).forEach(c => c.resize()), 50);
});

(async () => {
  try {
    const j = u => fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.json(); });
    [G, H] = await Promise.all([j('data/grid.geojson'), j('data/hasil.json')]);
    try {
      const B = await j('data/batas.geojson');
      batasLayer = L.geoJSON(B, { style: { color: '#fff', weight: 1.4, fill: false }, interactive: false, onEachFeature: (f, l) => kabBounds[f.properties.nama] = l.getBounds() }).addTo(map);
    } catch (e) { /* batas opsional */ }
    init();
    if (batasLayer) Object.entries(kabBounds).forEach(([n, b]) => L.marker(b.getCenter(), { interactive: false, icon: L.divIcon({ className: '', html: `<span style="color:#fff;text-shadow:0 0 3px #000,0 0 3px #000;font-size:11px;white-space:nowrap">${esc(n)}</span>` }) }).addTo(labelLayer));
    renderMetode(); apply(0, H.meta.tahun.length - 1); map.fitBounds(gridLayer.getBounds());
  } catch (e) {
    $('peta').innerHTML = '<div class="note">Data belum ada atau halaman dibuka lewat file://. Jalankan analisis/analisis.py lalu buka lewat http://localhost/ (XAMPP). Detail: ' + esc(e.message) + '</div>';
  }
})();
