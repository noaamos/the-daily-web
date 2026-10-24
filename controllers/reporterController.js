// Owner: member 3
// Every handler must check that the article belongs to req.user (article.author equals req.user._id).
const mongoose = require('mongoose');
const Article = require('../models/Article');
const { transition } = require('../services/articleService');
const { httpError } = require('../middleware/errorHandler');
const logger = require('../config/logger');
const { STATUS, CATEGORIES, STATUS_LABELS_HE, CATEGORY_LABELS_HE, PAGE_SIZE } = require('../config/constants');

const MAX_TITLE_LENGTH = 200;

// Statuses in which a reporter may change the draft. A published article is not editable yet:
// how editing a live article works (task 7) still has to be agreed with the team and the lecturer.
const EDITABLE = [STATUS.DRAFT, STATUS.RETURNED];

// Content fields of the draft: Hebrew name (for error messages) and maximum length
const DRAFT_FIELDS = {
  title: { label: 'כותרת', max: MAX_TITLE_LENGTH },
  summary: { label: 'תקציר', max: 500 },
  body: { label: 'תוכן', max: 50000 },
  imageUrl: { label: 'תמונה', max: 500 },
};

// The shape of one article in the "my articles" list (used by the list and by create)
function toRow(a) {
  return {
    id: a._id,
    title: (a.draft && a.draft.title) || '(ללא כותרת)',
    category: a.category,
    categoryLabel: CATEGORY_LABELS_HE[a.category],
    status: a.status,
    statusLabel: STATUS_LABELS_HE[a.status],
    editable: EDITABLE.includes(a.status),
    // The editor's note is only meaningful while the article is waiting for fixes. transition() keeps the old
    // text in the database after a resubmit (it is cleared on publish), so it must not be shown in other states.
    editorNote: a.status === STATUS.RETURNED ? (a.editorNote || '') : '',
    updatedAt: a.updatedAt,
  };
}

// Loads an article by id and makes sure it belongs to the logged-in reporter
async function loadOwnArticle(req) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) throw httpError(404, 'הכתבה לא נמצאה');
  const article = await Article.findById(id);
  if (!article) throw httpError(404, 'הכתבה לא נמצאה');
  if (String(article.author) !== String(req.user._id)) {
    logger.warn(`Blocked: ${req.user.username} tried to access article ${id} of another reporter`);
    throw httpError(403, 'אין הרשאה לכתבה זו');
  }
  return article;
}

