/**
 * Kubernetes utility functions for pod and HPA data processing
 * Extracted for testability
 */

/**
 * Parse pod metadata to extract relevant information
 */
export function parsePodMetadata(pod: any): { name: string; namespace: string } {
  return {
    name: pod?.metadata?.name || 'unknown',
    namespace: pod?.metadata?.namespace || 'default'
  };
}

/**
 * Parse pod status to extract phase and IP
 */
export function parsePodStatus(pod: any): { phase: string; ip: string } {
  return {
    phase: pod?.status?.phase || 'Unknown',
    ip: pod?.status?.podIP || '-'
  };
}

/**
 * Calculate pod ready status string (e.g., "2/3")
 */
export function getPodReadyStatus(pod: any): string {
  const containerStatuses = pod?.status?.containerStatuses || [];
  const ready = containerStatuses.filter((c: any) => c.ready).length;
  const total = containerStatuses.length;
  return `${ready}/${total}`;
}

/**
 * Calculate total restart count for a pod
 */
export function getPodRestartCount(pod: any): number {
  const containerStatuses = pod?.status?.containerStatuses || [];
  return containerStatuses.reduce(
    (sum: number, c: any) => sum + (c.restartCount || 0),
    0
  );
}

/**
 * Calculate pod age in seconds from creation timestamp
 */
export function calculatePodAgeSeconds(creationTimestamp: string | undefined): number {
  if (!creationTimestamp) return 9999;
  const creationTime = Date.parse(creationTimestamp);
  if (isNaN(creationTime)) return 9999;
  return Math.floor((Date.now() - creationTime) / 1000);
}

/**
 * Format age in seconds to human-readable string
 */
export function formatAge(ageSeconds: number): string {
  if (ageSeconds === 9999 || ageSeconds < 0) return '-';
  if (ageSeconds < 60) return `${ageSeconds}s`;
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m`;
  return `${Math.floor(ageSeconds / 3600)}h`;
}

/**
 * Parse complete pod information
 */
export function parsePodInfo(pod: any) {
  const { name, namespace } = parsePodMetadata(pod);
  const { phase, ip } = parsePodStatus(pod);
  const ready = getPodReadyStatus(pod);
  const restarts = getPodRestartCount(pod);
  const ageSeconds = calculatePodAgeSeconds(pod?.metadata?.creationTimestamp);
  const age = formatAge(ageSeconds);

  return {
    name,
    namespace,
    phase,
    ip,
    ready,
    restarts,
    ageSeconds,
    age
  };
}

/**
 * Parse HPA status information
 */
export function parseHPAStatus(hpa: any): {
  current: number;
  desired: number;
  min: number;
  max: number;
  cpu: string;
} {
  return {
    current: hpa?.status?.currentReplicas || 0,
    desired: hpa?.status?.desiredReplicas || 0,
    min: hpa?.spec?.minReplicas || 1,
    max: hpa?.spec?.maxReplicas || 10,
    cpu: hpa?.status?.currentCPUUtilizationPercentage
      ? `${hpa.status.currentCPUUtilizationPercentage}%`
      : '—'
  };
}

/**
 * Parse kubectl JSON output for pods
 */
export function parseKubectlPods(stdout: string): any[] {
  try {
    const obj = JSON.parse(stdout || '{}');
    return Array.isArray(obj.items) ? obj.items : [];
  } catch {
    return [];
  }
}

/**
 * Extract pod IPs from pod list
 */
export function extractPodIPs(pods: any[]): string[] {
  return pods
    .map((p: any) => p?.status?.podIP)
    .filter(Boolean) as string[];
}

/**
 * Build target URL for load distribution
 */
export function buildTargetUrl(ip: string, port: number = 3000): string {
  return `http://${ip}:${port}/cpu-load`;
}

/**
 * Distribute requests across targets using round-robin
 */
export function distributeTarget(targets: string[], index: number): string {
  if (!targets.length) return '127.0.0.1';
  return targets[index % targets.length];
}

/**
 * Calculate scaling percentage for progress bar
 */
export function calculateScalingPercentage(
  current: number,
  min: number,
  max: number
): number {
  if (max === min) return current > min ? 100 : 0;
  const percent = ((current - min) / (max - min)) * 100;
  return Math.min(100, Math.max(0, percent));
}

/**
 * Detect if a pod is newly created (< 60 seconds old)
 */
export function isNewPod(ageSeconds: number): boolean {
  return ageSeconds < 60 && ageSeconds >= 0 && ageSeconds !== 9999;
}

/**
 * Format SSE message for sending to client
 */
export function formatSSEMessage(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Create stress test result object
 */
export function createStressResult(
  elapsed: number,
  result: number,
  stopped: boolean,
  podName: string
) {
  return {
    status: stopped ? 'stopped' : 'complete',
    elapsed,
    result: result.toFixed(2),
    pod: podName
  };
}

/**
 * Create health check response
 */
export function createHealthResponse(podName: string) {
  return {
    status: 'healthy',
    pod: podName,
    timestamp: new Date().toISOString(),
    pid: process.pid,
    uptime: process.uptime(),
    memory: process.memoryUsage()
  };
}

/**
 * Create stop-load response
 */
export function createStopResponse() {
  return {
    status: 'stopped',
    timestamp: new Date().toISOString()
  };
}

/**
 * Create generate-load response
 */
export function createGenerateLoadResponse(
  targets: string[] | number,
  concurrency: number,
  rounds: number
) {
  return {
    status: 'started',
    targets,
    concurrency,
    rounds
  };
}

/**
 * Create concurrent test error response
 */
export function createConcurrentTestError() {
  return {
    status: 'error',
    message: 'A stress test is already running. Stop it first before starting a new one.'
  };
}

/**
 * Create internal stop response
 */
export function createInternalStopResponse() {
  return { status: 'stopped' };
}

/**
 * Generate pod card HTML
 */
export function generatePodCardHtml(podInfo: {
  name: string;
  namespace: string;
  phase: string;
  ip: string;
  ready: string;
  restarts: number;
  age: string;
}): string {
  const { name, namespace, phase, ip, ready, restarts, age } = podInfo;
  return `
        <div class="card">
          <div class="title">${name}</div>
          <div class="meta">NS: ${namespace} · IP: ${ip} · Age: ${age}</div>
          <div class="status ${phase.toLowerCase()}">Status: ${phase}</div>
          <div class="meta">Ready: ${ready} · Restarts: ${restarts}</div>
        </div>
      `;
}

/**
 * Generate pods page HTML
 */
export function generatePodsPageHtml(cards: string): string {
  return `<!doctype html>
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
}

/**
 * Generate pods error page HTML
 */
export function generatePodsErrorHtml(message: string): string {
  return `<!doctype html><html><body><h1>Pods</h1><p>kubectl failed: ${message}</p><p>Make sure kubectl is installed and kubeconfig is accessible to the server process.</p><p><a href="/">Back</a></p></body></html>`;
}
