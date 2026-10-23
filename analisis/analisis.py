#!/usr/bin/env python3
"""Analisis hotspot VIIRS Kalbar -> data/*.json untuk WebGIS.
Alur: filter -> (opsional) clip batas -> grid -> Gi* -> skor prioritas
      -> sensitivitas bobot (Monte Carlo) -> leave-one-year-out -> hold-out temporal."""
import argparse, json, math
from pathlib import Path
import numpy as np, pandas as pd
from scipy import ndimage, stats

B = Path(__file__).resolve().parent
ap = argparse.ArgumentParser()
ap.add_argument('--csv', default=str(B/'data_mentah'/'firms_viirs_snpp_kalbar_raw.csv'))
ap.add_argument('--batas', default=str(B/'batas'/'kalbar_kabkota.geojson'))
ap.add_argument('--out', default=str(B.parent/'data'))
ap.add_argument('--cell', type=float, default=0.1, help='ukuran kisi (derajat)')
ap.add_argument('--radius', type=int, default=2, help='radius ketetanggaan Gi* (sel)')
ap.add_argument('--buang-konf', default='l', help="confidence dibuang, pisah koma ('' = tidak ada)")
ap.add_argument('--train', default='2012-2019'); ap.add_argument('--test', default='2020-2025')
ap.add_argument('--mc', type=int, default=1000); ap.add_argument('--top', type=float, default=0.10)
a = ap.parse_args()
out = Path(a.out); out.mkdir(exist_ok=True, parents=True)
rng = np.random.default_rng(42)
W3 = np.array([1/3, 1/3, 1/3])  # bobot baseline: persistensi, intensitas, Gi*

# 1. Baca & filter ------------------------------------------------------------
df = pd.read_csv(a.csv, usecols=['latitude', 'longitude', 'confidence', 'type', 'year', 'month', 'frp', 'daynight'])
n_raw = len(df)
df = df[df.type == 0]; n_type = len(df)
drop = [c for c in a.buang_konf.split(',') if c]
df = df[~df.confidence.isin(drop)]; n_konf = len(df)

# 2. Batas administrasi (opsional tapi sangat disarankan) --------------------
kab = None; bp = Path(a.batas)
if bp.exists():
    import shapely
    from shapely.geometry import shape, mapping
    feats = json.load(open(bp, encoding='utf-8'))['features']
    def nm(p):
        for k in ('nama', 'shapeName', 'NAME_2', 'WADMKK', 'KABKOT', 'NAMOBJ', 'name', 'NAME'):
            if k in p and p[k]: return str(p[k])
        return str(list(p.values())[0])
    kab = [(nm(f['properties']), shape(f['geometry'])) for f in feats]
    union = shapely.union_all([g for _, g in kab])
    df = df[shapely.contains_xy(union, df.longitude.values, df.latitude.values)]
    lon, lat = df.longitude.values, df.latitude.values
    kid = np.full(len(df), -1)
    for i, (_, g) in enumerate(kab): kid[shapely.contains_xy(g, lon, lat) & (kid < 0)] = i
    df = df.assign(kid=kid)
    minx, miny, maxx, maxy = union.bounds
else:
    print('PERINGATAN: batas tidak ada -> memakai kotak sebatas titik (termasuk luar Kalbar). Jangan dipakai untuk naskah.')
    minx, miny, maxx, maxy = df.longitude.min(), df.latitude.min(), df.longitude.max(), df.latitude.max()
n_final = len(df)

# 3. Grid ---------------------------------------------------------------------
c = a.cell
x0, y0 = math.floor(minx/c)*c, math.floor(miny/c)*c
nc, nr = int(math.ceil((maxx-x0)/c)), int(math.ceil((maxy-y0)/c))
cx, cy = x0+(np.arange(nc)+.5)*c, y0+(np.arange(nr)+.5)*c
yrs = sorted(int(y) for y in df.year.unique()); ny = len(yrs)
yi = df.year.map({y: i for i, y in enumerate(yrs)}).values
col = np.clip(((df.longitude.values-x0)/c).astype(int), 0, nc-1)
row = np.clip(((df.latitude.values-y0)/c).astype(int), 0, nr-1)
C = np.bincount((yi*nr+row)*nc+col, minlength=ny*nr*nc).reshape(ny, nr, nc)
X, Y = np.meshgrid(cx, cy)
mask = (shapely.contains_xy(union, X.ravel(), Y.ravel()).reshape(nr, nc) | (C.sum(0) > 0)) if kab else np.ones((nr, nc), bool)
area = np.repeat(((c*111.32)**2*np.cos(np.radians(cy)))[:, None], nc, 1)  # km2

