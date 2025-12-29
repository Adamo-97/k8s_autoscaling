import express, { Request, Response } from 'express';
import os from 'os';
import { promisify } from 'util';
import { exec as _exec } from 'child_process';
import { KubeConfig, CoreV1Api, AutoscalingV2Api } from '@kubernetes/client-node';
import {
  parsePodInfo,
  parseHPAStatus,
  parseKubectlPods,
  extractPodIPs,
  formatSSEMessage,
  createStressResult,
  createHealthResponse,
  createStopResponse,
  createGenerateLoadResponse,
  createConcurrentTestError,
  createInternalStopResponse,
  generatePodCardHtml,
  generatePodsPageHtml,
  generatePodsErrorHtml
} from './utils/kubernetes';

const exec = promisify(_exec);

// ANSI color codes for terminal logging
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  orange: '\x1b[38;5;208m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

// Structured logging with colors
const log = {
  info: (msg: string) => console.log(`${COLORS.cyan}[INFO]${COLORS.reset} ${msg}`),
  scaleUp: (from: number, to: number, cpu: string) => 
    console.log(`${COLORS.bright}${COLORS.green}[SCALE-UP]${COLORS.reset} ${COLORS.green}▲ Replicas: ${from} → ${to} | CPU: ${cpu}${COLORS.reset}`),
  scaleDown: (from: number, to: number, cpu: string) => 
    console.log(`${COLORS.bright}${COLORS.orange}[SCALE-DOWN]${COLORS.reset} ${COLORS.orange}▼ Replicas: ${from} → ${to} | CPU: ${cpu}${COLORS.reset}`),
  hpaStatus: (current: number, desired: number, cpu: string, target: number) => 
    console.log(`${COLORS.blue}[HPA]${COLORS.reset} Current: ${current} | Desired: ${desired} | CPU: ${cpu} | Target: ${target}%`),
  stress: (action: string, details?: string) => 
    console.log(`${COLORS.magenta}[STRESS]${COLORS.reset} ${action}${details ? ` | ${details}` : ''}`),
  warn: (msg: string) => console.log(`${COLORS.yellow}[WARN]${COLORS.reset} ${msg}`),
  error: (msg: string) => console.log(`${COLORS.red}[ERROR]${COLORS.reset} ${msg}`),
  debug: (msg: string) => process.env.DEBUG && console.log(`${COLORS.gray}[DEBUG]${COLORS.reset} ${msg}`)
};

const app = express();
const PORT = process.env.PORT || 3000;
const POD_NAME = process.env.HOSTNAME || os.hostname();

// Global flag to stop stress tests
let stopStress = false;
let stressStartTime = 0;
let activeStressTest = false; // Track if a stress test is currently running

// Track HPA state for detecting scaling events
let lastReplicaCount = 0;
let lastCpuReading = '';
const HPA_TARGET_CPU = 50; // Must match k8s-hpa.yaml averageUtilization

// Middleware
app.use(express.json());

