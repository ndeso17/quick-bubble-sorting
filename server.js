const express = require('express');
const os = require('os');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

function bytesToGb(bytes) {
  return Number((bytes / (1024 ** 3)).toFixed(2));
}

function nowIso() {
  return new Date().toISOString();
}

function getHostResources() {
  const cpuThreads = Math.max(1, os.cpus()?.length || 1);
  const cpuCores = cpuThreads;
  const ramGbTotal = bytesToGb(os.totalmem());
  const ramGbFree = bytesToGb(os.freemem());
  return { cpuCores, cpuThreads, ramGbTotal, ramGbFree };
}

app.use((req, _res, next) => {
  console.log(`[${nowIso()}] request ${req.method} ${req.path}`);
  next();
});

app.get('/api/system/resources', (_req, res) => {
  console.log(`[${nowIso()}] api:system-resources`);
  res.json(getHostResources());
});

app.get('/', (_req, res) => {
  console.log(`[${nowIso()}] controller:index`);
  res.render('index');
});

app.get('/bubble', (_req, res) => {
  console.log(`[${nowIso()}] controller:bubble`);
  res.render('bubble');
});

app.get('/quick', (_req, res) => {
  console.log(`[${nowIso()}] controller:quick`);
  res.render('quick');
});

app.listen(PORT, () => {
  const host = getHostResources();
  console.log(`[${nowIso()}] app:start`);
  console.log(`[${nowIso()}] host resources: ${host.cpuCores} core, ${host.cpuThreads} thread, RAM ${host.ramGbTotal} GB (free ${host.ramGbFree} GB)`);
  console.log(`[${nowIso()}] server running on http://localhost:${PORT}`);
});
