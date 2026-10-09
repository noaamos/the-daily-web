// Owner: member 2
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES } = require('../config/constants');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true },
  passwordHash: { type: String, required: true }, // bcrypt hash - never store the plain password
  displayName: { type: String, required: true, trim: true },
  role: { type: String, enum: Object.values(ROLES), required: true },
}, { timestamps: true });

// Compares a plain password with the stored bcrypt hash. Returns a Promise<boolean>.
// bcrypt never decrypts the hash: it hashes `plain` again with the same salt and compares the results.
userSchema.methods.checkPassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

module.exports = mongoose.model('User', userSchema);
