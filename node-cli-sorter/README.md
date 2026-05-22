# Node.js CLI Sorter

CLI sorter berbasis Node.js `worker_threads` untuk pemakaian resource di level proses OS.
Array awal dibuat deterministik dan **kebalikan** dari target urutan sort (`--order`), bukan random.

## Run
```bash
node node-cli-sorter/cli.js --algo quick --order asc --n 100000 --threads 4 --ram-mb 1024
node node-cli-sorter/cli.js --algo bubble --order desc --n 20000 --threads 4 --ram-mb 1024
```

Catatan:
- `--order asc` -> array awal `n..1` (descending).
- `--order desc` -> array awal `1..n` (ascending).
- `--seed` tetap diterima untuk kompatibilitas, tapi tidak dipakai pada mode input awal deterministik ini.
