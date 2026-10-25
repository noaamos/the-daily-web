//shared
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
const WEATHER_CACHE_MS = 15 * 60 * 1000; // weather data may be up to 15 minutes old

module.exports = {
  ROLES, STATUS, STATUS_LABELS_HE, CATEGORIES, CATEGORY_LABELS_HE,
  PAGE_SIZE, COMMENT_LIMIT, WEATHER_CACHE_MS,
};
