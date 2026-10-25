
const router = require('express').Router();
const c = require('../controllers/commentController');
const commentLimit = require('../middleware/commentLimit');
const { requireRole } = require('../middleware/auth');

router.get('/:articleId', c.list);
router.post('/:articleId', commentLimit, c.create);        // returns the new comment -> client appends it
router.put('/:id', requireRole('editor'), c.update);
router.delete('/:id', requireRole('editor'), c.remove);

module.exports = router;
