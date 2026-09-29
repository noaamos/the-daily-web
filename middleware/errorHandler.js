// Owner: member 2
const logger = require('../config/logger');

function notFound(req, res) {
  if (req.originalUrl.includes('/api/')) return res.status(404).json({ error: 'לא נמצא' });
  res.status(404).render('error', { title: 'העמוד לא נמצא', message: 'העמוד שחיפשת לא קיים' });
}

// Any error passed to next(err) ends up here - the server never crashes on a bad request
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Invalid ObjectId in the URL, or failed schema validation -> client error
  const isClientError = err.name === 'CastError' || err.name === 'ValidationError';
  const status = err.status || (isClientError ? 400 : 500);
  if (status >= 500) logger.error(`${req.method} ${req.originalUrl} - ${err.stack || err.message}`);

  const message = status >= 500 ? 'אירעה שגיאה בשרת' : err.message;
  if (req.originalUrl.includes('/api/')) return res.status(status).json({ error: message });
  res.status(status).render('error', { title: 'שגיאה', message });
}

module.exports = { notFound, errorHandler };
