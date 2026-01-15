import { CONFIG, log } from '../config';

/**
 * Stress Service - Handles CPU stress test state and execution
 * 
 * This service is responsible for:
 * - Managing stress test state (start/stop flags)
 * - Executing CPU-intensive work
 * - Coordinating distributed load across pods
 * - Running phased load tests (Warm-up, Ramp-up, Steady, Ramp-down)
 * - Managing multi-iteration test suites for statistical validity
 */

// Test phase types
export type TestPhase = 'idle' | 'warm-up' | 'ramp-up' | 'steady' | 'ramp-down' | 'complete';

// Phased test state
export interface PhasedTestState {
  phase: TestPhase;
  intensity: number;        // 0-100%
  iteration: number;        // Current iteration (1-10)
  totalIterations: number;  // Total iterations to run
  phaseProgress: number;    // 0-100% progress within current phase
  elapsedMs: number;        // Time elapsed in current test
}

// Test result for a single iteration
export interface TestIterationResult {
  iteration: number;
  scaleUpTimeMs: number | null;    // Time to reach max replicas
  scaleDownTimeMs: number | null;  // Time to return to min replicas
  peakReplicas: number;
  peakCpuPercent: number;
  phases: {
    warmUp: { durationMs: number };
    rampUp: { durationMs: number; finalReplicas: number };
    steady: { durationMs: number; avgReplicas: number };
    rampDown: { durationMs: number; finalReplicas: number };
  };
}

// Aggregated test suite results
export interface TestSuiteResults {
  iterations: number;
  completed: number;
  avgScaleUpTimeMs: number | null;
  avgScaleDownTimeMs: number | null;
  avgPeakReplicas: number;
  avgPeakCpu: number;
  minScaleUpTimeMs: number | null;
  maxScaleUpTimeMs: number | null;
  results: TestIterationResult[];
}

// State management
let stopStress = false;
let activeStressTest = false;
let stressStartTime = 0;
const activeTimers: Set<NodeJS.Timeout> = new Set();

// Phased test state
let currentPhasedState: PhasedTestState = {
  phase: 'idle',
  intensity: 0,
  iteration: 0,
  totalIterations: 0,
  phaseProgress: 0,
  elapsedMs: 0
};

// Test suite results accumulator
let testSuiteResults: TestIterationResult[] = [];

// State getters/setters for testability
export const getStopStress = () => stopStress;
export const setStopStress = (value: boolean) => { stopStress = value; };
export const getActiveStressTest = () => activeStressTest;
export const setActiveStressTest = (value: boolean) => { activeStressTest = value; };
export const getStressStartTime = () => stressStartTime;
export const setStressStartTime = (value: number) => { stressStartTime = value; };

// Phased test state getters/setters
export const getPhasedTestState = () => ({ ...currentPhasedState });
export const setPhasedTestState = (state: Partial<PhasedTestState>) => {
  currentPhasedState = { ...currentPhasedState, ...state };
};
export const resetPhasedTestState = () => {
  currentPhasedState = {
    phase: 'idle',
    intensity: 0,
    iteration: 0,
    totalIterations: 0,
    phaseProgress: 0,
    elapsedMs: 0
  };
};

// Test suite results management
export const getTestSuiteResults = () => [...testSuiteResults];
export const addTestIterationResult = (result: TestIterationResult) => {
  testSuiteResults.push(result);
};
export const resetTestSuiteResults = () => {
  testSuiteResults = [];
};
export const calculateTestSuiteAggregates = (): TestSuiteResults => {
  const results = testSuiteResults;
  const completed = results.length;
  
  if (completed === 0) {
    return {
      iterations: 0,
      completed: 0,
      avgScaleUpTimeMs: null,
      avgScaleDownTimeMs: null,
      avgPeakReplicas: 0,
      avgPeakCpu: 0,
      minScaleUpTimeMs: null,
      maxScaleUpTimeMs: null,
      results: []
    };
  }
  
  const scaleUpTimes = results.filter(r => r.scaleUpTimeMs !== null).map(r => r.scaleUpTimeMs!);
  const scaleDownTimes = results.filter(r => r.scaleDownTimeMs !== null).map(r => r.scaleDownTimeMs!);
  
  return {
    iterations: currentPhasedState.totalIterations,
    completed,
    avgScaleUpTimeMs: scaleUpTimes.length > 0 
      ? Math.round(scaleUpTimes.reduce((a, b) => a + b, 0) / scaleUpTimes.length)
      : null,
    avgScaleDownTimeMs: scaleDownTimes.length > 0
      ? Math.round(scaleDownTimes.reduce((a, b) => a + b, 0) / scaleDownTimes.length)
      : null,
    avgPeakReplicas: results.reduce((a, b) => a + b.peakReplicas, 0) / completed,
    avgPeakCpu: results.reduce((a, b) => a + b.peakCpuPercent, 0) / completed,
    minScaleUpTimeMs: scaleUpTimes.length > 0 ? Math.min(...scaleUpTimes) : null,
    maxScaleUpTimeMs: scaleUpTimes.length > 0 ? Math.max(...scaleUpTimes) : null,
    results
  };
};
export const getActiveTimers = () => activeTimers;

