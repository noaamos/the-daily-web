// Store hourly view counters per article using $inc and upsert.
// Reduces database load compared to storing individual views.
const mongoose = require('mongoose');

const viewStatSchema = new mongoose.Schema({
  article: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true },
  bucket: { type: Date, required: true }, // start of the hour, e.g. 2026-10-05T14:00:00Z
  count: { type: Number, default: 0 },
});

viewStatSchema.index({ article: 1, bucket: 1 }, { unique: true });

module.exports = mongoose.model('ViewStat', viewStatSchema);
