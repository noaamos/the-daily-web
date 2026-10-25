// Seed demo comments only for articles with a published version.
// Runs after seedPendingUpdates() to include articles with pending updates.
const Comment = require('../models/Comment');

const ARTICLES_WITH_COMMENTS = 30;      // the 30 most recently published articles (what the home page shows first)
const COMMENTS_PER_ARTICLE = [1, 2, 3, 4, 5]; // repeats -> 30 articles, 90 comments
const MIN_AGE_MS = 6 * 60 * 60 * 1000;  // skip articles published in the last 6 hours, so comments are spread over time

const NAMES = ['רונית', 'אבי', 'נועה', 'משה', 'שירה', 'דניאל', 'תמר', 'יונתן', 'מאיה', 'אורי'];
const TEXTS = [
  'כתבה מעניינת, תודה על העדכון.',
  'מסכים לגמרי עם מה שנכתב כאן.',
  'הייתי שמח לקרוא עוד פרטים על הנושא.',
  'סוף סוף מישהו כותב על זה בצורה ברורה.',
  'יש לכם מקור לנתונים שהוצגו?',
  'קראתי בעיון, חשוב מאוד.',
  'לא בטוח שאני מסכים, אבל נקודת מבט מעניינת.',
  'תודה, שיתפתי עם המשפחה.',
  'מחכה לעדכון ההמשך.',
  'כתוב מצוין, כל הכבוד לכתבת.',
];

async function seedComments(articles) {
  const now = Date.now();
  const live = articles
    .filter((a) => a.published && a.firstPublishedAt && now - a.firstPublishedAt.getTime() >= MIN_AGE_MS)
    .sort((a, b) => b.firstPublishedAt - a.firstPublishedAt)
    .slice(0, ARTICLES_WITH_COMMENTS);

  const docs = [];
  live.forEach((a, i) => {
    const count = COMMENTS_PER_ARTICLE[i % COMMENTS_PER_ARTICLE.length];
    const start = a.firstPublishedAt.getTime();
    for (let j = 0; j < count; j++) {
      // spread the comments evenly between the publish time and now, oldest first
      const createdAt = new Date(start + ((now - start) * (j + 1)) / (count + 1));
      const n = i + j;
      docs.push({
        article: a._id,
        authorName: NAMES[n % NAMES.length],
        text: TEXTS[(i * 3 + j) % TEXTS.length],
        deviceId: `seed-device-${n % NAMES.length}`, // never matches a real browser, so it does not affect the rate limit
        createdAt,
        updatedAt: createdAt,
      });
    }
  });

  if (docs.length) await Comment.insertMany(docs);
  return { comments: docs.length, articles: live.length };
}

module.exports = { seedComments };
