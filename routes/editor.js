// Owner: member 4
const router = require('express').Router();
const c = require('../controllers/editorController');
const { requireRole } = require('../middleware/auth');

router.use(requireRole('editor'));

// Pages
router.get('/', c.dashboardPage);
router.get('/articles/:id', c.reviewPage);     // shows published vs. new version side by side
router.get('/analytics', c.analyticsPage);

// JSON API
router.get('/api/articles', c.list);                     // ?status=&page=
router.put('/api/articles/:id/draft', c.editDraft);      // editor edits the submitted content
router.post('/api/articles/:id/approve', c.approve);     // -> published (draft copied to published)
router.post('/api/articles/:id/return', c.returnForFixes); // body: { note }
router.delete('/api/articles/:id', c.remove);            // also delete its comments and stats
router.get('/api/articles/:id/stats', c.stats);          // data for the Impact Analytics chart

module.exports = router;
