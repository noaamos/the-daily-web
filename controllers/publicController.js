// Owner: member 1
const todo = require('./todo');
const Article = require('../models/Article');
const DeviceView = require('../models/DeviceView');
const { CATEGORIES, CATEGORY_LABELS_HE, PAGE_SIZE } = require('../config/constants');

const SORTS = {
  date: { firstPublishedAt: -1, _id: -1 },
  popular: { viewCount: -1, _id: -1 },
};
const VIEWED_OPTIONS = ['all', 'viewed', 'unviewed'];
const MAX_QUERY_LENGTH = 100;

exports.homePage = (req, res) => {
  res.render('public/home', { title: 'The Daily Web', categories: CATEGORIES, categoryLabels: CATEGORY_LABELS_HE });
};

// Must render the FULL article in the HTML (SEO) - load it here and pass it to the view, not via Ajax.
// Remember to call viewService.recordView(...) on every visit.
exports.articlePage = todo('articlePage');

// Escape characters that have a special meaning in a regex, so searching "C++" or "(" can't break the query
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

// Reads the query string and validates it. Missing values get defaults; invalid values throw a 400 error.
function parseFeedQuery(query) {
  const page = query.page === undefined ? 1 : Number(query.page);
  if (!Number.isInteger(page) || page < 1) throw badRequest('מספר עמוד לא תקין');

  const q = String(query.q || '').trim();
  if (q.length > MAX_QUERY_LENGTH) throw badRequest('טקסט החיפוש ארוך מדי');

  const category = query.category || '';
  if (category && !CATEGORIES.includes(category)) throw badRequest('קטגוריה לא קיימת');

  const viewed = query.viewed || 'all';
  if (!VIEWED_OPTIONS.includes(viewed)) throw badRequest('ערך סינון צפייה לא תקין');

  const sort = query.sort || 'date';
  if (!SORTS[sort]) throw badRequest('סוג מיון לא תקין');

  // snapshot: the moment the first page was loaded. Later pages only include articles published
  // up to that moment, so a newly published article can't push items down and cause duplicates.
  const snapshot = query.snapshot ? new Date(query.snapshot) : new Date();
  if (Number.isNaN(snapshot.getTime())) throw badRequest('snapshot לא תקין');

  return { page, q, category, viewed, sort, snapshot };
}

// Returns { articles, hasMore, page, snapshot }. Only articles that have a published version, fields from `published.*`.
exports.listArticles = async (req, res, next) => {
  try {
    const { page, q, category, viewed, sort, snapshot } = parseFeedQuery(req.query);

    const filter = {
      published: { $ne: null },
      firstPublishedAt: { $lte: snapshot },
    };
    if (q) filter['published.title'] = { $regex: escapeRegex(q), $options: 'i' };
    if (category) filter.category = category;

    if (viewed !== 'all') {
      const seenIds = await DeviceView.distinct('article', { deviceId: req.deviceId });
      filter._id = viewed === 'viewed' ? { $in: seenIds } : { $nin: seenIds };
    }

    // Ask for one extra article: if it comes back, there is at least one more page
    const docs = await Article.find(filter)
      .sort(SORTS[sort])
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE + 1)
      .select('published.title published.summary published.imageUrl category author firstPublishedAt viewCount')
      .populate('author', 'displayName')
      .lean();

    const hasMore = docs.length > PAGE_SIZE;
    const articles = docs.slice(0, PAGE_SIZE).map((a) => ({
      id: a._id,
      title: a.published.title,
      summary: a.published.summary,
      imageUrl: a.published.imageUrl,
      category: a.category,
      categoryLabel: CATEGORY_LABELS_HE[a.category],
      author: a.author ? a.author.displayName : '',
      publishedAt: a.firstPublishedAt,
      viewCount: a.viewCount,
    }));

    res.json({ articles, hasMore, page, snapshot: snapshot.toISOString() });
  } catch (err) {
    next(err);
  }
};

exports.weather = todo('weather');
