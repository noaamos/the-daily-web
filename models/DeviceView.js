// Owner: member 1
// Which articles a device (anonymous browser) has already opened - powers the "viewed / not viewed" filter.
const mongoose = require('mongoose');

const deviceViewSchema = new mongoose.Schema({
  deviceId: { type: String, required: true },
  article: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true },
}, { timestamps: true });

deviceViewSchema.index({ deviceId: 1, article: 1 }, { unique: true });

module.exports = mongoose.model('DeviceView', deviceViewSchema);
