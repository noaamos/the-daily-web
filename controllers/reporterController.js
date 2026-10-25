// Every handler must check that the article belongs to req.user (article.author equals req.user._id).
const mongoose = require('mongoose');
const Article = require('../models/Article');
const { transition } = require('../services/articleService');
const { isValidImageLink } = require('../services/imageLink');
const { parsePage } = require('../services/queryParams');
const { httpError } = require('../middleware/errorHandler');
const logger = require('../config/logger');
const { STATUS, CATEGORIES, STATUS_LABELS_HE, CATEGORY_LABELS_HE, PAGE_SIZE } = require('../config/constants');

const MAX_TITLE_LENGTH = 200;

// Reporter-editable statuses. Published articles are edited as drafts.
// The live version remains unchanged until editor approval.
const EDITABLE = [STATUS.DRAFT, STATUS.RETURNED, STATUS.PUBLISHED];

// The content fields that exist in both versions of an article
const CONTENT_KEYS = ['title', 'summary', 'body', 'imageUrl'];

// Does the draft of a published article differ from what the public sees?
function differsFromPublished(article) {
  return CONTENT_KEYS.some((key) => (article.draft[key] || '') !== (article.published[key] || ''));
}

// MongoDB aggregation: checks if a draft field differs from its published version without loading full article text.
const fieldDiffers = (key) => ({ $ne: [{ $ifNull: [`$draft.${key}`, ''] }, { $ifNull: [`$published.${key}`, ''] }] });
const hasPublishedVersion = { $eq: [{ $type: '$published' }, 'object'] };
// a published article whose draft differs from the published version in any field (changes that were not submitted yet)
const hasUnsentChanges = { $and: [{ $eq: ['$status', STATUS.PUBLISHED] }, hasPublishedVersion, { $or: CONTENT_KEYS.map(fieldDiffers) }] };
const STATUSES = Object.values(STATUS);

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
    // an update of an article that is live: it is waiting for the editor, or was returned for fixes
    isUpdate: Boolean(a.hasPublished) && a.status !== STATUS.PUBLISHED,
    // a published article whose draft was changed but not submitted yet
    unsentChanges: Boolean(a.unsent),
// Show the editor's note only when fixes are requested; it persists after resubmission until publication.
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

