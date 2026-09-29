// Owner: member 4
// Called from the public article page (member 1) on every visit.
// eslint-disable-next-line no-unused-vars
async function recordView(articleId, deviceId) {
  // TODO(member 4):
  //  - ViewStat.updateOne({ article, bucket: start of current hour }, { $inc: { count: 1 } }, { upsert: true })
  //  - Article.updateOne({ _id }, { $inc: { viewCount: 1 } })
  //  - (member 1 may also record DeviceView for the viewed/not-viewed filter)
}

// Returns data for the Impact Analytics chart: { buckets: [{ t, count }], publishes: [Date] }
// eslint-disable-next-line no-unused-vars
async function getArticleStats(articleId) {
  // TODO(member 4)
  return { buckets: [], publishes: [] };
}

module.exports = { recordView, getArticleStats };