/**
 * Clear all active timers - used for cleanup during stop
 */
export function clearAllTimers(): void {
  for (const timer of activeTimers) {
    clearTimeout(timer);
  }
  activeTimers.clear();
}

/**
 * Add a tracked timer that will be cleaned up on stop
 */
export function addTrackedTimer(callback: () => void, delayMs: number): NodeJS.Timeout {
  const timer = setTimeout(() => {
    activeTimers.delete(timer);
    callback();
  }, delayMs);
  timer.unref(); // Don't keep process alive
  activeTimers.add(timer);
  return timer;
}

/**
 * Reset all stress state - used when stopping tests
 */
export function resetStressState(): void {
  stopStress = true;
  activeStressTest = false;
  clearAllTimers();
}

/**
 * Start a new stress test - resets stop flag and marks test as active
 */
export function startStressTest(): void {
  activeStressTest = true;
  stopStress = false;
  stressStartTime = Date.now();
  log.stress('STARTED', `Time: ${new Date().toISOString()}`);
}

/**
 * End the current stress test
 */
export function endStressTest(): void {
  const elapsed = Math.floor((Date.now() - stressStartTime) / 1000);
  log.stress('COMPLETED', `Duration: ${elapsed}s`);
  activeStressTest = false;
  stopStress = true;
}

/**
 * Execute CPU-intensive work - the core of the stress test
 * 
 * This function performs mathematical operations in a tight loop to
 * maximize CPU utilization. It yields periodically to:
 * 1. Allow stop signals to be processed
 * 2. Prevent liveness probe failures
 * 3. Allow the event loop to handle SSE connections
 * 
 * @param durationMs - How long to run the stress test
 * @returns Object with elapsed time, result, and whether it was stopped
 */
export async function executeCpuWork(durationMs: number = CONFIG.STRESS.DURATION_MS): Promise<{
  elapsed: number;
  result: number;
  wasStopped: boolean;
}> {
  const start = Date.now();
  let result = 0;
  let wasStopped = false;
  
  // Check stop flag before starting
  if (stopStress) {
    return { elapsed: 0, result: 0, wasStopped: true };
  }
  
  const chunkDuration = CONFIG.STRESS.CHUNK_DURATION_MS;
  const iterations = CONFIG.STRESS.ITERATIONS_PER_CHUNK;
  
  while (Date.now() - start < durationMs) {
    // Check stop flag at each chunk
    if (stopStress) {
      wasStopped = true;
      break;
    }
    
    // CPU-intensive work chunk
    const chunkStart = Date.now();
    while (Date.now() - chunkStart < chunkDuration) {
      // Tight loop with expensive math operations
      for (let i = 0; i < iterations; i++) {
        // Operations that can't be optimized away
        const x = Math.sqrt(i + 1);
        const y = Math.sin(x) * Math.cos(x);
        result += y * Math.tan((i % 89) + 1);
      }
    }
    
    // CRITICAL: Yield to event loop EVERY chunk
    // This prevents: liveness probe failures, SSE disconnects, stop signal delays
    await new Promise(resolve => setImmediate(resolve));
  }
  
  const elapsed = Date.now() - start;
  return { elapsed, result, wasStopped };
}

/**
 * Execute streaming CPU work with progress updates
 * 
 * @param durationMs - Total duration
 * @param onProgress - Callback for progress updates
 * @returns Final result
 */
