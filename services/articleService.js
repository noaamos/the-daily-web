// Owner: member 3 (used by member 4 too)
// The ONLY place where an article's status is changed. Controllers call transition(), never set status directly.
const { STATUS, ROLES } = require('../config/constants');

// Allowed transitions, exactly as defined in the requirements. Anything else is rejected.
// who: which role may perform it.
const TRANSITIONS = {
  [`${STATUS.DRAFT}->${STATUS.PENDING}`]:     { who: ROLES.REPORTER },
  [`${STATUS.RETURNED}->${STATUS.PENDING}`]:  { who: ROLES.REPORTER },
  [`${STATUS.PENDING}->${STATUS.PUBLISHED}`]: { who: ROLES.EDITOR },
  [`${STATUS.PENDING}->${STATUS.RETURNED}`]:  { who: ROLES.EDITOR },
  // OPEN QUESTION (ask the lecturer): how does a reporter start editing an already-published article?
  // Option we suggest: status stays "published" while the reporter works on `draft`,
  // and submitting moves published -> pending (the public keeps seeing `published` the whole time).
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
  if (!canTransition(article.status, to, user.role)) {
    const err = new Error('מעבר מצב לא מותר');
    err.status = 400;
    throw err;
  }
  // TODO(member 3): reporter may only move their own articles (article.author equals user._id)

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
    // The draft becomes the version the public sees; the publish time is recorded for the Impact Analytics markers
    const now = new Date();
    article.published = article.draft.toObject();
    if (!article.firstPublishedAt) article.firstPublishedAt = now;
    article.lastPublishedAt = now;
    article.publishHistory.push({ at: now, by: user._id });
    article.editorNote = '';
  }

  article.status = to;
  return article.save();
}

module.exports = { TRANSITIONS, canTransition, transition };
