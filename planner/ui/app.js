(() => {
const {
  t,
  tUnit,
  tCampType,
  tRole,
  tReason,
  setLanguage,
  onLanguageChange,
  updatePageTranslations,
  updateLanguageSwitcherUI,
} = window.I18N_ENGINE || {
  t: (k, params = {}) => {
    let s = k;
    for (const [p, v] of Object.entries(params)) s = s.replaceAll(`{${p}}`, v);
    return s;
  },
  tUnit: (u) => u,
  tCampType: (tp) => tp,
  tRole: (r) => r,
  tReason: (rs) => rs,
  setLanguage: () => {},
  onLanguageChange: () => {},
  updatePageTranslations: () => {},
  updateLanguageSwitcherUI: () => {},
};

const S = {
  get(k, d) {
    try {
      const v = localStorage.getItem('tsoplan.' + k);
      return v === null ? d : JSON.parse(v);
    } catch (e) {
      return d;
    }
  },
  set(k, v) {
    localStorage.setItem('tsoplan.' + k, JSON.stringify(v));
  },
};

let META = { adventures: [], allUnits: [], defaultUnits: [] };
let GENERALS = [];
let UNIT_VALUES = {};
let QUEUE = [];
let LAST_PLAN_RESULT = null;
let CALC_TIMER = null;

// Settings state
let SETTINGS = {
  genUsage: 'min',
  lossAcc: 'max',
  sacrifice: 'cheap',
};

const $ = (id) => document.getElementById(id);

function getUnitIconUrl(unitId) {
  if (typeof UNIT_ICONS !== 'undefined' && UNIT_ICONS[unitId]) {
    return UNIT_ICONS[unitId];
  }
  return null;
}

function renderUnitIcon(unitId, extraClass = '') {
  const icon = getUnitIconUrl(unitId);
  const name = tUnit(unitId);
  if (!icon) return '';
  return `<img src="${icon}" class="unit-icon ${extraClass}" alt="${name}" data-tooltip="${name}" loading="lazy">`;
}

function renderUnitChip(unitId, count) {
  const icon = getUnitIconUrl(unitId);
  const name = tUnit(unitId);
  const countStr = count !== undefined ? `<span class="unit-count">${count}</span>` : '';
  if (!icon) {
    return `<span class="unit-chip" data-tooltip="${name}">${count ? count + ' ' : ''}${name}</span>`;
  }
  return `<span class="unit-chip" data-tooltip="${name}"><img src="${icon}" class="unit-icon" alt="${name}" loading="lazy">${countStr}</span>`;
}

function renderUnitLossChip(unitId, lostCount) {
  const icon = getUnitIconUrl(unitId);
  const name = tUnit(unitId);
  const lostStr = `−${fmt(lostCount)}`;
  if (!icon) {
    return `<span class="unit-chip loss" data-tooltip="${name}">${name} ${lostStr}</span>`;
  }
  return `<span class="unit-chip loss" data-tooltip="${name}"><img src="${icon}" class="unit-icon" alt="${name}" loading="lazy"><span class="unit-count">${lostStr}</span></span>`;
}

function initTooltips() {
  let tooltip = $('appTooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'appTooltip';
    tooltip.className = 'app-tooltip';
    document.body.appendChild(tooltip);
  }

  let activeTarget = null;

  function positionTooltip(target) {
    const rect = target.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    let top = rect.top - tipRect.height - 6;
    let left = rect.left + (rect.width - tipRect.width) / 2;

    if (top < 6) {
      top = rect.bottom + 6;
    }
    if (left < 6) left = 6;
    if (left + tipRect.width > window.innerWidth - 6) {
      left = window.innerWidth - tipRect.width - 6;
    }

    tooltip.style.top = `${Math.round(top)}px`;
    tooltip.style.left = `${Math.round(left)}px`;
  }

  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (!target) return;
    activeTarget = target;
    const text = target.getAttribute('data-tooltip');
    if (!text) return;
    tooltip.textContent = text;
    tooltip.classList.add('visible');
    positionTooltip(target);
  });

  document.addEventListener('mouseout', (e) => {
    if (!activeTarget) return;
    const related = e.relatedTarget;
    if (!related || !activeTarget.contains(related)) {
      tooltip.classList.remove('visible');
      activeTarget = null;
    }
  });

  window.addEventListener('scroll', () => {
    if (activeTarget && tooltip.classList.contains('visible')) {
      positionTooltip(activeTarget);
    }
  }, true);
}

async function loadMeta() {
  META = await (await fetch('/api/meta')).json();
  const prev = $('adv').value || S.get('adventure', null);
  updateAdventureSelect(prev);
  updateDockSummary();
}

