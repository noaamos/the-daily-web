// Owner: member 2
// Permissions are decided ONLY from the server-side session, never from data the browser sends.
const User = require('../models/User');

// Runs on every request: loads the logged-in user (if any) into req.user and res.locals.user
async function loadUser(req, res, next) {
  res.locals.user = null;
  if (!req.session.userId) return next();
  try {
    const user = await User.findById(req.session.userId).select('-passwordHash').lean();
    req.user = user || null;
    res.locals.user = req.user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  if (req.originalUrl.includes('/api/')) return res.status(401).json({ error: 'יש להתחבר למערכת' });
  res.redirect('/auth/login');
}

// Usage in a route file: router.use(requireRole('reporter'))
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return requireLogin(req, res, next);
    if (roles.includes(req.user.role)) return next();
    if (req.originalUrl.includes('/api/')) return res.status(403).json({ error: 'אין הרשאה לפעולה זו' });
    res.status(403).render('error', { title: 'אין הרשאה', message: 'אין לך הרשאה לצפות בעמוד זה' });
  };
}

module.exports = { loadUser, requireLogin, requireRole };
