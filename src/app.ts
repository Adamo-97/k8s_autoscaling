import express, { Request, Response, Application } from 'express';
import { CONFIG, log } from './config';
import { generateDashboardHtml, generateStressPageHtml } from './templates/dashboard';
import * as stressService from './services/stress.service';
import * as k8sService from './services/kubernetes.service';
import {
  formatSSEMessage,
  createStressResult,
  createHealthResponse,
  createStopResponse,
  createGenerateLoadResponse,
  createConcurrentTestError,
  createInternalStopResponse,
  parsePodInfo,
  generatePodCardHtml,
  generatePodsPageHtml,
  generatePodsErrorHtml
} from './utils/kubernetes';

/**
 * Create and configure the Express application
 */
export function createApp(): Application {
  const app = express();
  
  // Middleware
  app.use(express.json());
  
  // Routes
  registerRoutes(app);
  
  return app;
}

/**
 * Register all routes on the app
 */
function registerRoutes(app: Application): void {
  // Dashboard
  app.get('/', dashboardHandler);
  
  // Health
  app.get('/health', healthHandler);
  
  // Stress control
  app.post('/generate-load', generateLoadHandler);
  app.get('/cpu-load', cpuLoadHandler);
  app.post('/stop-load', stopLoadHandler);
  app.post('/internal-stop', internalStopHandler);
  
  // SSE endpoints
  app.get('/cluster-status', clusterStatusHandler);
  app.get('/stress-stream', stressStreamHandler);
  
  // Legacy endpoints
  app.get('/stress', stressPageHandler);
  app.get('/pods', podsHandler);
}

// ============= Route Handlers =============

/**
 * Dashboard - main UI
 */
function dashboardHandler(req: Request, res: Response): void {
  res.send(generateDashboardHtml(CONFIG.POD_NAME));
}

/**
 * Health check endpoint
 */
function healthHandler(req: Request, res: Response): void {
  res.json(createHealthResponse(CONFIG.POD_NAME));
}

/**
 * Generate distributed CPU load across all pods
 */
async function generateLoadHandler(req: Request, res: Response): Promise<void> {
  // Prevent concurrent stress tests
  if (stressService.getActiveStressTest()) {
    log.warn('Stress test already running - rejecting new request');
    res.status(409).json(createConcurrentTestError());
    return;
  }
  
  stressService.startStressTest();
  
  const { CONCURRENCY, ROUNDS } = CONFIG.STRESS;
  
  // Get pod IPs
  let podIps = await k8sService.getPodIPs();
  
  // Fallback to service IP if no pods found
  if (!podIps.length) {
    const serviceIP = await k8sService.getServiceClusterIP();
    if (serviceIP) podIps = [serviceIP];
  }
  
  const targets = podIps.length ? podIps : ['127.0.0.1'];
  log.stress('Load distribution', `Targets: ${targets.length}, Concurrency: ${CONCURRENCY}, Rounds: ${ROUNDS}`);
  
  // Run load test in background
  runDistributedLoadTest(targets, CONCURRENCY, ROUNDS);
  
  res.status(202).json(createGenerateLoadResponse(targets, CONCURRENCY, ROUNDS));
}

/**
 * Run distributed load test across targets
 */
async function runDistributedLoadTest(
  targets: string[], 
  concurrency: number, 
  rounds: number
): Promise<void> {
  try {
    for (let round = 0; round < rounds; round++) {
      if (stressService.getStopStress()) {
        log.stress('Stopped early', `Completed ${round}/${rounds} rounds`);
        break;
      }
      
      log.debug(`Round ${round + 1}/${rounds} starting`);
      
      // Create concurrent requests
      const tasks: Promise<any>[] = [];
      for (let i = 0; i < concurrency; i++) {
        const target = targets[i % targets.length];
        const url = `http://${target}:3000/cpu-load`;
        const p = (fetch as any)(url, {
          method: 'GET',
          signal: AbortSignal.timeout(CONFIG.TIMEOUTS.FETCH_MS)
        }).catch(() => null);
        tasks.push(p);
      }
      
      await Promise.all(tasks);
      await new Promise(resolve => setImmediate(resolve));
    }
  } catch (err) {
    log.error(`Load test failed: ${err}`);
  } finally {
    stressService.endStressTest();
  }
}

