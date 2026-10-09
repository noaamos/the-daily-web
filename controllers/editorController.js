// Owner: member 4
const mongoose = require('mongoose');
const Article = require('../models/Article');
const todo = require('./todo');
const { getArticleStats } = require('../services/viewService');
const { httpError } = require('../middleware/errorHandler');
const { STATUS, STATUS_LABELS_HE, CATEGORY_LABELS_HE, PAGE_SIZE } = require('../config/constants');

const STATUSES = Object.values(STATUS);
const MAX_QUERY_LENGTH = 100;

// Escape characters that have a special meaning in a regex, so searching "C++" or "(" can't break the query
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

exports.dashboardPage = (req, res) => {
  res.render('editor/dashboard', { title: 'אזור העורך' });
};

exports.reviewPage = todo('editor.reviewPage');

// Impact Analytics page. ?article=<id> pre-selects an article (link from the dashboard).
exports.analyticsPage = (req, res) => {
  const articleId = mongoose.isValidObjectId(req.query.article) ? String(req.query.article) : '';
  res.render('editor/analytics', { title: 'סטטיסטיקות כתבות', articleId });
};

// GET /editor/api/articles?status=&q=&page=
// All articles for the editor dashboard, newest activity first, plus a count per status for the filter chips.
exports.list = async (req, res, next) => {
  try {
    const filter = STATUSES.includes(req.query.status) ? { status: req.query.status } : {};
    const q = String(req.query.q || '').trim();
    if (q.length > MAX_QUERY_LENGTH) throw httpError(400, 'טקסט החיפוש ארוך מדי');
    if (q) {
      const rx = { $regex: escapeRegex(q), $options: 'i' };
      filter.$or = [{ 'published.title': rx }, { 'draft.title': rx }];
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);

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

exports.editDraft = todo('editor.editDraft');
exports.approve = todo('editor.approve');
exports.returnForFixes = todo('editor.returnForFixes');
exports.remove = todo('editor.remove');

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
