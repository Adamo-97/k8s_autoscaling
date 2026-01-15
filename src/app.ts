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

// Global set to track active SSE intervals for cleanup
const activeSSEIntervals = new Set<NodeJS.Timeout>();

/**
 * Clear all active SSE intervals - called on server shutdown or in tests
 */
export function clearAllSSEIntervals(): void {
  for (const interval of activeSSEIntervals) {
    clearInterval(interval);
  }
  activeSSEIntervals.clear();
}

// Track scaling metrics for test suite
interface ScalingMetrics {
  startReplicas: number;
  peakReplicas: number;
  peakCpu: number;
  scaleUpDetectedAt: number | null;
  scaleDownDetectedAt: number | null;
}

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
  app.post('/cpu-load-intensity', cpuLoadIntensityHandler);
  app.post('/stop-load', stopLoadHandler);
  app.post('/internal-stop', internalStopHandler);
  
  // Phased load test (4-phase pattern)
  app.post('/phased-load', phasedLoadHandler);
  
  // Full test suite (10 iterations)
  app.post('/run-test-suite', testSuiteHandler);
  app.get('/test-suite-status', testSuiteStatusHandler);
  app.get('/test-suite-results', testSuiteResultsHandler);
  
  // SSE endpoints
  app.get('/cluster-status', clusterStatusHandler);
  app.get('/stress-stream', stressStreamHandler);
  app.get('/phased-test-status', phasedTestStatusHandler);
  
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
 * CPU load with intensity endpoint - performs CPU work at specified intensity and duration
 * POST /cpu-load-intensity
 * Body: { durationMs: number, intensity: number }
 */
