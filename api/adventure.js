const { sendJson, withErrors } = require('./_shared');
const { loadAdventure } = require('../planner/engine');

module.exports = withErrors(async (req, res) => {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
  const url = new URL(req.url, 'http://localhost');
  const { data, camps } = loadAdventure(url.searchParams.get('id'));
  sendJson(res, 200, {
    map: data.map || null,
    camps: camps.map((c) => ({
      number: c.number,
      key: c.key,
      type: c.type,
      sector: c.sector,
      position: (data && data.camps && data.camps[c.key] && data.camps[c.key].position) || null,
      units: c.units.map((u) => ({ id: u.id, amount: u.amount })),
    })),
  });
});
