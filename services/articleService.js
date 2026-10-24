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
  // Editing an already-published article. The requirements do not define a transition out of "published", so this
  // one is OUR proposal (to be confirmed by the lecturer): the status stays "published" while the reporter works on
  // `draft`, and submitting the update moves published -> pending. The public keeps seeing `published` the whole time;
  // the editor approves or returns it like any other pending article (the draft is copied to `published` on approval).
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
    // The draft becomes the version the public sees; the publish time is recorded for the Impact Analytics markers
    const now = new Date();
    article.published = article.draft.toObject();
    if (!article.firstPublishedAt) article.firstPublishedAt = now;
    article.lastPublishedAt = now;
    article.publishHistory.push({ at: now, by: user._id });
    article.editorNote = '';
  }

  // The status is checked again inside the save itself (same idea as the conditional update of autosave/discard):
  // if another request moved the article after we loaded it (e.g. two submits at the same moment, or "cancel changes"
  // and "submit"), nothing is written and the caller gets a 409 instead of silently overwriting the newer status.
  const from = article.status;
  article.$where = { status: from };
  article.status = to;
  try {
    return await article.save();
  } catch (err) {
    // DocumentNotFoundError: the status filter did not match. VersionError: the same, reported by mongoose
    // when the save also modifies an array (publishHistory) and so adds the version check.
    if (err.name === 'DocumentNotFoundError' || err.name === 'VersionError') {
      const conflict = new Error('מצב הכתבה השתנה, אי אפשר לבצע את הפעולה');
      conflict.status = 409;
      throw conflict;
    }
    throw err;
  }
}

module.exports = { TRANSITIONS, canTransition, transition };
