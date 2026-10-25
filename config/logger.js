// Simple logger: prints to console and appends to logs/app.log.
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'logs', 'app.log');

const format = (level, message) => `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;

function write(level, message) {
  const line = format(level, message);
  (level === 'error' ? console.error : console.log)(line);
  fs.appendFile(LOG_FILE, line + '\n', () => {});
}

module.exports = {
  info: (msg) => write('info', msg),
  warn: (msg) => write('warn', msg),
  error: (msg) => write('error', msg),
  // Written synchronously: used right before the process exits, when an asynchronous write would never finish
  fatal: (msg) => {
    const line = format('fatal', msg);
    console.error(line);
    try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (err) { /* nothing more can be done */ }
  },
};
