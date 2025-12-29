/**
 * K8s Autoscaling Demo Server - Entry Point
 * 
 * This file is the main entry point for the server.
 * All application logic is in app.ts and the services.
 */

import { app } from './app';
import { CONFIG, COLORS, log } from './config';

// Start the server
if (require.main === module) {
  app.listen(CONFIG.PORT, () => {
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
    log.info(`HPA Target CPU: ${CONFIG.HPA_TARGET_CPU}% (scale up above, scale down below)`);
  });
}

// Export for backward compatibility
export { app };
