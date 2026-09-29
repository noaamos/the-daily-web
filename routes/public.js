// Owner: member 1
const router = require('express').Router();
const c = require('../controllers/publicController');

// Pages (server-rendered EJS)
router.get('/', c.homePage);
router.get('/articles/:id', c.articlePage);

// JSON API (Ajax)
router.get('/api/articles', c.listArticles); // ?page=1&q=&category=&viewed=all|viewed|unviewed&sort=date|popular
router.get('/api/weather', c.weather);

module.exports = router;
