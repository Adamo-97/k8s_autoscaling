import { CONFIG } from '../config';

/**
 * Generate the main dashboard HTML
 */
export function generateDashboardHtml(podName: string): string {
  return `<!DOCTYPE html>
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
    .log-entry{margin:2px 0;padding:4px 8px;border-radius:4px}
    .log-entry.scale-up{background:rgba(110,231,183,0.15);color:#6ee7b7;border-left:3px solid #6ee7b7}
    .log-entry.scale-down{background:rgba(251,146,60,0.15);color:#fb923c;border-left:3px solid #fb923c}
    .log-entry.hpa-status{background:rgba(96,165,250,0.1);color:#60a5fa;border-left:3px solid #60a5fa}
    .log-entry.stress{background:rgba(192,132,252,0.1);color:#c084fc;border-left:3px solid #c084fc}
    .log-entry.pod-new{background:rgba(250,204,21,0.1);color:#facc15;border-left:3px solid #facc15}
    .log-entry.error{background:rgba(248,113,113,0.1);color:#f87171;border-left:3px solid #f87171}
    .log-entry.info{color:var(--muted)}
  </style>
</head>
<body>
  <div class="container">
    <h1>Kubernetes Autoscaling Dashboard</h1>
    <p style="color:var(--muted);margin-bottom:20px">Live monitoring · Served by pod: <strong style="color:var(--accent)">${podName}</strong></p>

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
          <button id="start-stress">Start CPU Load (80s)</button>
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
    let clusterES;
    const startTime = Date.now();
    const knownPods = new Set();
    const podCreationTimes = new Map();
    let initialReplicas = null;
    let peakReplicas = 0;
    let lastReplicaCount = 0;
    let lastCpuValue = null;

    function logEvent(type, msg) {
      const logs = document.getElementById('logs');
      const time = new Date().toLocaleTimeString();
      const icons = {
        'scale-up': '▲',
        'scale-down': '▼',
        'hpa-status': '◉',
        'stress': '⚡',
        'pod-new': '✦',
        'error': '✕',
        'info': '•'
      };
      const icon = icons[type] || '•';
      logs.innerHTML = '<div class="log-entry ' + type + '">[' + time + '] ' + icon + ' ' + msg + '</div>' + logs.innerHTML;
      while (logs.children.length > 50) logs.removeChild(logs.lastChild);
    }

    function updateUptime() {
      const sec = Math.floor((Date.now() - startTime) / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      document.getElementById('uptime').textContent = m + 'm ' + s + 's';
    }
    setInterval(updateUptime, 1000);

    function connectCluster() {
      if (clusterES) clusterES.close();
      clusterES = new EventSource('/cluster-status');
      clusterES.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          
          if (data.hpa) {
            const current = data.hpa.current || 0;
            const desired = data.hpa.desired || 0;
            const min = data.hpa.min || 1;
            const max = data.hpa.max || 10;
            const cpuStr = data.hpa.cpu || '—';
            
            if (initialReplicas === null && current > 0) {
              initialReplicas = current;
              logEvent('info', 'Initial replica count: ' + initialReplicas);
            }
            if (current > peakReplicas) {
              peakReplicas = current;
            }
            
            if (current !== lastReplicaCount && lastReplicaCount > 0) {
              if (current > lastReplicaCount) {
                logEvent('scale-up', 'SCALING UP: ' + lastReplicaCount + ' → ' + current + ' replicas | CPU: ' + cpuStr);
              } else {
                logEvent('scale-down', 'SCALING DOWN: ' + lastReplicaCount + ' → ' + current + ' replicas | CPU: ' + cpuStr);
              }
            }
            lastReplicaCount = current;
            
            const cpuNum = parseInt(cpuStr);
            if (!isNaN(cpuNum) && lastCpuValue !== null && Math.abs(cpuNum - lastCpuValue) >= 10) {
              logEvent('hpa-status', 'CPU: ' + cpuStr + ' (target: 50%) | Replicas: ' + current + '/' + desired);
            }
            lastCpuValue = isNaN(cpuNum) ? lastCpuValue : cpuNum;
            
            const scalingText = initialReplicas !== null ? 
              'Started: ' + initialReplicas + ' → Peak: ' + peakReplicas + ' → Now: ' + current : '—';
            document.getElementById('scaling-progress').textContent = scalingText;
            document.getElementById('current-desired').textContent = current + ' / ' + desired;
            document.getElementById('min-max').textContent = min + ' / ' + max;
            document.getElementById('cpu-usage').textContent = cpuStr;
            
            const scalingPercent = Math.min(100, Math.max(0, ((current - min) / (max - min)) * 100));
            document.getElementById('scaling-bar').style.width = scalingPercent + '%';
          }

          if (data.pods) {
            const grid = document.getElementById('pods-grid');
            document.getElementById('pod-count').textContent = data.pods.length;
            const now = Date.now();
            
            grid.innerHTML = data.pods.map(p => {
              const isNew = !knownPods.has(p.name);
              const isRecent = p.ageSeconds < 60;
              
              if (isNew) {
                knownPods.add(p.name);
                podCreationTimes.set(p.name, now);
                logEvent('pod-new', 'New pod created: ' + p.name);
              }
              
              const cardClass = isRecent ? 'pod-card scaling-up' : 'pod-card';
              const badge = isRecent ? '<span class="badge new">NEW</span>' : '';
              
              return '<div class="' + cardClass + '">' +
                badge +
                '<div class="name">' + p.name + '</div>' +
                '<div class="meta">IP: ' + p.ip + ' · Age: ' + p.age + '</div>' +
                '<div class="meta">Ready: ' + p.ready + ' · Restarts: ' + p.restarts + '</div>' +
                '<span class="status ' + p.phase.toLowerCase() + '">' + p.phase + '</span>' +
              '</div>';
            }).join('');
          }
        } catch(e) { console.error(e); }
      };
      clusterES.onerror = () => {
        logEvent('error', 'Cluster SSE disconnected, reconnecting...');
        setTimeout(connectCluster, 2000);
      };
    }
    connectCluster();

    document.getElementById('start-stress').onclick = () => {
      document.getElementById('start-stress').disabled = true;
      document.getElementById('stop-stress').disabled = false;
      document.getElementById('stress-status').textContent = 'Running';
      logEvent('stress', 'CPU stress test STARTED - distributing load across pods');

      fetch('/generate-load', { method: 'POST' }).then(() => {
        let progress = 0;
        window.stressInterval = setInterval(() => {
          progress += 100 / 80;
          if (progress >= 100) {
            progress = 100;
            clearInterval(window.stressInterval);
            fetch('/stop-load', { method: 'POST' }).then(() => {
              logEvent('stress', 'Stop signal sent to all pods');
            }).catch(() => {});
            setTimeout(() => {
              document.getElementById('start-stress').disabled = false;
              document.getElementById('stop-stress').disabled = true;
              document.getElementById('stress-status').textContent = 'Idle';
              document.getElementById('stress-bar').style.width = '0%';
              logEvent('stress', 'CPU stress test COMPLETED');
            }, 1000);
          }
          document.getElementById('stress-bar').style.width = progress + '%';
        }, 1000);
      }).catch(() => {
        document.getElementById('stress-status').textContent = 'Error';
        document.getElementById('start-stress').disabled = false;
        document.getElementById('stop-stress').disabled = true;
        logEvent('error', 'Failed to start stress test');
      });
    };

    document.getElementById('stop-stress').onclick = () => {
      if (window.stressInterval) {
        clearInterval(window.stressInterval);
        window.stressInterval = null;
      }
      fetch('/stop-load', { method: 'POST' }).then(() => {
        document.getElementById('start-stress').disabled = false;
        document.getElementById('stop-stress').disabled = true;
        document.getElementById('stress-status').textContent = 'Stopped';
        document.getElementById('stress-bar').style.width = '0%';
        logEvent('stress', 'CPU stress test STOPPED by user');
      }).catch((e) => {
        logEvent('error', 'Stop request failed: ' + e.message);
      });
    };

    logEvent('info', 'Dashboard initialized - connected to cluster');
  </script>
</body>
</html>`;
}

