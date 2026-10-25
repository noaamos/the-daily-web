// Limit comments per device cookie or IP, returning 429 on violation.
// Counts are stored in MongoDB and survive server restarts.
// In-memory locks prevent concurrent requests from bypassing the limit.
// Supports a single server process; multiple processes require atomic DB enforcement.
const Comment = require('../models/Comment');
const logger = require('../config/logger');
const { COMMENT_LIMIT } = require('../config/constants');

const LOCK_TIMEOUT_MS = 10 * 1000; // safety net: a lock is never held longer than this

// "::ffff:1.2.3.4" (IPv4 inside IPv6) and "1.2.3.4" are the same address
const clientIp = (req) => (req.ip || '').replace(/^::ffff:/, '');

// ---- a lock per key: callers of the same key run one after the other ----
const queues = new Map(); // key -> promise that is finished when the last caller in line has released
function lock(key) {
  const previous = queues.get(key) || Promise.resolve();
  let release;
  const mine = new Promise((resolve) => { release = resolve; });
  const tail = previous.then(() => mine);
  queues.set(key, tail);
  return previous.then(() => () => {
    release();
    if (queues.get(key) === tail) queues.delete(key); // nobody is waiting behind us
  });
}

// Locks the device and the IP. The keys are always taken in the same order, so two requests can never wait for each other.
async function lockGuest(req) {
  const keys = [`device:${req.deviceId}`, clientIp(req) && `ip:${clientIp(req)}`].filter(Boolean).sort();
  const releases = [];
  for (const key of keys) releases.push(await lock(key));
  let done = false;
  return () => {
    if (done) return;
    done = true;
    releases.reverse().forEach((release) => release());
  };
}

// The comments that count against this guest: same device cookie, or same IP address, inside the time window
function recentFilter(req) {
  const same = [{ deviceId: req.deviceId }];
  if (clientIp(req)) same.push({ ip: clientIp(req) });
  return { $or: same, createdAt: { $gte: new Date(Date.now() - COMMENT_LIMIT.windowMs) } };
}

module.exports = async function commentLimit(req, res, next) {
  // The requirement limits guests only - logged-in staff (reporter / editor) are not limited
  if (req.user) return next();

  let release = () => {};
  try {
    release = await lockGuest(req);
    if (res.destroyed) return release(); // the browser gave up while waiting in line
    res.once('close', release);          // the response is finished (or the connection broke): next in line may go
    setTimeout(release, LOCK_TIMEOUT_MS).unref();

    const recent = recentFilter(req);
    const count = await Comment.countDocuments(recent);
    if (count < COMMENT_LIMIT.max) return next();

    // How long until the oldest comment in the window "expires" and a new one is allowed
    const oldest = await Comment.findOne(recent).sort({ createdAt: 1 }).select('createdAt').lean();
    const waitMs = oldest.createdAt.getTime() + COMMENT_LIMIT.windowMs - Date.now();
    const waitSec = Math.max(1, Math.ceil(waitMs / 1000));

    logger.warn(`Comment rate limit hit: device ${req.deviceId} ip ${clientIp(req)} (${count} comments in the last minute)`);
    res.set('Retry-After', String(waitSec));
    res.status(429).json({
      error: `ניתן לפרסם עד ${COMMENT_LIMIT.max} תגובות בדקה. נסו שוב בעוד ${waitSec} שניות.`,
      retryAfter: waitSec,
    });
  } catch (err) {
    release();
    next(err);
  }
};

module.exports.clientIp = clientIp;
