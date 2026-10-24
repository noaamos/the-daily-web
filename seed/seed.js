// Owner: member 2
// Starter seed so everyone has data from day one. Run: npm run seed  (DELETES existing data!)
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Article = require('../models/Article');
const Comment = require('../models/Comment');
const ViewStat = require('../models/ViewStat');
const DeviceView = require('../models/DeviceView');
const { STATUS } = require('../config/constants');
const { NEWS } = require('./newsArticles');
const { seedViewStats } = require('./seedViews');
const { seedPendingUpdates } = require('./seedUpdates');
const { seedComments } = require('./seedComments');

const ARTICLE_COUNT = 500;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  await Promise.all([User, Article, Comment, ViewStat, DeviceView].map((m) => m.deleteMany({})));

  const hash = (p) => bcrypt.hash(p, 10);
  const editor = await User.create({ username: 'editor', passwordHash: await hash('editor123'), displayName: 'עורכת ראשית', role: 'editor' });
  const reporters = await User.insertMany([
    { username: 'reporter1', passwordHash: await hash('reporter123'), displayName: 'דנה כהן', role: 'reporter' },
    { username: 'reporter2', passwordHash: await hash('reporter123'), displayName: 'יוסי לוי', role: 'reporter' },
    { username: 'reporter3', passwordHash: await hash('reporter123'), displayName: 'מיכל אברהם', role: 'reporter' },
  ]);

  const statuses = [STATUS.PUBLISHED, STATUS.PUBLISHED, STATUS.PUBLISHED, STATUS.DRAFT, STATUS.PENDING, STATUS.RETURNED];
  const articles = [];
  for (let i = 1; i <= ARTICLE_COUNT; i++) {
    const status = pick(statuses);
    const story = NEWS[(i - 1) % NEWS.length]; // real stories (see newsArticles.js), repeated to fill all the articles
    const content = {
      title: story.title,
      summary: story.summary,
      body: story.body, // plain text, empty line = new paragraph
      imageUrl: `https://picsum.photos/seed/dw${i}/800/450`,
    };
    const publishedAt = daysAgo(Math.floor(Math.random() * 30));
    const isPublished = status === STATUS.PUBLISHED;
    articles.push({
      author: pick(reporters)._id,
      category: story.category,
      status,
      draft: content,
      published: isPublished ? content : null,
      editorNote: status === STATUS.RETURNED ? 'נא לחדד את הכותרת ולהוסיף מקור.' : '',
      firstPublishedAt: isPublished ? publishedAt : null,
      lastPublishedAt: isPublished ? publishedAt : null,
      publishHistory: isPublished ? [{ at: publishedAt, by: editor._id }] : [],
      viewCount: isPublished ? Math.floor(Math.random() * 5000) : 0,
    });
  }
  const inserted = await Article.insertMany(articles);
  await Article.syncIndexes();
  const updatesCount = await seedPendingUpdates(inserted, editor._id); // member 4: pending updates of live articles
  const viewInfo = await seedViewStats(inserted, editor._id); // member 4: hourly views + publish history
  console.log(`Seeded ${updatesCount} pending updates of published articles`);
  console.log(`Seeded views: ${viewInfo.buckets} hourly buckets for ${viewInfo.articles} published articles`);
  const commentInfo = await seedComments(inserted); // member 2: demo comments on the newest live articles
  console.log(`Seeded ${commentInfo.comments} comments on ${commentInfo.articles} published articles`);

  console.log(`Seeded: 1 editor, ${reporters.length} reporters, ${ARTICLE_COUNT} articles`);
  console.log('Logins: editor / editor123, reporter1..3 / reporter123');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
