// Called on every public article page visit.
const mongoose = require('mongoose');
const ViewStat = require('../models/ViewStat');
const Article = require('../models/Article');

const HOUR_MS = 60 * 60 * 1000;

// Atomically increment hourly view counters using $inc, avoiding per-view documents.
// deviceId is unused here; the caller handles DeviceView tracking.
// eslint-disable-next-line no-unused-vars
async function recordView(articleId, deviceId) {
  const bucket = new Date(Math.floor(Date.now() / HOUR_MS) * HOUR_MS);
  await Promise.all([
    ViewStat.updateOne({ article: articleId, bucket }, { $inc: { count: 1 } }, { upsert: true }),
    Article.updateOne({ _id: articleId }, { $inc: { viewCount: 1 } }),
  ]);
}

// Returns Impact Analytics data (title, total, buckets, publishes).
// Returns null if the article is not found (controller responds with 404).
async function getArticleStats(articleId) {
  if (!mongoose.isValidObjectId(articleId)) return null;
  const [stats, article] = await Promise.all([
    ViewStat.find({ article: articleId }).sort({ bucket: 1 }).select('bucket count').lean(),
    Article.findById(articleId).select('publishHistory published.title draft.title viewCount').lean(),
  ]);
  if (!article) return null;
  return {
    title: (article.published && article.published.title) || (article.draft && article.draft.title) || '',
    total: article.viewCount,
    buckets: stats.map((s) => ({ t: s.bucket, count: s.count })),
    publishes: article.publishHistory.map((p) => p.at),
  };
}

// Returns combined stats for all articles in getArticleStats format.
// Excludes publish markers and before/after comparisons.
async function getOverallStats() {
  const buckets = await ViewStat.aggregate([
    { $group: { _id: '$bucket', count: { $sum: '$count' } } },
    { $sort: { _id: 1 } },
  ]);
  return {
    title: 'כל הכתבות',
    total: buckets.reduce((sum, b) => sum + b.count, 0),
    buckets: buckets.map((b) => ({ t: b._id, count: b.count })),
    publishes: [],
  };
}

module.exports = { recordView, getArticleStats, getOverallStats };
