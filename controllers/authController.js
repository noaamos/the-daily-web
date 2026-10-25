// Owner: member 2
const User = require('../models/User');
const logger = require('../config/logger');
const loginThrottle = require('../middleware/loginThrottle');
const { ROLES } = require('../config/constants');

// Where each role lands after logging in
function homeFor(user) {
  return user.role === ROLES.EDITOR ? '/editor' : '/reporter';
}

exports.loginPage = (req, res) => {
  // Already logged in -> no need to see the login form again
  if (req.user) return res.redirect(homeFor(req.user));
  res.render('auth/login', { title: 'התחברות', error: null });
};

exports.login = async (req, res, next) => {
  // String() blocks NoSQL injection: a body like username[$ne]=x would otherwise reach Mongo as an operator
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  // Too many wrong passwords from this address: refuse before even looking at the password
  const wait = loginThrottle.blockedFor(req.ip, username);
  if (wait) {
    logger.warn(`Login blocked (too many wrong passwords) for username "${username}" (ip ${req.ip})`);
    res.set('Retry-After', String(wait));
    return res.status(429).render('auth/login', { title: 'התחברות', error: `יותר מדי ניסיונות התחברות שגויים. נסו שוב בעוד ${Math.ceil(wait / 60)} דקות.` });
  }

  // Same message for "no such user" and "wrong password" - don't reveal which usernames exist
  const failed = () => {
    loginThrottle.recordFailure(req.ip, username);
    logger.warn(`Login failed for username "${username}" (ip ${req.ip})`);
    res.status(401).render('auth/login', { title: 'התחברות', error: 'שם משתמש או סיסמה שגויים' });
  };

  if (!username || !password) return failed();

  try {
    const user = await User.findOne({ username });
    if (!user || !(await user.checkPassword(password))) return failed();

    loginThrottle.recordSuccess(req.ip, username);

    // New session id after login (prevents session fixation), then store only the user id in it
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user._id;
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        logger.info(`Login: ${user.username} (${user.role})`);
        res.redirect(homeFor(user));
      });
    });
  } catch (err) {
    next(err);
  }
};

exports.logout = (req, res, next) => {
  const username = req.user ? req.user.username : null;
  req.session.destroy((err) => {
    if (err) return next(err);
    if (username) logger.info(`Logout: ${username}`);
    res.redirect('/');
  });
};
