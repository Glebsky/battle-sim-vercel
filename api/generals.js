const { sendJson, readBody, withErrors } = require('./_shared');
const { buildGenerals } = require('../planner/planner');

module.exports = withErrors(async (req, res) => {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
  const body = await readBody(req);
  const generals = buildGenerals(body.generalsExport).map((g) => ({
    uid: g.uid, name: g.name, base: g.base, capacity: g.capacity, skills: g.skillList,
  }));
  sendJson(res, 200, { generals, unitValues: (body.generalsExport && body.generalsExport.unitValues) || {} });
});