async function cpuLoadIntensityHandler(req: Request, res: Response): Promise<void> {
  const { durationMs = 6000, intensity = 100 } = req.body || {};
  
  // Early exit if stopped
  if (stressService.getStopStress()) {
    log.debug('CPU load intensity request - stopped flag is set, returning early');
    res.json(createStressResult(0, 0, true, CONFIG.POD_NAME));
    return;
  }
  
  // If no active test, reset stop flag (direct call)
  if (!stressService.getActiveStressTest()) {
    log.debug('CPU load intensity request - no active test, resetting stop flag');
    stressService.setStopStress(false);
  }
  
  log.debug(`CPU load intensity starting on ${CONFIG.POD_NAME}: ${durationMs}ms @ ${intensity}%`);
  const result = await stressService.executeCpuWorkAtIntensity(durationMs, intensity);
  log.debug(`CPU load intensity complete: ${result.elapsed}ms, stopped=${result.wasStopped}`);
  
  res.json({
    elapsed: result.elapsed,
    wasStopped: result.wasStopped,
    podName: CONFIG.POD_NAME,
    intensity,
    requestedDuration: durationMs
  });
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
  res.setHeader('Keep-Alive', 'timeout=120');
  res.flushHeaders();
  
  // Send initial comment to establish connection
  res.write(':ok\n\n');
  
  let isConnected = true;
  let writeErrors = 0;
  const MAX_WRITE_ERRORS = 3;
  
  const safeWrite = (data: string): boolean => {
    if (!isConnected || res.writableEnded) return false;
    try {
      res.write(data);
      writeErrors = 0; // Reset on successful write
      return true;
    } catch {
      writeErrors++;
      if (writeErrors >= MAX_WRITE_ERRORS) {
        isConnected = false;
      }
      return false;
    }
  };
  
  const send = (data: object) => {
    safeWrite(`data: ${JSON.stringify(data)}\n\n`);
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
  
  // Periodic updates - slower interval (3s) to reduce CPU impact
  const intervalId = setInterval(fetchAndSend, 3000);
  activeSSEIntervals.add(intervalId);
  
  // Send keepalive every 10 seconds to prevent timeout
  const keepaliveId = setInterval(() => {
    safeWrite(':keepalive\n\n');
  }, 10000);
  activeSSEIntervals.add(keepaliveId);
  
  // Cleanup on disconnect
  req.on('close', () => {
    isConnected = false;
    clearInterval(intervalId);
    clearInterval(keepaliveId);
    activeSSEIntervals.delete(intervalId);
    activeSSEIntervals.delete(keepaliveId);
  });
  
  req.on('error', () => {
    isConnected = false;
    clearInterval(intervalId);
    clearInterval(keepaliveId);
    activeSSEIntervals.delete(intervalId);
    activeSSEIntervals.delete(keepaliveId);
  });
}

// ============= Phased Load Test Handlers =============

/**
 * Start a phased load test (4-phase pattern)
 * POST /phased-load
 */
async function phasedLoadHandler(req: Request, res: Response): Promise<void> {
  if (stressService.getActiveStressTest()) {
    res.status(409).json({ 
      error: 'Test already running',
      message: 'A stress test is already in progress. Stop it first or wait for completion.'
    });
    return;
  }
  
  stressService.startStressTest();
  stressService.resetPhasedTestState();
  
  // Get targets for distributed load
  let podIps = await k8sService.getPodIPs();
  if (!podIps.length) {
    const serviceIP = await k8sService.getServiceClusterIP();
    if (serviceIP) podIps = [serviceIP];
  }
  const targets = podIps.length ? podIps : ['127.0.0.1'];
  
  log.stress('PHASED LOAD TEST', `Starting 4-phase test on ${targets.length} targets`);
  
  // Run phased test in background
  runPhasedLoadTest(targets).catch(err => {
    log.error(`Phased load test failed: ${err}`);
    stressService.endStressTest();
    stressService.resetPhasedTestState();
  });
  
  res.status(202).json({
    status: 'started',
    message: 'Phased load test started (4 phases: warm-up, ramp-up, steady, ramp-down)',
    phases: {
      warmUp: `${CONFIG.PHASED_TEST.WARM_UP_MS / 1000}s`,
      rampUp: `${CONFIG.PHASED_TEST.RAMP_UP_MS / 1000}s`,
      steady: `${CONFIG.PHASED_TEST.STEADY_MS / 1000}s`,
      rampDown: `${CONFIG.PHASED_TEST.RAMP_DOWN_MS / 1000}s`
    },
    totalDuration: `${(CONFIG.PHASED_TEST.WARM_UP_MS + CONFIG.PHASED_TEST.RAMP_UP_MS + 
                       CONFIG.PHASED_TEST.STEADY_MS + CONFIG.PHASED_TEST.RAMP_DOWN_MS) / 1000}s`,
    targets: targets.length,
    statusEndpoint: '/phased-test-status'
  });
}

/**
 * Run the phased load test
 */
async function runPhasedLoadTest(targets: string[]): Promise<void> {
  const sendLoadAtIntensity = async (intensity: number, durationMs: number): Promise<void> => {
    if (stressService.getStopStress()) return;
    
    // Calculate requests based on intensity
    const requestCount = Math.max(1, Math.floor(CONFIG.STRESS.CONCURRENCY * (intensity / 100)));
    
    if (targets.length === 1 && (targets[0] === '127.0.0.1' || targets[0] === process.env.POD_IP)) {
      // Single pod: run local CPU work at intensity
      await stressService.executeCpuWorkAtIntensity(durationMs, intensity);
    } else {
      // Distributed: send requests to pods
      const iterations = Math.ceil(durationMs / CONFIG.STRESS.DURATION_MS);
      for (let i = 0; i < iterations; i++) {
        if (stressService.getStopStress()) break;
        
        const tasks = [];
        for (let j = 0; j < requestCount; j++) {
          const target = targets[j % targets.length];
          const url = `http://${target}:3000/cpu-load`;
          tasks.push(
            fetch(url, { 
              method: 'GET',
              signal: AbortSignal.timeout(CONFIG.TIMEOUTS.FETCH_MS)
            }).catch(() => null)
          );
        }
        await Promise.all(tasks);
        await new Promise(r => setImmediate(r));
      }
    }
  };
  
  const onPhaseChange = (phase: stressService.TestPhase, intensity: number, progress: number) => {
    log.stress(`Phase: ${phase.toUpperCase()}`, `Intensity: ${intensity}%, Progress: ${progress.toFixed(0)}%`);
  };
  
  try {
    const result = await stressService.executePhasedLoadTest(sendLoadAtIntensity, onPhaseChange);
    log.stress('Phased test result', `Stopped: ${result.wasStopped}`);
  } finally {
    stressService.endStressTest();
  }
}

/**
 * Start full test suite (10+ iterations)
 * POST /run-test-suite
 */
async function testSuiteHandler(req: Request, res: Response): Promise<void> {
  if (stressService.getActiveStressTest()) {
    res.status(409).json({
      error: 'Test already running',
      message: 'A test is already in progress.'
    });
    return;
  }
  
  const iterations = req.body?.iterations || CONFIG.TEST_SUITE.ITERATIONS;
  
  stressService.startStressTest();
  stressService.resetTestSuiteResults();
  stressService.setPhasedTestState({ 
    phase: 'idle', 
    iteration: 0, 
    totalIterations: iterations 
  });
  
  log.stress('TEST SUITE', `Starting ${iterations}-iteration test suite`);
  
  // Run test suite in background
  runTestSuite(iterations).catch(err => {
    log.error(`Test suite failed: ${err}`);
    stressService.endStressTest();
  });
  
  res.status(202).json({
    status: 'started',
    message: `Test suite started with ${iterations} iterations`,
    iterations,
    estimatedDuration: `${(iterations * (CONFIG.PHASED_TEST.WARM_UP_MS + CONFIG.PHASED_TEST.RAMP_UP_MS + 
                         CONFIG.PHASED_TEST.STEADY_MS + CONFIG.PHASED_TEST.RAMP_DOWN_MS)) / 60000} minutes`,
    statusEndpoint: '/test-suite-status',
    resultsEndpoint: '/test-suite-results'
  });
}

/**
 * Run the full test suite
 */
async function runTestSuite(iterations: number): Promise<void> {
  let podIps = await k8sService.getPodIPs();
  if (!podIps.length) {
    const serviceIP = await k8sService.getServiceClusterIP();
    if (serviceIP) podIps = [serviceIP];
  }
  const targets = podIps.length ? podIps : ['127.0.0.1'];
  
  for (let i = 1; i <= iterations; i++) {
    // Reset stop flag at the start of each iteration to ensure it continues
    // Only check for explicit stop requests, not state from previous iteration
    if (stressService.getStopStress()) {
      // Check if this was an explicit stop request (user clicked stop)
      if (i > 1) {
        log.stress('Test suite stopped by user', `Completed ${i - 1}/${iterations} iterations`);
        break;
      }
      // For first iteration, reset and continue
      log.stress('Resetting stop flag for first iteration', '');
    }
    stressService.setStopStress(false);
    
    log.stress(`ITERATION ${i}/${iterations}`, 'Starting phased test');
    stressService.setPhasedTestState({ iteration: i, totalIterations: iterations, phase: 'idle' });
    
    const iterationStart = Date.now();
    const scalingMetrics: ScalingMetrics = {
      startReplicas: 0,
      peakReplicas: 0,
      peakCpu: 0,
      scaleUpDetectedAt: null,
      scaleDownDetectedAt: null
    };
    
    // Get initial replica count
    try {
      const status = await k8sService.fetchClusterStatus();
      scalingMetrics.startReplicas = status.hpa?.current || 1;
    } catch {
      scalingMetrics.startReplicas = 1;
    }
    
    // Track metrics during test
    const metricsInterval = setInterval(async () => {
      try {
        const status = await k8sService.fetchClusterStatus();
        const current = status.hpa?.current || 0;
        const cpu = status.hpa?.cpuValue || 0;
        
        if (current > scalingMetrics.peakReplicas) {
          scalingMetrics.peakReplicas = current;
          if (!scalingMetrics.scaleUpDetectedAt && current > scalingMetrics.startReplicas) {
            scalingMetrics.scaleUpDetectedAt = Date.now() - iterationStart;
          }
        }
        if (cpu > scalingMetrics.peakCpu) {
          scalingMetrics.peakCpu = cpu;
        }
        if (scalingMetrics.scaleUpDetectedAt && !scalingMetrics.scaleDownDetectedAt && 
            current <= scalingMetrics.startReplicas) {
          scalingMetrics.scaleDownDetectedAt = Date.now() - iterationStart;
        }
      } catch {
        // Ignore metrics errors
      }
    }, 5000);
    
    // Run phased test
    const sendLoad = async (intensity: number, durationMs: number) => {
      if (stressService.getStopStress()) return;
      const requestCount = Math.max(1, Math.floor(CONFIG.STRESS.CONCURRENCY * (intensity / 100)));
      
      if (targets.length === 1 && (targets[0] === '127.0.0.1' || targets[0] === process.env.POD_IP)) {
        await stressService.executeCpuWorkAtIntensity(durationMs, intensity);
      } else {
        // Distributed: send /cpu-load-intensity requests to pods at specified intensity
        const tasks = [];
        for (let j = 0; j < requestCount; j++) {
          const target = targets[j % targets.length];
          tasks.push(
            fetch(`http://${target}:3000/cpu-load-intensity`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ durationMs, intensity }),
              signal: AbortSignal.timeout(durationMs + 5000) // Timeout = duration + buffer
            }).catch(() => null)
          );
        }
        await Promise.all(tasks);
      }
    };
    
    let result;
    try {
      log.stress(`Iteration ${i}`, `Executing phased load test on ${targets.length} targets`);
      result = await stressService.executePhasedLoadTest(
        sendLoad,
        (phase, intensity, progress) => {
          log.debug(`Phase: ${phase}, Intensity: ${intensity}%, Progress: ${progress}%`);
        }
      );
      log.stress(`Iteration ${i}`, `Phased test returned: wasStopped=${result.wasStopped}`);
    } catch (err) {
      log.error(`Iteration ${i} phased test failed: ${err}`);
      clearInterval(metricsInterval);
      activeSSEIntervals.delete(metricsInterval);
      continue; // Skip to next iteration instead of breaking
    }
    
    clearInterval(metricsInterval);
    activeSSEIntervals.delete(metricsInterval);
    
    // Skip recording if test was stopped
    if (result.wasStopped) {
      log.stress(`Iteration ${i}`, 'Skipped - test was stopped');
      continue;
    }
    
    // Record iteration result
    log.stress(`Iteration ${i}`, 'Recording results...');
    const iterationResult: stressService.TestIterationResult = {
      iteration: i,
      scaleUpTimeMs: scalingMetrics.scaleUpDetectedAt,
      scaleDownTimeMs: scalingMetrics.scaleDownDetectedAt,
      peakReplicas: scalingMetrics.peakReplicas,
      peakCpuPercent: scalingMetrics.peakCpu,
      phases: {
        warmUp: { durationMs: result.phases.warmUp.durationMs },
        rampUp: { durationMs: result.phases.rampUp.durationMs, finalReplicas: scalingMetrics.peakReplicas },
        steady: { durationMs: result.phases.steady.durationMs, avgReplicas: scalingMetrics.peakReplicas },
        rampDown: { durationMs: result.phases.rampDown.durationMs, finalReplicas: scalingMetrics.startReplicas }
      }
    };
    
    stressService.addTestIterationResult(iterationResult);
    log.stress(`Iteration ${i} complete`, 
      `Peak: ${scalingMetrics.peakReplicas} replicas, CPU: ${scalingMetrics.peakCpu}%`);
    
    // NO cooldown between runs (per requirements)
    if (!CONFIG.TEST_SUITE.COOLDOWN_BETWEEN_RUNS) {
      log.stress('Next iteration', 'Starting immediately (no cooldown)');
    }
  }
  
  // Log final aggregated results
  const aggregates = stressService.calculateTestSuiteAggregates();
  log.stress('TEST SUITE COMPLETE', `${aggregates.completed}/${iterations} iterations`);
  log.stress('RESULTS', 
    `Avg scale-up: ${aggregates.avgScaleUpTimeMs ? (aggregates.avgScaleUpTimeMs / 1000).toFixed(1) + 's' : 'N/A'}, ` +
    `Avg peak: ${aggregates.avgPeakReplicas.toFixed(1)} replicas`
  );
  
  stressService.endStressTest();
}

