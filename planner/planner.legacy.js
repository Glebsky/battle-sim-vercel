// Wave planner on top of the real WASM combat engine.
//
// Rules implemented:
//  * camps are always processed in the exact order the user typed them;
//  * each wave takes the longest possible contiguous prefix of the remaining
//    camps (so nothing is attacked out of order);
//  * generals inside a wave are distributed globally optimally (min-cost
//    assignment), so scarce "strong" generals go to camps only they can win;
//  * the army stock is shared: all generals of one wave draw from the same
//    pool, and after the wave the pool is reduced by the losses only
//    (survivors come back and can be used again in the next wave);
//  * among plans with the same number of camps, total loss value is minimised;
//  * optional intercept safety: a general's army must also be able to beat the
//    next camp in order, in case the general gets intercepted.
const { loadAdventure, simulate, generalCapacity } = require('./engine');
const { minCostAssignment } = require('./matching');

const DEFAULT_UNITS = [
  'Swordsman', 'MountedSwordsman', 'Knight',
  'Marksman', 'ArmoredMarksman', 'MountedMarksman', 'Besieger',
];

const ALL_PLAYER_UNITS = [
  'Recruit', 'Militia', 'Soldier', 'EliteSoldier', 'Cavalry',
  'Bowman', 'Longbowman', 'Crossbowman', 'Cannoneer',
  'Swordsman', 'MountedSwordsman', 'Knight',
  'Marksman', 'ArmoredMarksman', 'MountedMarksman', 'Besieger',
];

function resolveCamps(camps, tokens) {
  const byNumber = new Map(camps.map((c) => [String(c.number), c]));
  const byKey = new Map(camps.map((c) => [c.key, c]));
  return tokens.map((t) => {
    const s = String(t).trim();
    const c = byNumber.get(s) || byKey.get(s);
    if (!c) throw new Error('Лагерь не найден: ' + s + ' (доступны 1..' + camps.length + ' или полные id)');
    return c;
  });
}

function buildGenerals(exportData) {
  return (exportData.specialists || []).map((s) => {
    const skills = Object.entries(s.skills || {}).map(([k, lvl]) => k + lvl);
    return {
      uid: s.id,
      name: s.name || s.base,
      base: s.base,
      skills,
      capacity: generalCapacity(s.base, skills),
      skillList: s.skills || {},
    };
  });
}

function candidateArmies(units, capacity, stepPct, pool) {
  const avail = (id) => (pool[id] === undefined ? Infinity : Math.max(0, pool[id]));
  const cap = (id, n) => Math.min(n, avail(id));
  const armies = [];
  for (const u of units) {
    const a = cap(u, capacity);
    if (a > 0) armies.push([{ id: u, amount: a }]);
  }
  const step = Math.max(1, Math.round((capacity * stepPct) / 100));
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      for (let a = step; a < capacity; a += step) {
        const x = cap(units[i], a);
        const y = cap(units[j], capacity - a);
        if (x + y === 0) continue;
        const army = [];
        if (x > 0) army.push({ id: units[i], amount: x });
        if (y > 0) army.push({ id: units[j], amount: y });
        armies.push(army);
      }
    }
  }
  return armies;
}

function violatesNoLoss(res, noLoss) {
  if (!noLoss.length) return false;
  return res.perUnit.some((u) => noLoss.includes(u.id) && u.max > 0);
}

function wins(camp, army, general, opts, repetitions) {
  const res = simulate({ camp, army, general, repetitions, unitValues: opts.unitValues });
  if (res.victoryChance < 1) return null;
  if (violatesNoLoss(res, opts.noLoss)) return null;
  return res;
}

// Losses charged against the stock: worst case by default, average optionally.
function lossesOf(result, mode) {
  const out = {};
  for (const u of result.perUnit) {
    const n = mode === 'avg' ? Math.ceil(u.lost) : u.max;
    if (n > 0) out[u.id] = (out[u.id] || 0) + n;
  }
  return out;
}

// Best army for one (camp, general) pair within the given pool.
function bestForPair(camp, general, opts, nextCamp, pool) {
  const { units, stepPct, reps, verify } = opts;
  const armies = candidateArmies(units, general.capacity, stepPct, pool);
  let best = null;
  for (const army of armies) {
    const quick = wins(camp, army, general, opts, reps);
    if (!quick) continue;
    if (best && quick.lostValue > best.lostValue * 1.5) continue;
    const full = wins(camp, army, general, opts, verify);
    if (!full) continue;

    let interceptSafe = null;
    if (nextCamp) {
      interceptSafe = !!wins(nextCamp, army, general, opts, reps);
      if (opts.interceptSafe && !interceptSafe) continue;
    }

    if (!best || full.lostValue < best.lostValue) {
      best = {
        army,
        lostValue: full.lostValue,
        lostAmount: full.lostAmount,
        xp: full.xp,
        duration: full.duration,
        perUnit: full.perUnit,
        interceptSafe,
        losses: lossesOf(full, opts.lossAccounting),
      };
    }
  }
  return best;
}

