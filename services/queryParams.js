// Reading and checking values that arrive in the query string (?page=2&q=...). Used by the public feed, the reporter
// list, the editor list and the user list, so that all of them accept and refuse the same things.
// Every function either returns a clean value or throws a 400 error with a Hebrew message (see errorHandler).
const { httpError } = require('../middleware/errorHandler');

const MAX_PAGE = 100000; // 2 million articles at 20 per page: far more than this system will ever hold

// Page number: only digits, 1 or more. Rejects "abc", "0", "-3", "1.5", "1e20", " 2", "0x10" and arrays (?page=1&page=2).
function parsePage(value) {
  if (value === undefined) return 1;
  if (typeof value !== 'string' || !/^[1-9]\d{0,5}$/.test(value) || Number(value) > MAX_PAGE) throw httpError(400, 'מספר עמוד לא תקין');
  return Number(value);
}

// Search text: a string without control characters (a null character in a regular expression makes MongoDB fail),
// trimmed and not longer than `max`. Missing = empty search.
function parseSearchText(value, max) {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw httpError(400, 'טקסט החיפוש אינו תקין');
  if (/[\u0000-\u001f\u007f]/.test(value)) throw httpError(400, 'טקסט החיפוש מכיל תווים לא חוקיים');
  const text = value.trim();
  if (text.length > max) throw httpError(400, 'טקסט החיפוש ארוך מדי');
  return text;
}

// Escape characters that have a special meaning in a regex, so searching "C++" or "(" can't break the query
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { parsePage, parseSearchText, escapeRegex, MAX_PAGE };
