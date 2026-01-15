// Configuration constants
export const CONFIG = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  POD_NAME: process.env.HOSTNAME || require('os').hostname(),
  NODE_ENV: process.env.NODE_ENV || 'development',
  DEBUG: process.env.DEBUG !== 'false', // Default to true for diagnostics
  
  // HPA settings - must match k8s-hpa.yaml
  HPA_TARGET_CPU: 50,
  
  // Stress test settings - Tuned for HPA triggering without pod crashes
  STRESS: {
    CONCURRENCY: 20,         // Concurrent requests per round (reduced to prevent overload)
    ROUNDS: 12,              // Number of rounds (12 * 8s = 96s total)
    DURATION_MS: 8000,       // Duration per cpu-load call (8 seconds)
    CHUNK_DURATION_MS: 200,  // Work chunk before yielding (200ms - balanced)
    ITERATIONS_PER_CHUNK: 100000, // 100K iterations - sustainable load
  },

  // Phased load test settings (4-phase pattern for proper scalability testing)
  PHASED_TEST: {
    WARM_UP_MS: 30000,       // Phase 1: 30s system stabilization (no load)
    RAMP_UP_MS: 60000,       // Phase 2: 60s gradual load increase (10% → 100%)
    STEADY_MS: 60000,        // Phase 3: 60s sustained peak load
    RAMP_DOWN_MS: 60000,     // Phase 4: 60s gradual load decrease (100% → 0%)
    INTENSITY_STEPS: 10,     // Number of intensity levels (10 = 10% increments)
  },

  // Full test suite settings (for statistically valid results)
  TEST_SUITE: {
    ITERATIONS: 10,          // Minimum 10 iterations for valid averaging
    COOLDOWN_BETWEEN_RUNS: false, // Do NOT cool down between runs (per requirements)
  },
  
  // Timeouts
  TIMEOUTS: {
    FETCH_MS: 15000,         // Fetch request timeout
    STOP_SIGNAL_MS: 1000,    // Stop signal timeout per pod
    SSE_INTERVAL_MS: 2000,   // SSE update interval
  }
};

// ANSI color codes for terminal logging
export const COLORS = {
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
export const log = {
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
  debug: (msg: string) => CONFIG.DEBUG && console.log(`${COLORS.gray}[DEBUG]${COLORS.reset} ${msg}`)
};
