// Owner: member 2
// Limits wrong passwords, so a script cannot try thousands of passwords for an account.
//   - one account from one IP address: LOGIN_LIMIT.maxPerAccount wrong attempts inside the time window
//   - one IP address, any accounts:    LOGIN_LIMIT.maxPerIp wrong attempts inside the time window
// While a limit is reached even the right password is refused (otherwise the guessing would simply go on).
// Counting per account AND IP address means a stranger cannot lock the real editor out of the system: the editor
// logs in from another address. The counters are kept in the memory of this server process; a restart clears them.
const { LOGIN_LIMIT } = require('../config/constants');

const failures = new Map(); // key -> timestamps (ms) of the wrong attempts that are still inside the window

// "::ffff:1.2.3.4" (IPv4 inside IPv6) and "1.2.3.4" are the same address
const clean = (ip) => String(ip || '').replace(/^::ffff:/, '');
const accountKey = (ip, username) => `account:${clean(ip)}|${username}`;
const ipKey = (ip) => `ip:${clean(ip)}`;

// The attempts of this key that are still inside the window (older ones are forgotten)
function recent(key) {
  const since = Date.now() - LOGIN_LIMIT.windowMs;
  const times = (failures.get(key) || []).filter((t) => t > since);
  if (times.length) failures.set(key, times);
  else failures.delete(key);
  return times;
}

// Seconds the caller must wait, or 0 when the login may be tried
function blockedFor(ip, username) {
  const blocked = [[accountKey(ip, username), LOGIN_LIMIT.maxPerAccount], [ipKey(ip), LOGIN_LIMIT.maxPerIp]]
    .map(([key, max]) => ({ times: recent(key), max }))
    .filter(({ times, max }) => times.length >= max);
  if (!blocked.length) return 0;
  // a limit opens when enough of its old attempts have left the window; the login may be tried when all of them are open
  const free = Math.max(...blocked.map(({ times, max }) => times[times.length - max] + LOGIN_LIMIT.windowMs));
  return Math.max(1, Math.ceil((free - Date.now()) / 1000));
}

function recordFailure(ip, username) {
  const now = Date.now();
  [accountKey(ip, username), ipKey(ip)].forEach((key) => failures.set(key, [...recent(key), now]));
}

// A correct login starts the account's count again (the IP's count stays: it covers all accounts)
function recordSuccess(ip, username) {
  failures.delete(accountKey(ip, username));
}

// Forget old entries now and then, so the map cannot grow for ever
setInterval(() => { for (const key of [...failures.keys()]) recent(key); }, 60 * 1000).unref();

module.exports = { blockedFor, recordFailure, recordSuccess };