/**
 * Get test suite status
 * GET /test-suite-status
 */
function testSuiteStatusHandler(req: Request, res: Response): void {
  const state = stressService.getPhasedTestState();
  const isRunning = stressService.getActiveStressTest();
  
  res.json({
    running: isRunning,
    phase: state.phase,
    intensity: state.intensity,
    iteration: state.iteration,
    totalIterations: state.totalIterations,
    phaseProgress: state.phaseProgress,
    completedIterations: stressService.getTestSuiteResults().length
  });
}

/**
 * Get test suite results
 * GET /test-suite-results
 */
function testSuiteResultsHandler(req: Request, res: Response): void {
  const aggregates = stressService.calculateTestSuiteAggregates();
  res.json(aggregates);
}

/**
 * SSE endpoint for phased test status
 * GET /phased-test-status
 */
async function phasedTestStatusHandler(req: Request, res: Response): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Keep-Alive', 'timeout=120');
  res.flushHeaders();
  
  res.write(':ok\n\n');
  
  let isConnected = true;
  let writeErrors = 0;
  const MAX_WRITE_ERRORS = 3;
  
  const safeWrite = (data: string): boolean => {
    if (!isConnected || res.writableEnded) return false;
    try {
      res.write(data);
      writeErrors = 0; // Reset on successful write
      return true;
    } catch {
      writeErrors++;
      if (writeErrors >= MAX_WRITE_ERRORS) {
        isConnected = false;
      }
      return false;
    }
  };
  
  const send = () => {
    if (!isConnected || res.writableEnded) return;
    
    const state = stressService.getPhasedTestState();
    const isRunning = stressService.getActiveStressTest();
    const results = stressService.getTestSuiteResults();
    const aggregates = stressService.calculateTestSuiteAggregates();
    
    safeWrite(`data: ${JSON.stringify({
      running: isRunning,
      ...state,
      completedIterations: results.length,
      latestResult: results.length > 0 ? results[results.length - 1] : null,
      aggregates: aggregates
    })}\n\n`);
  };
  
  // Send heartbeat comments every 5s to keep connection alive
  const heartbeatId = setInterval(() => {
    safeWrite(':heartbeat\n\n');
  }, 5000);
  activeSSEIntervals.add(heartbeatId);
  
  send();
  const intervalId = setInterval(send, 2000); // Slower updates to reduce load
  activeSSEIntervals.add(intervalId);
  
  req.on('close', () => {
    isConnected = false;
    clearInterval(intervalId);
    clearInterval(heartbeatId);
    activeSSEIntervals.delete(intervalId);
    activeSSEIntervals.delete(heartbeatId);
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
