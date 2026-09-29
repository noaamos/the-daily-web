// Owner: member 4
// Views are NOT stored one document per view (thousands of readers would flood the DB).
// Instead each document is a counter for one article in one hour ("bucket"), updated with $inc + upsert.
// The chart then reads a few dozen small documents per article.
const mongoose = require('mongoose');

const viewStatSchema = new mongoose.Schema({
  article: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true },
  bucket: { type: Date, required: true }, // start of the hour, e.g. 2026-10-05T14:00:00Z
  count: { type: Number, default: 0 },
});

viewStatSchema.index({ article: 1, bucket: 1 }, { unique: true });

module.exports = mongoose.model('ViewStat', viewStatSchema);