function matchesAdventure(advId, query) {
  if (!query) return true;
  const q = query.toLowerCase().trim();
  if (!q) return true;
  const idLower = advId.toLowerCase();
  if (idLower.includes(q)) return true;
  const normId = idLower.replace(/[_\-]+/g, ' ');
  const normQ = q.replace(/[_\-]+/g, ' ');
  if (normId.includes(normQ)) return true;
  const terms = normQ.split(/\s+/).filter(Boolean);
  return terms.length > 0 && terms.every((term) => normId.includes(term) || idLower.includes(term));
}

function updateAdventureSelect(selectedId = null, query = null) {
  if (!META || !META.adventures) return;
  const q = query !== null ? query : ($('advSearch') ? $('advSearch').value : '');
  const filtered = META.adventures.filter((a) => matchesAdventure(a.id, q));
  const prev = selectedId || ($('adv') ? $('adv').value : null) || S.get('adventure', null);

  if (filtered.length === 0) {
    $('adv').innerHTML = `<option value="" disabled selected>${t('pane.camps.notFound')}</option>`;
    return;
  }

  $('adv').innerHTML = filtered
    .map((a) => `<option value="${a.id}">${a.id} (${t('camp.suffix', { camps: a.camps })})</option>`)
    .join('');

  const filteredIds = filtered.map((a) => a.id);
  const nextVal = filteredIds.includes(prev) ? prev : (filteredIds[0] || '');
  const changed = $('adv').value !== nextVal;
  $('adv').value = nextVal;

  if (changed) {
    S.set('adventure', nextVal);
    updateDockSummary();
    loadAdventureInfo();
  }
}

function filterAdventures(query) {
  updateAdventureSelect(null, query);
}

function updateDockSummary() {
  const adv = $('adv') ? $('adv').value : '—';
  if ($('dockAdvLabel')) $('dockAdvLabel').textContent = adv;
  if ($('mobileAdventureName')) $('mobileAdventureName').textContent = adv;
}

