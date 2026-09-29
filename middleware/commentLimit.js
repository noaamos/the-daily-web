// Owner: member 2
// Guest may post at most COMMENT_LIMIT.max comments per COMMENT_LIMIT.windowMs from the same device.
// Must be enforced here on the server; on violation respond 429 with a clear Hebrew message.
const { COMMENT_LIMIT } = require('../config/constants');

// eslint-disable-next-line no-unused-vars
module.exports = async function commentLimit(req, res, next) {
  // TODO(member 2): count this device's comments in the last minute (Comment.countDocuments by deviceId + createdAt)
  // if count >= COMMENT_LIMIT.max -> return res.status(429).json({ error: '...' })
  next();
};
