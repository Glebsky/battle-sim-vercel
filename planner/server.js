#!/usr/bin/env node
// Local web UI for the TSO adventure planner.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { listAdventures, loadAdventure, ADVENTURE_DIR } = require('./engine');
const { plan, buildGenerals, ALL_PLAYER_UNITS, DEFAULT_UNITS } = require('./planner');

const PORT = Number(process.env.PORT || 8787);
const UI_DIR = path.join(__dirname, 'ui');

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, fs.readFileSync(path.join(UI_DIR, 'index.html')), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/app.js') {
      return send(res, 200, fs.readFileSync(path.join(UI_DIR, 'app.js')), 'text/javascript; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/meta') {
      return send(res, 200, {
        adventures: listAdventures(),
        adventureDir: ADVENTURE_DIR,
        allUnits: ALL_PLAYER_UNITS,
        defaultUnits: DEFAULT_UNITS,
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/adventure') {
      const { camps } = loadAdventure(url.searchParams.get('id'));
      return send(res, 200, {
        camps: camps.map((c) => ({
          number: c.number, key: c.key, type: c.type, sector: c.sector,
          units: c.units.map((u) => ({ id: u.id, amount: u.amount })),
        })),
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/generals') {
      const body = await readBody(req);
      const generals = buildGenerals(body.generalsExport).map((g) => ({
        uid: g.uid, name: g.name, base: g.base, capacity: g.capacity, skills: g.skillList,
      }));
      return send(res, 200, { generals, unitValues: body.generalsExport.unitValues || {} });
    }
    if (req.method === 'POST' && url.pathname === '/api/plan') {
      const body = await readBody(req);
      delete require.cache[require.resolve('./planner')];
      delete require.cache[require.resolve('./multi')];
      delete require.cache[require.resolve('./engine')];
      const freshPlanner = require('./planner');
      return send(res, 200, freshPlanner.plan(body));
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: (e && e.message) || String(e) });
  }
});

server.listen(PORT, () => {
  console.log('TSO planner UI: http://localhost:' + PORT);
});
