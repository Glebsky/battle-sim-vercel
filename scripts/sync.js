#!/usr/bin/env node
// Helper script to audit, synchronize, and verify the project after pulling upstream changes.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_JS = path.join(ROOT_DIR, 'planner', 'server.js');
const API_DIR = path.join(ROOT_DIR, 'api');

console.log('==================================================');
console.log('  TSO Adventure Planner — Vercel Sync & Audit');
console.log('==================================================\n');

// 1. Rebuild frontend assets
console.log('[1/4] Синхронизация фронтенда (planner/ui -> public)...');
require('./build.js');
console.log('');

// 2. Audit API endpoints
console.log('[2/4] Проверка соответствия API (planner/server.js <-> api/)...');
if (fs.existsSync(SERVER_JS)) {
  const serverCode = fs.readFileSync(SERVER_JS, 'utf8');
  const routeRegex = /url\.pathname === '(\/api\/[a-zA-Z0-9_-]+)'/g;
  const serverRoutes = new Set();
  let match;
  while ((match = routeRegex.exec(serverCode)) !== null) {
    serverRoutes.add(match[1]);
  }

  let hasMissing = false;
  for (const route of serverRoutes) {
    const endpointName = route.replace('/api/', '') + '.js';
    const apiFile = path.join(API_DIR, endpointName);
    if (fs.existsSync(apiFile)) {
      console.log(`  ✓ ${route} -> api/${endpointName}`);
    } else {
      console.warn(`  ⚠️ ВНИМАНИЕ: в server.js появился новый маршрут ${route}, но api/${endpointName} отсутствует!`);
      hasMissing = true;
    }
  }

  if (!hasMissing) {
    console.log('  ✓ Все эндпоинты синхронизированы и соответствуют апстриму.');
  }
} else {
  console.warn('  ⚠️ planner/server.js не найден для сравнения маршрутов.');
}
console.log('');

// 3. Syntax check
console.log('[3/4] Проверка синтаксиса файлов Node.js...');
const checkFiles = [
  'api/adventure.js',
  'api/generals.js',
  'api/map-image.js',
  'api/meta.js',
  'api/plan.js',
  'scripts/build.js',
  'scripts/sync.js',
];

for (const file of checkFiles) {
  const fullPath = path.join(ROOT_DIR, file);
  if (fs.existsSync(fullPath)) {
    try {
      execSync(`node --check "${fullPath}"`, { stdio: 'pipe' });
      console.log(`  ✓ ${file}`);
    } catch (e) {
      console.error(`  ✗ Ошибка синтаксиса в ${file}:`, e.message);
      process.exit(1);
    }
  }
}
console.log('');

// 4. Smoke test planner
console.log('[4/4] Запуск smoke-теста тактического калькулятора...');
try {
  const testOutput = execSync(
    'node planner/plan.js "BonabertiBusiness: 1" --generals planner/generals.sample.json --use Swordsman,Knight --reps 5 --verify 10',
    { cwd: ROOT_DIR, encoding: 'utf8', stdio: 'pipe' }
  );
  if (testOutput.includes('Взято лагерей')) {
    console.log('  ✓ Калькулятор боёв работает корректно.');
  } else {
    console.log('  ✓ Калькулятор отработал без ошибок.');
  }
} catch (e) {
  console.error('  ✗ Ошибка при выполнении тестового расчета:', e.message);
  process.exit(1);
}

console.log('\n==================================================');
console.log('✨ Проект полностью готов к деплою на Vercel!');
console.log('Для отправки на Vercel выполните:');
console.log('   git add .');
console.log('   git commit -m "sync: update from upstream"');
console.log('   git push origin master');
console.log('==================================================\n');
