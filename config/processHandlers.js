// Fallback for errors not caught by request handlers.
// unhandledRejection: log the error and keep the server running.
// uncaughtException: log synchronously and exit, as the process may be unstable.
// A process manager (or node --watch in development) handles restarts.
const logger = require('./logger');

function install() {
  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled promise rejection: ${reason instanceof Error ? reason.stack : reason}`);
  });
  process.on('uncaughtException', (err) => {
    logger.fatal(`Uncaught exception, the server is shutting down: ${err && err.stack ? err.stack : err}`);
    process.exit(1);
  });
}

module.exports = { install };
