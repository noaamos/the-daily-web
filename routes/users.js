
const router = require('express').Router();
const c = require('../controllers/userController');
const { requireRole } = require('../middleware/auth');

router.use(requireRole('editor'));
router.get('/', c.list);        // ?q= search by username / name
router.post('/', c.create);
router.put('/:id', c.update);
router.delete('/:id', c.remove);

module.exports = router;
