// Owner: member 2
const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  article: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true },
  authorName: { type: String, required: true, trim: true, maxlength: 50 },
  text: { type: String, required: true, trim: true, maxlength: 1000 },
  deviceId: { type: String, required: true }, // used for the 3-per-minute limit
}, { timestamps: true });

commentSchema.index({ article: 1, createdAt: -1 });
commentSchema.index({ deviceId: 1, createdAt: -1 });

module.exports = mongoose.model('Comment', commentSchema);
