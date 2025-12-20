import express, { Request, Response } from 'express';
import os from 'os';
import { promisify } from 'util';
import { exec as _exec } from 'child_process';
const exec = promisify(_exec);

const app = express();
const PORT = process.env.PORT || 3000;
const POD_NAME = process.env.HOSTNAME || os.hostname();

// Middleware
app.use(express.json());

// Main landing page (clean dark mode, console font)
app.get('/', (req: Request, res: Response) => {
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Team 22</title>
    <style>
      :root{--bg:#0b0f14;--card:rgba(20,24,28,0.9);--muted:#9aa6b2;--accent:#6ee7b7}
      *{box-sizing:border-box}
      html,body{height:100%}
      body{margin:0;background:var(--bg);color:#e6eef3;font-family:'SFMono-Regular','Menlo','Monaco','Consolas',monospace;display:flex;align-items:center;justify-content:center}
      .card{background:var(--card);padding:36px;border-radius:10px;max-width:720px;width:calc(100% - 32px);border:1px solid rgba(255,255,255,0.03)}
      h1{margin:0 0 8px 0;font-size:32px}
      p{color:#9aa6b2}
      .links{margin-top:18px}
      a{color:var(--accent);text-decoration:none;margin-right:14px}
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Team 22</h1>
      <p>Lightweight autoscaling demo for Kubernetes on EC2 (no EKS required).</p>
      <div class="links">
        <a href="/stress">Run stress (30s CPU)</a>
        <a href="/health">Health</a>
        <a href="/pods">Pods</a>
      </div>
      <div class="pod">Pod: ${POD_NAME}</div>
    </div>
  </body>
</html>`;
  res.send(html);
});
// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    pod: POD_NAME,
    timestamp: new Date().toISOString(),
    pid: process.pid,
    memory: process.memoryUsage()
  });
});

// CPU-intensive stress endpoint for testing autoscaling
// Serve the interactive stress control page (client will connect to SSE)
app.get('/stress', (req: Request, res: Response) => {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Team 22 - Stress Control</title>
  <style>
    :root{--bg:#0b0f14;--card:rgba(20,24,28,0.9);--muted:#9aa6b2;--accent:#6ee7b7;--warn:#f59e0b}
    body{margin:0;background:var(--bg);color:#e6eef3;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh}
    .card{background:var(--card);padding:28px;border-radius:10px;width:720px;max-width:96%;box-shadow:0 8px 30px rgba(0,0,0,0.6)}
    h1{margin:0 0 8px 0}
    .controls{display:flex;gap:12px;margin-top:12px}
    button{background:transparent;border:1px solid rgba(255,255,255,0.06);padding:8px 12px;border-radius:8px;color:var(--accent);cursor:pointer}
    .danger{border-color:rgba(245,158,11,0.12);color:var(--warn)}
    .info{margin-top:14px;color:var(--muted);font-size:13px}
    .bar{height:14px;background:rgba(255,255,255,0.06);border-radius:8px;overflow:hidden;margin-top:12px}
    .bar > i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),#35b779);width:0%}
    .meta{display:flex;gap:18px;margin-top:12px;font-size:13px;color:var(--muted)}
  </style>
</head>
<body>
  <div class="card">
    <h1>Stress Control</h1>
    <div class="info">Pod: ${POD_NAME} · PID: ${process.pid} · Node: ${process.version}</div>
    <div class="controls">
      <button id="start">Start CPU Load</button>
      <button id="stop" class="danger">Stop (disconnect)</button>
      <a href="/" style="align-self:center;color:var(--muted);text-decoration:none">Back</a>
    </div>

    <div class="bar" aria-hidden>
      <i id="progress"></i>
    </div>
    <div class="meta">
      <div id="percent">Progress: 0%</div>
      <div id="elapsed">Elapsed: 0s</div>
      <div id="result">Result: —</div>
    </div>
  </div>

  <script>
    let es;
    const startBtn = document.getElementById('start');
    const stopBtn = document.getElementById('stop');
    const progressEl = document.getElementById('progress');
    const percentEl = document.getElementById('percent');
    const elapsedEl = document.getElementById('elapsed');
    const resultEl = document.getElementById('result');

    function connect() {
      if (es) es.close();
      es = new EventSource('/stress-stream');
      es.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data);
          progressEl.style.width = d.progress + '%';
          percentEl.textContent = 'Progress: ' + d.progress + '%';
          elapsedEl.textContent = 'Elapsed: ' + Math.floor(d.elapsed/1000) + 's';
          if (d.result !== undefined) resultEl.textContent = 'Result: ' + d.result.toExponential(2);
        } catch(e) { console.error(e); }
      };
      es.onerror = () => {
        es.close();
        es = null;
      };
    }

    startBtn.onclick = () => {
      connect();
      startBtn.disabled = true;
    };
    stopBtn.onclick = () => {
      if (es) es.close();
      startBtn.disabled = false;
    };
  </script>
</body>
</html>`;
  res.send(html);
});

// SSE endpoint that runs CPU work and streams progress
app.get('/stress-stream', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();

  const duration = 30000; // 30s
  const start = Date.now();
  let lastProgress = -1;
  let result = 0;

  function send(data: object) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  // perform CPU work in small chunks, yielding to event loop so SSE can flush
  while (Date.now() - start < duration) {
    const chunkStart = Date.now();
    // busy work for ~80ms
    while (Date.now() - chunkStart < 80) {
      for (let i = 0; i < 200000; i++) {
        result += Math.sqrt(i) * Math.sin(i) * Math.cos(i);
      }
    }
    const elapsed = Date.now() - start;
    const progress = Math.min(100, Math.floor((elapsed / duration) * 100));
    if (progress !== lastProgress) {
      lastProgress = progress;
      send({ progress, elapsed, result: Number(result.toFixed(6)) });
    }
    // yield to event loop so client receives updates
    await new Promise((r) => setImmediate(r));
    if (res.writableEnded) break;
  }

  const totalElapsed = Date.now() - start;
  send({ progress: 100, elapsed: totalElapsed, result: Number(result.toFixed(6)) });
  // close stream
  res.write('event: done\n');
  res.write(`data: ${JSON.stringify({ status: 'complete' })}\n\n`);
  res.end();
});

// Pods overview page — uses `kubectl` if available to list pods and render cards
app.get('/pods', async (req: Request, res: Response) => {
  try {
    const { stdout } = await exec('kubectl get pods -o json --all-namespaces');
    const obj = JSON.parse(stdout || '{}');
    const items = Array.isArray(obj.items) ? obj.items : [];

    const cards = items.map((p: any) => {
      const name = p.metadata?.name || 'unknown';
      const ns = p.metadata?.namespace || 'default';
      const phase = p.status?.phase || 'Unknown';
      const podIP = p.status?.podIP || '-';
      const containers = p.status?.containerStatuses || [];
      const ready = containers.filter((c: any) => c.ready).length + '/' + (containers.length || 0);
      const restarts = containers.reduce((s: number, c: any) => s + (c.restartCount || 0), 0);
      const age = (() => {
        const t = p.metadata?.creationTimestamp && Date.parse(p.metadata.creationTimestamp);
        if (!t) return '-';
        const s = Math.floor((Date.now() - t) / 1000);
        if (s < 60) return s + 's';
        if (s < 3600) return Math.floor(s/60) + 'm';
        return Math.floor(s/3600) + 'h';
      })();

      return `
        <div class="card">
          <div class="title">${name}</div>
          <div class="meta">NS: ${ns} · IP: ${podIP} · Age: ${age}</div>
          <div class="status ${phase.toLowerCase()}">Status: ${phase}</div>
          <div class="meta">Ready: ${ready} · Restarts: ${restarts}</div>
        </div>
      `;
    }).join('\n');

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Pods</title>
  <style>
    body{margin:16px;font-family:monospace;background:#071018;color:#e6eef3}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
    .card{background:rgba(255,255,255,0.03);padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.02)}
    .title{font-weight:700;margin-bottom:6px}
    .meta{font-size:13px;color:#9aa6b2;margin-bottom:6px}
    .status{padding:6px;border-radius:6px;font-weight:600}
    .status.running{background:rgba(110,231,183,0.06);color:#6ee7b7}
    .status.pending{background:rgba(245,158,11,0.06);color:#f59e0b}
    .status.failed{background:rgba(239,68,68,0.06);color:#f87171}
  </style>
</head>
<body>
  <h1>Pods (from kubectl)</h1>
  <p style="color:#9aa6b2">This page uses the server's <code>kubectl</code> command — ensure your kubeconfig is accessible.</p>
  <div class="grid">${cards}</div>
  <p style="margin-top:12px;color:#9aa6b2"><a href="/" style="color:#6ee7b7">Back</a></p>
</body>
</html>`;

    res.send(html);
  } catch (err: any) {
    const message = String(err.message || err);
    res.send(`<!doctype html><html><body><h1>Pods</h1><p>kubectl failed: ${message}</p><p>Make sure kubectl is installed and kubeconfig is accessible to the server process.</p><p><a href="/">Back</a></p></body></html>`);
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`[SERVER] Running on port ${PORT}`);
  console.log(`[POD] Name: ${POD_NAME}`);
  console.log(`[ENV] Environment: ${process.env.NODE_ENV || 'development'}`);
});
