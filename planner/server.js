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

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    // API endpoints
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
    if (req.method === 'GET') {
      let reqPath = decodeURIComponent(url.pathname);
      if (reqPath === '/' || !reqPath) reqPath = '/index.html';
      const cleanPath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
      const localFile = path.join(UI_DIR, cleanPath);
      if (localFile.startsWith(UI_DIR) && fs.existsSync(localFile) && fs.statSync(localFile).isFile()) {
        const ext = path.extname(localFile).toLowerCase();
        const mime = MIME_TYPES[ext] || 'application/octet-stream';
        return send(res, 200, fs.readFileSync(localFile), mime);
      }
    }

    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: (e && e.message) || String(e) });
  }
});

server.listen(PORT, () => {
  console.log('TSO planner UI: http://localhost:' + PORT);
});
