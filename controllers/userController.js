// Owner: member 2
const todo = require('./todo');

exports.list = todo('users.list');
exports.create = todo('users.create');
exports.update = todo('users.update');
exports.remove = todo('users.remove');
