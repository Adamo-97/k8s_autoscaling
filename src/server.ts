import express, { Request, Response } from 'express';
import os from 'os';
import { promisify } from 'util';
import { exec as _exec } from 'child_process';
import http from 'http';
import https from 'https';
import { KubeConfig, CoreV1Api, AutoscalingV1Api } from '@kubernetes/client-node';
const exec = promisify(_exec);

// Node 18+ has global fetch, but ensure agents for keepalive
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

const app = express();
const PORT = process.env.PORT || 3000;
const POD_NAME = process.env.HOSTNAME || os.hostname();

// Middleware
app.use(express.json());

// Unified dashboard with real-time pod monitoring and HPA status
app.get('/', (req: Request, res: Response) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Team 22 - K8s Autoscaling Dashboard</title>
  <style>
    :root{--bg:#0a0e14;--card:#14181c;--muted:#9aa6b2;--accent:#6ee7b7;--warn:#f59e0b;--danger:#ef4444}
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:var(--bg);color:#e6eef3;font-family:'Courier New',monospace;padding:20px;min-height:100vh}
    h1{font-size:24px;margin-bottom:8px}
    h2{font-size:16px;margin:16px 0 8px;color:var(--accent);text-transform:uppercase;letter-spacing:1px}
    .container{max-width:1400px;margin:0 auto}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:20px}
    .card{background:var(--card);padding:16px;border-radius:8px;border:1px solid rgba(255,255,255,0.03)}
    .card h3{font-size:14px;margin-bottom:10px;color:var(--muted)}
    .stat{display:flex;justify-content:space-between;margin:6px 0;font-size:13px}
    .stat .label{color:var(--muted)}
    .stat .value{color:var(--accent);font-weight:700}
    .pod-card{background:var(--card);padding:12px;border-radius:6px;border:1px solid rgba(255,255,255,0.05);margin-bottom:8px;transition:all 0.3s}
    .pod-card.new{animation:highlight 1s ease-out;border-color:var(--accent)}
    @keyframes highlight{from{background:rgba(110,231,183,0.15)}to{background:var(--card)}}
    .pod-card .name{font-weight:700;margin-bottom:4px;font-size:13px}
    .pod-card .meta{font-size:11px;color:var(--muted);margin:2px 0}
    .status{display:inline-block;padding:4px 8px;border-radius:4px;font-size:11px;font-weight:600}
    .status.running{background:rgba(110,231,183,0.1);color:var(--accent)}
    .status.pending{background:rgba(245,158,11,0.1);color:var(--warn)}
    .status.failed{background:rgba(239,68,68,0.1);color:var(--danger)}
    .controls{display:flex;gap:10px;margin-top:12px}
    button{background:rgba(110,231,183,0.06);border:1px solid rgba(110,231,183,0.2);padding:10px 16px;border-radius:6px;color:var(--accent);cursor:pointer;font-family:inherit;font-size:13px}
    button:hover{background:rgba(110,231,183,0.12)}
    button:disabled{opacity:0.4;cursor:not-allowed}
    .bar{height:12px;background:rgba(255,255,255,0.05);border-radius:6px;overflow:hidden;margin-top:8px}
    .bar > div{height:100%;background:linear-gradient(90deg,var(--accent),#35b779);transition:width 0.3s}
    .hpa-info{display:flex;gap:20px;flex-wrap:wrap}
    .hpa-info > div{flex:1;min-width:120px}
    #logs{background:rgba(0,0,0,0.3);padding:12px;border-radius:6px;max-height:200px;overflow-y:auto;font-size:11px;line-height:1.6;color:var(--muted)}
    .log-entry{margin:2px 0}
  </style>
</head>
<body>
  <div class="container">
    <h1>Team 22 - Kubernetes Autoscaling Dashboard</h1>
    <p style="color:var(--muted);margin-bottom:20px">Live monitoring · Served by pod: <strong style="color:var(--accent)">${POD_NAME}</strong></p>

    <div class="grid">
      <div class="card">
        <h3>HPA Status</h3>
        <div id="hpa-status">
          <div class="stat"><span class="label">Current Replicas</span><span class="value" id="current-replicas">—</span></div>
          <div class="stat"><span class="label">Desired Replicas</span><span class="value" id="desired-replicas">—</span></div>
          <div class="stat"><span class="label">Min / Max</span><span class="value" id="min-max">—</span></div>
          <div class="stat"><span class="label">CPU Usage</span><span class="value" id="cpu-usage">—</span></div>
        </div>
      </div>

      <div class="card">
        <h3>Stress Control</h3>
        <div class="stat"><span class="label">Status</span><span class="value" id="stress-status">Idle</span></div>
        <div class="bar"><div id="stress-bar" style="width:0%"></div></div>
        <div class="controls">
          <button id="start-stress">Start CPU Load (30s)</button>
          <button id="stop-stress" disabled>Stop</button>
        </div>
      </div>

      <div class="card">
        <h3>Cluster Info</h3>
        <div class="stat"><span class="label">Active Pods</span><span class="value" id="pod-count">—</span></div>
        <div class="stat"><span class="label">Node Version</span><span class="value">${process.version}</span></div>
        <div class="stat"><span class="label">PID</span><span class="value">${process.pid}</span></div>
        <div class="stat"><span class="label">Uptime</span><span class="value" id="uptime">—</span></div>
      </div>
    </div>

    <h2>Active Pods</h2>
    <div id="pods-grid" class="grid"></div>

    <h2>Event Log</h2>
    <div id="logs"></div>
  </div>

  <script>
    let stressES, clusterES;
    const startTime = Date.now();
    const knownPods = new Set();

    function log(msg) {
      const logs = document.getElementById('logs');
      const time = new Date().toLocaleTimeString();
      logs.innerHTML = '<div class="log-entry">[' + time + '] ' + msg + '</div>' + logs.innerHTML;
    }

    function updateUptime() {
      const sec = Math.floor((Date.now() - startTime) / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      document.getElementById('uptime').textContent = m + 'm ' + s + 's';
    }
    setInterval(updateUptime, 1000);

    // Connect to cluster status SSE
    function connectCluster() {
      if (clusterES) clusterES.close();
      clusterES = new EventSource('/cluster-status');
      clusterES.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          
          // HPA
          if (data.hpa) {
            document.getElementById('current-replicas').textContent = data.hpa.current || '—';
            document.getElementById('desired-replicas').textContent = data.hpa.desired || '—';
            document.getElementById('min-max').textContent = (data.hpa.min || '—') + ' / ' + (data.hpa.max || '—');
            document.getElementById('cpu-usage').textContent = data.hpa.cpu || '—';
          }

          // Pods
          if (data.pods) {
            const grid = document.getElementById('pods-grid');
            document.getElementById('pod-count').textContent = data.pods.length;
            
            grid.innerHTML = data.pods.map(p => {
              const isNew = !knownPods.has(p.name);
              if (isNew) {
                knownPods.add(p.name);
                log('New pod detected: ' + p.name);
              }
              return \`<div class="pod-card \${isNew ? 'new' : ''}">
                <div class="name">\${p.name}</div>
                <div class="meta">IP: \${p.ip} · Age: \${p.age}</div>
                <div class="meta">Ready: \${p.ready} · Restarts: \${p.restarts}</div>
                <span class="status \${p.phase.toLowerCase()}">\${p.phase}</span>
              </div>\`;
            }).join('');
          }
        } catch(e) { console.error(e); }
      };
      clusterES.onerror = () => {
        log('Cluster SSE disconnected, reconnecting...');
        setTimeout(connectCluster, 2000);
      };
    }
    connectCluster();

    // Stress control
    document.getElementById('start-stress').onclick = () => {
      if (stressES) stressES.close();
      stressES = new EventSource('/stress-stream');
      document.getElementById('start-stress').disabled = true;
      document.getElementById('stop-stress').disabled = false;
      document.getElementById('stress-status').textContent = 'Running';
      log('CPU stress started');

        // Instead of streaming from a single pod, call the server to generate distributed load
        fetch('/generate-load', { method: 'POST' }).then(() => {
          document.getElementById('start-stress').disabled = true;
          document.getElementById('stop-stress').disabled = false;
          document.getElementById('stress-status').textContent = 'Load started';
          document.getElementById('stress-bar').style.width = '100%';
        }).catch(() => {
          document.getElementById('stress-status').textContent = 'Error starting load';
        });
    };

    document.getElementById('stop-stress').onclick = () => {
      // We cannot stop remote /cpu-load once started; just update UI
      document.getElementById('start-stress').disabled = false;
      document.getElementById('stop-stress').disabled = true;
      document.getElementById('stress-status').textContent = 'Stopped';
      document.getElementById('stress-bar').style.width = '0%';
      log('CPU stress stop requested (best-effort)');
    };

    log('Dashboard initialized');
  </script>
</body>
</html>`;
  res.send(html);
});
// SSE endpoint for real-time cluster status (pods + HPA)
app.get('/cluster-status', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const fetchStatus = async () => {
    try {
      const status: any = { pods: [], hpa: {} };

      // Try in-cluster config first, fall back to kubectl if not available
      try {
        const kc = new KubeConfig();
        try {
          kc.loadFromCluster();
        } catch (err) {
          kc.loadFromDefault();
        }
        const k8sApi = kc.makeApiClient(CoreV1Api);
        const hpaApi = kc.makeApiClient(AutoscalingV1Api);

        // list pods in same namespace (default) and all namespaces if allowed
        const podsResp = await k8sApi.listPodForAllNamespaces();
        const items = Array.isArray(podsResp.body.items) ? podsResp.body.items : [];
        status.pods = items.map((p: any) => ({
          name: p.metadata?.name || 'unknown',
          namespace: p.metadata?.namespace || 'default',
          phase: p.status?.phase || 'Unknown',
          ip: p.status?.podIP || '-',
          ready: (p.status?.containerStatuses?.filter((c: any) => c.ready).length || 0) + '/' + (p.status?.containerStatuses?.length || 0),
          restarts: p.status?.containerStatuses?.reduce((s: number, c: any) => s + (c.restartCount || 0), 0) || 0,
          age: (() => {
            const t = p.metadata?.creationTimestamp && Date.parse(p.metadata.creationTimestamp);
            if (!t) return '-';
            const s = Math.floor((Date.now() - t) / 1000);
            if (s < 60) return s + 's';
            if (s < 3600) return Math.floor(s / 60) + 'm';
            return Math.floor(s / 3600) + 'h';
          })()
        }));

        // list HPA (v1) - may not exist
        try {
          const hpaResp = await hpaApi.listHorizontalPodAutoscalerForAllNamespaces();
          const hpaItems = Array.isArray(hpaResp.body.items) ? hpaResp.body.items : [];
          if (hpaItems.length > 0) {
            const h = hpaItems[0];
            status.hpa = {
              current: h.status?.currentReplicas || 0,
              desired: h.status?.desiredReplicas || 0,
              min: h.spec?.minReplicas || 1,
              max: h.spec?.maxReplicas || 10,
              cpu: ((h as any).status?.currentMetrics?.find((m: any) => m.type === 'Resource' && m.resource?.name === 'cpu')?.resource?.current?.averageUtilization ? String((h as any).status?.currentMetrics?.find((m: any) => m.type === 'Resource' && m.resource?.name === 'cpu')?.resource?.current?.averageUtilization) + '%' : '—')
            };
          }
        } catch (e) {
          // ignore HPA errors
        }
      } catch (err) {
        // Fallback: try kubectl shell (useful for local dev when kubeconfig is present)
        try {
          const { stdout: podOut } = await exec('kubectl get pods -o json --all-namespaces');
          const podObj = JSON.parse(podOut || '{}');
          const items = Array.isArray(podObj.items) ? podObj.items : [];
          status.pods = items.map((p: any) => ({
            name: p.metadata?.name || 'unknown',
            namespace: p.metadata?.namespace || 'default',
            phase: p.status?.phase || 'Unknown',
            ip: p.status?.podIP || '-',
            ready: (p.status?.containerStatuses?.filter((c: any) => c.ready).length || 0) + '/' + (p.status?.containerStatuses?.length || 0),
            restarts: p.status?.containerStatuses?.reduce((s: number, c: any) => s + (c.restartCount || 0), 0) || 0,
            age: (() => {
              const t = p.metadata?.creationTimestamp && Date.parse(p.metadata.creationTimestamp);
              if (!t) return '-';
              const s = Math.floor((Date.now() - t) / 1000);
              if (s < 60) return s + 's';
              if (s < 3600) return Math.floor(s/60) + 'm';
              return Math.floor(s/3600) + 'h';
            })()
          }));
        } catch (e) {
          // give up; status.pods stays empty
        }
      }

      send(status);
    } catch (err) {
      send({ error: String(err) });
    }
  };

  // Send initial status
  await fetchStatus();

  // Poll every 2 seconds
  const interval = setInterval(async () => {
    if (res.writableEnded) {
      clearInterval(interval);
      return;
    }
    await fetchStatus();
  }, 2000);

  req.on('close', () => {
    clearInterval(interval);
  });
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

// Endpoint to trigger distributed load across pods
app.post('/generate-load', async (req: Request, res: Response) => {
  const concurrency = 20;

  // Get pod IPs for app label
  let podIps: string[] = [];
  try {
    const kc = new KubeConfig();
    try { kc.loadFromCluster(); } catch { kc.loadFromDefault(); }
    const k8sApi = kc.makeApiClient(CoreV1Api);
    const podsResp = await k8sApi.listNamespacedPod('default', undefined, undefined, undefined, undefined, 'app=k8s-autoscaling');
    podIps = (podsResp.body.items || []).map((p: any) => p.status?.podIP).filter(Boolean);
  } catch (err) {
    try {
      const { stdout } = await exec("kubectl get pods -l app=k8s-autoscaling -o json -n default");
      const obj = JSON.parse(stdout || '{}');
      podIps = (obj.items || []).map((p: any) => p.status?.podIP).filter(Boolean);
    } catch (e) {
      // ignore
    }
  }

  // fallback to service clusterIP if no pod IPs found
  if (!podIps.length) {
    try {
      const kc = new KubeConfig();
      try { kc.loadFromCluster(); } catch { kc.loadFromDefault(); }
      const core = kc.makeApiClient(CoreV1Api);
      const s = await core.readNamespacedService('k8s-autoscaling-service','default');
      const clusterIP = s.body.spec?.clusterIP;
      if (clusterIP) podIps = [clusterIP];
    } catch {}
  }

  // Fire concurrent requests to /cpu-load on each target
  (async () => {
    const targets = podIps.length ? podIps : ['127.0.0.1'];
    const tasks: Promise<any>[] = [];
    for (let i = 0; i < concurrency; i++) {
      const target = targets[i % targets.length];
      const url = `http://${target}:3000/cpu-load`;
      const p = (fetch as any)(url, { method: 'GET' }).catch(() => null);
      tasks.push(p);
    }
    try { await Promise.all(tasks); } catch {}
  })();

  res.status(202).json({ status: 'started', targets: podIps.length || ['service'], concurrency });
});

// SSE endpoint that runs CPU work and streams progress
// Simple CPU load endpoint for load testing (short bursts, non-blocking)
app.get('/cpu-load', async (req: Request, res: Response) => {
  const start = Date.now();
  let result = 0;
  
  // Perform intensive CPU work for about 5 seconds (enough to trigger HPA but not kill pod)
  const duration = 5000;
  while (Date.now() - start < duration) {
    for (let i = 0; i < 500000; i++) {
      result += Math.sqrt(i) * Math.sin(i) * Math.cos(i);
    }
  }
  
  const elapsed = Date.now() - start;
  res.json({ 
    status: 'complete', 
    elapsed, 
    result: result.toFixed(2),
    pod: POD_NAME 
  });
});

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
