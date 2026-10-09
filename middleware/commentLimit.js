// Owner: member 2
// Guest may post at most COMMENT_LIMIT.max comments per COMMENT_LIMIT.windowMs from the same device.
// Enforced here on the server (runs before commentController.create); on violation -> 429 with a Hebrew message.
// The count comes from the comments already saved in MongoDB, so the limit also survives a server restart.
const Comment = require('../models/Comment');
const logger = require('../config/logger');
const { COMMENT_LIMIT } = require('../config/constants');

module.exports = async function commentLimit(req, res, next) {
  // The requirement limits guests only - logged-in staff (reporter / editor) are not limited
  if (req.user) return next();

  try {
    const since = new Date(Date.now() - COMMENT_LIMIT.windowMs);
    const recent = { deviceId: req.deviceId, createdAt: { $gte: since } };
    const count = await Comment.countDocuments(recent);
    if (count < COMMENT_LIMIT.max) return next();

    // How long until the oldest comment in the window "expires" and a new one is allowed
    const oldest = await Comment.findOne(recent).sort({ createdAt: 1 }).select('createdAt').lean();
    const waitMs = oldest.createdAt.getTime() + COMMENT_LIMIT.windowMs - Date.now();
    const waitSec = Math.max(1, Math.ceil(waitMs / 1000));

    logger.warn(`Comment rate limit hit: device ${req.deviceId} (${count} comments in the last minute)`);
    res.set('Retry-After', String(waitSec));
    res.status(429).json({
      error: `ניתן לפרסם עד ${COMMENT_LIMIT.max} תגובות בדקה. נסו שוב בעוד ${waitSec} שניות.`,
      retryAfter: waitSec,
    });
  } catch (err) {
    next(err);
  }
};
