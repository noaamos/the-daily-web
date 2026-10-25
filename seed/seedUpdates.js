// Seed demo pending updates for published articles.
// Keeps the live version visible while the new draft awaits editor review.
const Article = require('../models/Article');
const { STATUS } = require('../config/constants');

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedPendingUpdates(articles, editorId) {
  const updates = [];
  articles.filter((a) => a.status === STATUS.PENDING).forEach((a, i) => {
    if (i % 3 !== 0) return; // about a third of the pending articles are updates
    const first = new Date(Date.now() - (3 + (i % 10)) * DAY_MS);
    const old = a.draft.toObject();
    const published = { ...old, title: `${old.title} (גרסה קודמת)`, summary: `${old.summary} זו הגרסה שפורסמה לפני העדכון.`, body: old.body.split('\n\n')[0] };
    // keep the in-memory documents in sync: seedViewStats() reads them to generate view history for live articles
    a.published = published;
    a.firstPublishedAt = first;
    updates.push({
      updateOne: {
        filter: { _id: a._id },
        update: {
          $set: {
            published,
            firstPublishedAt: first,
            lastPublishedAt: first,
            publishHistory: [{ at: first, by: editorId }],
            viewCount: 100 + i * 7,
          },
        },
      },
    });
  });
  if (updates.length) await Article.bulkWrite(updates);
  return updates.length;
}

module.exports = { seedPendingUpdates };
