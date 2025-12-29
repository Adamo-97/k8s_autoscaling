import { CONFIG, log } from '../config';

/**
 * Stress Service - Handles CPU stress test state and execution
 * 
 * This service is responsible for:
 * - Managing stress test state (start/stop flags)
 * - Executing CPU-intensive work
 * - Coordinating distributed load across pods
 */

// State management
let stopStress = false;
let activeStressTest = false;
let stressStartTime = 0;
const activeTimers: Set<NodeJS.Timeout> = new Set();

// State getters/setters for testability
export const getStopStress = () => stopStress;
export const setStopStress = (value: boolean) => { stopStress = value; };
export const getActiveStressTest = () => activeStressTest;
export const setActiveStressTest = (value: boolean) => { activeStressTest = value; };
export const getStressStartTime = () => stressStartTime;
export const setStressStartTime = (value: number) => { stressStartTime = value; };
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
 * maximize CPU utilization. It yields to the event loop periodically
 * to allow stop signals to be processed.
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
    
    // CPU-intensive work - mathematical operations that can't be optimized away
    const chunkStart = Date.now();
    while (Date.now() - chunkStart < chunkDuration) {
      for (let i = 0; i < iterations; i++) {
        // Use operations that are CPU-bound and prevent optimization
        result += Math.sqrt(i) * Math.sin(i) * Math.cos(i) * Math.tan((i % 100) + 1);
      }
    }
    
    // Yield to event loop - allows stop signals to be processed
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
