// Owner: member 1
const mongoose = require('mongoose');
const Article = require('../models/Article');
const DeviceView = require('../models/DeviceView');
const viewService = require('../services/viewService');
const weatherService = require('../services/weatherService');
const logger = require('../config/logger');
const { parsePage, parseSearchText, escapeRegex } = require('../services/queryParams');
const { CATEGORIES, CATEGORY_LABELS_HE, PAGE_SIZE } = require('../config/constants');

const SORTS = {
  date: { firstPublishedAt: -1, _id: -1 },
  popular: { viewCount: -1, _id: -1 },
};
const VIEWED_OPTIONS = ['all', 'viewed', 'unviewed'];
// hasOwn: a plain `SORTS[value]` would also "find" inherited names like "constructor" or "toString"
const isSort = (value) => typeof value === 'string' && Object.hasOwn(SORTS, value);
// the moment of the first page, as the server writes it (toISOString): the next pages send it back unchanged
const SNAPSHOT_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const MAX_QUERY_LENGTH = 100;
// Front page takes the newest articles, each used once: 4 carousel slides, 2 medium cards, 4 in "latest news", 4 in the picks row
const FRONT_CARDS = 14;

const PUBLISHED = { published: { $ne: null } };
const CARD_FIELDS = 'published.title published.summary published.imageUrl category author firstPublishedAt viewCount';

// The shape of one article in lists (feed API + home page front section)
function toCard(a) {
  return {
    id: a._id,
    title: a.published.title,
    summary: a.published.summary,
    imageUrl: a.published.imageUrl,
    category: a.category,
    categoryLabel: CATEGORY_LABELS_HE[a.category],
    author: a.author ? a.author.displayName : '',
    publishedAt: a.firstPublishedAt,
    viewCount: a.viewCount,
  };
}

function findCards(sort, limit, filter = PUBLISHED) {
  return Article.find(filter).sort(sort).limit(limit).select(CARD_FIELDS).populate('author', 'displayName').lean();
}

// "Most read" and "latest news" boxes of the article page's sidebar (the home page builds its own, see homePage).
// The article being read is left out of both, so it never recommends itself.
async function sidebarNews(articleId) {
  const others = { ...PUBLISHED, _id: { $ne: articleId } };
  const [latest, mostRead] = await Promise.all([findCards(SORTS.date, 4, others), findCards(SORTS.popular, 5, others)]);
  return { latest: latest.map(toCard), mostRead: mostRead.map(toCard) };
}

// Home page. The "front page" section (carousel, medium cards, picks, latest, most read) is rendered on the server;
// the "all articles" feed below it is loaded with Ajax by feed.js.
// Filters in the URL (/?category=sports) pre-select the controls, so category links and the Back button work.
exports.homePage = async (req, res, next) => {
  try {
    const initial = {
      q: String(req.query.q || '').slice(0, MAX_QUERY_LENGTH),
      category: CATEGORIES.includes(req.query.category) ? req.query.category : '',
      viewed: VIEWED_OPTIONS.includes(req.query.viewed) ? req.query.viewed : 'all',
      sort: isSort(req.query.sort) ? req.query.sort : 'date',
    };
    const [latest, mostRead] = await Promise.all([findCards(SORTS.date, FRONT_CARDS), findCards(SORTS.popular, 5)]);
    const cards = latest.map(toCard);

    res.render('public/home', {
      title: 'The Daily Web',
      description: 'The Daily Web - חדשות, כלכלה, ספורט, טכנולוגיה ותרבות',
      initial,
      showFront: !initial.q && !initial.category && initial.viewed === 'all',
      front: {
        featured: cards[0],            // truthy only when there is at least one published article
        slides: cards.slice(0, 4),
        medium: cards.slice(4, 6),
        latest: cards.slice(6, 10),
        strip: cards.slice(10, 14),
        mostRead: mostRead.map(toCard),
      },
    });
  } catch (err) {
    next(err);
  }
};

function notFoundPage(res) {
  res.status(404).render('error', { title: 'הכתבה לא נמצאה', message: 'הכתבה שחיפשת לא קיימת או שעדיין לא פורסמה' });
}

