// Owner: member 2 - user management. Every route here is editor-only (router.use(requireRole('editor')) in routes/users.js).
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Article = require('../models/Article');
const logger = require('../config/logger');
const { ROLES } = require('../config/constants');
const { httpError } = require('../middleware/errorHandler');

const BCRYPT_ROUNDS = 10;
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/; // checked after lowercasing
const PASSWORD_MIN = 6;
const DISPLAY_NAME_MAX = 50;

// Never send passwordHash to the browser
function toPublic(u) {
  return { _id: u._id, username: u.username, displayName: u.displayName, role: u.role, createdAt: u.createdAt };
}

// Escape regex special characters so a search like "a.b" or "(" is treated as plain text
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Validators: each returns the clean value or throws a 400 error with a Hebrew message
function checkUsername(value) {
  const username = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!USERNAME_RE.test(username)) throw httpError(400, 'שם משתמש: 3-30 תווים, אותיות באנגלית, ספרות, נקודה, מקף או קו תחתון');
  return username;
}
function checkPassword(value) {
  if (typeof value !== 'string' || value.length < PASSWORD_MIN) throw httpError(400, `הסיסמה חייבת להכיל לפחות ${PASSWORD_MIN} תווים`);
  return value;
}
function checkDisplayName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > DISPLAY_NAME_MAX) throw httpError(400, `יש להזין שם תצוגה (עד ${DISPLAY_NAME_MAX} תווים)`);
  return name;
}
function checkRole(value) {
  if (!Object.values(ROLES).includes(value)) throw httpError(400, 'תפקיד לא תקין');
  return value;
}

async function findUserOr404(id) {
  if (!mongoose.isValidObjectId(id)) throw httpError(400, 'מזהה משתמש לא תקין');
  const user = await User.findById(id);
  if (!user) throw httpError(404, 'המשתמש לא נמצא');
  return user;
}

// GET /api/users?q= -> { users: [...] }  search by username or display name
exports.list = async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const filter = {};
    if (q) {
      const re = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ username: re }, { displayName: re }];
    }
    const users = await User.find(filter).sort({ role: 1, username: 1 }).lean();
    res.json({ users: users.map(toPublic) });
  } catch (err) {
    next(err);
  }
};

// POST /api/users  body: { username, password, displayName, role } -> 201 + the new user
exports.create = async (req, res, next) => {
  try {
    const username = checkUsername(req.body.username);
    const password = checkPassword(req.body.password);
    const displayName = checkDisplayName(req.body.displayName);
    const role = checkRole(req.body.role);

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    // A duplicate username fails on the unique index (error 11000) -> errorHandler answers 409
    const user = await User.create({ username, passwordHash, displayName, role });
    logger.info(`User created: ${user.username} (${user.role}) by ${req.user.username}`);
    res.status(201).json(toPublic(user));
  } catch (err) {
    next(err);
  }
};

// PUT /api/users/:id  body: any of { username, password, displayName, role } - only the sent fields change
exports.update = async (req, res, next) => {
  try {
    const user = await findUserOr404(req.params.id);
    const isSelf = user._id.equals(req.user._id);

    if (req.body.username !== undefined) user.username = checkUsername(req.body.username);
    if (req.body.displayName !== undefined) user.displayName = checkDisplayName(req.body.displayName);
    if (req.body.role !== undefined) {
      const role = checkRole(req.body.role);
      // An editor who removes their own editor role would lock themselves (and maybe everyone) out
      if (isSelf && role !== ROLES.EDITOR) throw httpError(400, 'לא ניתן לשנות את התפקיד של המשתמש המחובר');
      user.role = role;
    }
    if (req.body.password !== undefined) {
      user.passwordHash = await bcrypt.hash(checkPassword(req.body.password), BCRYPT_ROUNDS);
    }

    await user.save(); // duplicate username -> 11000 -> 409 in errorHandler
    logger.info(`User updated: ${user.username} by ${req.user.username}`);
    res.json(toPublic(user));
  } catch (err) {
    next(err);
  }
};

// DELETE /api/users/:id -> 204
exports.remove = async (req, res, next) => {
  try {
    const user = await findUserOr404(req.params.id);
    if (user._id.equals(req.user._id)) throw httpError(400, 'לא ניתן למחוק את המשתמש המחובר');
    // Article.author is required - deleting the author would leave articles without a reporter
    if (await Article.exists({ author: user._id })) {
      throw httpError(409, 'לא ניתן למחוק משתמש שיש לו כתבות במערכת');
    }

    await user.deleteOne();
    logger.info(`User deleted: ${user.username} by ${req.user.username}`);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};
