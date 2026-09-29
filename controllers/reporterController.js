// Owner: member 3
// Every handler must check that the article belongs to req.user (article.author equals req.user._id).
const todo = require('./todo');

exports.dashboardPage = (req, res) => {
  res.render('reporter/dashboard', { title: 'אזור הכתב' });
};

exports.editPage = todo('reporter.editPage');
exports.listMine = todo('reporter.listMine');
exports.create = todo('reporter.create');
exports.autosave = todo('reporter.autosave');
exports.submit = todo('reporter.submit');
