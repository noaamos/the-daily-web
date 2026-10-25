// Owner: member 4
const mongoose = require('mongoose');
const Article = require('../models/Article');
const Comment = require('../models/Comment');
const ViewStat = require('../models/ViewStat');
const DeviceView = require('../models/DeviceView');
const { getArticleStats, getOverallStats } = require('../services/viewService');
const { transition } = require('../services/articleService');
const { isValidImageLink } = require('../services/imageLink');
const { httpError } = require('../middleware/errorHandler');
const { parsePage, parseSearchText, escapeRegex } = require('../services/queryParams');
const logger = require('../config/logger');
const { STATUS, STATUS_LABELS_HE, CATEGORY_LABELS_HE, PAGE_SIZE } = require('../config/constants');

const STATUSES = Object.values(STATUS);
const MAX_QUERY_LENGTH = 100;
const MAX_NOTE_LENGTH = 1000;

// Looks the article up; a malformed id is a 400, a missing article a 404 (both handled by errorHandler)
async function loadArticle(id) {
  if (!mongoose.isValidObjectId(id)) throw httpError(400, 'מזהה כתבה לא תקין');
  const article = await Article.findById(id);
  if (!article) throw httpError(404, 'הכתבה לא נמצאה');
  return article;
}

// Content fields of an article version, with their Hebrew names and maximum lengths
const CONTENT_FIELDS = [
  { key: 'title', label: 'כותרת', max: 200 },
  { key: 'summary', label: 'תקציר', max: 500 },
  { key: 'body', label: 'תוכן', max: 50000 },
  { key: 'imageUrl', label: 'תמונה', max: 500 },
];

// Validates what the editor sent when editing a draft; returns only the allowed, trimmed fields
function cleanContent(input) {
  const out = {};
  CONTENT_FIELDS.forEach(({ key, label, max }) => {
    const value = input[key];
    if (typeof value !== 'string') throw httpError(400, `השדה "${label}" חסר או לא תקין`);
    const text = value.trim();
    if (text.length > max) throw httpError(400, `השדה "${label}" ארוך מדי (עד ${max} תווים)`);
    out[key] = text;
  });
  if (!out.title) throw httpError(400, 'חובה למלא כותרת');
  if (out.imageUrl && !isValidImageLink(out.imageUrl)) throw httpError(400, 'קישור התמונה חייב להיות כתובת תקינה שמתחילה ב-http או https');
  return out;
}

exports.dashboardPage = (req, res) => {
  res.render('editor/dashboard', { title: 'אזור העורך' });
};

// GET /editor/articles/:id - the submitted content; for an update of a live article also the published version
exports.reviewPage = async (req, res, next) => {
  try {
    const article = await loadArticle(req.params.id);
    await article.populate('author', 'displayName');
    const isUpdate = Boolean(article.published) && article.status === STATUS.PENDING;
    // Which fields differ between what the public sees now and what is waiting for approval
    const changed = {};
    if (isUpdate) CONTENT_FIELDS.forEach(({ key }) => { changed[key] = article.published[key] !== article.draft[key]; });
    res.render('editor/review', {
      title: `בדיקת כתבה | ${article.draft.title || article.published?.title || ''}`,
      article: article.toObject(),
      fields: CONTENT_FIELDS,
      isUpdate,
      changed,
      canAct: article.status === STATUS.PENDING,
      statusLabel: STATUS_LABELS_HE[article.status],
      categoryLabel: CATEGORY_LABELS_HE[article.category],
      authorName: article.author ? article.author.displayName : '',
    });
  } catch (err) {
    next(err);
  }
};

// Impact Analytics page. ?article=<id> pre-selects an article (link from the dashboard).
exports.analyticsPage = (req, res) => {
  const articleId = mongoose.isValidObjectId(req.query.article) ? String(req.query.article) : '';
  res.render('editor/analytics', { title: 'סטטיסטיקות כתבות', articleId });
};

