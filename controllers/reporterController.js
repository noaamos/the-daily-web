// Owner: member 3
// Every handler must check that the article belongs to req.user (article.author equals req.user._id).
const todo = require('./todo');
const Article = require('../models/Article');
const { httpError } = require('../middleware/errorHandler');
const { STATUS_LABELS_HE, CATEGORY_LABELS_HE, PAGE_SIZE } = require('../config/constants');

exports.dashboardPage = (req, res) => {
  res.render('reporter/dashboard', { title: 'אזור הכתב' });
};

exports.editPage = todo('reporter.editPage');

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
      .select('status category draft.title updatedAt')
      .lean();

    const hasMore = docs.length > PAGE_SIZE;
    const articles = docs.slice(0, PAGE_SIZE).map((a) => ({
      id: a._id,
      title: (a.draft && a.draft.title) || '(ללא כותרת)',
      category: a.category,
      categoryLabel: CATEGORY_LABELS_HE[a.category],
      status: a.status,
      statusLabel: STATUS_LABELS_HE[a.status],
      updatedAt: a.updatedAt,
    }));

    res.json({ articles, hasMore });
  } catch (err) {
    next(err);
  }
};

exports.create = todo('reporter.create');
exports.autosave = todo('reporter.autosave');
exports.submit = todo('reporter.submit');
