// Owner: member 2
// Demo reader comments for published articles. The texts are deliberately generic (no claims about any story),
// because the same news stories repeat across the seeded articles.
// Called from seed.js with the inserted articles.
const Comment = require('../models/Comment');

const COMMENTED_SHARE = 0.45; // about this share of the published articles has comments
const MAX_PER_ARTICLE = 5;

const NAMES = ['נועה', 'אורי', 'מיכל ל.', 'דניאל', 'שירה', 'עומר', 'תמר', 'יובל', 'רוני כהן', 'אילת', 'גיא', 'הדס'];
const TEXTS = [
  'תודה על הסיכום, קצר וברור.',
  'מעניין לראות איך זה יתפתח בימים הקרובים.',
  'כתבה טובה, חבל שאין קצת יותר פרטים.',
  'לא ידעתי על זה, תודה שפרסמתם.',
  'אשמח לכתבת המשך בנושא.',
  'סוף סוף מישהו מסביר את זה בצורה פשוטה.',
  'צריך לראות מה יקרה בפועל, בינתיים רק הצהרות.',
  'שווה לעקוב אחרי הנושא הזה.',
  'מקווה שנקבל עדכון כשיהיו חדשות נוספות.',
  'כתבה מאוזנת, יישר כוח.',
  'מה דעתכם? לי זה נראה חשוב יותר ממה שנדמה.',
  'שיתפתי עם החברים, תודה.',
  'הייתי שמח לראות גם את הרקע לסיפור.',
  'ידיעה חשובה, תודה על העדכון המהיר.',
  'האם יש מקור לנתונים האלה?',
  'קצר ולעניין, בדיוק כמו שצריך.',
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function seedComments(articles) {
  const now = Date.now();
  const docs = [];
  let device = 0;

  for (const a of articles) {
    if (!a.published || Math.random() > COMMENTED_SHARE) continue;
    const from = a.firstPublishedAt.getTime();
    const count = 1 + Math.floor(Math.random() * MAX_PER_ARTICLE);
    for (let i = 0; i < count; i++) {
      const at = new Date(from + Math.random() * Math.max(0, now - from)); // between publishing and now, never in the future
      docs.push({
        article: a._id,
        authorName: pick(NAMES),
        text: pick(TEXTS),
        deviceId: `seed-device-${device++ % 40}`,
        createdAt: at,
        updatedAt: at,
      });
    }
  }
  await Comment.insertMany(docs);
  return docs.length;
}

module.exports = { seedComments };
