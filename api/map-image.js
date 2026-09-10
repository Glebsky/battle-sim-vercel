const fs = require('fs');
const path = require('path');
const https = require('https');
const { sendJson, withErrors } = require('./_shared');

const MAPS_DIR = path.join(__dirname, '..', 'maps');
const MAP_FOLDERS = ['maps2400', 'maps1600', 'maps1200', 'maps', 'maps800', 'maps3200'];

function fetchRemoteMap(key) {
  return new Promise((resolve) => {
    let index = 0;
    function tryNext() {
      if (index >= MAP_FOLDERS.length) return resolve(null);
      const folder = MAP_FOLDERS[index++];
      const remoteUrl = `https://tsowiki.eu/images/${folder}/${key}.webp`;
      const req = https.get(
        remoteUrl,
        {
          headers: {
            Referer: 'https://tsowiki.eu/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          },
        },
        (res) => {
          if (res.statusCode === 200) {
            resolve({ res, folder });
          } else {
            res.resume();
            tryNext();
          }
        }
      );
      req.on('error', () => tryNext());
    }
    tryNext();
  });
}

module.exports = withErrors(async (req, res) => {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
  const url = new URL(req.url, 'http://localhost');
  const key = (url.searchParams.get('key') || '').trim();

  if (!key || !/^[a-zA-Z0-9_-]+$/.test(key)) {
    return sendJson(res, 400, { error: 'Invalid map key' });
  }

  // 1. Check local maps directory if bundled
  const localFile = path.join(MAPS_DIR, `${key}.webp`);
  if (fs.existsSync(localFile) && fs.statSync(localFile).size > 0) {
    res.writeHead(200, {
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    return fs.createReadStream(localFile).pipe(res);
  }

  // 2. Fetch remotely from tsowiki.eu if not available locally
  const remote = await fetchRemoteMap(key);
  if (!remote) {
    return sendJson(res, 404, { error: 'Map image not found' });
  }

  res.writeHead(200, {
    'Content-Type': 'image/webp',
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  remote.res.pipe(res);
});