def gistar(x):
    """Getis-Ord Gi* (bobot biner, jendela persegi radius r, hanya sel dalam wilayah)."""
    r = a.radius; k = np.ones((2*r+1, 2*r+1)); m = mask.astype(float)
    W = ndimage.convolve(m, k, mode='constant'); S = ndimage.convolve(x*m, k, mode='constant')
    n = m.sum(); xb = (x*m).sum()/n; s = math.sqrt(max((x*x*m).sum()/n-xb**2, 0))
    den = s*np.sqrt(np.maximum(n*W-W**2, 0)/(n-1))
    return np.where(den > 0, (S-xb*W)/np.where(den > 0, den, 1), 0)*mask

def komponen(sel):
    Cs = C[sel]; tot = Cs.sum(0).astype(float)
    pers = (Cs > 0).mean(0); dens = tot/len(sel)/area*100  # titik/100 km2/tahun
    b = np.log1p(dens); b = b/max(b[mask].max(), 1e-9)
    z = gistar(tot)
    return tot, pers, dens, z, np.stack([pers, b, np.clip(z, 0, 2.576)/2.576])

allsel = list(range(ny))
tot, pers, dens, z, comp = komponen(allsel)
score = (comp*W3[:, None, None]).sum(0)
act = mask & (tot > 0); idx = np.flatnonzero(act.ravel()); N = len(idx)
k_top = math.ceil(a.top*N)

def topset(s, t, k):
    o = np.lexsort((-t.ravel()[idx], -s.ravel()[idx])); return set(idx[o[:k]].tolist())

# 4. Sensitivitas bobot (Monte Carlo Dirichlet) ------------------------------
A = comp.reshape(3, -1)[:, idx]
S = rng.dirichlet([1, 1, 1], a.mc) @ A
tp = np.argpartition(-S, k_top-1, axis=1)[:, :k_top]
stab = np.bincount(tp.ravel(), minlength=N)/a.mc

# 5. Leave-one-year-out -------------------------------------------------------
base = topset(score, tot, k_top); loyo = {}
for i, y in enumerate(yrs):
    t, _, _, _, cm = komponen([j for j in allsel if j != i])
    ts = topset((cm*W3[:, None, None]).sum(0), t, k_top)
    loyo[str(y)] = round(len(base & ts)/len(base | ts), 3)

# 6. Hold-out temporal --------------------------------------------------------
t0, t1 = map(int, a.train.split('-')); e0, e1 = map(int, a.test.split('-'))
tr = [i for i, y in enumerate(yrs) if t0 <= y <= t1]; te = [i for i, y in enumerate(yrs) if e0 <= y <= e1]
t_tr, _, _, _, cm = komponen(tr); s_tr = (cm*W3[:, None, None]).sum(0); t_te = C[te].sum(0).astype(float)
ho = {'train': a.train, 'test': a.test,
      'spearman_komposit': round(float(stats.spearmanr(s_tr.ravel()[idx], t_te.ravel()[idx]).statistic), 3),
      'spearman_baseline': round(float(stats.spearmanr(t_tr.ravel()[idx], t_te.ravel()[idx]).statistic), 3), 'presisi': []}
for f in (0.05, 0.10, 0.20):
    k = math.ceil(f*N); ref = topset(t_te, t_te, k)
    ho['presisi'].append({'top': f, 'k': k, 'komposit': round(len(topset(s_tr, t_tr, k) & ref)/k, 3),
                          'baseline': round(len(topset(t_tr, t_tr, k) & ref)/k, 3)})

