// Simple logger: prints to console and appends to logs/app.log.
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'logs', 'app.log');

function write(level, message) {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
  (level === 'error' ? console.error : console.log)(line);
  fs.appendFile(LOG_FILE, line + '\n', () => {});
}

module.exports = {
  info: (msg) => write('info', msg),
  warn: (msg) => write('warn', msg),
  error: (msg) => write('error', msg),
};