// Validate draft fields; allow an empty title until submission.
// Preserve body text as typed and trim other fields.
function cleanDraft(input) {
  const out = {};
  Object.entries(DRAFT_FIELDS).forEach(([key, { label, max }]) => {
    const value = input[key];
    if (typeof value !== 'string') throw httpError(400, `השדה "${label}" חסר או לא תקין`);
    const text = key === 'body' ? value : value.trim();
    if (text.length > max) throw httpError(400, `השדה "${label}" ארוך מדי (עד ${max} תווים)`);
    out[key] = text;
  });
  if (out.imageUrl && !isValidImageLink(out.imageUrl)) throw httpError(400, 'קישור התמונה חייב להיות כתובת תקינה שמתחילה ב-http או https');
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
// Server-rendered form with the latest saved version; pending articles are read-only.
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

// GET /reporter/api/articles?page=&status=&unsent=1
// Returns reporter's articles by latest activity: { articles, hasMore, counts }.
// status: filters by draft/pending/returned/published; invalid values return 400.
// unsent=1: published articles with unsubmitted draft changes.
// counts: unfiltered totals per status and unsent changes.
exports.listMine = async (req, res, next) => {
  try {
    const page = parsePage(req.query.page);
    const { status, unsent } = req.query;
    // includes() compares with ===, so an array or an object (?status[$ne]=x) is rejected too
    if (status !== undefined && !STATUSES.includes(status)) throw httpError(400, 'מצב כתבה לא תקין');
    if (unsent !== undefined && unsent !== '1') throw httpError(400, 'ערך הסינון לא תקין');

    const match = { author: req.user._id };
    if (status) match.status = status;
    if (unsent) match.$expr = hasUnsentChanges;

    const [docs, grouped] = await Promise.all([
      Article.aggregate([
        { $match: match },
        { $sort: { updatedAt: -1, _id: -1 } },
        { $skip: (page - 1) * PAGE_SIZE },
        { $limit: PAGE_SIZE + 1 }, // one extra row tells us whether there is another page
        {
          $project: {
            status: 1, category: 1, 'draft.title': 1, editorNote: 1, updatedAt: 1,
            hasPublished: hasPublishedVersion,
            unsent: hasUnsentChanges,
          },
        },
      ]),
      Article.aggregate([
        { $match: { author: req.user._id } },
        { $group: { _id: '$status', n: { $sum: 1 }, unsent: { $sum: { $cond: [hasUnsentChanges, 1, 0] } } } },
      ]),
    ]);

    const counts = { total: 0, unsent: 0 };
    STATUSES.forEach((s) => { counts[s] = 0; });
    grouped.forEach((g) => { counts[g._id] = g.n; counts.total += g.n; counts.unsent += g.unsent; });

    const hasMore = docs.length > PAGE_SIZE;
    const articles = docs.slice(0, PAGE_SIZE).map(toRow);

    res.json({ articles, hasMore, counts });
  } catch (err) {
    next(err);
  }
};

// POST /reporter/api/articles  body: { category, title? }
// Creates a draft (201) for the logged-in reporter.
// Author and status are set server-side, not accepted from the client.
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

// PUT /reporter/api/articles/:id/draft
// Saves the full draft (last request wins) without changing published content or status.
exports.autosave = async (req, res, next) => {
  try {
    const article = await loadOwnArticle(req); // 404 / 403
    if (!EDITABLE.includes(article.status)) throw httpError(409, 'אי אפשר לערוך כתבה במצב הזה');
    const content = cleanDraft(req.body || {}); // 400 on invalid data

    // A category change would show on the public site before approval, so an article with a published version keeps its category.
    if (article.published) {
      if (content.category !== undefined && content.category !== article.category) {
        throw httpError(400, 'אי אפשר לשנות קטגוריה של כתבה שפורסמה');
      }
      delete content.category;
    }

  // Recheck owner and status during the update to prevent stale saves from overwriting concurrent changes.
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
// Submits the reporter's complete article for review.
// Status is controlled by transition(), not the request body.
exports.submit = async (req, res, next) => {
  try {
    const article = await loadOwnArticle(req); // 404 / 403
    const missing = [];
    if (!(article.draft.title || '').trim()) missing.push('כותרת');
    if (!(article.draft.body || '').trim()) missing.push('תוכן');
    if (missing.length) throw httpError(400, `לפני ההגשה יש למלא: ${missing.join(' ו')}`);
// Require actual changes when submitting published or returned updates.
// Prevents identical reviews and false publish markers in analytics.
    if (article.published && !differsFromPublished(article)) {
      throw httpError(400, article.status === STATUS.RETURNED
        ? 'הטיוטה זהה לגרסה שפורסמה, ולכן אין מה להגיש. תקנו את הכתבה לפי הערת העורך ואז הגישו שוב.'
        : 'אין שינויים להגשה');
    }
    await transition(article, STATUS.PENDING, req.user); // 400 when the current status does not allow it
    logger.info(`Reporter ${req.user.username} submitted article ${article._id}`);
    res.json({ status: article.status, statusLabel: STATUS_LABELS_HE[article.status] });
  } catch (err) {
    next(err);
  }
};

// POST /reporter/api/articles/:id/discard
// Discards unsent changes by restoring the published version to the draft.
// Only allowed while the article is published.
exports.discardChanges = async (req, res, next) => {
  try {
    const article = await loadOwnArticle(req); // 404 / 403
    if (article.status !== STATUS.PUBLISHED || !article.published) {
      throw httpError(409, 'אפשר לבטל שינויים רק בכתבה שפורסמה ושעדיין לא הוגש לה עדכון');
    }
    const live = article.published.toObject();
    const saved = await Article.findOneAndUpdate(
      { _id: article._id, author: req.user._id, status: STATUS.PUBLISHED },
      {
        $set: {
          'draft.title': live.title,
          'draft.summary': live.summary,
          'draft.body': live.body,
          'draft.imageUrl': live.imageUrl,
          draftSavedAt: null,
        },
      },
      { new: true },
    );
    if (!saved) throw httpError(409, 'מצב הכתבה השתנה, אי אפשר לבטל שינויים');
    logger.info(`Reporter ${req.user.username} cancelled the changes of article ${article._id}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};
