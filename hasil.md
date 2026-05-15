# Analisis Hasil Benchmark (n=1000, threads=4, ram=2024 MB)

## Data Uji

### Quick Sort

- Node CLI:
  - `duration_ms=116`
  - `comparisons=7987`
  - `swaps=3725`
  - `sorted=true`
- C++:
  - `duration_ms=1`
  - `comparisons=10614`
  - `swaps=4973`
  - `sorted=true`

### Bubble Sort

- Node CLI:
  - `duration_ms=121`
  - `comparisons=123886`
  - `swaps=62974`
  - `sorted=true`
- C++:
  - `duration_ms=13`
  - `comparisons=499422`
  - `swaps=254715`
  - `sorted=true`

---

## Ringkasan Temuan

1. Semua eksekusi valid karena `sorted=true`.
2. C++ jauh lebih cepat dari Node CLI pada kedua algoritma.
3. Nilai `comparisons/swaps` tidak bisa dibandingkan 1:1 antar implementasi karena strategi algoritma internal berbeda.

---

## Analisis Detail

### 1) Performa waktu

- Quick: C++ (`1 ms`) vs Node CLI (`116 ms`) -> C++ sekitar 100x+ lebih cepat.
- Bubble: C++ (`13 ms`) vs Node CLI (`121 ms`) -> C++ sekitar 9x lebih cepat.

Penyebab utama:

- C++ native compile (overhead runtime kecil, memory access lebih efisien).
- Node CLI memakai `worker_threads` + serialisasi/passing data antar worker + overhead V8/GC.
- Untuk input `n=1000`, overhead runtime sangat terasa pada Node.

### 2) Kenapa metrik operasi berbeda

Perbedaan `comparisons` dan `swaps` antara Node vs C++ muncul karena:

- Implementasi quick sort berbeda (pivot behavior, urutan partisi, pembagian chunk).
- Implementasi bubble berbeda (Node CLI saat ini sort per chunk worker lalu merge; C++ saat ini bubble klasik serial stabil).
- Dataset acak berbeda tiap run (tidak menggunakan seed yang sama lintas tool).

Jadi metrik operasi antar dua tool ini tidak apples-to-apples kecuali:

- data input sama persis,
- algoritma dan counting rule sama persis,
- strategi paralelisasi sama.

### 3) Validitas klaim resource

- Node CLI: real OS process, thread nyata via `worker_threads`, limit RAM via V8 worker resource limits.
- C++: real OS process, thread native, opsi `--pin-cores` aktif (Linux), limit proses via RLIMIT_AS.

Artinya kedua tool sudah berada di domain resource OS-level (bukan browser-level).

---

## Perbandingan Node.js CLI vs Browser (dari screenshot)

Kondisi uji browser:

- `n=1000`, core `4`, thread `4`, RAM `2 GB`

### Quick Sort

- Node CLI:
  - `duration_ms=116` (0.116 s)
  - `comparisons=7987`
  - `swaps=3725`
- Browser:
  - `duration=14.44 s`
  - `comparisons=9923`
  - `swaps=4690`

Estimasi rasio waktu:

- Browser sekitar `14.44 / 0.116 = ~124x` lebih lambat dari Node CLI.

### Bubble Sort

- Node CLI:
  - `duration_ms=121` (0.121 s)
  - `comparisons=123886`
  - `swaps=62974`
- Browser:
  - `duration=51.98 s`
  - `comparisons=493506`
  - `swaps=252810`

Estimasi rasio waktu:

- Browser sekitar `51.98 / 0.121 = ~429x` lebih lambat dari Node CLI.

### Kenapa Browser jauh lebih lambat

1. Browser version melakukan rendering visual tiap langkah (DOM update, style/layout, repaint).
2. Ada overhead animasi + sinkronisasi UI thread.
3. Workload sorting di browser bercampur dengan biaya visualisasi, jadi bukan pure compute benchmark.
4. Implementasi browser dan Node CLI tidak identik (counting rule dan alur task berbeda), jadi metrik operasi tidak 1:1.

Kesimpulan bagian ini:

- Node CLI jauh lebih cocok untuk benchmark performa komputasi murni.
- Browser cocok untuk demo visual edukasi, bukan baseline performa algoritma.

---

## Kesimpulan

- Untuk kasus uji ini, C++ lebih unggul jelas pada latency.
- Node CLI tetap valid untuk workflow JS, tapi ada overhead runtime dibanding C++.
- Browser paling lambat karena beban visualisasi/DOM sangat dominan.
- Jika target utama Anda adalah performa mentah dan kontrol resource ketat, C++ adalah pilihan lebih kuat.

## Batasan Rangkuman & Kesimpulan
- Hasil di dokumen ini berlaku untuk skenario uji yang dicatat: `n=1000`, `threads=4`, `RAM=2024 MB` (CLI/C++) dan `2 GB` (browser UI).
- Angka `comparisons` dan `swaps` antar platform tidak sepenuhnya setara karena implementasi internal berbeda.
- Perbandingan Browser vs CLI mencampur efek visualisasi (DOM/render) dengan komputasi, jadi tidak merepresentasikan performa komputasi murni.
- Kesimpulan utama: untuk benchmark performa murni gunakan CLI/C++; browser diposisikan sebagai media visualisasi.