# 7. Ekspor -------------------------------------------------------------------
kelas = np.select([z >= 2.576, z >= 1.960, z >= 1.645, z <= -1.645], [3, 2, 1, -1], 0)
rank = np.empty(N, int); rank[np.argsort(-score.ravel()[idx], kind='stable')] = np.arange(1, N+1)
cname = [None]*N
if kab:
    cxy = (X.ravel()[idx], Y.ravel()[idx])
    for n_, g in kab:
        for j in np.flatnonzero(shapely.contains_xy(g, *cxy)):
            if cname[j] is None: cname[j] = n_
feats = []
for j, q in enumerate(idx):
    r, cn = divmod(int(q), nc); xa, ya = round(x0+cn*c, 4), round(y0+r*c, 4); xb, yb = round(xa+c, 4), round(ya+c, 4)
    feats.append({'type': 'Feature', 'geometry': {'type': 'Polygon', 'coordinates': [[[xa, ya], [xb, ya], [xb, yb], [xa, yb], [xa, ya]]]},
                  'properties': {'id': int(q), 'n': int(tot[r, cn]), 'y': C[:, r, cn].tolist(), 'p': round(float(pers[r, cn]), 3),
                                 'd': round(float(dens[r, cn]), 3), 'z': round(float(z[r, cn]), 2), 'k': int(kelas[r, cn]),
                                 's': round(float(score[r, cn]), 3), 'st': round(float(stab[j]), 3), 'rk': int(rank[j]), 'kab': cname[j]}})
json.dump({'type': 'FeatureCollection', 'features': feats}, open(out/'grid.geojson', 'w'), separators=(',', ':'))

mon = df.groupby(['year', 'month']).size().unstack(fill_value=0).reindex(index=yrs, columns=range(1, 13), fill_value=0)
kabj = None
if kab:
    kk = df[df.kid >= 0].groupby(['kid', 'year']).size().unstack(fill_value=0).reindex(index=range(len(kab)), columns=yrs, fill_value=0)
    kl = kelas.ravel()[idx]
    kabj = [{'nama': n_, 'y': kk.loc[i].tolist(), 'total': int(kk.loc[i].sum()),
             'sel_klaster99': sum(1 for j in range(N) if cname[j] == n_ and kl[j] == 3),
             'sel_klaster95': sum(1 for j in range(N) if cname[j] == n_ and kl[j] >= 2)} for i, (n_, _) in enumerate(kab)]
    json.dump({'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {'nama': n_},
               'geometry': mapping(g.simplify(0.004))} for n_, g in kab]}, open(out/'batas.geojson', 'w'), separators=(',', ':'))
hasil = {'meta': {'sumber': 'NASA FIRMS, VIIRS 375 m S-NPP (VIIRS_SNPP_SP)', 'tahun': yrs, 'ukuran_kisi_derajat': c,
                  'radius_gi': a.radius, 'konfidensi_dibuang': drop, 'type_dipakai': 0, 'batas_dipakai': bool(kab),
                  'baris_mentah': n_raw, 'setelah_filter_type': n_type, 'setelah_filter_konfidensi': n_konf, 'baris_final': n_final,
                  'sel_aktif': N, 'nc': nc, 'nr': nr, 'x0': x0, 'y0': y0, 'mask_ids': np.flatnonzero(mask.ravel()).tolist(), 'bobot_baseline': [1/3]*3, 'mc': a.mc, 'top_frac': a.top},
         'tahunan': {'tahun': yrs, 'jumlah': C.sum((1, 2)).tolist(),
                     'frp_rata2': df.groupby('year').frp.mean().reindex(yrs).round(2).tolist(),
                     'siang': (df.daynight == 'D').groupby(df.year).sum().reindex(yrs).astype(int).tolist(),
                     'malam': (df.daynight == 'N').groupby(df.year).sum().reindex(yrs).astype(int).tolist()},
         'bulanan': {'tahun': yrs, 'm': mon.values.tolist()},
         'kabupaten': kabj,
         'validasi': {'holdout': ho, 'loyo_jaccard_top': loyo, 'loyo_rata2': round(float(np.mean(list(loyo.values()))), 3),
                      'mc_stab_sel_top': int((stab >= 0.9).sum()), 'mc_k_top': k_top}}
json.dump(hasil, open(out/'hasil.json', 'w'), separators=(',', ':'))
print(f'Selesai. sel aktif={N}, titik final={n_final:,}/{n_raw:,}; hold-out:', json.dumps(ho['presisi']))
