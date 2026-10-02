// Owner: member 2
const logger = require('../config/logger');

const isApi = (req) => req.originalUrl.includes('/api/');

// Helper for controllers: throw httpError(404, 'לא נמצא') or next(httpError(...))
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function notFound(req, res) {
  if (isApi(req)) return res.status(404).json({ error: 'לא נמצא' });
  res.status(404).render('error', { title: 'העמוד לא נמצא', message: 'העמוד שחיפשת לא קיים' });
}

// Turns any error into { status, message } with a Hebrew message that is safe to show the user
function describe(err) {
  // Our own errors (httpError, articleService) already have a status and a Hebrew message
  if (err.status && !err.type) return { status: err.status, message: err.message };
  // Broken JSON / body too large - thrown by express.json() before our code runs
  if (err.type) return { status: err.status || 400, message: 'הבקשה שנשלחה אינה תקינה' };
  // Invalid ObjectId in the URL, e.g. /api/comments/123
  if (err.name === 'CastError') return { status: 400, message: 'מזהה לא תקין' };
  // Failed Mongoose schema validation (required, maxlength, enum...)
  if (err.name === 'ValidationError') return { status: 400, message: 'הנתונים שנשלחו אינם תקינים' };
  // Unique index violation, e.g. two users with the same username
  if (err.code === 11000) {
    const isUsername = err.keyValue && 'username' in err.keyValue;
    return { status: 409, message: isUsername ? 'שם המשתמש כבר קיים במערכת' : 'הרשומה כבר קיימת' };
  }
  return { status: 500, message: 'אירעה שגיאה בשרת' };
}

// Any error passed to next(err) ends up here - the server never crashes on a bad request
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const { status, message } = describe(err);

  if (status >= 500) logger.error(`${req.method} ${req.originalUrl} - ${err.stack || err.message}`);
  else logger.warn(`${req.method} ${req.originalUrl} - ${status} ${message}`);

  if (res.headersSent) return; // response already started - nothing more we can send
  if (isApi(req)) return res.status(status).json({ error: message });
  res.status(status).render('error', { title: 'שגיאה', message });
}

module.exports = { notFound, errorHandler, httpError };
