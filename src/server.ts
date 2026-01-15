/**
 * K8s Autoscaling Demo Server - Entry Point
 * 
 * This is the main entry point. All logic is in files:
 * - config/index.ts - Configuration and logging
 * - services/stress.service.ts - CPU stress test logic
 * - services/kubernetes.service.ts - K8s API interactions
 * - templates/dashboard.ts - HTML templates
 * - app.ts - Express app setup and routes
 */

export { app } from './app';
export { CONFIG, COLORS, log } from './config';
export * from './services/stress.service';
export * from './services/kubernetes.service';
export { clearAllSSEIntervals } from './app';

// Re-export utils for backward compatibility
export * from './utils/kubernetes';

import { app, clearAllSSEIntervals } from './app';
import { CONFIG, COLORS, log } from './config';

// Start the server when run directly
if (require.main === module) {
  const server = app.listen(CONFIG.PORT, () => {
    console.log(`${COLORS.bright}${COLORS.cyan}╔════════════════════════════════════════════════════════════╗${COLORS.reset}`);
    console.log(`${COLORS.bright}${COLORS.cyan}║${COLORS.reset}  ${COLORS.green}K8s Autoscaling Demo Server${COLORS.reset}                              ${COLORS.cyan}║${COLORS.reset}`);
    console.log(`${COLORS.bright}${COLORS.cyan}╠════════════════════════════════════════════════════════════╣${COLORS.reset}`);
    console.log(`${COLORS.cyan}║${COLORS.reset}  ${COLORS.gray}Port:${COLORS.reset}        ${COLORS.green}${CONFIG.PORT}${COLORS.reset}`);
    console.log(`${COLORS.cyan}║${COLORS.reset}  ${COLORS.gray}Pod:${COLORS.reset}         ${COLORS.yellow}${CONFIG.POD_NAME}${COLORS.reset}`);
    console.log(`${COLORS.cyan}║${COLORS.reset}  ${COLORS.gray}Environment:${COLORS.reset} ${CONFIG.NODE_ENV}`);
    console.log(`${COLORS.cyan}║${COLORS.reset}  ${COLORS.gray}PID:${COLORS.reset}         ${process.pid}`);
    console.log(`${COLORS.cyan}║${COLORS.reset}  ${COLORS.gray}Node:${COLORS.reset}        ${process.version}`);
    console.log(`${COLORS.bright}${COLORS.cyan}╚════════════════════════════════════════════════════════════╝${COLORS.reset}`);
    log.info('Server started successfully');
    log.info(`HPA Target CPU: ${CONFIG.HPA_TARGET_CPU}%`);
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    log.info(`${signal} received, shutting down gracefully...`);
    clearAllSSEIntervals();
    server.close(() => {
      log.info('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