async function init() {
  await loadMeta();
  initTooltips();
  $('camps').value = S.get('camps', '');
  $('step').value = S.get('step', 10);
  $('reps').value = S.get('reps', 60);
  $('verify').value = S.get('verify', 400);
  $('maxGen').value = S.get('maxGen', 0);
  $('beam').value = S.get('beam', 5);
  $('chain').checked = S.get('chain', false);

  // Load Segmented Settings
  SETTINGS.genUsage = S.get('genUsage', 'min');
  SETTINGS.lossAcc = S.get('lossAcc', 'max');
  SETTINGS.sacrifice = S.get('sacrifice', 'cheap');
  syncSegmentedControls();

  bindSegmentedControl('ctrlGenUsage', (val) => {
    SETTINGS.genUsage = val;
    S.set('genUsage', val);
  });
  bindSegmentedControl('ctrlLossAcc', (val) => {
    SETTINGS.lossAcc = val;
    S.set('lossAcc', val);
  });
  bindSegmentedControl('ctrlSacrifice', (val) => {
    SETTINGS.sacrifice = val;
    S.set('sacrifice', val);
  });

  renderUnits();
  await loadAdventureInfo();

  const saved = S.get('generalsExport', null);
  if (saved) await applyGeneralsExport(saved);

  // Language Switcher binding
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.onclick = () => {
      setLanguage(btn.dataset.lang);
    };
  });

  // Re-render views when language changes
  onLanguageChange(() => {
    updateAdventureSelect();
    renderCampButtons();
    renderQueue();
    renderUnits();
    if (GENERALS.length) {
      $('genHint').innerHTML = t('gen.hint.loaded', { count: GENERALS.length });
      filterGenerals($('genSearch') ? $('genSearch').value : '');
    } else {
      const tbody = $('genTable').querySelector('tbody');
      if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="dim" style="text-align:center; padding:16px;">${t('gen.table.empty')}</td></tr>`;
    }
    if (LAST_PLAN_RESULT) {
      renderResult(LAST_PLAN_RESULT);
    }
  });

  // Apply active translations on startup
  updateLanguageSwitcherUI();
  updatePageTranslations();

  // Sidebar Sub-tab switching
  document.querySelectorAll('.side-tab-btn').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('.side-tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.side-pane').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const targetPane = $('pane-' + btn.dataset.tab);
      if (targetPane) targetPane.classList.add('active');
    };
  });

  // Mobile navigation tabs
  $('tabBtnParams').onclick = () => setMobileTab('params');
  $('tabBtnResults').onclick = () => setMobileTab('results');

  // Adventure events
  if ($('advSearch')) {
    $('advSearch').oninput = (e) => filterAdventures(e.target.value);
  }
  $('adv').onchange = () => {
    S.set('adventure', $('adv').value);
    updateDockSummary();
    loadAdventureInfo();
  };
  $('advReload').onclick = async () => {
    await loadMeta();
    await loadAdventureInfo();
  };

  // Camp queue events
  $('camps').oninput = () => {
    S.set('camps', $('camps').value);
    queueFromText();
  };
  $('campAll').onclick = () => {
    QUEUE = (window.CAMPS || []).map((c) => c.number);
    syncQueue();
  };
  $('campClear').onclick = () => {
    QUEUE = [];
    syncQueue();
  };
  $('campBtns').onclick = (e) => {
    const b = e.target.closest('.camp');
    if (!b) return;
    const n = Number(b.dataset.n);
    QUEUE = QUEUE.includes(n) ? QUEUE.filter((x) => x !== n) : [...QUEUE, n];
    syncQueue();
  };
  $('campQueue').onclick = (e) => {
    const c = e.target.closest('.qchip');
    if (!c) return;
    QUEUE = QUEUE.filter((x) => x !== Number(c.dataset.n));
    syncQueue();
  };

  // Segmented controls event binding
  bindSegmentedControl('ctrlGenUsage', (val) => { SETTINGS.genUsage = val; S.set('genUsage', val); });
  bindSegmentedControl('ctrlLossAcc', (val) => { SETTINGS.lossAcc = val; S.set('lossAcc', val); });
  bindSegmentedControl('ctrlSacrifice', (val) => { SETTINGS.sacrifice = val; S.set('sacrifice', val); });

  // General search
  $('genSearch').oninput = (e) => filterGenerals(e.target.value);

  // Unit presets
  $('presetElite').onclick = () => applyUnitPreset('elite');
  $('presetAll').onclick = () => applyUnitPreset('all');

  // Numeric persistence
  for (const id of ['step', 'reps', 'verify', 'maxGen', 'beam']) {
    $(id).oninput = () => S.set(id, Number($(id).value));
  }
  $('chain').onchange = () => S.set('chain', $('chain').checked);

  // File upload
  $('genFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      S.set('generalsExport', data);
      await applyGeneralsExport(data);
    } catch (err) {
      alert(t('toast.jsonError', { err: err.message }));
    }
  };

  $('genAll').onclick = () => toggleAllGenerals(true);
  $('genNone').onclick = () => toggleAllGenerals(false);
  $('run').onclick = run;
  if ($('runMobile')) $('runMobile').onclick = run;
}

function bindSegmentedControl(id, onChange) {
  const container = $(id);
  if (!container) return;
  container.onclick = (e) => {
    const btn = e.target.closest('.segmented-btn');
    if (!btn) return;
    container.querySelectorAll('.segmented-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    onChange(btn.dataset.val);
  };
}

function syncSegmentedControls() {
  const syncGroup = (id, currentVal) => {
    const container = $(id);
    if (!container) return;
    container.querySelectorAll('.segmented-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.val === currentVal);
    });
  };
  syncGroup('ctrlGenUsage', SETTINGS.genUsage);
  syncGroup('ctrlLossAcc', SETTINGS.lossAcc);
  syncGroup('ctrlSacrifice', SETTINGS.sacrifice);
}

function setMobileTab(tab) {
  if (tab === 'params') {
    document.body.className = 'tab-params';
    $('tabBtnParams').classList.add('active');
    $('tabBtnResults').classList.remove('active');
  } else {
    document.body.className = 'tab-results';
    $('tabBtnParams').classList.remove('active');
    $('tabBtnResults').classList.add('active');
  }
}

async function loadAdventureInfo() {
  const id = $('adv').value;
  if (!id) return;
  const { camps } = await (await fetch('/api/adventure?id=' + encodeURIComponent(id))).json();
  window.CAMPS = camps;
  
  queueFromText();
  const valid = QUEUE.filter((n) => n >= 1 && n <= camps.length);
  if (valid.length !== QUEUE.length) {
    QUEUE = valid;
    syncQueue();
  } else {
    renderCampButtons();
    renderQueue();
  }
  updateDockSummary();
}

// --- Camp kinds and Attack Queue -------------------------------------------
function campKind(type) {
  const s = String(type || '').toLowerCase();
  if (s.includes('leader') || s.includes('boss')) return 'leader';
  if (s.includes('small')) return 'small';
  if (s.includes('medium')) return 'medium';
  if (s.includes('large') || s.includes('big')) return 'large';
  return 'other';
}

function renderCampButtons() {
  $('campBtns').innerHTML = (window.CAMPS || []).map((c) => {
    const enemy = c.units.map((u) => `${u.amount} ${tUnit(u.id)}`).join(', ');
    const total = c.units.reduce((s, u) => s + u.amount, 0);
    const pos = QUEUE.indexOf(c.number);
    const isQueued = pos >= 0;
    const tip = t('camp.tooltip', {
      num: c.number,
      sector: c.sector,
      type: tCampType(c.type),
      total,
      enemies: enemy,
    });
    return `<button class="camp ${campKind(c.type)}${isQueued ? ' queued' : ''}" data-n="${c.number}"` +
      ` title="${tip}">` +
      `<span>${c.number}</span>` +
      `${isQueued ? `<span class="camp-order-badge">${pos + 1}</span>` : ''}` +
      `</button>`;
  }).join('');
}

function renderQueue() {
  const count = QUEUE.length;
  if ($('queueCount')) $('queueCount').textContent = t('pane.camps.selected', { count });
  if ($('sideBadgeCamps')) $('sideBadgeCamps').textContent = count;
  if ($('dockQueueCount')) $('dockQueueCount').textContent = count;
  if ($('dockQueueSummary')) $('dockQueueSummary').innerHTML = t('dock.queue', { count });
  if ($('mobileQueueCount')) $('mobileQueueCount').textContent = count;
  if ($('mobileQueueText')) $('mobileQueueText').innerHTML = t('mobile.queue', { count });

  $('campQueue').innerHTML = count
    ? QUEUE.map((n, i) => `
        <span class="qchip" data-n="${n}" title="${t('pane.camps.clear')}">
          <span>${i + 1}.</span>
          <b>${n}</b>
          <span class="qchip-close">✕</span>
        </span>
      `).join('')
    : `<span class="dim" style="font-size:11px; padding:4px;">${t('pane.camps.queueEmpty')}</span>`;
}

function syncQueue(writeInput = true) {
  if (writeInput) {
    $('camps').value = QUEUE.join(', ');
    S.set('camps', $('camps').value);
  }
  renderCampButtons();
  renderQueue();
}

function queueFromText() {
  const nums = ($('camps').value || '').split(/[,\s]+/).filter(Boolean)
    .map(Number).filter((n) => Number.isFinite(n) && n > 0);
  QUEUE = [...new Set(nums)];
  syncQueue(false);
}

// --- Troops / Stock --------------------------------------------------------
const ELITE_UNITS = [
  'Swordsman', 'MountedSwordsman', 'Knight',
  'Marksman', 'ArmoredMarksman', 'MountedMarksman', 'Besieger',
];

function applyUnitPreset(preset) {
  if (preset === 'elite') {
    S.set('useUnits', ELITE_UNITS);
    S.set('noLoss', ['MountedMarksman', 'Besieger']);
  } else if (preset === 'all') {
    S.set('useUnits', META.allUnits);
  }
  renderUnits();
}

function renderUnits() {
  const use = S.get('useUnits', META.defaultUnits || ELITE_UNITS);
  const noLoss = S.get('noLoss', []);
  const stock = S.get('stock', S.get('limits', {}));
  const tbody = $('unitTable').querySelector('tbody');
  
  tbody.innerHTML = (META.allUnits || []).map((u) => {
    const isElite = ELITE_UNITS.includes(u);
    const localizedName = tUnit(u);
    const displayName = localizedName !== u
      ? `${localizedName} <span class="dim" style="font-size:11px; font-weight:400;">(${u})</span>`
      : u;
    return `
      <tr>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            ${renderUnitIcon(u, 'unit-icon-table')}
            <span style="font-weight:${isElite ? '600' : '400'}; color:${isElite ? '#f1f5f9' : '#94a3b8'};">
              ${displayName}
            </span>
          </div>
        </td>
        <td style="text-align:center;">
          <input type="checkbox" data-u="${u}" class="use" ${use.includes(u) ? 'checked' : ''}>
        </td>
        <td style="text-align:center;">
          <input type="checkbox" data-u="${u}" class="nl" ${noLoss.includes(u) ? 'checked' : ''}>
        </td>
        <td style="text-align:right;">
          <input type="number" class="num lim font-mono" data-u="${u}" placeholder="—" value="${stock[u] ?? ''}" style="width:68px; padding:3px 6px; font-size:12px;">
        </td>
      </tr>
    `;
  }).join('');
  tbody.oninput = saveUnits;
}

function saveUnits() {
  const use = [...document.querySelectorAll('.use:checked')].map((i) => i.dataset.u);
  const noLoss = [...document.querySelectorAll('.nl:checked')].map((i) => i.dataset.u);
  const stock = {};
  for (const i of document.querySelectorAll('.lim')) {
    if (i.value !== '') stock[i.dataset.u] = Number(i.value);
  }
  S.set('useUnits', use);
  S.set('noLoss', noLoss);
  S.set('stock', stock);
}

// --- Generals --------------------------------------------------------------
async function applyGeneralsExport(data) {
  try {
    const res = await (await fetch('/api/generals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generalsExport: data }),
    })).json();

    GENERALS = res.generals || [];
    UNIT_VALUES = res.unitValues || {};
    const enabled = S.get('enabledGenerals', GENERALS.map((g) => g.uid));

    if ($('sideBadgeGenerals')) $('sideBadgeGenerals').textContent = GENERALS.length;
    $('genHint').innerHTML = t('gen.hint.loaded', { count: GENERALS.length });
    renderGeneralsTable(GENERALS, enabled);
  } catch (err) {
    $('genHint').innerHTML = `<span class="danger">${t('gen.hint.error', { msg: err.message })}</span>`;
  }
}

function renderGeneralsTable(list, enabledList) {
  const enabled = enabledList || S.get('enabledGenerals', GENERALS.map((g) => g.uid));
  const tbody = $('genTable').querySelector('tbody');
  
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="dim" style="text-align:center; padding:16px;">${t('gen.table.noMatch')}</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((g) => `
    <tr>
      <td style="text-align:center;">
        <input type="checkbox" class="gen" data-uid="${g.uid}" ${enabled.includes(g.uid) ? 'checked' : ''}>
      </td>
      <td style="font-weight:600; color:#f1f5f9;">${g.name}</td>
      <td class="dim" style="font-size:11px;">${g.base}</td>
      <td style="text-align:right;">
        <span class="font-mono" style="font-weight:700; color:#60a5fa;">${g.capacity}</span>
      </td>
    </tr>
  `).join('');

  $('genTable').oninput = () => {
    S.set('enabledGenerals', [...document.querySelectorAll('.gen:checked')].map((i) => i.dataset.uid));
  };
}

function filterGenerals(query) {
  const q = (query || '').toLowerCase().trim();
  const filtered = GENERALS.filter((g) => 
    g.name.toLowerCase().includes(q) || g.base.toLowerCase().includes(q)
  );
  renderGeneralsTable(filtered);
}

function toggleAllGenerals(on) {
  for (const i of document.querySelectorAll('.gen')) i.checked = on;
  S.set('enabledGenerals', on ? GENERALS.map((g) => g.uid) : []);
}

// --- Calculation and Tactical Dashboard -------------------------------------
async function run() {
  const exportData = S.get('generalsExport', null);
  if (!exportData) {
    showToast(t('toast.needGenerals'), 'warn');
    const genTab = document.querySelector('.side-tab-btn[data-tab="generals"]');
    if (genTab) genTab.click();
    setMobileTab('params');
    return;
  }

  const campTokens = $('camps').value.split(/[,\s]+/).filter(Boolean);
  if (!campTokens.length) {
    showToast(t('toast.needCamps'), 'warn');
    const campTab = document.querySelector('.side-tab-btn[data-tab="camps"]');
    if (campTab) campTab.click();
    setMobileTab('params');
    return;
  }

  $('run').disabled = true;
  if ($('runMobile')) $('runMobile').disabled = true;
  
  // Show skeleton loader and switch view
  renderSkeletonLoader();
  setMobileTab('results');

  const body = {
    adventure: $('adv').value,
    camps: campTokens,
    generalsExport: exportData,
    enabledGenerals: S.get('enabledGenerals', GENERALS.map((g) => g.uid)),
    units: S.get('useUnits', META.defaultUnits),
    noLoss: S.get('noLoss', []),
    stock: S.get('stock', S.get('limits', {})),
    lossAccounting: SETTINGS.lossAcc,
    unitValues: UNIT_VALUES,
    stepPct: Number($('step').value),
    reps: Number($('reps').value),
    verify: Number($('verify').value),
    maxGeneralsPerCamp: Number($('maxGen').value) || undefined,
    beam: Number($('beam').value),
    chainCamps: $('chain').checked,
    sacrificePolicy: SETTINGS.sacrifice,
    generalUsage: SETTINGS.genUsage,
  };

  try {
    const res = await (await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })).json();

    LAST_PLAN_RESULT = res;
    renderResult(res);
  } catch (e) {
    $('out').innerHTML = `
      <div class="panel-card" style="border-color: rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.08);">
        <div style="font-weight:700; color:#f87171; margin-bottom:6px;">${t('result.error.calcTitle')}</div>
        <div class="dim" style="font-size:13px;">${e.message}</div>
      </div>
    `;
  } finally {
    $('run').disabled = false;
    if ($('runMobile')) $('runMobile').disabled = false;
    clearInterval(CALC_TIMER);
  }
}

function renderSkeletonLoader() {
  let elapsed = 0;
  $('out').innerHTML = `
    <div class="skeleton-loader">
      <div class="panel-card" style="text-align:center; padding:32px 20px;">
        <div style="display:inline-flex; align-items:center; justify-content:center; width:48px; height:48px; border-radius:50%; background:rgba(59,130,246,0.15); color:#60a5fa; margin-bottom:12px;">
          <svg class="spin-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="2" x2="12" y2="6"></line>
            <line x1="12" y1="18" x2="12" y2="22"></line>
            <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
            <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
            <line x1="2" y1="12" x2="6" y2="12"></line>
            <line x1="18" y1="12" x2="22" y2="12"></line>
            <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
            <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
          </svg>
        </div>
        <h3 style="font-size:16px; font-weight:700; color:#fff; margin-bottom:4px;">${t('loader.title')}</h3>
        <p class="muted" style="font-size:13px;">${t('loader.desc')}</p>
        <div class="font-mono dim" id="calcTimerText" style="font-size:12px; margin-top:8px;">${t('loader.timer', { time: '0.0' })}</div>
      </div>

      <div class="skeleton-card">
        <div class="skeleton-shimmer"></div>
        <div class="skeleton-bar" style="width:35%; height:20px;"></div>
        <div class="skeleton-bar" style="width:80%;"></div>
        <div class="skeleton-bar" style="width:60%;"></div>
      </div>
      <div class="skeleton-card">
        <div class="skeleton-shimmer"></div>
        <div class="skeleton-bar" style="width:40%; height:20px;"></div>
        <div class="skeleton-bar" style="width:75%;"></div>
        <div class="skeleton-bar" style="width:55%;"></div>
      </div>
    </div>
  `;

  if (!document.getElementById('spin-style')) {
    const st = document.createElement('style');
    st.id = 'spin-style';
    st.textContent = '@keyframes spin { 100% { transform: rotate(360deg); } } .spin-icon { animation: spin 1.5s linear infinite; }';
    document.head.appendChild(st);
  }

  CALC_TIMER = setInterval(() => {
    elapsed += 0.2;
    const el = $('calcTimerText');
    if (el) el.textContent = t('loader.timer', { time: elapsed.toFixed(1) });
  }, 200);
}

function fmt(n) {
  return Math.round((n || 0) * 100) / 100;
}

function fmtStockPills(o) {
  const entries = Object.entries(o || {});
  if (!entries.length) return `<span class="dim">${t('result.unlimited')}</span>`;
  return entries
    .map(([k, v]) => renderUnitChip(k, v))
    .join(' ');
}

function renderResult(r) {
  if (r.error) {
    $('out').innerHTML = `
      <div class="panel-card" style="border-color: rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.08);">
        <div style="font-weight:700; color:#f87171; margin-bottom:6px;">${t('result.error.title')}</div>
        <div class="dim" style="font-size:13px;">${r.error}</div>
      </div>
    `;
    return;
  }

  if ($('mobileWaveCount')) {
    $('mobileWaveCount').textContent = r.waves.length;
  }

  let totalGeneralsUsed = 0;
  for (const w of r.waves) {
    for (const a of w.attacks) {
      totalGeneralsUsed += a.generalsUsed || (a.squad ? a.squad.length : 1);
    }
  }

  let html = `
    <!-- Tactical Summary Dashboard -->
    <div class="dashboard-header">
      <div class="dashboard-title-group">
        <div class="dashboard-title">${t('result.title')}</div>
        <div class="dashboard-subtitle">${t('result.subtitle', { adv: $('adv').value, camps: r.waves.reduce((s, w) => s + w.attacks.length, 0) })}</div>
      </div>
      <div class="row gap-sm" style="margin:0;">
        <button class="sec" id="btnCopyPlan">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          ${t('result.btnCopy')}
        </button>
      </div>
    </div>

    <!-- Bento Stats -->
    <div class="bento-stats font-mono">
      <div class="bento-stat-card">
        <span class="stat-label">${t('result.bento.waves')}</span>
        <span class="stat-value accent">${r.waves.length}</span>
      </div>
      <div class="bento-stat-card">
        <span class="stat-label">${t('result.bento.lostValue')}</span>
        <span class="stat-value warn">${fmt(r.totalLostValue)}</span>
      </div>
      <div class="bento-stat-card">
        <span class="stat-label">${t('result.bento.generals')}</span>
        <span class="stat-value ok">${totalGeneralsUsed}</span>
      </div>
      <div class="bento-stat-card">
        <span class="stat-label">${t('result.bento.calcTime')}</span>
        <span class="stat-value">${fmt(r.seconds)}s</span>
      </div>
    </div>
  `;

  // Render Waves
  for (const w of r.waves) {
    const burnedMap = new Map((w.burned || []).map((b) => [b.uid, b]));
    
    // Format burned generals banner
    let burnedBanner = '';
    if (w.burned && w.burned.length > 0) {
      const freeList = w.burned.filter((b) => b.free).map((b) => b.name);
      const deadList = w.burned.filter((b) => !b.free).map((b) => b.name);
      burnedBanner = `
        <div style="padding:10px 14px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); border-radius:var(--radius-sm); margin:10px 0; font-size:12px; display:flex; flex-direction:column; gap:4px;">
          ${deadList.length ? `<div><span class="tag-pill danger" style="margin-right:4px;">${t('wave.cooldown')}</span> ${t('wave.cooldownDesc', { list: deadList.join(', ') })}</div>` : ''}
          ${freeList.length ? `<div><span class="tag-pill ok" style="margin-right:4px;">${t('wave.freeRevive')}</span> ${t('wave.freeReviveDesc', { list: freeList.join(', ') })}</div>` : ''}
        </div>
      `;
    }

    html += `
      <div class="wave">
        <div class="wave-header">
          <div class="wave-title-wrap">
            <span class="wave-badge">${t('wave.badge', { num: w.index })}</span>
            <span class="wave-title">${t('wave.campsParallel', { count: w.attacks.length })}</span>
          </div>
          <div class="wave-summary-pills font-mono">
            <span class="summary-pill">${t('wave.stockBefore', { stock: fmtStockPills(w.stockBefore) })}</span>
          </div>
        </div>
        <div class="wave-body">
          ${burnedBanner}
    `;

    for (const a of w.attacks) {
      const lost = a.perUnit.filter((u) => u.lost > 0)
        .map((u) => renderUnitLossChip(u.id, u.lost)).join(' ') || `<span class="tag-pill ok">${t('atk.noLoss')}</span>`;
      
      const enemy = a.camp.units.map((u) => renderUnitChip(u.id, u.amount)).join(' ');

      const squadHtml = (a.squad || []).map((s) => {
        const sLost = s.perUnit.filter((u) => u.lost > 0)
          .map((u) => renderUnitLossChip(u.id, u.lost)).join(' ') || t('atk.lostNone');
        
        const isOpener = s.role && (s.role.includes('вскрытие') || s.role.includes('opener') || s.role.includes('відкриття'));
        const roleClass = isOpener ? 'opener' : 'finisher';
        const roleLabel = tRole(s.role);

        // Check if general was sacrificed in this wave
        const burnInfo = burnedMap.get(s.general.uid);
        let burnBadge = '';
        if (burnInfo) {
          if (burnInfo.free) {
            burnBadge = `<span class="tag-pill ok" title="${t('atk.badgeRevivedTip')}">${t('atk.badgeRevived')}</span>`;
          } else {
            burnBadge = `<span class="tag-pill danger" title="${t('atk.badgeCooldownTip')}">${t('atk.badgeCooldown')}</span>`;
          }
        }

        return `
          <div class="step">
            <div class="step-header">
              <div class="step-gen-name">
                <span class="camp-order-badge" style="position:static; width:18px; height:18px; font-size:10px;">${s.order}</span>
                <span>${s.general.name}</span>
                <span class="dim" style="font-size:11px; font-weight:400;">(${s.general.base}, ${t('atk.cap', { cap: s.general.capacity })})</span>
                ${burnBadge}
              </div>
              <span class="step-role-badge ${roleClass}">${roleLabel}</span>
            </div>
            <div class="step-army font-mono">
              ${s.army.map((u) => renderUnitChip(u.id, u.amount)).join(' <span style="color:var(--text-dim); opacity:0.6; font-size:11px;">+</span> ')}
            </div>
            <div class="step-stats font-mono">
              <span>${t('atk.killed', { count: s.defKills })}</span>
              <span>${t('atk.rounds', { count: fmt(s.rounds) })}</span>
              <span>${t('atk.stepLosses', { losses: sLost })}</span>
            </div>
          </div>
        `;
      }).join('');

      let tagBadge = '';
      if (a.chained) {
        tagBadge = `<span class="tag-pill warn">${t('atk.chainBadge', { idx: a.chainIndex, total: a.chainTotal, path: a.chainCamps.join(' → ') })}</span>`;
      } else if (a.generalsUsed > 1) {
        tagBadge = `<span class="tag-pill warn">${t('atk.squadBadge', { count: a.generalsUsed })}</span>`;
      }

      html += `
        <div class="atk">
          <div class="atk-header">
            <div class="atk-camp-info">
              <span>${t('atk.camp', { num: a.camp.number })}</span>
              <span class="camp-type-pill ${campKind(a.camp.type)}">${tCampType(a.camp.type)}</span>
              <span class="dim" style="font-size:12px; font-weight:400;">(${t('atk.sector', { num: a.camp.sector })})</span>
            </div>
            <div>${tagBadge}</div>
          </div>

          <div class="enemy-box">
            <b>${t('atk.enemy')}</b> ${enemy}
          </div>

          <div class="squad-steps">
            ${squadHtml}
          </div>

          <div class="atk-footer font-mono">
            <div class="row gap-sm" style="margin:0; flex-wrap:wrap;">
              <span class="muted">${t('atk.losses')}</span>
              ${lost}
              <span class="dim">· ${t('atk.cost', { cost: fmt(a.lostValue) })}</span>
            </div>
            <div class="row gap-sm" style="margin:0;">
              <span class="tag-pill ok">${t('atk.victory')}</span>
              ${a.soloable === false ? `<span class="dim" style="font-size:10px;">${t('atk.soloNo')}</span>` : ''}
              ${a.sacrificeExempt ? `<span class="tag-pill warn" title="${t('atk.sacrificeBadge')}">${t('atk.sacrificeBadge')}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }

    html += `
        </div>
        <div class="wave-stock-footer font-mono">
          <div>${t('wave.armiesUsed', { stock: fmtStockPills(w.waveUsage) })}</div>
          <div>${t('wave.lossesDeducted', { stock: fmtStockPills(w.waveLosses) })}</div>
          <div>${t('wave.stockAfter', { stock: fmtStockPills(w.stockAfter) })}</div>
        </div>
    `;

    if (w.blocker) {
      html += `
        <div style="padding:10px 18px; background:rgba(245,158,11,0.1); border-top:1px solid rgba(245,158,11,0.2); font-size:12px; color:#fbbf24;">
          ${t('wave.blocker', { num: w.blocker.number, reason: tReason(w.blocker.reason), need: w.blocker.need })}
        </div>
      `;
    }

    html += '</div>';
  }

  // Unsolved warning
  if (r.unsolved && r.unsolved.length) {
    html += `
      <div class="panel-card" style="border-color: rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.08);">
        <div style="font-weight:700; color:#f87171; margin-bottom:4px;">${t('unsolved.title', { camps: r.unsolved.map((c) => c.number).join(', ') })}</div>
        ${r.stopReason ? `<div class="dim" style="font-size:12px;">${t('unsolved.reason', { reason: r.stopReason })}</div>` : ''}
      </div>
    `;
  }

  $('out').innerHTML = html;

  if ($('btnCopyPlan')) {
    $('btnCopyPlan').onclick = copyPlanToClipboard;
  }
}

function copyPlanToClipboard() {
  if (!LAST_PLAN_RESULT || !LAST_PLAN_RESULT.waves) return;

  const lines = [];
  lines.push(t('plan.header', { adv: $('adv').value }));
  lines.push(t('plan.summary', { waves: LAST_PLAN_RESULT.waves.length, losses: fmt(LAST_PLAN_RESULT.totalLostValue) }));
  lines.push('');

  for (const w of LAST_PLAN_RESULT.waves) {
    lines.push(t('plan.waveHeader', { wave: w.index, camps: w.attacks.length }));
    if (w.burned && w.burned.length) {
      const dead = w.burned.filter((b) => !b.free).map((b) => b.name);
      const revived = w.burned.filter((b) => b.free).map((b) => b.name);
      if (dead.length) lines.push(t('plan.cdLabel', { list: dead.join(', ') }));
      if (revived.length) lines.push(t('plan.reviveLabel', { list: revived.join(', ') }));
    }
    for (const a of w.attacks) {
      lines.push(t('plan.campHeader', { num: a.camp.number, type: tCampType(a.camp.type), sector: a.camp.sector }));
      for (const s of (a.squad || [])) {
        const armyStr = s.army.map((u) => `${u.amount} ${tUnit(u.id)}`).join(' + ');
        const sLost = s.perUnit.filter((u) => u.lost > 0).map((u) => `${tUnit(u.id)} -${fmt(u.lost)}`).join(', ') || t('plan.noLoss');
        lines.push(t('plan.attackLine', { order: s.order, gen: s.general.name, role: tRole(s.role), army: armyStr, losses: sLost }));
      }
    }
    lines.push('');
  }

  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    showToast(t('toast.copied'), 'ok');
  }).catch(() => {
    showToast(t('toast.copyFailed'), 'warn');
  });
}

function showToast(msg, type = 'ok') {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      padding: 10px 18px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      z-index: 100;
      transition: opacity 0.3s ease, transform 0.3s ease;
      pointer-events: none;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    `;
    document.body.appendChild(toast);
  }

  if (type === 'ok') {
    toast.style.background = 'rgba(16, 185, 129, 0.95)';
    toast.style.color = '#fff';
  } else {
    toast.style.background = 'rgba(245, 158, 11, 0.95)';
    toast.style.color = '#000';
  }

  toast.textContent = msg;
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(10px)';
  }, 2500);
}

init();
})();