// Validates the draft the reporter sent and returns only the allowed fields.
// The title may be empty here (the reporter is still writing); completeness is checked when submitting.
// The body is kept exactly as typed; the other fields are trimmed.
function cleanDraft(input) {
  const out = {};
  Object.entries(DRAFT_FIELDS).forEach(([key, { label, max }]) => {
    const value = input[key];
    if (typeof value !== 'string') throw httpError(400, `השדה "${label}" חסר או לא תקין`);
    const text = key === 'body' ? value : value.trim();
    if (text.length > max) throw httpError(400, `השדה "${label}" ארוך מדי (עד ${max} תווים)`);
    out[key] = text;
  });
  if (out.imageUrl && !/^https?:\/\//i.test(out.imageUrl)) throw httpError(400, 'קישור התמונה חייב להתחיל ב-http או https');
  if (input.category !== undefined) {
    if (typeof input.category !== 'string' || !CATEGORIES.includes(input.category)) throw httpError(400, 'קטגוריה לא תקינה');
    out.category = input.category;
  }
  return out;
}

exports.dashboardPage = (req, res) => {
  res.render('reporter/dashboard', { title: 'אזור הכתב' });
};

// GET /reporter/articles/:id/edit
// The form is filled on the server, so a refresh always shows the last saved version.
// An article that is waiting for approval or already published opens read-only.
exports.editPage = async (req, res, next) => {
  try {
    const article = await loadOwnArticle(req);
    res.render('reporter/edit', {
      title: 'עריכת כתבה',
      article: article.toObject(),
      canEdit: EDITABLE.includes(article.status),
      statusLabel: STATUS_LABELS_HE[article.status],
    });
  } catch (err) {
    next(err);
  }
};

// GET /reporter/api/articles?page=
// The logged-in reporter's own articles, newest activity first. Returns { articles, hasMore }.
exports.listMine = async (req, res, next) => {
  try {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    if (!Number.isInteger(page) || page < 1) throw httpError(400, 'מספר עמוד לא תקין');

    const docs = await Article.find({ author: req.user._id })
      .sort({ updatedAt: -1, _id: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE + 1) // one extra row tells us whether there is another page
      .select('status category draft.title editorNote updatedAt')
      .lean();

    const hasMore = docs.length > PAGE_SIZE;
    const articles = docs.slice(0, PAGE_SIZE).map(toRow);

    res.json({ articles, hasMore });
  } catch (err) {
    next(err);
  }
};

// POST /reporter/api/articles  body: { category, title? }
// Creates a new article in "draft" status owned by the logged-in reporter. Returns the new list row (201).
// Only `category` and `title` are read from the body: author and status are set here, never taken from the client.
exports.create = async (req, res, next) => {
  try {
    const { category, title = '' } = req.body || {};
    if (typeof category !== 'string' || !CATEGORIES.includes(category)) throw httpError(400, 'יש לבחור קטגוריה');
    if (typeof title !== 'string') throw httpError(400, 'הכותרת אינה תקינה');
    const cleanTitle = title.trim();
    if (cleanTitle.length > MAX_TITLE_LENGTH) throw httpError(400, `הכותרת ארוכה מדי (עד ${MAX_TITLE_LENGTH} תווים)`);

    const article = await Article.create({
      author: req.user._id,
      category,
      status: STATUS.DRAFT,
      draft: { title: cleanTitle },
    });
    logger.info(`Reporter ${req.user.username} created article ${article._id}`);
    res.status(201).json(toRow(article.toObject()));
  } catch (err) {
    next(err);
  }
};

// PUT /reporter/api/articles/:id/draft  body: { title, summary, body, imageUrl, category? }
// Saves the whole draft in one go (the last request wins). Never touches `published` or `status`.
exports.autosave = async (req, res, next) => {
  try {
    const article = await loadOwnArticle(req); // 404 / 403
    if (!EDITABLE.includes(article.status)) throw httpError(409, 'אי אפשר לערוך כתבה במצב הזה');
    const content = cleanDraft(req.body || {}); // 400 on invalid data

    // Owner and status are checked again inside the update itself, so an action that changes the status
    // at this very moment (e.g. an editor approving) can never be overwritten by an older save.
    const saved = await Article.findOneAndUpdate(
      { _id: article._id, author: req.user._id, status: { $in: EDITABLE } },
      {
        $set: {
          'draft.title': content.title,
          'draft.summary': content.summary,
          'draft.body': content.body,
          'draft.imageUrl': content.imageUrl,
          ...(content.category && { category: content.category }),
          draftSavedAt: new Date(),
        },
      },
      { new: true, runValidators: true },
    );
    if (!saved) throw httpError(409, 'מצב הכתבה השתנה, אי אפשר לשמור');
    res.json({ savedAt: saved.draftSavedAt });
  } catch (err) {
    next(err);
  }
};


// POST /reporter/api/articles/:id/submit
// Moves the reporter's own article to "pending" (waiting for the editor). The article must be complete first.
// Nothing is read from the request body: the status change is decided by transition() alone.
exports.submit = async (req, res, next) => {
  try {
    const article = await loadOwnArticle(req); // 404 / 403
    const missing = [];
    if (!(article.draft.title || '').trim()) missing.push('כותרת');
    if (!(article.draft.body || '').trim()) missing.push('תוכן');
    if (missing.length) throw httpError(400, `לפני ההגשה יש למלא: ${missing.join(' ו')}`);

    await transition(article, STATUS.PENDING, req.user); // 400 when the current status does not allow it
    logger.info(`Reporter ${req.user.username} submitted article ${article._id}`);
    res.json({ status: article.status, statusLabel: STATUS_LABELS_HE[article.status] });
  } catch (err) {
    next(err);
  }
};
