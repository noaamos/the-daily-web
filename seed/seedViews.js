// Seed hourly view counters and publishHistory update markers for published articles.
// Called by seed.js; viewCount is the sum of generated hourly buckets.
const ViewStat = require('../models/ViewStat');
const Article = require('../models/Article');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HISTORY_DAYS = 30; // articles were published up to 30 days ago: cover their whole life
const rand = (min, max) => min + Math.random() * (max - min);

function extraPublishes(first, now) {
  if (Math.random() > 0.35) return []; // ~1/3 of the articles were updated after publishing
  if (now.getTime() - first.getTime() < 4 * HOUR_MS) return []; // published too recently to have been updated
  const n = 1 + Math.floor(Math.random() * 3);
  const times = [];
  for (let i = 0; i < n; i++) times.push(new Date(rand(first.getTime(), now.getTime() - 2 * HOUR_MS)));
  return times.sort((a, b) => a - b);
}

async function seedViewStats(articles, editorId) {
  const now = new Date();
  const currentHour = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  const statDocs = [];
  const updates = [];

  for (const a of articles) {
    if (!a.published) continue;
    const first = a.firstPublishedAt;
    const publishTimes = [first, ...extraPublishes(first, now)];
    const start = Math.max(Math.floor(first.getTime() / HOUR_MS) * HOUR_MS, currentHour - HISTORY_DAYS * DAY_MS);
    const base = rand(3, 40); // how popular this article is
    let total = 0;

    for (let t = start; t <= currentHour; t += HOUR_MS) {
      const hoursSinceFirst = Math.max(0, (t - first.getTime()) / HOUR_MS);
      let rate = base * Math.exp(-hoursSinceFirst / 120); // slow decay after the first publish
      for (const p of publishTimes.slice(1)) {
        const h = (t - p.getTime()) / HOUR_MS;
        if (h >= 0) rate += base * 2.5 * Math.exp(-h / 12); // traffic bump after an update
      }
      const count = Math.round(rate * rand(0.6, 1.4));
      if (count > 0) {
        statDocs.push({ article: a._id, bucket: new Date(t), count });
        total += count;
      }
    }

    updates.push({
      updateOne: {
        filter: { _id: a._id },
        update: {
          $set: {
            viewCount: total,
            lastPublishedAt: publishTimes[publishTimes.length - 1],
            publishHistory: publishTimes.map((at) => ({ at, by: editorId })),
          },
        },
      },
    });
  }

  if (statDocs.length) await ViewStat.insertMany(statDocs);
  if (updates.length) await Article.bulkWrite(updates);
  return { buckets: statDocs.length, articles: updates.length };
}

module.exports = { seedViewStats };
