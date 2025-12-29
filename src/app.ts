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
  
  // Check if we're the only pod - run local stress instead of HTTP requests
  const isSinglePod = targets.length === 1 && (
    targets[0] === '127.0.0.1' || 
    targets[0] === process.env.POD_IP ||
    await k8sService.isCurrentPodIP(targets[0])
  );
  
  if (isSinglePod) {
    log.stress('Single pod mode', 'Running local CPU stress (no HTTP overhead)');
    runLocalStressTest(ROUNDS);
  } else {
    // Distributed load across multiple pods
    runDistributedLoadTest(targets, CONCURRENCY, ROUNDS);
  }
  
  res.status(202).json(createGenerateLoadResponse(targets, CONCURRENCY, ROUNDS));
}

/**
 * Run local stress test when we're the only pod
 * This avoids HTTP overhead and timeouts from self-requests
 */
async function runLocalStressTest(rounds: number): Promise<void> {
  log.stress('Local stress starting', `${rounds} rounds of CPU work`);
  
  try {
    for (let round = 0; round < rounds; round++) {
      if (stressService.getStopStress()) {
        log.stress('Stopped early', `Completed ${round}/${rounds} rounds`);
        break;
      }
      
      log.info(`Local round ${round + 1}/${rounds} - CPU stress`);
      
      // Run CPU-intensive work directly
      const result = await stressService.executeCpuWork();
      log.debug(`Local round ${round + 1} complete: ${result.elapsed}ms, stopped=${result.wasStopped}`);
      
      if (result.wasStopped) break;
      
      // Brief yield between rounds
      await new Promise(resolve => setImmediate(resolve));
    }
  } catch (err) {
    log.error(`Local stress test failed: ${err}`);
  } finally {
    stressService.endStressTest();
    log.stress('Local stress complete');
  }
}

/**
 * Run distributed load test across targets
 */
async function runDistributedLoadTest(
  targets: string[], 
  concurrency: number, 
  rounds: number
): Promise<void> {
  log.stress('Distributed load starting', `${rounds} rounds x ${concurrency} concurrent requests`);
  
  try {
    for (let round = 0; round < rounds; round++) {
      if (stressService.getStopStress()) {
        log.stress('Stopped early', `Completed ${round}/${rounds} rounds`);
        break;
      }
      
      log.info(`Round ${round + 1}/${rounds} - sending ${concurrency} requests to ${targets.length} targets`);
      
      // Create concurrent requests
      const tasks: Promise<any>[] = [];
      for (let i = 0; i < concurrency; i++) {
        const target = targets[i % targets.length];
        const url = `http://${target}:3000/cpu-load`;
        const p = (fetch as any)(url, {
          method: 'GET',
          signal: AbortSignal.timeout(CONFIG.TIMEOUTS.FETCH_MS)
        }).catch((e: any) => {
          log.debug(`Request to ${target} failed: ${e?.message || e}`);
          return null;
        });
        tasks.push(p);
      }
      
      const results = await Promise.all(tasks);
      const successCount = results.filter(r => r !== null).length;
      log.debug(`Round ${round + 1} complete: ${successCount}/${concurrency} succeeded`);
      
      await new Promise(resolve => setImmediate(resolve));
    }
  } catch (err) {
    log.error(`Load test failed: ${err}`);
  } finally {
    stressService.endStressTest();
    log.stress('Distributed load complete');
  }
}

/**
 * CPU load endpoint - performs intensive CPU work
 */
async function cpuLoadHandler(req: Request, res: Response): Promise<void> {
  // Early exit if stopped
  if (stressService.getStopStress()) {
    log.debug('CPU load request - stopped flag is set, returning early');
    res.json(createStressResult(0, 0, true, CONFIG.POD_NAME));
    return;
  }
  
  // If no active test, reset stop flag (direct call)
  if (!stressService.getActiveStressTest()) {
    log.debug('CPU load request - no active test, resetting stop flag');
    stressService.setStopStress(false);
  }
  
  log.debug(`CPU load starting on ${CONFIG.POD_NAME}`);
  const result = await stressService.executeCpuWork();
  log.debug(`CPU load complete: ${result.elapsed}ms, stopped=${result.wasStopped}`);
  
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
  // Proper SSE headers to prevent chunked encoding errors
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  
  // Send initial comment to establish connection
  res.write(':ok\n\n');
  
  let isConnected = true;
  
  const send = (data: object) => {
    if (isConnected && !res.writableEnded) {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (e) {
        isConnected = false;
      }
    }
  };
  
  const fetchAndSend = async () => {
    if (!isConnected) return;
    try {
      const status = await k8sService.fetchClusterStatus();
      send(status);
    } catch (err) {
      log.debug(`Cluster status fetch error: ${err}`);
      // Send error state but keep connection alive
      send({ pods: [], hpa: { error: true } });
    }
  };
  
  // Initial fetch
  await fetchAndSend();
  
  // Periodic updates
  const intervalId = setInterval(fetchAndSend, CONFIG.TIMEOUTS.SSE_INTERVAL_MS);
  
  // Send keepalive every 15 seconds to prevent timeout
  const keepaliveId = setInterval(() => {
    if (isConnected && !res.writableEnded) {
      res.write(':keepalive\n\n');
    }
  }, 15000);
  
  // Cleanup on disconnect
  req.on('close', () => {
    isConnected = false;
    clearInterval(intervalId);
    clearInterval(keepaliveId);
  });
  
  req.on('error', () => {
    isConnected = false;
    clearInterval(intervalId);
    clearInterval(keepaliveId);
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