// GET /editor/api/articles?status=&q=&page=
// All articles for the editor dashboard, newest activity first, plus a count per status for the filter chips.
exports.list = async (req, res, next) => {
  try {
    // includes() compares with ===, so an array or an object (?status[$ne]=x) is rejected too
    if (req.query.status !== undefined && !STATUSES.includes(req.query.status)) throw httpError(400, 'מצב כתבה לא תקין');
    const filter = req.query.status ? { status: req.query.status } : {};
    const q = parseSearchText(req.query.q, MAX_QUERY_LENGTH);
    if (q) {
      const rx = { $regex: escapeRegex(q), $options: 'i' };
      filter.$or = [{ 'published.title': rx }, { 'draft.title': rx }];
    }
    const page = parsePage(req.query.page);

    const [docs, grouped] = await Promise.all([
      Article.find(filter)
        .sort({ updatedAt: -1, _id: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE + 1) // one extra row tells us whether there is another page
        .select('status category draft.title published.title author updatedAt viewCount')
        .populate('author', 'displayName')
        .lean(),
      Article.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);

    const counts = { total: 0 };
    STATUSES.forEach((s) => { counts[s] = 0; });
    grouped.forEach((g) => { counts[g._id] = g.n; counts.total += g.n; });

    const hasMore = docs.length > PAGE_SIZE;
    const articles = docs.slice(0, PAGE_SIZE).map((a) => ({
      id: a._id,
      title: (a.published && a.published.title) || (a.draft && a.draft.title) || '(ללא כותרת)',
      author: a.author ? a.author.displayName : '',
      category: a.category,
      categoryLabel: CATEGORY_LABELS_HE[a.category],
      status: a.status,
      statusLabel: STATUS_LABELS_HE[a.status],
      // a live article whose new version is waiting for approval: the editor must be able to tell
      isUpdate: Boolean(a.published) && a.status === STATUS.PENDING,
      updatedAt: a.updatedAt,
      viewCount: a.viewCount,
    }));

    res.json({ articles, counts, hasMore });
  } catch (err) {
    next(err);
  }
};

// PUT /editor/api/articles/:id/draft - the editor edits the submitted content (only while it waits for approval)
exports.editDraft = async (req, res, next) => {
  try {
    const article = await loadArticle(req.params.id);
    if (article.status !== STATUS.PENDING) throw httpError(400, 'אפשר לערוך רק כתבה שממתינה לאישור');
    const content = cleanContent(req.body || {});
    article.draft = content; // never touches `published`: the public keeps seeing the approved version
    article.draftSavedAt = new Date();
    await article.save();
    logger.info(`Editor ${req.user.username} edited the draft of article ${article._id}`);
    res.json({ draft: article.draft });
  } catch (err) {
    next(err);
  }
};

// POST /editor/api/articles/:id/approve - publish: the draft becomes the public version (see transition())
exports.approve = async (req, res, next) => {
  try {
    const article = await loadArticle(req.params.id);
    await transition(article, STATUS.PUBLISHED, req.user);
    logger.info(`Editor ${req.user.username} published article ${article._id}`);
    res.json({ status: article.status, lastPublishedAt: article.lastPublishedAt });
  } catch (err) {
    next(err);
  }
};

// POST /editor/api/articles/:id/return - send back to the reporter with a note
exports.returnForFixes = async (req, res, next) => {
  try {
    const article = await loadArticle(req.params.id);
    const note = req.body && req.body.note;
    if (typeof note !== 'string' || !note.trim()) throw httpError(400, 'חובה לכתוב הערה לכתב');
    if (note.trim().length > MAX_NOTE_LENGTH) throw httpError(400, `ההערה ארוכה מדי (עד ${MAX_NOTE_LENGTH} תווים)`);
    await transition(article, STATUS.RETURNED, req.user, { note });
    logger.info(`Editor ${req.user.username} returned article ${article._id} for fixes`);
    res.json({ status: article.status });
  } catch (err) {
    next(err);
  }
};

// DELETE /editor/api/articles/:id - removes the article and everything that belongs to it.
// Dependents go first and the article last, so a half-failed delete can simply be repeated.
exports.remove = async (req, res, next) => {
  try {
    const article = await loadArticle(req.params.id);
    await Promise.all([
      Comment.deleteMany({ article: article._id }),
      ViewStat.deleteMany({ article: article._id }),
      DeviceView.deleteMany({ article: article._id }),
    ]);
    await Article.deleteOne({ _id: article._id });
    logger.info(`Editor ${req.user.username} deleted article ${article._id}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

// GET /editor/api/stats/overview - views of all the articles together (shown before an article is picked)
exports.overallStats = async (req, res, next) => {
  try {
    res.json(await getOverallStats());
  } catch (err) {
    next(err);
  }
};

// GET /editor/api/articles/:id/stats - data for the Impact Analytics chart
exports.stats = async (req, res, next) => {
  try {
    const stats = await getArticleStats(req.params.id);
    if (!stats) throw httpError(404, 'הכתבה לא נמצאה');
    res.json(stats);
  } catch (err) {
    next(err);
  }
};
