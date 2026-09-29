// Owner: member 2
exports.loginPage = (req, res) => {
  res.render('auth/login', { title: 'התחברות', error: null });
};

// TODO(member 2): find user, bcrypt.compare, then req.session.userId = user._id and redirect by role.
// On failure re-render the login page with an error (don't reveal whether the username exists).
exports.login = (req, res) => {
  res.status(501).render('auth/login', { title: 'התחברות', error: 'ההתחברות עוד לא מומשה' });
};

exports.logout = (req, res, next) => {
  req.session.destroy((err) => (err ? next(err) : res.redirect('/')));
};
