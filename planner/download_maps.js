#!/usr/bin/env node
// Batch downloader for all TSO adventure map images from tsowiki.eu
const fs = require('fs');
const path = require('path');
const https = require('https');

const ADVENTURE_DIR = path.join(__dirname, '..', 'adventures');
const MAPS_DIR = path.join(__dirname, '..', 'maps');
if (!fs.existsSync(MAPS_DIR)) fs.mkdirSync(MAPS_DIR, { recursive: true });

const CANDIDATE_FOLDERS = ['maps2400', 'maps1600', 'maps1200', 'maps', 'maps800', 'maps3200'];

function getUniqueMapKeys() {
  const mapKeys = new Map();
  for (const f of fs.readdirSync(ADVENTURE_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(ADVENTURE_DIR, f), 'utf8'));
      if (d.map && d.map.key) {
        const k = d.map.key;
        if (!mapKeys.has(k)) mapKeys.set(k, []);
        mapKeys.get(k).push(d.id || f.replace('.json', ''));
      }
    } catch (e) {}
  }
  return mapKeys;
}

function downloadSingleMap(key) {
  return new Promise((resolve) => {
    const dest = path.join(MAPS_DIR, `${key}.webp`);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      return resolve({ status: 'cached', size: fs.statSync(dest).size });
    }

    let folderIndex = 0;
    function tryFolder() {
      if (folderIndex >= CANDIDATE_FOLDERS.length) {
        return resolve({ status: 'failed', error: 'Not found in any resolution folder' });
      }
      const folder = CANDIDATE_FOLDERS[folderIndex++];
      const url = `https://tsowiki.eu/images/${folder}/${key}.webp`;

      const req = https.get(url, {
        headers: {
          'Referer': 'https://tsowiki.eu/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
      }, (res) => {
        if (res.statusCode === 200) {
          const ws = fs.createWriteStream(dest);
          res.pipe(ws);
          ws.on('finish', () => {
            const size = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
            resolve({ status: 'downloaded', folder, size });
          });
          ws.on('error', (err) => {
            try { fs.unlinkSync(dest); } catch (e) {}
            resolve({ status: 'failed', error: err.message });
          });
        } else {
          res.resume();
          tryFolder();
        }
      });
      req.on('error', () => tryFolder());
    }

    tryFolder();
  });
}

async function runQueue(items, concurrency, fn) {
  let index = 0;
  const results = [];
  const workers = Array.from({ length: concurrency }, async () => {
    while (index < items.length) {
      const curIndex = index++;
      const item = items[curIndex];
      const res = await fn(item, curIndex, items.length);
      results[curIndex] = res;
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  const mapKeysMap = getUniqueMapKeys();
  const keys = [...mapKeysMap.keys()].sort();
  console.log(`[Map Downloader] Found ${keys.length} unique map keys across all adventure maps.`);
  console.log(`[Map Downloader] Destination: ${MAPS_DIR}\n`);

  let downloadedCount = 0;
  let cachedCount = 0;
  let failedCount = 0;
  let totalBytes = 0;

  await runQueue(keys, 4, async (key, idx, total) => {
    const num = `[${String(idx + 1).padStart(3, ' ')}/${total}]`;
    const res = await downloadSingleMap(key);
    if (res.status === 'cached') {
      cachedCount++;
      totalBytes += res.size;
      console.log(`${num} ✓ CACHED:     ${key} (${(res.size / 1024).toFixed(1)} KB)`);
    } else if (res.status === 'downloaded') {
      downloadedCount++;
      totalBytes += res.size;
      console.log(`${num} ↓ DOWNLOADED: ${key} from ${res.folder} (${(res.size / 1024).toFixed(1)} KB)`);
    } else {
      failedCount++;
      console.error(`${num} ✗ FAILED:     ${key} — ${res.error}`);
    }
    return res;
  });

  console.log('\n========================================');
  console.log(`Done! Summary:`);
  console.log(`  Downloaded new: ${downloadedCount}`);
  console.log(`  Already cached: ${cachedCount}`);
  console.log(`  Failed:         ${failedCount}`);
  console.log(`  Total size:     ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log('========================================\n');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { downloadSingleMap, getUniqueMapKeys };
