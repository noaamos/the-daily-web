// Owner: member 3
const router = require('express').Router();
const c = require('../controllers/reporterController');
const { requireRole } = require('../middleware/auth');

router.use(requireRole('reporter')); // every route below is reporter-only (checked on the server)

// Pages
router.get('/', c.dashboardPage);
router.get('/articles/:id/edit', c.editPage);

// JSON API
router.get('/api/articles', c.listMine);
router.post('/api/articles', c.create);                 // creates an empty draft, returns { _id }
router.put('/api/articles/:id/draft', c.autosave);      // autosave: called every few seconds while typing
router.post('/api/articles/:id/submit', c.submit);      // -> pending (also published -> pending for an update)
router.post('/api/articles/:id/discard', c.discardChanges); // published article: draft goes back to the published version

module.exports = router;
