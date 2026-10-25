// Centralize all article status changes in transition(); controllers never modify status directly.
const { STATUS, ROLES } = require('../config/constants');

// Defines allowed status transitions and the roles permitted to perform them.
// Rejects all other transitions.
const TRANSITIONS = {
  [`${STATUS.DRAFT}->${STATUS.PENDING}`]:     { who: ROLES.REPORTER },
  [`${STATUS.RETURNED}->${STATUS.PENDING}`]:  { who: ROLES.REPORTER },
  [`${STATUS.PENDING}->${STATUS.PUBLISHED}`]: { who: ROLES.EDITOR },
  [`${STATUS.PENDING}->${STATUS.RETURNED}`]:  { who: ROLES.EDITOR },
// Published articles remain visible while draft updates await review.
// Submitting an update moves published -> pending (inferred from requirements).
// The editor can approve the draft as the new published version or return it for changes.
  [`${STATUS.PUBLISHED}->${STATUS.PENDING}`]: { who: ROLES.REPORTER },
};

function canTransition(from, to, role) {
  const rule = TRANSITIONS[`${from}->${to}`];
  return Boolean(rule && rule.who === role);
}

/**
 * Move an article to a new status.
 * @param {Document} article - mongoose Article document
 * @param {string} to        - target status (STATUS.*)
 * @param {object} user      - req.user
 * @param {object} [opts]    - { note } editor note when returning for fixes
 * @returns the saved article. Throws an error with .status = 400/403 if not allowed.
 */
async function transition(article, to, user, opts = {}) {
  // A reporter may only move their own articles. (An editor may move any article, as the table above allows.)
  if (user.role === ROLES.REPORTER && String(article.author) !== String(user._id)) {
    const err = new Error('אין הרשאה לכתבה זו');
    err.status = 403;
    throw err;
  }
  if (!canTransition(article.status, to, user.role)) {
    const err = new Error('מעבר מצב לא מותר');
    err.status = 400;
    throw err;
  }

  if (to === STATUS.RETURNED) {
    const note = typeof opts.note === 'string' ? opts.note.trim() : '';
    if (!note) {
      const err = new Error('חובה לכתוב הערה לכתב');
      err.status = 400;
      throw err;
    }
    article.editorNote = note;
  }

  if (to === STATUS.PUBLISHED) {
// Validate draft content before publishing, regardless of who edited it.
    const missing = [];
    if (!(article.draft.title || '').trim()) missing.push('כותרת');
    if (!(article.draft.body || '').trim()) missing.push('תוכן');
    if (missing.length) {
      const err = new Error(`אי אפשר לפרסם כתבה בלי ${missing.join(' ובלי ')}`);
      err.status = 400;
      throw err;
    }
    // The draft becomes the version the public sees; the publish time is recorded for the Impact Analytics markers
    const now = new Date();
    article.published = article.draft.toObject();
    if (!article.firstPublishedAt) article.firstPublishedAt = now;
    article.lastPublishedAt = now;
    article.publishHistory.push({ at: now, by: user._id });
    article.editorNote = '';
  }

// Recheck status during save to prevent concurrent updates from overwriting changes.
// Return 409 if the status changed since the article was loaded.
  const from = article.status;
  article.$where = { status: from };
  article.status = to;
  try {
    return await article.save();
  } catch (err) {
// DocumentNotFoundError: status filter no longer matches.
// VersionError: Mongoose detects a version conflict when updating publishHistory.
    if (err.name === 'DocumentNotFoundError' || err.name === 'VersionError') {
      const conflict = new Error('מצב הכתבה השתנה, אי אפשר לבצע את הפעולה');
      conflict.status = 409;
      throw conflict;
    }
    throw err;
  }
}

module.exports = { TRANSITIONS, canTransition, transition };
