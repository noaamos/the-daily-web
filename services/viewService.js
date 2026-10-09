// Owner: member 4
// Called from the public article page (member 1) on every visit.
const mongoose = require('mongoose');
const ViewStat = require('../models/ViewStat');
const Article = require('../models/Article');

const HOUR_MS = 60 * 60 * 1000;

// Every visit is one atomic $inc on a per-article, per-hour counter (see models/ViewStat.js),
// so thousands of concurrent readers never create one document per view.
// `deviceId` is not used here: DeviceView (viewed / not viewed filter) is written by the caller.
// eslint-disable-next-line no-unused-vars
async function recordView(articleId, deviceId) {
  const bucket = new Date(Math.floor(Date.now() / HOUR_MS) * HOUR_MS);
  await Promise.all([
    ViewStat.updateOne({ article: articleId, bucket }, { $inc: { count: 1 } }, { upsert: true }),
    Article.updateOne({ _id: articleId }, { $inc: { viewCount: 1 } }),
  ]);
}

// Returns data for the Impact Analytics chart: { title, total, buckets: [{ t, count }], publishes: [Date] }
// or null when the article does not exist (the controller answers 404).
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

module.exports = { recordView, getArticleStats };
