WEBGIS HOTSPOT KALBAR (XAMPP)

1. Salin folder ini ke C:\xampp\htdocs\webgis_hotspot
2. Start Apache di XAMPP Control Panel (PHP/MySQL tidak diperlukan).
3. Buka http://localhost/webgis_hotspot/  (jangan dobel-klik index.html: fetch data ditolak lewat file://)

Menjalankan ulang analisis:
  a. pip install -r analisis/requirements.txt
  b. Taruh firms_viirs_snpp_kalbar_raw.csv di analisis/data_mentah/
  c. Batas RBI 50K 2023 sudah dikonversi: analisis/batas/kalbar_kabkota.geojson (14 kab/kota).
     Konversi ulang dari shapefile: python analisis/konversi_batas.py <path_tanpa_ekstensi_shp>  (butuh: pip install pyshp)
  d. python analisis/analisis.py
     Opsi: --cell 0.05 --radius 3 --buang-konf "" --train 2012-2019 --test 2020-2025
  e. Muat ulang browser (Ctrl+F5).

Folder data/ berisi hasil analisis dengan batas RBI 50K 2023 dan data VIIRS S-NPP 2012-2025 (parameter default).
Leaflet, Chart.js, dan peta dasar (OSM, Esri satelit, dll) dimuat dari internet.
