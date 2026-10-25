// Owner: member 2
const mongoose = require('mongoose');
const Comment = require('../models/Comment');
const Article = require('../models/Article');
const logger = require('../config/logger');
const { httpError } = require('../middleware/errorHandler');
const { clientIp } = require('../middleware/commentLimit');

const NAME_MAX = 50;   // same limits as models/Comment.js
const TEXT_MAX = 1000;

// Returns the trimmed string, or null if it is missing / not a string / empty / too long
function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}

// Only these fields are sent to the browser (deviceId stays on the server)
function toPublic(c) {
  return { _id: c._id, authorName: c.authorName, text: c.text, createdAt: c.createdAt };
}

// Comments are allowed only on articles the public can see
async function findPublishedArticle(id) {
  if (!mongoose.isValidObjectId(id)) throw httpError(400, 'מזהה כתבה לא תקין');
  const article = await Article.exists({ _id: id, published: { $ne: null } });
  if (!article) throw httpError(404, 'הכתבה לא נמצאה');
  return article;
}

// GET /api/comments/:articleId -> { comments: [...] } oldest first (new comments are appended at the end)
exports.list = async (req, res, next) => {
  try {
    const article = await findPublishedArticle(req.params.articleId);
    const comments = await Comment.find({ article: article._id }).sort({ createdAt: 1 }).lean();
    res.json({ comments: comments.map(toPublic) });
  } catch (err) {
    next(err);
  }
};

// POST /api/comments/:articleId  body: { authorName, text } -> 201 + the new comment
// (commentLimit runs before this handler and keeps the guest's lock until the response is sent)
exports.create = async (req, res, next) => {
  try {
    const article = await findPublishedArticle(req.params.articleId);
    const authorName = cleanText(req.body.authorName, NAME_MAX);
    const text = cleanText(req.body.text, TEXT_MAX);
    if (!authorName) throw httpError(400, `יש להזין שם (עד ${NAME_MAX} תווים)`);
    if (!text) throw httpError(400, `יש להזין תגובה (עד ${TEXT_MAX} תווים)`);

    // The IP is saved for guests only: it is what the 3-per-minute limit counts (a guest who drops the device cookie
    // is still the same IP), and staff comments must not use up the limit of a guest on the same network
    const ip = req.user ? undefined : clientIp(req) || undefined;
    const comment = await Comment.create({ article: article._id, authorName, text, deviceId: req.deviceId, ip });
    logger.info(`Comment added ${comment._id} on article ${article._id} (device ${req.deviceId})`);
    res.status(201).json(toPublic(comment));
  } catch (err) {
    next(err);
  }
};

// PUT /api/comments/:id  body: { authorName?, text? } - editor only (enforced in routes/comments.js)
exports.update = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, 'מזהה תגובה לא תקין');
    const comment = await Comment.findById(req.params.id);
    if (!comment) throw httpError(404, 'התגובה לא נמצאה');

    if (req.body.authorName !== undefined) {
      const authorName = cleanText(req.body.authorName, NAME_MAX);
      if (!authorName) throw httpError(400, `שם לא תקין (עד ${NAME_MAX} תווים)`);
      comment.authorName = authorName;
    }
    if (req.body.text !== undefined) {
      const text = cleanText(req.body.text, TEXT_MAX);
      if (!text) throw httpError(400, `תגובה לא תקינה (עד ${TEXT_MAX} תווים)`);
      comment.text = text;
    }

    await comment.save();
    logger.info(`Comment ${comment._id} edited by ${req.user.username}`);
    res.json(toPublic(comment));
  } catch (err) {
    next(err);
  }
};

// DELETE /api/comments/:id - editor only (enforced in routes/comments.js)
exports.remove = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, 'מזהה תגובה לא תקין');
    const comment = await Comment.findByIdAndDelete(req.params.id);
    if (!comment) throw httpError(404, 'התגובה לא נמצאה');
    logger.info(`Comment ${comment._id} deleted by ${req.user.username}`);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};
