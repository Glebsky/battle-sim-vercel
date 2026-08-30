// Min-cost assignment (Hungarian / JV shortest augmenting path) for rectangular
// cost matrices. cost[i][j] = Infinity means "impossible".
// Returns { assignment: number[] (col per row, -1 if none), cost } or null if
// not every row can be assigned.
function minCostAssignment(cost) {
  const n = cost.length;
  if (n === 0) return { assignment: [], cost: 0 };
  const m = cost[0].length;
  if (m < n) return null;

  const BIG = 1e12;
  const a = cost.map((row) => row.map((v) => (Number.isFinite(v) ? v : BIG)));

  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0); // p[j] = row matched to column j
  const way = new Array(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(Infinity);
    const used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  const assignment = new Array(n).fill(-1);
  let total = 0;
  for (let j = 1; j <= m; j++) {
    if (p[j] > 0) {
      assignment[p[j] - 1] = j - 1;
      total += a[p[j] - 1][j - 1];
    }
  }
  // Reject if any row got an "impossible" cell.
  for (let i = 0; i < n; i++) {
    const j = assignment[i];
    if (j < 0 || !Number.isFinite(cost[i][j])) return null;
  }
  return { assignment, cost: total };
}

module.exports = { minCostAssignment };
