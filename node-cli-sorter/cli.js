#!/usr/bin/env node
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');

function parseArgs(argv) {
  const cfg = {
    algo: 'quick',
    n: 100000,
    threads: Math.min(4, os.cpus().length || 4),
    ramMb: 1024,
    seed: Date.now(),
    verify: true,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--algo') cfg.algo = next();
    else if (a === '--n') cfg.n = Number(next());
    else if (a === '--threads') cfg.threads = Number(next());
    else if (a === '--ram-mb') cfg.ramMb = Number(next());
    else if (a === '--seed') cfg.seed = Number(next());
    else if (a === '--no-verify') cfg.verify = false;
    else if (a === '--help') {
      console.log('Usage: node node-cli-sorter/cli.js --algo quick|bubble --n 100000 --threads 4 --ram-mb 1024 [--seed 1] [--no-verify]');
      process.exit(0);
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }

  if (!['quick', 'bubble'].includes(cfg.algo)) throw new Error('--algo must be quick or bubble');
  cfg.n = Math.max(2, Math.floor(cfg.n));
  cfg.threads = Math.max(1, Math.floor(cfg.threads));
  cfg.ramMb = Math.max(128, Math.floor(cfg.ramMb));
  return cfg;
}

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function makeShuffled(n, seed) {
  const arr = Array.from({ length: n }, (_, i) => i + 1);
  const rnd = lcg(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function isSorted(a) {
  for (let i = 1; i < a.length; i++) if (a[i - 1] > a[i]) return false;
  return true;
}

function splitChunks(arr, parts) {
  const out = [];
  const size = Math.ceil(arr.length / parts);
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function mergeSortedArrays(arrays) {
  const merged = [];
  const idx = arrays.map(() => 0);
  while (true) {
    let minVal = Infinity;
    let minIdx = -1;
    for (let i = 0; i < arrays.length; i++) {
      const p = idx[i];
      if (p < arrays[i].length && arrays[i][p] < minVal) {
        minVal = arrays[i][p];
        minIdx = i;
      }
    }
    if (minIdx === -1) break;
    merged.push(minVal);
    idx[minIdx]++;
  }
  return merged;
}

function runWorker(workerPath, payload) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, {
      resourceLimits: {
        maxOldGenerationSizeMb: payload.ramMbPerWorker,
      },
    });
    worker.once('message', (msg) => {
      worker.terminate();
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg);
    });
    worker.once('error', (err) => {
      worker.terminate();
      reject(err);
    });
    worker.postMessage(payload);
  });
}

async function main() {
  const cfg = parseArgs(process.argv);
  const hostThreads = os.cpus().length || 1;
  const hostRamMb = Math.round(os.totalmem() / 1024 / 1024);
  const useThreads = Math.min(cfg.threads, hostThreads);
  const workerRamMb = Math.max(64, Math.floor(cfg.ramMb / useThreads));

  console.log(`[CLI] Host: threads=${hostThreads}, ram_mb=${hostRamMb}`);
  console.log(`[CLI] Config: algo=${cfg.algo}, n=${cfg.n}, threads=${useThreads}, ram_mb=${cfg.ramMb}`);

  const arr = makeShuffled(cfg.n, cfg.seed);
  const chunks = splitChunks(arr, useThreads);
  const workerPath = path.join(__dirname, 'worker.js');

  const t0 = performance.now();
  const results = await Promise.all(
    chunks.map((chunk, i) => runWorker(workerPath, {
      id: i,
      algorithm: cfg.algo,
      chunk,
      ramMbPerWorker: workerRamMb,
    }))
  );

  let comparisons = 0;
  let swaps = 0;
  for (const r of results) {
    comparisons += r.comparisons;
    swaps += r.swaps;
  }

  const merged = mergeSortedArrays(results.map((r) => r.sorted));
  const t1 = performance.now();

  const ok = cfg.verify ? isSorted(merged) : true;

  console.log(
    `[CLI] result algo=${cfg.algo} n=${cfg.n} duration_ms=${Math.round(t1 - t0)} comparisons=${comparisons} swaps=${swaps} sorted=${ok}`
  );

  if (!ok) process.exit(2);
}

main().catch((err) => {
  console.error('[CLI] error:', err.message || err);
  process.exit(1);
});
