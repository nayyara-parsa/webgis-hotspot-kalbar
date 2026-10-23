"""Ubah shapefile RBI 50K (kab/kota) -> analisis/batas/kalbar_kabkota.geojson (14 kab/kota, tanpa poligon TIPADM=999)."""
import json, sys, shapefile
from shapely.geometry import shape, mapping
from shapely import force_2d
src = sys.argv[1]; dst = sys.argv[2] if len(sys.argv) > 2 else 'batas/kalbar_kabkota.geojson'
r = shapefile.Reader(src, encoding='utf-8'); feats = []
for sr in r.shapeRecords():
    p = sr.record.as_dict()
    if str(p.get('TIPADM')) == '999' or p['NAMOBJ'] == p.get('WADMPR'): continue  # poligon sisa / bukan kab-kota
    g = force_2d(shape(sr.shape.__geo_interface__)).simplify(0.0005, preserve_topology=True)
    feats.append({'type': 'Feature', 'properties': {'nama': p['NAMOBJ'], 'kode': p['KDPKAB']}, 'geometry': mapping(g)})
json.dump({'type': 'FeatureCollection', 'features': feats}, open(dst, 'w'), separators=(',', ':'))
print(len(feats), 'kab/kota ->', dst)
