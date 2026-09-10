#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'planner', 'ui');
const DEST_DIR = path.join(ROOT_DIR, 'public');

console.log('[Build] Synchronizing frontend assets...');
console.log(`  Source:      ${SRC_DIR}`);
console.log(`  Destination: ${DEST_DIR}`);

if (!fs.existsSync(SRC_DIR)) {
  console.error(`[Build] ERROR: Source directory not found: ${SRC_DIR}`);
  process.exit(1);
}

if (!fs.existsSync(DEST_DIR)) {
  fs.mkdirSync(DEST_DIR, { recursive: true });
}

// Recursively copy directory contents
function copyRecursive(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }
      copyRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

try {
  copyRecursive(SRC_DIR, DEST_DIR);
  console.log('[Build] ✓ Frontend assets synchronized successfully to public/');
} catch (err) {
  console.error('[Build] ERROR while copying assets:', err);
  process.exit(1);
}
