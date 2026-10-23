// Owner: member 3
// Every handler must check that the article belongs to req.user (article.author equals req.user._id).
const todo = require('./todo');
const Article = require('../models/Article');
const { httpError } = require('../middleware/errorHandler');
const logger = require('../config/logger');
const { STATUS, CATEGORIES, STATUS_LABELS_HE, CATEGORY_LABELS_HE, PAGE_SIZE } = require('../config/constants');

const MAX_TITLE_LENGTH = 200;

// The shape of one article in the "my articles" list (used by the list and by create)
function toRow(a) {
  return {
    id: a._id,
    title: (a.draft && a.draft.title) || '(ללא כותרת)',
    category: a.category,
    categoryLabel: CATEGORY_LABELS_HE[a.category],
    status: a.status,
    statusLabel: STATUS_LABELS_HE[a.status],
    updatedAt: a.updatedAt,
  };
}

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
exports.autosave = todo('reporter.autosave');
exports.submit = todo('reporter.submit');