function plan(input) {
  const {
    adventure,
    camps: campTokens,
    generalsExport,
    enabledGenerals,
    units = DEFAULT_UNITS,
    noLoss = [],
    stock: stockInput = input.limits || {},
    unitValues = {},
    stepPct = 10,
    reps = 60,
    verify = 400,
    interceptSafe = false,
    lossAccounting = 'max', // 'max' = worst case, 'avg' = average losses
  } = input;

  const t0 = Date.now();
  const { camps } = loadAdventure(adventure);
  const targets = resolveCamps(camps, campTokens); // strict user order
  let generals = buildGenerals(generalsExport);
  if (enabledGenerals && enabledGenerals.length) {
    generals = generals.filter((g) => enabledGenerals.includes(g.uid));
  }

  const opts = { units, noLoss, unitValues, stepPct, reps, verify, interceptSafe, lossAccounting };

  // Current stock. Units without a number are treated as unlimited.
  const stock = {};
  for (const u of units) if (stockInput[u] !== undefined && stockInput[u] !== null && stockInput[u] !== '') stock[u] = Number(stockInput[u]);
  const initialStock = { ...stock };

  const cache = new Map();
  const poolKey = (pool) => units.map((u) => (pool[u] === undefined ? '*' : pool[u])).join('/');
  const getBest = (camp, general, pool) => {
    const key = camp.key + '|' + general.uid + '|' + poolKey(pool);
    if (!cache.has(key)) {
      const idx = targets.indexOf(camp);
      const nextCamp = idx >= 0 && idx + 1 < targets.length ? targets[idx + 1] : null;
      cache.set(key, bestForPair(camp, general, opts, nextCamp, pool));
    }
    return cache.get(key);
  };

  const solvers = new Map();
  for (const camp of targets) {
    solvers.set(camp.key, generals.filter((g) => getBest(camp, g, stock)).map((g) => g.name));
  }

  const remaining = targets.slice();
  const waves = [];
  let guard = 0;
  let stopReason = null;

  while (remaining.length && guard++ < 40) {
    const maxLen = Math.min(remaining.length, generals.length);
    let chosen = null;

    for (let len = maxLen; len >= 1 && !chosen; len--) {
      const slice = remaining.slice(0, len);

      // Step 1: optimal general assignment, each pair evaluated against the
      // full current stock (upper bound).
      const cost = slice.map((camp) =>
        generals.map((g) => {
          const b = getBest(camp, g, stock);
          return b ? b.lostValue : Infinity;
        })
      );
      const match = minCostAssignment(cost);
      if (!match) continue;

      // Step 2: allocate troops from the shared pool, camp by camp in order.
      const pool = { ...stock };
      const attacks = [];
      let ok = true;
      for (let i = 0; i < slice.length; i++) {
        const camp = slice[i];
        const general = generals[match.assignment[i]];
        const best = getBest(camp, general, pool);
        if (!best) { ok = false; break; }
        for (const u of best.army) {
          if (pool[u.id] !== undefined) pool[u.id] -= u.amount;
        }
        attacks.push({ camp, general, ...best });
      }
      if (ok) chosen = attacks;
    }

    if (!chosen) {
      stopReason = remaining.length
        ? 'Лагерь ' + remaining[0].number + ' не взять: либо не хватает войск в запасе, либо ни один генерал не даёт 100% победы'
        : null;
      break;
    }

    // Stock before / after: only losses are subtracted, survivors return.
    const stockBefore = { ...stock };
    const waveLosses = {};
    for (const a of chosen) {
      for (const [id, n] of Object.entries(a.losses)) {
        waveLosses[id] = (waveLosses[id] || 0) + n;
        if (stock[id] !== undefined) stock[id] = Math.max(0, stock[id] - n);
      }
    }

    waves.push({ attacks: chosen, stockBefore, stockAfter: { ...stock }, waveLosses });
    remaining.splice(0, chosen.length);
  }

  return {
    adventure,
    order: targets.map((c) => c.number),
    interceptSafe,
    lossAccounting,
    initialStock,
    finalStock: stock,
    waves: waves.map((w, i) => ({
      index: i + 1,
      stockBefore: w.stockBefore,
      stockAfter: w.stockAfter,
      waveLosses: w.waveLosses,
      waveUsage: w.attacks.reduce((acc, a) => {
        for (const u of a.army) acc[u.id] = (acc[u.id] || 0) + u.amount;
        return acc;
      }, {}),
      attacks: w.attacks.map((p) => ({
        camp: {
          number: p.camp.number, key: p.camp.key, type: p.camp.type,
          sector: p.camp.sector, units: p.camp.units,
        },
        general: {
          uid: p.general.uid, name: p.general.name,
          base: p.general.base, capacity: p.general.capacity,
        },
        army: p.army,
        lostValue: p.lostValue,
        lostAmount: p.lostAmount,
        xp: p.xp,
        perUnit: p.perUnit,
        losses: p.losses,
        interceptSafe: p.interceptSafe,
        solverCount: (solvers.get(p.camp.key) || []).length,
        solvers: solvers.get(p.camp.key) || [],
      })),
    })),
    unsolved: remaining.map((c) => ({
      number: c.number, key: c.key, type: c.type,
      solvers: solvers.get(c.key) || [],
    })),
    stopReason,
    totalLostValue: waves.flatMap((w) => w.attacks).reduce((s, p) => s + p.lostValue, 0),
    seconds: (Date.now() - t0) / 1000,
  };
}

module.exports = { plan, buildGenerals, resolveCamps, DEFAULT_UNITS, ALL_PLAYER_UNITS };