// Unified dashboard with real-time pod monitoring and HPA status
app.get('/', (req: Request, res: Response) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>K8s Autoscaling Dashboard</title>
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
    .pod-card{background:var(--card);padding:12px;border-radius:6px;border:1px solid rgba(255,255,255,0.05);margin-bottom:8px;transition:all 0.3s;position:relative}
    .pod-card.new{animation:highlight 2s ease-out;border-color:var(--accent)}
    .pod-card.scaling-up{border-color:#f59e0b;animation:pulse 1s infinite}
    @keyframes highlight{from{background:rgba(110,231,183,0.2)}to{background:var(--card)}}
    @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,0.4)}50%{box-shadow:0 0 0 8px rgba(245,158,11,0)}}
    .badge{position:absolute;top:-6px;right:-6px;background:var(--accent);color:#000;font-size:9px;padding:2px 6px;border-radius:10px;font-weight:700}
    .badge.new{background:#f59e0b}
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
    <h1>Kubernetes Autoscaling Dashboard</h1>
    <p style="color:var(--muted);margin-bottom:20px">Live monitoring · Served by pod: <strong style="color:var(--accent)">${POD_NAME}</strong></p>

    <div class="grid">
      <div class="card">
        <h3>HPA Status</h3>
        <div id="hpa-status">
          <div class="stat"><span class="label">Scaling Progress</span><span class="value" id="scaling-progress">—</span></div>
          <div class="stat"><span class="label">Current / Desired</span><span class="value" id="current-desired">— / —</span></div>
          <div class="stat"><span class="label">Min / Max</span><span class="value" id="min-max">—</span></div>
          <div class="stat"><span class="label">CPU Usage</span><span class="value" id="cpu-usage">—</span></div>
        </div>
        <div class="bar"><div id="scaling-bar" style="width:0%;background:linear-gradient(90deg,#f59e0b,var(--accent))"></div></div>
      </div>

      <div class="card">
        <h3>Stress Control</h3>
        <div class="stat"><span class="label">Status</span><span class="value" id="stress-status">Idle</span></div>
        <div class="bar"><div id="stress-bar" style="width:0%"></div></div>
        <div class="controls">
          <button id="start-stress">Start CPU Load (60s)</button>
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
    const podCreationTimes = new Map();
    let initialReplicas = null;
    let peakReplicas = 0;
    let lastReplicaCount = 0;

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
            const current = data.hpa.current || 0;
            const desired = data.hpa.desired || 0;
            const min = data.hpa.min || 1;
            const max = data.hpa.max || 10;
            
            // Track scaling progress
            if (initialReplicas === null && current > 0) {
              initialReplicas = current;
              log('Initial replica count: ' + initialReplicas);
            }
            if (current > peakReplicas) {
              peakReplicas = current;
            }
            
            // Detect scaling events
            if (current !== lastReplicaCount && lastReplicaCount > 0) {
              if (current > lastReplicaCount) {
                log('+++++++++++ SCALING UP: ' + lastReplicaCount + ' → ' + current + ' replicas');
              } else {
                log('----------- SCALING DOWN: ' + lastReplicaCount + ' → ' + current + ' replicas');
              }
            }
            lastReplicaCount = current;
            
            // Update display
            const scalingText = initialReplicas !== null ? 
              'Started: ' + initialReplicas + ' → Peak: ' + peakReplicas + ' → Now: ' + current : '—';
            document.getElementById('scaling-progress').textContent = scalingText;
            document.getElementById('current-desired').textContent = current + ' / ' + desired;
            document.getElementById('min-max').textContent = min + ' / ' + max;
            document.getElementById('cpu-usage').textContent = data.hpa.cpu || '—';
            
            // Scaling bar shows progress from min to max
            const scalingPercent = Math.min(100, Math.max(0, ((current - min) / (max - min)) * 100));
            document.getElementById('scaling-bar').style.width = scalingPercent + '%';
          }

          // Pods
          if (data.pods) {
            const grid = document.getElementById('pods-grid');
            document.getElementById('pod-count').textContent = data.pods.length;
            const now = Date.now();
            
            grid.innerHTML = data.pods.map(p => {
              const isNew = !knownPods.has(p.name);
              const isRecent = p.ageSeconds < 60; // Less than 60 seconds old
              
              if (isNew) {
                knownPods.add(p.name);
                podCreationTimes.set(p.name, now);
                log('[[POD]] New pod created: ' + p.name);
              }
              
              const cardClass = isRecent ? 'pod-card scaling-up' : 'pod-card';
              const badge = isRecent ? '<span class="badge new">NEW</span>' : '';
              
              return \`<div class="\${cardClass}">
                \${badge}
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
          
          // Animate progress bar over 60 seconds
          let progress = 0;
          window.stressInterval = setInterval(() => {
            progress += 100 / 60; // Increment every second for 60 seconds
            if (progress >= 100) {
              progress = 100;
              clearInterval(window.stressInterval);
              // CRITICAL: Call /stop-load to ensure all pods stop their CPU work
              fetch('/stop-load', { method: 'POST' }).then(() => {
                log('Stop signal sent to all pods');
              }).catch(() => {});
              // Re-enable button after load completes
              setTimeout(() => {
                document.getElementById('start-stress').disabled = false;
                document.getElementById('stop-stress').disabled = true;
                document.getElementById('stress-status').textContent = 'Idle';
                document.getElementById('stress-bar').style.width = '0%';
                log('CPU stress completed');
              }, 1000);
            }
            document.getElementById('stress-bar').style.width = progress + '%';
          }, 1000);
        }).catch(() => {
          document.getElementById('stress-status').textContent = 'Error starting load';
          document.getElementById('start-stress').disabled = false;
          document.getElementById('stop-stress').disabled = true;
        });
    };

    document.getElementById('stop-stress').onclick = () => {
      // Clear the progress interval if it's running
      if (window.stressInterval) {
        clearInterval(window.stressInterval);
        window.stressInterval = null;
      }
      // Call server to stop the stress test
      fetch('/stop-load', { method: 'POST' }).then(() => {
        document.getElementById('start-stress').disabled = false;
        document.getElementById('stop-stress').disabled = true;
        document.getElementById('stress-status').textContent = 'Stopped';
        document.getElementById('stress-bar').style.width = '0%';
        log('CPU stress stopped');
      }).catch((e) => {
        log('Stop request failed: ' + e.message);
      });
    };

    log('Dashboard initialized');
  </script>
</body>
</html>`;
  res.send(html);
});
// SSE endpoint for real-time cluster status (pods + HPA)
// Uses v2 HPA API for instant metrics (no delay)
app.get('/cluster-status', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();

  const send = (data: object) => {
    res.write(formatSSEMessage(data));
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
        const hpaApi = kc.makeApiClient(AutoscalingV2Api);

        // list pods in same namespace (default) with app label only
        const podsResp = await k8sApi.listNamespacedPod('default', undefined, undefined, undefined, undefined, 'app=k8s-autoscaling');
        const items = Array.isArray(podsResp.body.items) ? podsResp.body.items : [];
        status.pods = items.map((p: any) => parsePodInfo(p));

        // list HPA (v2) in default namespace - provides real-time metrics
        try {
          const hpaResp = await hpaApi.listNamespacedHorizontalPodAutoscaler('default');
          const hpaItems = Array.isArray(hpaResp.body.items) ? hpaResp.body.items : [];
          if (hpaItems.length > 0) {
            const hpa = hpaItems[0];
            // Parse v2 HPA format with detailed metrics
            const currentMetrics = hpa.status?.currentMetrics || [];
            const cpuMetric = currentMetrics.find((m: any) => m.resource?.name === 'cpu');
            const cpuValue = cpuMetric?.resource?.current?.averageUtilization;
            const cpuStr = cpuValue !== undefined ? `${cpuValue}%` : '—';
            
            status.hpa = {
              current: hpa.status?.currentReplicas || 0,
              desired: hpa.status?.desiredReplicas || 0,
              min: hpa.spec?.minReplicas || 1,
              max: hpa.spec?.maxReplicas || 10,
              cpu: cpuStr,
              conditions: hpa.status?.conditions || []
            };
            
            // Server-side logging for HPA state changes (with colors)
            const currentReplicas = status.hpa.current;
            if (lastReplicaCount > 0 && currentReplicas !== lastReplicaCount) {
              if (currentReplicas > lastReplicaCount) {
                log.scaleUp(lastReplicaCount, currentReplicas, cpuStr);
              } else {
                log.scaleDown(lastReplicaCount, currentReplicas, cpuStr);
              }
            }
            
            // Log HPA diagnostics periodically (every 10s or on CPU change)
            if (cpuStr !== lastCpuReading) {
              log.hpaStatus(currentReplicas, status.hpa.desired, cpuStr, HPA_TARGET_CPU);
              
              // Diagnostic: explain why HPA isn't scaling
              if (cpuValue !== undefined && currentReplicas > 1) {
                if (cpuValue < HPA_TARGET_CPU) {
                  log.debug(`CPU ${cpuValue}% < target ${HPA_TARGET_CPU}% - HPA should scale down after stabilization window`);
                } else if (cpuValue >= HPA_TARGET_CPU) {
                  log.debug(`CPU ${cpuValue}% >= target ${HPA_TARGET_CPU}% - HPA will maintain or increase replicas`);
                }
              }
              lastCpuReading = cpuStr;
            }
            lastReplicaCount = currentReplicas;
          }
        } catch (e) {
          // Fallback to v1-style parsing if v2 fails
          log.warn(`HPA v2 API error, falling back: ${e}`);
        }
      } catch (err) {
        // Fallback: try kubectl shell (useful for local dev when kubeconfig is present)
        try {
          const { stdout: podOut } = await exec('kubectl get pods -l app=k8s-autoscaling -o json -n default');
          const items = parseKubectlPods(podOut);
          status.pods = items.map((p: any) => parsePodInfo(p));
          
          // Also try to get HPA via kubectl
          try {
            const { stdout: hpaOut } = await exec('kubectl get hpa k8s-autoscaling-hpa -o json -n default');
            const hpa = JSON.parse(hpaOut);
            const currentMetrics = hpa.status?.currentMetrics || [];
            const cpuMetric = currentMetrics.find((m: any) => m.resource?.name === 'cpu');
            const cpuValue = cpuMetric?.resource?.current?.averageUtilization;
            status.hpa = {
              current: hpa.status?.currentReplicas || 0,
              desired: hpa.status?.desiredReplicas || 0,
              min: hpa.spec?.minReplicas || 1,
              max: hpa.spec?.maxReplicas || 10,
              cpu: cpuValue !== undefined ? `${cpuValue}%` : '—'
            };
          } catch (hpaErr) {
            // HPA not available
          }
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

  // Poll every 1 second for more responsive metrics (reduced from 2s)
  const interval = setInterval(async () => {
    if (res.writableEnded) {
      clearInterval(interval);
      return;
    }
    await fetchStatus();
  }, 1000);

  req.on('close', () => {
    clearInterval(interval);
  });
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json(createHealthResponse(POD_NAME));
});

// CPU-intensive stress endpoint for testing autoscaling
// Serve the interactive stress control page (client will connect to SSE)
app.get('/stress', (req: Request, res: Response) => {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Stress Control</title>
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

// Endpoint to stop all CPU stress tests
app.post('/stop-load', async (req: Request, res: Response) => {
  log.stress('STOP requested', `Active test: ${activeStressTest}`);
  stopStress = true;
  activeStressTest = false;
  
  // Helper to get current pod IPs (re-query to catch newly scaled pods)
  const getPodIPs = async (): Promise<string[]> => {
    try {
      const kc = new KubeConfig();
      try { kc.loadFromCluster(); } catch { kc.loadFromDefault(); }
      const k8sApi = kc.makeApiClient(CoreV1Api);
      const podsResp = await k8sApi.listNamespacedPod('default', undefined, undefined, undefined, undefined, 'app=k8s-autoscaling');
      return extractPodIPs(podsResp.body.items || []);
    } catch {
      return [];
    }
  };
  
  // Send stop signal to all pods multiple times to ensure delivery
  // This handles newly scaled pods that may not have received initial signal
  const sendStopToAll = async (podIps: string[], wave: number) => {
    log.debug(`Stop wave ${wave}: sending to ${podIps.length} pods`);
    const stopPromises = podIps.map(ip => 
      (fetch as any)(`http://${ip}:3000/internal-stop`, { method: 'POST', signal: AbortSignal.timeout(2000) }).catch(() => null)
    );
    await Promise.allSettled(stopPromises);
  };
  
  try {
    // First wave: stop all current pods
    const podIps = await getPodIPs();
    log.stress('Stopping all pods', `Count: ${podIps.length}`);
    await sendStopToAll(podIps, 1);
    
    // Second wave after short delay (catch any pods that just came up)
    setTimeout(async () => {
      const newPodIps = await getPodIPs();
      await sendStopToAll(newPodIps, 2);
    }, 1000);
    
    // Third wave for extra safety (catch pods spinning up during scale)
    setTimeout(async () => {
      const finalPodIps = await getPodIPs();
      await sendStopToAll(finalPodIps, 3);
    }, 3000);
    
    // Fourth wave after longer delay (new pods from HPA)
    setTimeout(async () => {
      const latePodIps = await getPodIPs();
      await sendStopToAll(latePodIps, 4);
      log.stress('All stop waves complete');
    }, 10000);
  } catch (err) {
    // Fallback: stop locally only (already done above)
  }
  
  res.json(createStopResponse());
});

// Internal endpoint for pods to receive stop signals from other pods
app.post('/internal-stop', (req: Request, res: Response) => {
  log.debug(`Internal stop received on ${POD_NAME}`);
  stopStress = true;
  activeStressTest = false;
  // Do NOT reset stopStress here - only reset when new stress test starts
  // This ensures all ongoing /cpu-load work stops and stays stopped
  res.json(createInternalStopResponse());
});

// Endpoint to trigger distributed load across pods
app.post('/generate-load', async (req: Request, res: Response) => {
  // Prevent multiple concurrent stress tests
  if (activeStressTest) {
    log.warn('Stress test already running - rejecting new request');
    return res.status(409).json(createConcurrentTestError());
  }
  
  activeStressTest = true;
  stopStress = false; // Reset stop flag
  stressStartTime = Date.now();
  log.stress('STARTED', `Time: ${new Date().toISOString()}`);
  
  const concurrency = 50; // Increased from 20 for more load
  const rounds = 6; // Run 6 rounds of 10 seconds each = 60 seconds total

  // Get pod IPs for app label
  let podIps: string[] = [];
  try {
    const kc = new KubeConfig();
    try { kc.loadFromCluster(); } catch { kc.loadFromDefault(); }
    const k8sApi = kc.makeApiClient(CoreV1Api);
    const podsResp = await k8sApi.listNamespacedPod('default', undefined, undefined, undefined, undefined, 'app=k8s-autoscaling');
    podIps = extractPodIPs(podsResp.body.items || []);
  } catch (err) {
    try {
      const { stdout } = await exec("kubectl get pods -l app=k8s-autoscaling -o json -n default");
      const items = parseKubectlPods(stdout);
      podIps = extractPodIPs(items);
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

  // Fire concurrent requests to /cpu-load on each target in multiple rounds
  (async () => {
    const targets = podIps.length ? podIps : ['127.0.0.1'];
    log.stress('Load distribution', `Targets: ${targets.length}, Concurrency: ${concurrency}, Rounds: ${rounds}`);
    
    for (let round = 0; round < rounds; round++) {
      // Check if stop was requested
      if (stopStress) {
        log.stress('Stopped early', `Completed ${round}/${rounds} rounds`);
        break;
      }
      
      log.debug(`Round ${round + 1}/${rounds} starting`);
      const tasks: Promise<any>[] = [];
      for (let i = 0; i < concurrency; i++) {
        const target = targets[i % targets.length];
        const url = `http://${target}:3000/cpu-load`;
        const p = (fetch as any)(url, { method: 'GET' }).catch(() => null);
        tasks.push(p);
      }
      try { await Promise.all(tasks); } catch {}
    }
    
    // Auto-cleanup after stress test completes
    // IMPORTANT: Do NOT reset stopStress here - let /stop-load handle it
    // This prevents race conditions where ongoing /cpu-load calls continue
    const elapsed = Math.floor((Date.now() - stressStartTime) / 1000);
    log.stress('COMPLETED', `Duration: ${elapsed}s`);
    activeStressTest = false;
    // Signal stop to ensure any stragglers finish quickly
    stopStress = true;
  })();

  res.status(202).json(createGenerateLoadResponse(podIps.length || ['service'], concurrency, rounds));
});

// SSE endpoint that runs CPU work and streams progress
// Simple CPU load endpoint for load testing (short bursts, non-blocking)
app.get('/cpu-load', async (req: Request, res: Response) => {
  const start = Date.now();
  let result = 0;
  let wasStopped = false;
  
  // CRITICAL: Check stop flag BEFORE starting any work
  // This prevents newly scaled pods from doing unnecessary work
  if (stopStress) {
    return res.json(createStressResult(0, 0, true, POD_NAME));
  }
  
  // If no active stress test, assume direct call - reset stop flag
  if (!activeStressTest) {
    stopStress = false;
  }
  
  // Perform intensive CPU work for about 10 seconds (enough to trigger HPA)
  // Check stop flag VERY frequently to allow instant abort
  const duration = 10000;
  const checkInterval = 10000; // Check stop flag every 10k iterations (~5ms) - 10x more frequent
  let iterCount = 0;
  
  while (Date.now() - start < duration) {
    // Check stop flag frequently for instant response
    if (iterCount % checkInterval === 0 && stopStress) {
      wasStopped = true;
      break;
    }
    result += Math.sqrt(iterCount) * Math.sin(iterCount) * Math.cos(iterCount) * Math.tan(iterCount % 100 + 1);
    iterCount++;
  }
  
  const elapsed = Date.now() - start;
  res.json(createStressResult(elapsed, result, wasStopped, POD_NAME));
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
    res.write(formatSSEMessage(data));
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
  res.write(formatSSEMessage({ status: 'complete' }));
  res.end();
});

// Pods overview page — uses `kubectl` if available to list pods and render cards
app.get('/pods', async (req: Request, res: Response) => {
  try {
    const { stdout } = await exec('kubectl get pods -o json --all-namespaces');
    const items = parseKubectlPods(stdout);

    const cards = items.map((p: any) => {
      const podInfo = parsePodInfo(p);
      return generatePodCardHtml(podInfo);
    }).join('\n');

    res.send(generatePodsPageHtml(cards));
  } catch (err: any) {
    const message = String(err.message || err);
    res.send(generatePodsErrorHtml(message));
  }
});

// Start the server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`${COLORS.bright}${COLORS.cyan}╔════════════════════════════════════════════════════════════╗${COLORS.reset}`);
    console.log(`${COLORS.bright}${COLORS.cyan}║${COLORS.reset}  ${COLORS.green}K8s Autoscaling Demo Server${COLORS.reset}                              ${COLORS.cyan}║${COLORS.reset}`);
    console.log(`${COLORS.bright}${COLORS.cyan}╠════════════════════════════════════════════════════════════╣${COLORS.reset}`);
    console.log(`${COLORS.cyan}║${COLORS.reset}  ${COLORS.gray}Port:${COLORS.reset}        ${COLORS.green}${PORT}${COLORS.reset}                                          ${COLORS.cyan}║${COLORS.reset}`);
    console.log(`${COLORS.cyan}║${COLORS.reset}  ${COLORS.gray}Pod:${COLORS.reset}         ${COLORS.yellow}${POD_NAME}${COLORS.reset}`);
    console.log(`${COLORS.cyan}║${COLORS.reset}  ${COLORS.gray}Environment:${COLORS.reset} ${process.env.NODE_ENV || 'development'}`);
    console.log(`${COLORS.cyan}║${COLORS.reset}  ${COLORS.gray}PID:${COLORS.reset}         ${process.pid}`);
    console.log(`${COLORS.cyan}║${COLORS.reset}  ${COLORS.gray}Node:${COLORS.reset}        ${process.version}`);
    console.log(`${COLORS.bright}${COLORS.cyan}╚════════════════════════════════════════════════════════════╝${COLORS.reset}`);
    log.info('Server started successfully');
    log.info(`HPA Target CPU: ${HPA_TARGET_CPU}% (scale up above, scale down below)`);
  });
}

export { app };
