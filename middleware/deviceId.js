// Gives every browser a random anonymous id in a cookie -> req.deviceId
// Used by: comment rate limit (member 2), viewed/not-viewed filter (member 1).
const crypto = require('crypto');

const COOKIE = 'dw_device';

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  const match = header.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

module.exports = function deviceId(req, res, next) {
  let id = readCookie(req, COOKIE);
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) {
    id = crypto.randomUUID();
    res.cookie(COOKIE, id, { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 365, sameSite: 'lax' });
  }
  req.deviceId = id;
  next();
};
