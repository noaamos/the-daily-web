const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES } = require('../config/constants');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true },
  passwordHash: { type: String, required: true }, // bcrypt hash - never store the plain password
  displayName: { type: String, required: true, trim: true },
  role: { type: String, enum: Object.values(ROLES), required: true },
}, { timestamps: true });

// Verifies a plain password against its bcrypt hash without decrypting it.
// Returns Promise<boolean>.
userSchema.methods.checkPassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

module.exports = mongoose.model('User', userSchema);
