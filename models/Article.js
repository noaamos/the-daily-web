// SHARED MODEL - agreed by the whole team. Open a small separate PR for any change.
//
// Key idea: an article holds two versions of its content.
//   - `published`: what the public sees. null until the first approval.
//   - `draft`:     what the reporter is working on (autosaved). Copied into `published` when an editor approves.
// So the public site always queries `published != null` and reads from `published.*`,
// no matter what the current `status` is. This is what keeps the old version visible while an update is in review.
const mongoose = require('mongoose');
const { STATUS, CATEGORIES } = require('../config/constants');

const contentSchema = new mongoose.Schema({
  title: { type: String, trim: true, default: '' },
  summary: { type: String, trim: true, default: '' },
  body: { type: String, default: '' },
  imageUrl: { type: String, trim: true, default: '' },
}, { _id: false });

const articleSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  category: { type: String, enum: CATEGORIES, required: true },
  status: { type: String, enum: Object.values(STATUS), default: STATUS.DRAFT },

  draft: { type: contentSchema, default: () => ({}) },
  published: { type: contentSchema, default: null },

  editorNote: { type: String, default: '' },   // shown to the reporter when status = returned
  firstPublishedAt: { type: Date, default: null }, // "תאריך פרסום" shown on the site
  lastPublishedAt: { type: Date, default: null },

  // One entry per editor approval - used for the markers on the Impact Analytics chart
  publishHistory: [{
    at: { type: Date, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    _id: false,
  }],

  viewCount: { type: Number, default: 0 },     // total views, used for "sort by popularity"
  draftSavedAt: { type: Date, default: null }, // last autosave
}, { timestamps: true });

// Indexes - needed so the site stays fast with thousands of articles
articleSchema.index({ firstPublishedAt: -1 });
articleSchema.index({ category: 1, firstPublishedAt: -1 });
articleSchema.index({ viewCount: -1 });
articleSchema.index({ author: 1, updatedAt: -1 });
articleSchema.index({ status: 1, updatedAt: -1 });
articleSchema.index({ 'published.title': 'text' });

module.exports = mongoose.model('Article', articleSchema);