/**
 * Generate legacy stress page HTML
 */
export function generateStressPageHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>CPU Stress Test</title>
  <style>
    body{background:#1a1a2e;color:#eee;font-family:monospace;padding:20px}
    #log{background:#16213e;padding:15px;border-radius:8px;height:400px;overflow-y:auto}
    .progress{margin:20px 0}
    .bar{background:#0f3460;height:20px;border-radius:10px;overflow:hidden}
    .fill{background:#e94560;height:100%;transition:width 0.3s}
  </style>
</head>
<body>
  <h1>CPU Stress Test (SSE)</h1>
  <div class="progress"><div class="bar"><div class="fill" id="bar"></div></div></div>
  <div id="log"></div>
  <script>
    const log = document.getElementById('log');
    const bar = document.getElementById('bar');
    const es = new EventSource('/stress-stream');
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      bar.style.width = d.progress + '%';
      log.innerHTML += '<div>Progress: ' + d.progress + '% | Elapsed: ' + d.elapsed + 'ms</div>';
      log.scrollTop = log.scrollHeight;
    };
    es.addEventListener('done', e => {
      const d = JSON.parse(e.data);
      log.innerHTML += '<div style="color:#4ade80">✓ Complete: ' + d.status + '</div>';
      es.close();
    });
    es.onerror = () => {
      log.innerHTML += '<div style="color:#f87171">Connection error</div>';
    };
  </script>
</body>
</html>`;
}
