      let arr = [];
      let sorting = false;
      let paused = false;
      let runStartTime = 0;
      let elapsedBeforePause = 0;

      let comp = 0, sw = 0, ps = 0;
      let hiI = -1, hiJ = -1;

      let workerPool = null;
      const pendingTasks = new Map();
      let taskSeq = 1;
      let hostResources = null;

      function formatDuration(ms) {
        if (ms < 1000) return `${Math.round(ms)} ms`;
        return `${(ms / 1000).toFixed(2)} s`;
      }

      function getElapsedMs() {
        if (!runStartTime) return elapsedBeforePause;
        return elapsedBeforePause + (performance.now() - runStartTime);
      }

      function updateDuration() {
        document.getElementById("sTime").textContent = formatDuration(getElapsedMs());
      }

      function updateStats() {
        document.getElementById("sComp").textContent = comp;
        document.getElementById("sSwap").textContent = sw;
        document.getElementById("sPass").textContent = ps;
      }

      function toBytesFromGb(gb) {
        return gb * 1024 * 1024 * 1024;
      }

      function estimateMemoryBytes(n, threadCount) {
        const valueBytes = 8;
        const dataBytes = n * valueBytes;
        const scratchFrames = dataBytes * 4;
        const workerOverhead = threadCount * 2 * 1024 * 1024;
        const uiOverhead = n * 256;
        return dataBytes + scratchFrames + workerOverhead + uiOverhead;
      }

      function getHardwareThreads() {
        return Math.max(1, navigator.hardwareConcurrency || 4);
      }

      async function fetchHostResources() {
        const fallbackThreads = getHardwareThreads();
        const fallback = {
          cpuCores: fallbackThreads,
          cpuThreads: fallbackThreads,
          ramGbTotal: 8,
          ramGbFree: 2,
          fromFallback: true,
        };

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 2500);
          const res = await fetch('/api/system/resources', { signal: controller.signal });
          clearTimeout(timeout);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const d = await res.json();

          const cpuCores = Math.max(1, Math.floor(Number(d.cpuCores)) || 0);
          const cpuThreads = Math.max(1, Math.floor(Number(d.cpuThreads)) || 0);
          const ramGbTotalRaw = Number(d.ramGbTotal);
          const ramGbFreeRaw = Number(d.ramGbFree);
          if (!(ramGbTotalRaw > 0) || !(ramGbFreeRaw > 0) || cpuCores < 1 || cpuThreads < 1) {
            throw new Error('Invalid payload');
          }

          let ramGbTotal = ramGbTotalRaw;
          let ramGbFree = ramGbFreeRaw;
          if (ramGbFree > ramGbTotal) {
            ramGbFree = ramGbTotal;
            console.warn('ramGbFree > ramGbTotal, clamped');
          }

          return {
            cpuCores,
            cpuThreads,
            ramGbTotal,
            ramGbFree,
            fromFallback: false,
          };
        } catch (_e) {
          document.getElementById('msg').textContent = '⚠ Gagal deteksi host resource dari backend, memakai fallback lokal.';
          return fallback;
        }
      }

      function setSelectOptions(selectEl, values, formatter = (v) => String(v)) {
        const current = selectEl.value;
        selectEl.innerHTML = '';
        values.forEach((v) => {
          const opt = document.createElement('option');
          opt.value = String(v);
          opt.textContent = formatter(v);
          selectEl.appendChild(opt);
        });
        if (values.some((v) => String(v) === current)) selectEl.value = current;
      }

      function buildRamOptions(maxFreeGb) {
        const cap = Math.max(0.5, Math.floor(maxFreeGb));
        const base = [0.5, 1, 2, 4, 8, 12, 16, 24, 32, 48, 64];
        const out = base.filter((x) => x <= cap);
        if (!out.length) out.push(0.5);
        if (!out.includes(cap) && cap > out[out.length - 1]) out.push(cap);
        return Array.from(new Set(out)).sort((a, b) => a - b);
      }

      function populateResourceSelections(host) {
        hostResources = host;
        const coreSelect = document.getElementById('coreSelect');
        const threadSelect = document.getElementById('threadSelect');
        const ramSelect = document.getElementById('ramSelect');

        const coreOpts = Array.from({ length: host.cpuCores }, (_, i) => i + 1);
        setSelectOptions(coreSelect, coreOpts);

        const defaultCore = Math.max(1, Math.min(host.cpuCores, host.cpuThreads));
        coreSelect.value = String(defaultCore);

        const threadMax = Math.min(defaultCore, host.cpuThreads);
        const threadOpts = Array.from({ length: threadMax }, (_, i) => i + 1);
        setSelectOptions(threadSelect, threadOpts);
        threadSelect.value = String(Math.max(1, Math.min(threadMax, 4)));

        const ramOpts = buildRamOptions(host.ramGbFree);
        setSelectOptions(ramSelect, ramOpts, (v) => `${v} GB`);
        const preferredRam = ramOpts.includes(2) ? 2 : ramOpts[ramOpts.length - 1];
        ramSelect.value = String(preferredRam);

        coreSelect.addEventListener('change', () => {
          const selectedCore = Math.max(1, parseInt(coreSelect.value, 10) || 1);
          const currentThread = Math.max(1, parseInt(threadSelect.value, 10) || 1);
          const newThreadMax = Math.min(selectedCore, host.cpuThreads);
          const newThreadOpts = Array.from({ length: newThreadMax }, (_, i) => i + 1);
          setSelectOptions(threadSelect, newThreadOpts);
          threadSelect.value = String(Math.min(currentThread, newThreadMax));
          readResources();
        });

        threadSelect.addEventListener('change', readResources);
        ramSelect.addEventListener('change', readResources);

        readResources();
      }

      function readResources() {
        const coreSelect = document.getElementById('coreSelect');
        const threadSelect = document.getElementById('threadSelect');
        const ramSelect = document.getElementById('ramSelect');

        const hostThreads = hostResources ? hostResources.cpuThreads : getHardwareThreads();
        const hostCores = hostResources ? hostResources.cpuCores : hostThreads;

        let coreCount = Math.max(1, parseInt(coreSelect.value, 10) || 1);
        let threadCount = Math.max(1, parseInt(threadSelect.value, 10) || 1);
        let ramGb = Math.max(0.5, parseFloat(ramSelect.value) || 0.5);

        coreCount = Math.min(coreCount, hostCores);
        threadCount = Math.min(threadCount, coreCount, hostThreads);

        coreSelect.value = String(coreCount);
        threadSelect.value = String(threadCount);

        const effectiveWorkers = threadCount;
        const hostTxt = hostResources
          ? `Host detected: ${hostResources.cpuCores}C/${hostResources.cpuThreads}T, RAM total ${hostResources.ramGbTotal} GB, free ${hostResources.ramGbFree} GB`
          : `Host detected: ${hostCores}C/${hostThreads}T`;
        document.getElementById('resourceHint').textContent = `${hostTxt} | Effective worker: ${effectiveWorkers}`;

        return { coreCount, threadCount, ramGb, ramBytes: toBytesFromGb(ramGb), hostThreads, effectiveWorkers };
      }

      function render(a, ci, cj, sortedMask) {
        const wrap = document.getElementById("chart-wrap");
        if (!a.length) {
          wrap.innerHTML = "";
          return;
        }
        const maxVal = Math.max(...a);
        const maxH = 230;
        wrap.innerHTML = "";
        a.forEach((v, idx) => {
          const col = document.createElement("div");
          col.className = "bar-col";

          const h = Math.max(18, Math.round((v / maxVal) * maxH));
          const bar = document.createElement("div");
          bar.className = "bar " + (sortedMask && sortedMask[idx] ? "sorted" : (idx === ci || idx === cj ? "orange" : "yellow"));
          bar.style.height = h + "px";

          const val = document.createElement("span");
          val.className = "bar-val";
          val.textContent = v;
          bar.appendChild(val);

          const idxEl = document.createElement("span");
          idxEl.className = "bar-idx";
          idxEl.textContent = idx;

          col.appendChild(bar);
          col.appendChild(idxEl);
          wrap.appendChild(col);
        });
      }

      function createWorkerPool(size) {
        const workerCode = `
self.onmessage = function(e) {
  const { taskId, task } = e.data;
  if (!task || task.type !== "pairBatch") {
    self.postMessage({ taskId, error: "Invalid task" });
    return;
  }
  try {
    const { source, pairs } = task;
    const updates = [];
    let localComp = 0;
    let localSwap = 0;
    for (let k = 0; k < pairs.length; k++) {
      const i = pairs[k][0];
      const j = pairs[k][1];
      localComp++;
      if (source[i] > source[j]) {
        localSwap++;
        updates.push([i, source[j], j, source[i]]);
      }
    }
    self.postMessage({ taskId, result: { updates, localComp, localSwap } });
  } catch (err) {
    self.postMessage({ taskId, error: err && err.message ? err.message : String(err) });
  }
};`;

        const blob = new Blob([workerCode], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        const workers = [];

        for (let i = 0; i < size; i++) {
          const worker = new Worker(url);
          worker.busy = false;
          worker.onmessage = (e) => {
            const { taskId, result, error } = e.data;
            const slot = pendingTasks.get(taskId);
            if (!slot) return;
            pendingTasks.delete(taskId);
            worker.busy = false;
            if (error) slot.reject(new Error(error));
            else slot.resolve(result);
          };
          workers.push(worker);
        }

        return {
          workers,
          size,
          async runTask(task) {
            const freeWorker = await this.acquireWorker();
            return new Promise((resolve, reject) => {
              const taskId = taskSeq++;
              pendingTasks.set(taskId, { resolve, reject });
              freeWorker.busy = true;
              freeWorker.postMessage({ taskId, task });
            });
          },
          async acquireWorker() {
            while (true) {
              const w = this.workers.find((x) => !x.busy);
              if (w) return w;
              await new Promise((r) => setTimeout(r, 1));
            }
          },
          destroy() {
            this.workers.forEach((w) => w.terminate());
            URL.revokeObjectURL(url);
          }
        };
      }

      function chunkPairs(pairs, chunksCount) {
        if (!pairs.length) return [[]];
        const result = Array.from({ length: Math.max(1, chunksCount) }, () => []);
        for (let i = 0; i < pairs.length; i++) result[i % result.length].push(pairs[i]);
        return result.filter((x) => x.length > 0);
      }

      async function runBubbleParallel() {
        const n = arr.length;
        const sortedMask = new Array(n).fill(false);

        for (let phase = 0; phase < n; phase++) {
          await waitIfPaused();
          if (!sorting) return;

          ps = phase + 1;
          const start = phase % 2;
          const pairs = [];
          for (let i = start; i < n - 1; i += 2) pairs.push([i, i + 1]);

          const chunks = chunkPairs(pairs, workerPool.size);
          const snapshot = arr.slice();
          const results = await Promise.all(chunks.map((group) => workerPool.runTask({ type: "pairBatch", source: snapshot, pairs: group })));

          let anySwap = false;
          for (const result of results) {
            comp += result.localComp;
            sw += result.localSwap;
            for (const u of result.updates) {
              anySwap = true;
              const i = u[0], vi = u[1], j = u[2], vj = u[3];
              arr[i] = vi;
              arr[j] = vj;
              hiI = i;
              hiJ = j;
            }
          }

          const sortedSuffix = Math.max(0, phase - 1);
          for (let k = 0; k < sortedSuffix; k++) sortedMask[n - 1 - k] = true;

          render(arr, hiI, hiJ, sortedMask);
          updateStats();
          updateDuration();
          document.getElementById("msg").textContent = anySwap
            ? `Pass ${ps}: compare+swap selesai (${pairs.length} pasangan).`
            : `Pass ${ps}: tidak ada swap.`;

          if (!anySwap && phase > 0) break;
          await new Promise((r) => setTimeout(r, 0));
        }

        for (let i = 0; i < n; i++) sortedMask[i] = true;
        render(arr, -1, -1, sortedMask);
      }

      async function waitIfPaused() {
        while (paused && sorting) {
          await new Promise((r) => setTimeout(r, 20));
        }
      }

      function generate() {
        resetRuntimeOnly();
        const n = Math.max(2, parseInt(document.getElementById("nInput").value, 10) || 24);
        document.getElementById("nInput").value = n;

        arr = Array.from({ length: n }, (_, i) => i + 1);
        for (let i = n - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }

        render(arr, -1, -1, new Array(n).fill(false));
        document.getElementById("msg").textContent = 'Array siap. Klik "Mulai Sort".';
      }

      function validateBeforeStart() {
        const n = Math.max(2, parseInt(document.getElementById("nInput").value, 10) || 24);
        const resources = readResources();
        const est = estimateMemoryBytes(n, resources.threadCount);

        if (resources.ramGb <= 0) {
          return { ok: false, message: "RAM harus > 0 GB." };
        }
        if (resources.threadCount > resources.coreCount) {
          return { ok: false, message: "Thread tidak boleh lebih besar dari core." };
        }
        if (est > resources.ramBytes) {
          const estMb = (est / (1024 * 1024)).toFixed(2);
          return { ok: false, message: `Estimasi memori ${estMb} MB melebihi RAM alokasi ${resources.ramGb} GB.` };
        }
        return { ok: true, resources };
      }

      async function startSort() {
        if (sorting) return;
        const validation = validateBeforeStart();
        if (!validation.ok) {
          document.getElementById("msg").textContent = `⚠ ${validation.message}`;
          return;
        }

        if (!arr.length) generate();

        sorting = true;
        paused = false;
        comp = 0; sw = 0; ps = 0;
        hiI = -1; hiJ = -1;
        runStartTime = performance.now();
        elapsedBeforePause = 0;

        updateStats();
        updateDuration();
        document.getElementById("btnSort").disabled = true;
        document.getElementById("btnPause").disabled = false;
        document.getElementById("btnPause").textContent = "⏸ Pause";

        workerPool = createWorkerPool(validation.resources.effectiveWorkers);
        document.getElementById("sThr").textContent = String(validation.resources.effectiveWorkers);

        try {
          document.getElementById("msg").textContent = "Memulai Bubble Parallel (Odd-Even)...";
          await runBubbleParallel();

          if (sorting) {
            const finalElapsedMs = getElapsedMs();
            sorting = false;
            runStartTime = 0;
            elapsedBeforePause = finalElapsedMs;
            document.getElementById("msg").textContent = `✓ Sorting selesai! Waktu: ${formatDuration(finalElapsedMs)}`;
          }
        } catch (err) {
          sorting = false;
          runStartTime = 0;
          document.getElementById("msg").textContent = `⚠ Error: ${err.message || err}`;
        } finally {
          if (workerPool) {
            workerPool.destroy();
            workerPool = null;
          }
          document.getElementById("btnSort").disabled = false;
          document.getElementById("btnPause").disabled = true;
          document.getElementById("btnPause").textContent = "⏸ Pause";
          updateDuration();
        }
      }

      function pauseResume() {
        if (!sorting) return;
        const btn = document.getElementById("btnPause");
        if (!paused) {
          paused = true;
          elapsedBeforePause += performance.now() - runStartTime;
          runStartTime = 0;
          btn.textContent = "▶ Lanjut";
          document.getElementById("msg").textContent = "Sorting dipause.";
        } else {
          paused = false;
          runStartTime = performance.now();
          btn.textContent = "⏸ Pause";
          document.getElementById("msg").textContent = "Sorting dilanjutkan...";
        }
      }

      function resetRuntimeOnly() {
        sorting = false;
        paused = false;
        runStartTime = 0;
        elapsedBeforePause = 0;
        comp = 0; sw = 0; ps = 0;
        hiI = -1; hiJ = -1;

        if (workerPool) {
          workerPool.destroy();
          workerPool = null;
        }
        pendingTasks.clear();

        updateStats();
        document.getElementById("sTime").textContent = "0 ms";
        document.getElementById("sThr").textContent = "0";

        document.getElementById("btnSort").disabled = false;
        document.getElementById("btnPause").disabled = true;
        document.getElementById("btnPause").textContent = "⏸ Pause";
      }

      function reset() {
        resetRuntimeOnly();
        arr = [];
        render([], -1, -1, []);
        document.getElementById("msg").textContent = "Di-reset. Generate array baru atau mulai lagi.";
      }

      async function initDefaults() {
        const host = await fetchHostResources();
        populateResourceSelections(host);
        generate();
      }

      initDefaults();
      setInterval(() => {
        if (sorting && !paused) updateDuration();
      }, 100);