export async function executeStreamingCpuWork(
  durationMs: number,
  onProgress: (progress: number, elapsed: number, result: number) => void
): Promise<{ elapsed: number; result: number; stopped: boolean }> {
  const start = Date.now();
  let lastProgress = -1;
  let result = 0;
  
  while (Date.now() - start < durationMs) {
    if (stopStress) {
      break;
    }
    
    // Work chunk (~80ms)
    const chunkStart = Date.now();
    while (Date.now() - chunkStart < 80) {
      for (let i = 0; i < 50000; i++) {
        result += Math.sqrt(i) * Math.sin(i) * Math.cos(i);
      }
    }
    
    const elapsed = Date.now() - start;
    const progress = Math.min(100, Math.floor((elapsed / durationMs) * 100));
    
    if (progress !== lastProgress) {
      lastProgress = progress;
      onProgress(progress, elapsed, Number(result.toFixed(6)));
    }
    
    await new Promise(r => setImmediate(r));
  }
  
  return {
    elapsed: Date.now() - start,
    result: Number(result.toFixed(6)),
    stopped: stopStress
  };
}

/**
 * Execute CPU work at a specific intensity level (0-100%)
 * Intensity controls the ratio of work time to idle time
 * 
 * @param durationMs - How long to run at this intensity
 * @param intensity - Load intensity from 0 to 100
 */
export async function executeCpuWorkAtIntensity(
  durationMs: number,
  intensity: number
): Promise<{ elapsed: number; wasStopped: boolean }> {
  const start = Date.now();
  const normalizedIntensity = Math.max(0, Math.min(100, intensity)) / 100;
  
  if (stopStress || normalizedIntensity === 0) {
    // For 0% intensity, just wait (warm-up/cooldown)
    const waitTime = Math.min(durationMs, 1000);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    return { elapsed: Date.now() - start, wasStopped: stopStress };
  }
  
  const chunkDuration = CONFIG.STRESS.CHUNK_DURATION_MS;
  const iterations = Math.floor(CONFIG.STRESS.ITERATIONS_PER_CHUNK * normalizedIntensity);
  
  while (Date.now() - start < durationMs) {
    if (stopStress) {
      return { elapsed: Date.now() - start, wasStopped: true };
    }
    
    // CPU work proportional to intensity
    const chunkStart = Date.now();
    const workDuration = chunkDuration * normalizedIntensity;
    
    while (Date.now() - chunkStart < workDuration) {
      for (let i = 0; i < iterations; i++) {
        const x = Math.sqrt(i + 1);
        const y = Math.sin(x) * Math.cos(x);
        Math.tan((i % 89) + 1) * y;
      }
    }
    
    // Idle time inversely proportional to intensity
    const idleTime = chunkDuration * (1 - normalizedIntensity);
    if (idleTime > 10) {
      await new Promise(resolve => setTimeout(resolve, idleTime));
    }
    
    await new Promise(resolve => setImmediate(resolve));
  }
  
  return { elapsed: Date.now() - start, wasStopped: false };
}

/**
 * Sleep utility that respects stop flag
 */
export async function sleepWithStopCheck(ms: number): Promise<boolean> {
  const start = Date.now();
  const checkInterval = 500; // Check every 500ms
  
  while (Date.now() - start < ms) {
    if (stopStress) return true; // Was stopped
    const remaining = ms - (Date.now() - start);
    await new Promise(resolve => setTimeout(resolve, Math.min(checkInterval, remaining)));
  }
  
  return stopStress;
}

/**
 * Execute a single phased load test iteration
 * Follows the 4-phase pattern: Warm-up → Ramp-up → Steady → Ramp-down
 * 
 * @param sendLoad - Callback to send load at given intensity
 * @param onPhaseChange - Callback when phase changes
 * @returns Timing data for the iteration
 */
