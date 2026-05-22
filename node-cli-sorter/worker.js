const { parentPort } = require('worker_threads');

function bubbleSort(arr, order) {
  let comparisons = 0;
  let swaps = 0;
  const a = arr.slice();
  for (let i = 0; i < a.length - 1; i++) {
    let swapped = false;
    for (let j = 0; j < a.length - 1 - i; j++) {
      comparisons++;
      const shouldSwap = order === 'desc' ? a[j] < a[j + 1] : a[j] > a[j + 1];
      if (shouldSwap) {
        const t = a[j];
        a[j] = a[j + 1];
        a[j + 1] = t;
        swaps++;
        swapped = true;
      }
    }
    if (!swapped) break;
  }
  return { sorted: a, comparisons, swaps };
}

function quickSortWithStats(arr, order) {
  const a = arr.slice();
  let comparisons = 0;
  let swaps = 0;

  function partition(lo, hi) {
    const pivot = a[hi];
    let i = lo - 1;
    for (let j = lo; j < hi; j++) {
      comparisons++;
      const goesLeft = order === 'desc' ? a[j] >= pivot : a[j] <= pivot;
      if (goesLeft) {
        i++;
        if (i !== j) {
          const t = a[i];
          a[i] = a[j];
          a[j] = t;
          swaps++;
        }
      }
    }
    if (i + 1 !== hi) {
      const t = a[i + 1];
      a[i + 1] = a[hi];
      a[hi] = t;
      swaps++;
    }
    return i + 1;
  }

  function quick(lo, hi) {
    if (lo >= hi) return;
    const p = partition(lo, hi);
    quick(lo, p - 1);
    quick(p + 1, hi);
  }

  quick(0, a.length - 1);
  return { sorted: a, comparisons, swaps };
}

parentPort.on('message', (msg) => {
  const { algorithm, chunk, id, order = 'asc' } = msg;
  try {
    const out = algorithm === 'bubble' ? bubbleSort(chunk, order) : quickSortWithStats(chunk, order);
    parentPort.postMessage({ id, ...out });
  } catch (err) {
    parentPort.postMessage({ id, error: err.message || String(err) });
  }
});
