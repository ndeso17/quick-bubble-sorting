# C++ OS-Level Sorter

CLI sorter C++ untuk penggunaan resource lebih nyata di level OS.

## Fitur
- Algoritma: `quick` dan `bubble` (odd-even parallel)
- Thread nyata via `std::thread`
- Opsi pinning thread ke core (`--pin-cores`, Linux)
- Batas memori proses via `RLIMIT_AS` (`--ram-mb`, Linux)
- Output metrik durasi, comparisons, swaps

## Build
```bash
cd cpp-sort
cmake -S . -B build
cmake --build build -j
```

## Run
```bash
./build/sorter --algo quick --n 100000 --threads 4 --ram-mb 1024 --pin-cores
./build/sorter --algo bubble --n 20000 --threads 4 --ram-mb 1024
```

## Argumen
- `--algo quick|bubble`
- `--n <jumlah elemen>`
- `--threads <jumlah thread>`
- `--ram-mb <batas RAM proses dalam MB>`
- `--pin-cores` (opsional, Linux)
- `--no-verify` (opsional, skip validasi sorted)

## Catatan
- `--ram-mb` dan `--pin-cores` paling efektif di Linux.
- Untuk kontrol resource yang konsisten di production, jalankan via cgroup/systemd/Docker.
