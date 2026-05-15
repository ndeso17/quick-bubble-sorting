      let arr = [];
      let sorting = false;
      let paused = false;
      let runStartTime = 0;
      let elapsedBeforePause = 0;

      let comp = 0, sw = 0, steps = 0, maxDepth = 0;
      let pivotIdx = -1;
      let compareIdx = [];
      let range = [-1, -1];
      let sortedMask = [];

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
        document.getElementById("sCalls").textContent = steps;
        document.getElementById("sDepth").textContent = maxDepth;
      }

      function toBytesFromGb(gb) {
        return gb * 1024 * 1024 * 1024;
      }

      function estimateMemoryBytes(n, threadCount) {
        const valueBytes = 8;
        const dataBytes = n * valueBytes;
        const scratchFrames = dataBytes * 6;
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

      function render() {
        const wrap = document.getElementById("chart-wrap");
        if (!arr.length) {
          wrap.innerHTML = "";
          return;
        }

        const maxVal = Math.max(...arr);
        const maxH = 230;
        wrap.innerHTML = "";
        const compareSet = new Set(compareIdx);

        for (let idx = 0; idx < arr.length; idx++) {
          const v = arr[idx];
          const col = document.createElement("div");
          col.className = "bar-col";
          const h = Math.max(18, Math.round((v / maxVal) * maxH));

          const bar = document.createElement("div");
          let cls = "normal";
          if (sortedMask[idx]) cls = "sorted";
          else if (idx === pivotIdx) cls = "pivot";
          else if (compareSet.has(idx)) cls = "comparing";
          else if (range[0] >= 0 && idx >= range[0] && idx <= range[1]) cls = "inrange";
          bar.className = `bar ${cls}`;
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
        }
      }

      function createWorkerPool(size) {
        const workerCode = `
self.onmessage = function(e) {
  const { taskId, task } = e.data;
  if (!task || task.type !== "partition") {
    self.postMessage({ taskId, error: "Invalid task" });
    return;
  }
  try {
    const { source, left, right } = task;
    const segment = source.slice(left, right + 1);
    const pivotVal = segment[segment.length - 1];
    let i = -1;
    let localComp = 0;
    let localSwap = 0;
    const comparePairs = [];

    for (let j = 0; j < segment.length - 1; j++) {
      localComp++;
      comparePairs.push([left + j, right]);
      if (segment[j] <= pivotVal) {
        i++;
        if (i !== j) {
          const t = segment[i]; segment[i] = segment[j]; segment[j] = t;
          localSwap++;
        }
      }
    }

    const pivotLocal = i + 1;
    if (pivotLocal !== segment.length - 1) {
      const t = segment[pivotLocal];
      segment[pivotLocal] = segment[segment.length - 1];
      segment[segment.length - 1] = t;
      localSwap++;
    }

    self.postMessage({
      taskId,
      result: {
        left,
        right,
        pivotIndex: left + pivotLocal,
        pivotValue: pivotVal,
        segment,
        localComp,
        localSwap,
        comparePairs
      }
    });
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

      async function waitIfPaused() {
        while (paused && sorting) {
          await new Promise((r) => setTimeout(r, 20));
        }
      }

      async function runQuickParallel() {
        sortedMask = new Array(arr.length).fill(false);
        const stack = [{ l: 0, r: arr.length - 1, depth: 1 }];

        while (stack.length && sorting) {
          await waitIfPaused();
          if (!sorting) return;

          const group = [];
          while (stack.length && group.length < workerPool.size) {
            const current = stack.pop();
            if (current.l >= current.r) {
              if (current.l === current.r) sortedMask[current.l] = true;
              continue;
            }
            group.push(current);
          }

          if (!group.length) continue;

          steps++;
          const snapshot = arr.slice();
          const results = await Promise.all(
            group.map((g) => workerPool.runTask({ type: "partition", source: snapshot, left: g.l, right: g.r }))
          );

          for (let idx = 0; idx < group.length; idx++) {
            const g = group[idx];
            const r = results[idx];
            comp += r.localComp;
            sw += r.localSwap;
            maxDepth = Math.max(maxDepth, g.depth);

            for (let p = r.left; p <= r.right; p++) {
              arr[p] = r.segment[p - r.left];
            }

            pivotIdx = r.pivotIndex;
            compareIdx = r.comparePairs.length ? r.comparePairs[r.comparePairs.length - 1] : [r.pivotIndex, r.right];
            range = [r.left, r.right];
            sortedMask[r.pivotIndex] = true;

            const leftLen = r.pivotIndex - 1 - r.left + 1;
            const rightLen = r.right - (r.pivotIndex + 1) + 1;

            if (leftLen > 1) stack.push({ l: r.left, r: r.pivotIndex - 1, depth: g.depth + 1 });
            else if (leftLen === 1) sortedMask[r.left] = true;

            if (rightLen > 1) stack.push({ l: r.pivotIndex + 1, r: r.right, depth: g.depth + 1 });
            else if (rightLen === 1) sortedMask[r.right] = true;

            render();
            updateStats();
            updateDuration();
            document.getElementById("msg").textContent =
              `Step ${steps}: partisi [${r.left}..${r.right}], pivot ${r.pivotValue} di indeks ${r.pivotIndex}.`;
          }

          await new Promise((r) => setTimeout(r, 0));
        }

        sortedMask.fill(true);
        pivotIdx = -1;
        compareIdx = [];
        range = [-1, -1];
        render();
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

        sortedMask = new Array(n).fill(false);
        pivotIdx = -1;
        compareIdx = [];
        range = [-1, -1];
        render();
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
        comp = 0;
        sw = 0;
        steps = 0;
        maxDepth = 0;
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
          document.getElementById("msg").textContent = "Memulai Quick Parallel...";
          await runQuickParallel();

          if (sorting) {
            const finalElapsedMs = getElapsedMs();
            sorting = false;
            runStartTime = 0;
            elapsedBeforePause = finalElapsedMs;
            document.getElementById("msg").textContent = `✓ Quick Sort selesai! Waktu: ${formatDuration(finalElapsedMs)}`;
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

        comp = 0;
        sw = 0;
        steps = 0;
        maxDepth = 0;
        pivotIdx = -1;
        compareIdx = [];
        range = [-1, -1];

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
        sortedMask = [];
        render();
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
