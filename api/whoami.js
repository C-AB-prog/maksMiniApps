// /api/whoami.js
exports.config = { runtime: 'nodejs20.x' };

const { getOrCreateUser, sendJSON } = require('./_utils');

module.exports = async (req, res) => {
  const { user, source } = getOrCreateUser(req, res);
  return sendJSON(res, 200, { user, source });
};
