// Shared constants for the server and client
const ROLES = { REPORTER: 'reporter', EDITOR: 'editor' };

const STATUS = {
  DRAFT: 'draft',         // "בהכנה"
  PENDING: 'pending',     // "ממתינה לאישור עורך"
  PUBLISHED: 'published', // "פורסמה"
  RETURNED: 'returned',   // "הוחזרה לתיקונים"
};

const STATUS_LABELS_HE = {
  draft: 'בהכנה',
  pending: 'ממתינה לאישור עורך',
  published: 'פורסמה',
  returned: 'הוחזרה לתיקונים',
};

const CATEGORIES = ['politics', 'economy', 'sports', 'tech', 'culture', 'health'];

const CATEGORY_LABELS_HE = {
  politics: 'פוליטיקה',
  economy: 'כלכלה',
  sports: 'ספורט',
  tech: 'טכנולוגיה',
  culture: 'תרבות',
  health: 'בריאות',
};

const PAGE_SIZE = 20; // articles per infinite-scroll load
const COMMENT_LIMIT = { max: 3, windowMs: 60 * 1000 }; // guest: 3 comments per minute per device
const LOGIN_LIMIT = { maxPerAccount: 5, maxPerIp: 50, windowMs: 10 * 60 * 1000 }; // wrong passwords per 10 minutes, see middleware/loginThrottle.js
const WEATHER_MAX_AGE_MS = 15 * 60 * 1000; // the requirement: weather shown to users is never older than this
const WEATHER_CACHE_MS = 5 * 60 * 1000;    // the server refreshes it this often (and the page asks this often), so the age on screen stays well under the limit

module.exports = {
  ROLES, STATUS, STATUS_LABELS_HE, CATEGORIES, CATEGORY_LABELS_HE,
  PAGE_SIZE, COMMENT_LIMIT, LOGIN_LIMIT, WEATHER_MAX_AGE_MS, WEATHER_CACHE_MS,
};