export async function executePhasedLoadTest(
  sendLoad: (intensity: number, durationMs: number) => Promise<void>,
  onPhaseChange: (phase: TestPhase, intensity: number, progress: number) => void
): Promise<{
  phases: {
    warmUp: { durationMs: number };
    rampUp: { durationMs: number };
    steady: { durationMs: number };
    rampDown: { durationMs: number };
  };
  wasStopped: boolean;
}> {
  const { WARM_UP_MS, RAMP_UP_MS, STEADY_MS, RAMP_DOWN_MS, INTENSITY_STEPS } = CONFIG.PHASED_TEST;
  const stepDuration = Math.floor(RAMP_UP_MS / INTENSITY_STEPS);
  const phaseResults = {
    warmUp: { durationMs: 0 },
    rampUp: { durationMs: 0 },
    steady: { durationMs: 0 },
    rampDown: { durationMs: 0 }
  };
  
  // ===== PHASE 1: WARM-UP (No load, system stabilization) =====
  log.stress('PHASE 1: WARM-UP', `${WARM_UP_MS / 1000}s stabilization period`);
  setPhasedTestState({ phase: 'warm-up', intensity: 0, phaseProgress: 0 });
  onPhaseChange('warm-up', 0, 0);
  
  const warmUpStart = Date.now();
  const wasStoppedWarmUp = await sleepWithStopCheck(WARM_UP_MS);
  phaseResults.warmUp.durationMs = Date.now() - warmUpStart;
  
  if (wasStoppedWarmUp) {
    return { phases: phaseResults, wasStopped: true };
  }
  
  // ===== PHASE 2: RAMP-UP (Gradual increase 10% → 100%) =====
  log.stress('PHASE 2: RAMP-UP', `${RAMP_UP_MS / 1000}s gradual load increase`);
  setPhasedTestState({ phase: 'ramp-up' });
  
  const rampUpStart = Date.now();
  for (let step = 1; step <= INTENSITY_STEPS; step++) {
    if (stopStress) {
      phaseResults.rampUp.durationMs = Date.now() - rampUpStart;
      return { phases: phaseResults, wasStopped: true };
    }
    
    const intensity = (step / INTENSITY_STEPS) * 100;
    const progress = (step / INTENSITY_STEPS) * 100;
    
    log.stress('RAMP-UP', `Intensity: ${intensity.toFixed(0)}%`);
    setPhasedTestState({ intensity, phaseProgress: progress });
    onPhaseChange('ramp-up', intensity, progress);
    
    await sendLoad(intensity, stepDuration);
  }
  phaseResults.rampUp.durationMs = Date.now() - rampUpStart;
  
  // ===== PHASE 3: STEADY (Sustained peak load at 100%) =====
  log.stress('PHASE 3: STEADY', `${STEADY_MS / 1000}s sustained peak load`);
  setPhasedTestState({ phase: 'steady', intensity: 100, phaseProgress: 0 });
  onPhaseChange('steady', 100, 0);
  
  const steadyStart = Date.now();
  const steadyChunks = Math.ceil(STEADY_MS / stepDuration);
  
  for (let chunk = 0; chunk < steadyChunks; chunk++) {
    if (stopStress) {
      phaseResults.steady.durationMs = Date.now() - steadyStart;
      return { phases: phaseResults, wasStopped: true };
    }
    
    const progress = ((chunk + 1) / steadyChunks) * 100;
    setPhasedTestState({ phaseProgress: progress });
    onPhaseChange('steady', 100, progress);
    
    await sendLoad(100, stepDuration);
  }
  phaseResults.steady.durationMs = Date.now() - steadyStart;
  
  // ===== PHASE 4: RAMP-DOWN (Gradual decrease 100% → 0%) =====
  log.stress('PHASE 4: RAMP-DOWN', `${RAMP_DOWN_MS / 1000}s gradual load decrease`);
  setPhasedTestState({ phase: 'ramp-down' });
  
  const rampDownStart = Date.now();
  for (let step = INTENSITY_STEPS - 1; step >= 0; step--) {
    if (stopStress) {
      phaseResults.rampDown.durationMs = Date.now() - rampDownStart;
      return { phases: phaseResults, wasStopped: true };
    }
    
    const intensity = (step / INTENSITY_STEPS) * 100;
    const progress = ((INTENSITY_STEPS - step) / INTENSITY_STEPS) * 100;
    
    log.stress('RAMP-DOWN', `Intensity: ${intensity.toFixed(0)}%`);
    setPhasedTestState({ intensity, phaseProgress: progress });
    onPhaseChange('ramp-down', intensity, progress);
    
    await sendLoad(intensity, stepDuration);
  }
  phaseResults.rampDown.durationMs = Date.now() - rampDownStart;
  
  // ===== COMPLETE =====
  log.stress('PHASED TEST COMPLETE', 'All 4 phases finished');
  setPhasedTestState({ phase: 'complete', intensity: 0, phaseProgress: 100 });
  onPhaseChange('complete', 0, 100);
  
  return { phases: phaseResults, wasStopped: false };
}
