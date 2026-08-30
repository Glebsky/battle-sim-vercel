const { sendJson, withErrors } = require('./_shared');
const { listAdventures, ADVENTURE_DIR } = require('../planner/engine');
const { ALL_PLAYER_UNITS, DEFAULT_UNITS } = require('../planner/planner');

module.exports = withErrors(async (req, res) => {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
  sendJson(res, 200, {
    adventures: listAdventures(),
    adventureDir: ADVENTURE_DIR,
    allUnits: ALL_PLAYER_UNITS,
    defaultUnits: DEFAULT_UNITS,
  });
});
