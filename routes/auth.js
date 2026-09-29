// Owner: member 2
const router = require('express').Router();
const c = require('../controllers/authController');

router.get('/login', c.loginPage);
router.post('/login', c.login);   // reporter -> /reporter, editor -> /editor
router.post('/logout', c.logout);

module.exports = router;
