// Owner: member 4
const todo = require('./todo');

exports.dashboardPage = (req, res) => {
  res.render('editor/dashboard', { title: 'אזור העורך' });
};

exports.reviewPage = todo('editor.reviewPage');
exports.analyticsPage = todo('editor.analyticsPage');
exports.list = todo('editor.list');
exports.editDraft = todo('editor.editDraft');
exports.approve = todo('editor.approve');
exports.returnForFixes = todo('editor.returnForFixes');
exports.remove = todo('editor.remove');
exports.stats = todo('editor.stats');
