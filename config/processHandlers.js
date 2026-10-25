// The last safety net for errors that nobody caught. Every request handler already has its own try/catch and the error
// middleware answers the user; this is for what slips through anyway (e.g. a forgotten .catch on a promise).
//   unhandledRejection: a promise failed and nobody listened. Log it and keep serving: the state of the server is fine.
//   uncaughtException:  an exception escaped everywhere. The process may be in an unknown state, so log it (synchronously,
//                       or the last line would be lost) and exit. A process manager (or `node --watch` while developing)
//                       starts it again.
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
