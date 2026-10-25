// Permissions are decided ONLY from the server-side session, never from data the browser sends.
const User = require('../models/User');
const logger = require('../config/logger');

const isApi = (req) => req.originalUrl.includes('/api/');

// Runs on every request: loads the logged-in user (if any) into req.user and res.locals.user
async function loadUser(req, res, next) {
  res.locals.user = null;
  if (!req.session.userId) return next();
  try {
    const user = await User.findById(req.session.userId).select('-passwordHash').lean();
    if (!user) delete req.session.userId; // the user was deleted - this session is no longer logged in
    req.user = user || null;
    res.locals.user = req.user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  logger.warn(`Blocked (not logged in): ${req.method} ${req.originalUrl}`);
  if (isApi(req)) return res.status(401).json({ error: 'יש להתחבר למערכת' });
  res.redirect('/auth/login');
}

// Usage in a route file: router.use(requireRole('reporter'))
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return requireLogin(req, res, next);
    if (roles.includes(req.user.role)) return next();
    logger.warn(`Blocked (forbidden): ${req.user.username} (${req.user.role}) -> ${req.method} ${req.originalUrl}`);
    if (isApi(req)) return res.status(403).json({ error: 'אין הרשאה לפעולה זו' });
    res.status(403).render('error', { title: 'אין הרשאה', message: 'אין לך הרשאה לצפות בעמוד זה' });
  };
}

module.exports = { loadUser, requireLogin, requireRole };
