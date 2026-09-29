// Owner: member 2
const todo = require('./todo');

exports.list = todo('comments.list');
exports.create = todo('comments.create');
exports.update = todo('comments.update');
exports.remove = todo('comments.remove');
