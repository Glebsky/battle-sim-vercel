const { sendJson, readBody, withErrors } = require('./_shared');
const planner = require('../planner/planner');

// No hot-reload here: on Vercel every cold start already loads fresh modules,
// and clearing require.cache would re-init the WASM engine on every request.
module.exports = withErrors(async (req, res) => {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
  const body = await readBody(req);
  sendJson(res, 200, planner.plan(body));
});