// Body is stored as plain text; an empty line separates paragraphs. The view prints each paragraph
// with <%= %> (escaped), so text written by a reporter can never inject HTML or scripts into the page.
function toParagraphs(body) {
  return String(body || '')
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

// Counting the visit must never break or slow down the page, so we don't await it and only log failures
function trackVisit(articleId, deviceId) {
  viewService.recordView(articleId, deviceId)
    .catch((err) => logger.error(`recordView failed for ${articleId}: ${err.message}`));
  // Remember that this device opened the article (for the "viewed / not viewed" filter). Upsert = at most one row.
  DeviceView.updateOne({ deviceId, article: articleId }, { $setOnInsert: { deviceId, article: articleId } }, { upsert: true })
    .catch((err) => logger.error(`DeviceView failed for ${articleId}: ${err.message}`));
}

// Server-rendered article page: the full text is in the HTML the server returns (search engines can read it
// without running JavaScript). Only the comments are loaded later with Ajax.
exports.articlePage = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return notFoundPage(res);

    // Only the published version is public - a draft or an update waiting for approval is never shown here
    const article = await Article.findOne({ _id: req.params.id, published: { $ne: null } })
      .select('published category author firstPublishedAt lastPublishedAt')
      .populate('author', 'displayName')
      .lean();
    if (!article) return notFoundPage(res);

    // A HEAD request (an uptime monitor, a link preview) only asks whether the page exists: nobody reads the article,
    // so it is not a view. Every real visit (GET), including a refresh, is counted.
    if (req.method !== 'HEAD') trackVisit(article._id, req.deviceId);

    const wasUpdated = article.lastPublishedAt && article.lastPublishedAt > article.firstPublishedAt;
    const { latest, mostRead } = await sidebarNews(article._id);
    res.render('public/article', {
      latest,
      mostRead,
      title: article.published.title + ' | The Daily Web',
      description: article.published.summary,
      image: article.published.imageUrl,
      article,
      content: article.published,
      paragraphs: toParagraphs(article.published.body),
      categoryLabel: CATEGORY_LABELS_HE[article.category],
      authorName: article.author ? article.author.displayName : '',
      updatedAt: wasUpdated ? article.lastPublishedAt : null,
    });
  } catch (err) {
    next(err);
  }
};

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

// Reads the query string and validates it. Missing values get defaults; invalid values throw a 400 error.
function parseFeedQuery(query) {
  const page = parsePage(query.page);
  const q = parseSearchText(query.q, MAX_QUERY_LENGTH);

  const category = query.category || '';
  if (category && !CATEGORIES.includes(category)) throw badRequest('קטגוריה לא קיימת');

  const viewed = query.viewed || 'all';
  if (!VIEWED_OPTIONS.includes(viewed)) throw badRequest('ערך סינון צפייה לא תקין');

  const sort = query.sort || 'date';
  if (!isSort(sort)) throw badRequest('סוג מיון לא תקין');

  // snapshot: the moment the first page was loaded. Later pages only include articles published
  // up to that moment, so a newly published article can't push items down and cause duplicates.
  let snapshot = new Date();
  if (query.snapshot !== undefined) {
    if (typeof query.snapshot !== 'string' || !SNAPSHOT_FORMAT.test(query.snapshot)) throw badRequest('snapshot לא תקין');
    snapshot = new Date(query.snapshot);
    if (Number.isNaN(snapshot.getTime())) throw badRequest('snapshot לא תקין');
  }

  return { page, q, category, viewed, sort, snapshot };
}

// Returns { articles, hasMore, page, snapshot }. Only articles that have a published version, fields from `published.*`.
exports.listArticles = async (req, res, next) => {
  try {
    const { page, q, category, viewed, sort, snapshot } = parseFeedQuery(req.query);

    const filter = { ...PUBLISHED, firstPublishedAt: { $lte: snapshot } };
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
      .select(CARD_FIELDS)
      .populate('author', 'displayName')
      .lean();

    const hasMore = docs.length > PAGE_SIZE;
    const pageDocs = docs.slice(0, PAGE_SIZE);

    // Which of THESE articles has this device already opened? (checks only this page, not the whole history)
    const seenOnPage = await DeviceView.find({ deviceId: req.deviceId, article: { $in: pageDocs.map((a) => a._id) } })
      .select('article')
      .lean();
    const seenSet = new Set(seenOnPage.map((v) => String(v.article)));

    const articles = pageDocs.map((a) => ({ ...toCard(a), viewed: seenSet.has(String(a._id)) }));

    res.json({ articles, hasMore, page, snapshot: snapshot.toISOString() });
  } catch (err) {
    next(err);
  }
};

exports.weather = async (req, res) => {
  const data = await weatherService.getWeather(); // never throws
  if (!data) return res.status(503).json({ error: 'מזג האוויר לא זמין כרגע' });
  res.set('Cache-Control', 'public, max-age=300'); // browsers may reuse it for 5 minutes
  res.json(data);
};
