// Configuration constants
export const CONFIG = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  POD_NAME: process.env.HOSTNAME || require('os').hostname(),
  NODE_ENV: process.env.NODE_ENV || 'development',
  DEBUG: !!process.env.DEBUG,
  
  // HPA settings - must match k8s-hpa.yaml
  HPA_TARGET_CPU: 50,
  
  // Stress test settings - AGGRESSIVE for HPA triggering
  STRESS: {
    CONCURRENCY: 50,         // Concurrent requests per round
    ROUNDS: 10,              // Number of rounds (10 * 8s = 80s total)
    DURATION_MS: 8000,       // Duration per cpu-load call (8 seconds)
    CHUNK_DURATION_MS: 500,  // Work chunk before yielding (500ms - less yielding = more CPU)
    ITERATIONS_PER_CHUNK: 5000000, // 5M Math operations per chunk - MUCH heavier
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
