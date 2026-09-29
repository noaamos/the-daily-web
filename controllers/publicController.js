// Owner: member 1
const todo = require('./todo');
const { CATEGORIES, CATEGORY_LABELS_HE } = require('../config/constants');

exports.homePage = (req, res) => {
  res.render('public/home', { title: 'The Daily Web', categories: CATEGORIES, categoryLabels: CATEGORY_LABELS_HE });
};

// Must render the FULL article in the HTML (SEO) - load it here and pass it to the view, not via Ajax.
// Remember to call viewService.recordView(...) on every visit.
exports.articlePage = todo('articlePage');

// Returns { articles: [...], hasMore: boolean }. Only articles with published != null, fields from `published.*`.
exports.listArticles = todo('listArticles');

exports.weather = todo('weather');
