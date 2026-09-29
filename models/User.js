// Owner: member 2
const mongoose = require('mongoose');
const { ROLES } = require('../config/constants');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true },
  passwordHash: { type: String, required: true }, // bcrypt hash - never store the plain password
  displayName: { type: String, required: true, trim: true },
  role: { type: String, enum: Object.values(ROLES), required: true },
}, { timestamps: true });

// TODO(member 2): helper methods, e.g. userSchema.methods.checkPassword = function (plain) { ... }

module.exports = mongoose.model('User', userSchema);