/**
 * CPU load endpoint - performs intensive CPU work
 */
async function cpuLoadHandler(req: Request, res: Response): Promise<void> {
  // Early exit if stopped
  if (stressService.getStopStress()) {
    res.json(createStressResult(0, 0, true, CONFIG.POD_NAME));
    return;
  }
  
  // If no active test, reset stop flag (direct call)
  if (!stressService.getActiveStressTest()) {
    stressService.setStopStress(false);
  }
  
  const result = await stressService.executeCpuWork();
  res.json(createStressResult(result.elapsed, result.result, result.wasStopped, CONFIG.POD_NAME));
}

/**
 * Stop all stress tests
 */
async function stopLoadHandler(req: Request, res: Response): Promise<void> {
  log.stress('STOP requested', `Active test: ${stressService.getActiveStressTest()}`);
  
  stressService.resetStressState();
  
  // Send stop to all pods in waves
  const sendStopWave = async (wave: number) => {
    if (!stressService.getStopStress()) return; // Only if still stopping
    const podIps = await k8sService.getPodIPs();
    log.debug(`Stop wave ${wave}: sending to ${podIps.length} pods`);
    const promises = podIps.map(ip => k8sService.sendStopToPod(ip));
    await Promise.allSettled(promises);
  };
  
  try {
    await k8sService.sendStopToAllPods();
    
    // Schedule follow-up waves
    stressService.addTrackedTimer(() => sendStopWave(2), 1000);
    stressService.addTrackedTimer(() => {
      sendStopWave(3);
      log.stress('All stop waves complete');
    }, 3000);
  } catch (err) {
    log.error(`Stop failed: ${err}`);
  }
  
  res.json(createStopResponse());
}

/**
 * Internal stop - receives stop signal from other pods
 */
function internalStopHandler(req: Request, res: Response): void {
  log.debug(`Internal stop received on ${CONFIG.POD_NAME}`);
  stressService.setStopStress(true);
  stressService.setActiveStressTest(false);
  res.json(createInternalStopResponse());
}

/**
 * Cluster status SSE endpoint
 */
async function clusterStatusHandler(req: Request, res: Response): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (res.flushHeaders) res.flushHeaders();
  
  const send = (data: object) => {
    if (!res.writableEnded) {
      res.write(formatSSEMessage(data));
    }
  };
  
  const fetchAndSend = async () => {
    try {
      const status = await k8sService.fetchClusterStatus();
      send(status);
    } catch (err) {
      log.debug(`Cluster status fetch error: ${err}`);
    }
  };
  
  // Initial fetch
  await fetchAndSend();
  
  // Periodic updates
  const intervalId = setInterval(fetchAndSend, CONFIG.TIMEOUTS.SSE_INTERVAL_MS);
  
  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(intervalId);
  });
}

/**
 * Stress stream SSE endpoint
 */
async function stressStreamHandler(req: Request, res: Response): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (res.flushHeaders) res.flushHeaders();
  
  const duration = 30000;
  
  const result = await stressService.executeStreamingCpuWork(
    duration,
    (progress, elapsed, result) => {
      if (!res.writableEnded) {
        res.write(formatSSEMessage({ progress, elapsed, result }));
      }
    }
  );
  
  if (!res.writableEnded) {
    res.write(formatSSEMessage({ progress: 100, elapsed: result.elapsed, result: result.result }));
    res.write('event: done\n');
    res.write(formatSSEMessage({ status: result.stopped ? 'stopped' : 'complete' }));
    res.end();
  }
}

/**
 * Legacy stress page
 */
function stressPageHandler(req: Request, res: Response): void {
  res.send(generateStressPageHtml());
}

/**
 * Pods overview page
 */
async function podsHandler(req: Request, res: Response): Promise<void> {
  try {
    const pods = await k8sService.getAllPods();
    const cards = pods.map((p: any) => {
      const podInfo = parsePodInfo(p);
      return generatePodCardHtml(podInfo);
    }).join('\n');
    res.send(generatePodsPageHtml(cards));
  } catch (err: any) {
    res.send(generatePodsErrorHtml(String(err.message || err)));
  }
}

// Export app instance
export const app = createApp();
