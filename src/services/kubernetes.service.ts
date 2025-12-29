import { KubeConfig, CoreV1Api, AutoscalingV2Api } from '@kubernetes/client-node';
import { promisify } from 'util';
import { exec as _exec } from 'child_process';
import { CONFIG, log } from '../config';
import { 
  parsePodInfo, 
  parseHPAStatus, 
  parseHPAStatusV2,
  parseKubectlPods, 
  extractPodIPs 
} from '../utils/kubernetes';

const exec = promisify(_exec);

/**
 * Kubernetes Service - Handles all K8s API interactions
 * 
 * Supports two modes:
 * 1. In-cluster: Uses ServiceAccount token via @kubernetes/client-node
 * 2. Local/fallback: Uses kubectl shell commands
 */

// Track HPA state for detecting scaling events
let lastReplicaCount = 0;
let lastCpuReading = '';

// Getters/setters for testability
export const getLastReplicaCount = () => lastReplicaCount;
export const setLastReplicaCount = (value: number) => { lastReplicaCount = value; };
export const getLastCpuReading = () => lastCpuReading;
export const setLastCpuReading = (value: string) => { lastCpuReading = value; };

/**
 * Create a KubeConfig, trying in-cluster first, then default
 */
export function createKubeConfig(): KubeConfig {
  const kc = new KubeConfig();
  try {
    kc.loadFromCluster();
  } catch {
    kc.loadFromDefault();
  }
  return kc;
}

/**
 * Get pod IPs for the autoscaling app
 * Only returns IPs of pods that are Running + Ready (not terminating)
 * 
 * @returns Array of pod IP addresses
 */
export async function getPodIPs(): Promise<string[]> {
  try {
    const kc = createKubeConfig();
    const k8sApi = kc.makeApiClient(CoreV1Api);
    const podsResp = await k8sApi.listNamespacedPod(
      'default', 
      undefined, 
      undefined, 
      undefined, 
      undefined, 
      'app=k8s-autoscaling'
    );
    const allPods = podsResp.body.items || [];
    const readyIPs = extractPodIPs(allPods);
    log.debug(`getPodIPs: ${allPods.length} total pods, ${readyIPs.length} ready: [${readyIPs.join(', ')}]`);
    return readyIPs;
  } catch (err) {
    log.debug(`K8s API failed, trying kubectl: ${err}`);
    try {
      const { stdout } = await exec("kubectl get pods -l app=k8s-autoscaling -o json -n default");
      const items = parseKubectlPods(stdout);
      const readyIPs = extractPodIPs(items);
      log.debug(`getPodIPs (kubectl): ${items.length} total pods, ${readyIPs.length} ready`);
      return readyIPs;
    } catch (e) {
      log.debug(`kubectl also failed: ${e}`);
      return [];
    }
  }
}

/**
 * Get service ClusterIP as fallback for pod IPs
 */
export async function getServiceClusterIP(): Promise<string | null> {
  try {
    const kc = createKubeConfig();
    const core = kc.makeApiClient(CoreV1Api);
    const service = await core.readNamespacedService('k8s-autoscaling-service', 'default');
    return service.body.spec?.clusterIP || null;
  } catch {
    return null;
  }
}

/**
 * Fetch cluster status including pods and HPA data
 * 
 * @returns Object containing pods array and HPA status
 */
export async function fetchClusterStatus(): Promise<{
  pods: any[];
  hpa: any;
}> {
  const status: { pods: any[]; hpa: any } = { pods: [], hpa: {} };
  
  try {
    const kc = createKubeConfig();
    const coreApi = kc.makeApiClient(CoreV1Api);
    const autoscalingApi = kc.makeApiClient(AutoscalingV2Api);
    
    // Fetch pods
    const podsResp = await coreApi.listNamespacedPod(
      'default',
      undefined,
      undefined,
      undefined,
      undefined,
      'app=k8s-autoscaling'
    );
    status.pods = (podsResp.body.items || []).map(parsePodInfo);
    
    // Fetch HPA using v2 API for instant metrics
    try {
      const hpaResp = await autoscalingApi.readNamespacedHorizontalPodAutoscaler(
        'k8s-autoscaling-hpa',
        'default'
      );
      // Use V2 parser for proper metrics extraction
      status.hpa = parseHPAStatusV2(hpaResp.body);
      log.debug(`HPA fetched: CPU=${status.hpa.cpu}, current=${status.hpa.current}, desired=${status.hpa.desired}`);
      
      // Log scaling events
      logScalingEvents(status.hpa);
    } catch (hpaErr: any) {
      log.error(`HPA fetch failed: ${hpaErr?.message || hpaErr}`);
      status.hpa = { current: 0, desired: 0, min: 1, max: 10, cpu: '—', error: true };
    }
  } catch (err) {
    // Fallback to kubectl
    log.debug(`K8s API failed, trying kubectl: ${err}`);
    try {
      const { stdout } = await exec('kubectl get pods -l app=k8s-autoscaling -o json -n default');
      const items = parseKubectlPods(stdout);
      status.pods = items.map(parsePodInfo);
      
      const { stdout: hpaOut } = await exec('kubectl get hpa k8s-autoscaling-hpa -o json -n default');
      status.hpa = parseHPAStatus(JSON.parse(hpaOut));
      logScalingEvents(status.hpa);
    } catch (e) {
      log.debug(`kubectl fallback failed: ${e}`);
    }
  }
  
  return status;
}

/**
 * Log scaling events based on HPA status changes
 */
function logScalingEvents(hpa: any): void {
  const currentReplicas = hpa.currentReplicas || 0;
  const cpu = hpa.currentCPU || '0%';
  
  if (lastReplicaCount > 0 && currentReplicas !== lastReplicaCount) {
    if (currentReplicas > lastReplicaCount) {
      log.scaleUp(lastReplicaCount, currentReplicas, cpu);
    } else {
      log.scaleDown(lastReplicaCount, currentReplicas, cpu);
    }
  }
  
  lastReplicaCount = currentReplicas;
  lastCpuReading = cpu;
}

/**
 * Send stop signal to a single pod
 */
export async function sendStopToPod(ip: string): Promise<boolean> {
  try {
    await (fetch as any)(`http://${ip}:3000/internal-stop`, {
      method: 'POST',
      signal: AbortSignal.timeout(CONFIG.TIMEOUTS.STOP_SIGNAL_MS)
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Send stop signal to all pods
 */
export async function sendStopToAllPods(): Promise<void> {
  const podIps = await getPodIPs();
  log.stress('Stopping all pods', `Count: ${podIps.length}`);
  
  const stopPromises = podIps.map(ip => sendStopToPod(ip));
  await Promise.allSettled(stopPromises);
}

/**
 * Get all pods using kubectl (for /pods page)
 */
export async function getAllPods(): Promise<any[]> {
  const { stdout } = await exec('kubectl get pods -o json --all-namespaces');
  return parseKubectlPods(stdout);
}
