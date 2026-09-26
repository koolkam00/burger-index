// The Patty Ladder: the People's Top 10's daily board (user decisions 2026-09-25/26). Plain JS with no imports, so
// the daily job runs it on Node 22 without an npm install (scripts/snapshot-peoples-top.mjs), the tests import it,
// and a browser could run it too.
//
// A port of the ranker design's reference implementation (FINAL.md with ladder.mjs, checked against the simulator
// sim.py): computeBoard(inputs, prev) is pure. `inputs` are the public aggregates the database publishes each night
// (rpc/ranker_board_inputs, supabase/README.md); `prev` is yesterday's committed board, the only state carried
// forward. The algorithm, in short (FINAL.md section 3):
//
//   - A list's burger at place p beats every burger below it with weight 0.8^(p-1)/(k-1), times the list's surge
//     weight f (the database damps lists saved in a surge). A burger a list leaves off never loses.
//   - Strengths theta: the unique maximum of an anchored Bradley-Terry likelihood with one virtual win and one loss
//     against an average burger (theta 0). Damped Newton to 1e-10; 100 iterations at most, else LadderFitError.
//   - Cautious score raw = theta - max(0, sd - 0.2) (sd from the Laplace approximation). The published score S moves
//     at most 0.25 a day, is frozen while its burger is surging or held by the owner, and a newly ranked burger
//     starts from min(raw, 0).
//   - Ranked: on clamp(ceil(0.5% of weighted lists), 5, 50) weighted lists from at least half that many networks
//     (80% of it to stay ranked) and in the dataset. Rising: 3+ weighted lists, not ranked.
//   - The Top 10: yesterday's seat holders that are still ranked keep their seats; a newcomer needs two snapshots
//     running in the computed ten, no review (a surge-driven climb or an owner hold), and to beat the weakest seat
//     by 0.05 when the ten are full.
//
// Deviations from the reference, none of which changes a board: JSDoc types; `hidden` may be any iterable; a
// `prev` with no asOf (the empty board committed before the first publication) counts as no history; and
// refreshInputs() below, the JS twin of the nightly database refresh, for tests and audits.

/**
 * @typedef {object} LadderParams
 * @property {string} version
 * @property {number} c ghost prior: c virtual wins and c virtual losses against an average burger
 * @property {number} z cautious key: theta - z * max(0, sd - floor)
 * @property {number} floor the dead zone: only the part of sd above it is taken off
 * @property {number} kappa consistency (phi) pseudo-count
 * @property {number} phiFlag phi at or above this = an inconsistent record (owner flag only)
 * @property {number} step the published score moves at most this much a day
 * @property {number} margin a confirmed challenger must beat the weakest seat by this much
 * @property {number} bar review: surge support >= bar x the burger's lists
 * @property {number} gateFrac
 * @property {number} gateMin
 * @property {number} gateMax
 * @property {number} keep a ranked burger stays ranked down to keep x the gate
 * @property {number} netFrac distinct networks >= netFrac x the gate
 * @property {number} risingMin
 * @property {number} closeP adjacent rows are "too close to call" below this
 * @property {number} tol Newton tolerance (max |step|)
 */

/** @type {Readonly<LadderParams>} */
export const PARAMS = Object.freeze({
  version: "patty-ladder/1",
  c: 1, // ghost prior: 1 virtual win + 1 virtual loss against an average burger
  z: 1.0, // cautious key = theta - z * max(0, sd - floor)
  floor: 0.2, // a dead zone, not a floor under sd: only the part of sd above 0.2 is taken off (none at sd <= 0.2)
  kappa: 20, // consistency (phi) pseudo-count
  phiFlag: 2.5, // phi >= 2.5 = inconsistent record: owner review flag (no automatic effect)
  step: 0.25, // published score moves at most 0.25 per day
  margin: 0.05, // a confirmed challenger takes a Top-10 seat only if its score beats that seat's by 0.05
  bar: 0.25, // needs review: >= 25% of its lists ranked it in their top half on its (uncleared) surge days;
  // it keeps a seat it holds but can't take a new one until the owner clears or voids them
  gateFrac: 0.005,
  gateMin: 5,
  gateMax: 50,
  keep: 0.8, // ranked tier
  netFrac: 0.5, // distinct /24 networks >= half the gate
  risingMin: 3, // Rising tier: 3+ weighted lists
  closeP: 0.75, // adjacent rows "too close to call" below this
  tol: 1e-10,
});

/**
 * The surge rule the database applies each night (FINAL.md 3.3, supabase/README.md "The nightly refresh"); here for
 * refreshInputs() and the tests. `minDup` is the shortest list the duplicate collapse applies to.
 */
export const SURGE = Object.freeze({ tminDay: 3, tminWeek: 5, mult: 3, warmup: 500, windowDays: 7, minDup: 5 });

// ---------------------------------------------------------------- weights (also a SQL table)
export const BETA = 0.8;
/**
 * The winner at 1-based place p of a k-item list beats each burger below it with this weight: a list's #1 wins 1
 * in total whatever the length; each place down counts 20% less.
 * @param {number} k
 * @param {number} p
 */
export const pairWeight = (k, p) => BETA ** (p - 1) / (k - 1);

// ---------------------------------------------------------------- surge factors (DB job; here for tests)
/**
 * A burger's damping on one save day from its day and 7-day counts: min over the windows with n > T of
 * min(1, (T + sqrt(n - T)) / n), T = max(tmin, mult x N x share); 1 when neither window is over.
 * @param {number} nDay lists naming the burger saved that day
 * @param {number} nWeek lists naming it saved in the 7 days ending that day
 * @param {number} Nday all lists saved that day
 * @param {number} Nweek all lists saved in the window
 * @param {number} share (lists naming it saved before the window + 1) / (all lists saved before it + 1)
 * @param {{ tminDay?: number, tminWeek?: number, mult?: number }} [opts]
 */
export function surgeFactor(nDay, nWeek, Nday, Nweek, share, { tminDay = 3, tminWeek = 5, mult = 3 } = {}) {
  let f = 1;
  for (const [n, N, tmin] of [
    [nDay, Nday, tminDay],
    [nWeek, Nweek, tminWeek],
  ]) {
    const T = Math.max(tmin, mult * N * share);
    if (n > T) f = Math.min(f, Math.min(1, (T + Math.sqrt(n - T)) / n));
  }
  return f;
}

const sig = (x) => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));
const logsig = (x) => (x >= 0 ? -Math.log1p(Math.exp(-x)) : x - Math.log1p(Math.exp(x)));
const r6 = (x) => Math.round(x * 1e6) / 1e6; // outputs
/**
 * Published inputs are rounded to 9 significant digits before the fit, so every reader fits the same numbers.
 * @param {number} x
 */
export const sig9 = (x) => Number(Number(x).toPrecision(9));

// ---------------------------------------------------------------- dense linear algebra
function cholesky(A, n) {
  // in place lower factor, row-major; returns L (same array)
  for (let j = 0; j < n; j++) {
    const rj = j * n;
    let s = A[rj + j];
    for (let k = 0; k < j; k++) s -= A[rj + k] * A[rj + k];
    if (!(s > 0)) throw new Error("matrix not positive definite");
    const d = Math.sqrt(s);
    A[rj + j] = d;
    for (let i = j + 1; i < n; i++) {
      const ri = i * n;
      let t = A[ri + j];
      for (let k = 0; k < j; k++) t -= A[ri + k] * A[rj + k];
      A[ri + j] = t / d;
    }
  }
  return A;
}
function cholSolve(L, n, b) {
  const y = Float64Array.from(b);
  for (let i = 0; i < n; i++) {
    let s = y[i];
    const ri = i * n;
    for (let k = 0; k < i; k++) s -= L[ri + k] * y[k];
    y[i] = s / L[ri + i];
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * y[k];
    y[i] = s / L[i * n + i];
  }
  return y;
}
function invLowerT(L, n) {
  // MT[j*n+i] = (L^-1)[i][j]: column j of L^-1 by forward substitution, stored as a row
  const MT = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    const x = MT.subarray(j * n, j * n + n);
    x[j] = 1 / L[j * n + j];
    for (let i = j + 1; i < n; i++) {
      let s = 0;
      const ri = i * n;
      for (let k = j; k < i; k++) s -= L[ri + k] * x[k];
      x[i] = s / L[ri + i];
    }
  }
  return MT;
}

// ---------------------------------------------------------------- the fit
/**
 * The strengths. W: n*n directed weights (W[i*n+j] = weight of i beating j). Maximises
 * F = sum_ij W_ij log s(t_i - t_j) + c sum_i [log s(t_i) + log s(-t_i)] (strictly concave, one answer).
 * Cold start (theta0 null): Hunter MM sweeps to 1e-2, then damped Newton; warm start: Newton from theta0.
 * `converged` is false only when the 100-iteration cap ran out (iterations is then 100): computeBoard refuses it.
 * @param {Float64Array} W
 * @param {number} n
 * @param {number} c
 * @param {ArrayLike<number> | null} theta0
 * @param {number} tol
 * @returns {{ theta: Float64Array, N: Float64Array, LinvT: Float64Array, iterations: number, converged: boolean }}
 */
export function fitStrength(W, n, c, theta0, tol) {
  const th = theta0 ? Float64Array.from(theta0) : new Float64Array(n);
  const N = new Float64Array(n * n);
  const wins = new Float64Array(n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      N[i * n + j] = W[i * n + j] + W[j * n + i];
      wins[i] += W[i * n + j];
    }
  if (!theta0) {
    // cold start: Hunter MM sweeps with the ghost as a fixed opponent, until max change < 1e-2
    for (let sweep = 0; sweep < 50; sweep++) {
      const pi = th.map(Math.exp);
      let mx = 0;
      const next = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let den = (2 * c) / (pi[i] + 1);
        for (let j = 0; j < n; j++) {
          const nij = N[i * n + j];
          if (nij) den += nij / (pi[i] + pi[j]);
        }
        next[i] = Math.log(wins[i] + c) - Math.log(den);
        mx = Math.max(mx, Math.abs(next[i] - th[i]));
      }
      th.set(next);
      if (mx < 1e-2) break;
    }
  }
  const obj = (t) => {
    let f = 0;
    for (let i = 0; i < n; i++) {
      f += c * (logsig(t[i]) + logsig(-t[i]));
      for (let j = 0; j < n; j++) {
        const w = W[i * n + j];
        if (w) f += w * logsig(t[i] - t[j]);
      }
    }
    return f;
  };
  let F = null;
  let it = 0;
  /** @type {Float64Array} */
  let L = new Float64Array(0);
  let converged = false;
  for (; it < 100; it++) {
    // damped Newton; the factor of the last step gives the variance
    const H = new Float64Array(n * n);
    const g = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = sig(th[i]);
      let gi = wins[i] + c * (1 - 2 * s);
      let hd = 2 * c * s * (1 - s);
      for (let j = 0; j < n; j++) {
        const nij = N[i * n + j];
        if (!nij) continue;
        const p = sig(th[i] - th[j]);
        gi -= nij * p;
        const h = nij * p * (1 - p);
        hd += h;
        H[i * n + j] = -h;
      }
      H[i * n + i] = hd;
      g[i] = gi;
    }
    L = cholesky(H, n);
    const d = cholSolve(L, n, g);
    let mx = 0;
    for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(d[i]));
    if (mx < tol) {
      for (let i = 0; i < n; i++) th[i] += d[i];
      converged = true;
      break;
    }
    let t = Math.min(1, 1 / mx);
    if (t * mx <= 0.25) {
      // near the optimum: plain step
      for (let i = 0; i < n; i++) th[i] += t * d[i];
      F = null;
      continue;
    }
    if (F === null) F = obj(th);
    let cand = th;
    let Fc = F;
    for (let k = 0; k < 60; k++) {
      cand = th.map((x, i) => x + t * d[i]);
      Fc = obj(cand);
      if (Fc >= F - 1e-12 * Math.abs(F)) break;
      t /= 2;
    }
    th.set(cand);
    F = Fc;
  }
  return { theta: th, N, LinvT: invLowerT(L, n), iterations: converged ? it + 1 : it, converged };
}

/** Thrown by computeBoard when the fit hit the iteration cap: the daily job must not publish, and yesterday's board stays. */
export class LadderFitError extends Error {
  /** @param {number} iterations */
  constructor(iterations) {
    super(`strength fit did not converge within ${iterations} Newton iterations`);
    this.name = "LadderFitError";
    this.code = "NOT_CONVERGED";
    this.iterations = iterations;
  }
}
// (H^-1)_ab = sum_k (L^-1)[k][a] (L^-1)[k][b] = dot of rows a and b of LinvT
const covOf = (LinvT, n, a, b) => {
  let s = 0;
  const ra = a * n;
  const rb = b * n;
  for (let k = Math.max(a, b); k < n; k++) s += LinvT[ra + k] * LinvT[rb + k];
  return s;
};

function normCdf(x) {
  // Abramowitz-Stegun 7.1.26 via erf, |err| < 1.5e-7
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const e = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + (x >= 0 ? e : -e));
}

// ---------------------------------------------------------------- the board
/**
 * @typedef {object} LadderItem
 * @property {string} key a menu key: a restaurant id, or "chain:<slug>"
 * @property {number} lists lists naming it (after the duplicate collapse)
 * @property {number} weighted the sum of those lists' surge weights
 * @property {number} firsts lists naming it #1
 * @property {number} networks distinct /24 (IPv4) or /48 (IPv6) networks among those lists
 * @property {boolean} [surging] damped on the last counted save day (asOf): its score is frozen
 * @property {number} [surgeLists] surge support: lists naming it in their top half on its uncleared surge days
 * @property {boolean} [held] the owner's hold: score frozen, no new seat
 */
/** @typedef {{ a: string, b: string, wab: number, wba: number, q: number }} LadderPair a < b; wab = a beat b */
/**
 * @typedef {object} LadderInputs
 * @property {string} asOf the last save day counted (New York date)
 * @property {number} totalLists lists in the fit (after the duplicate collapse)
 * @property {number} weightedLists the sum of their surge weights
 * @property {LadderItem[]} items
 * @property {LadderPair[]} pairs
 * @property {Iterable<string>} [hidden] keys in the fit that are never shown (not in the dataset)
 */
/**
 * @typedef {object} LadderRow
 * @property {string} key
 * @property {"ranked" | "rising" | "listed"} tier
 * @property {number | null} rank 1-based, ranked rows only (the Top 10 first)
 * @property {number | null} score the published score S (ranked rows only)
 * @property {number} theta
 * @property {number} sd
 * @property {number} phi
 * @property {number} raw
 * @property {number} lists
 * @property {number} weighted
 * @property {number} firsts
 * @property {number} networks
 * @property {number} needs weighted lists short of the gate, or networks short of the floor (0 when ranked)
 * @property {boolean} surging
 * @property {boolean} inconsistent phi >= phiFlag (owner flag)
 * @property {boolean} held
 * @property {boolean} review under review: can't take a new seat
 * @property {boolean} frozen the score didn't move (surging with history, or held)
 * @property {number | null} aheadP P(this row is truly ahead of the next), adjacent ranked rows (first 50)
 * @property {boolean | null} closeToNext aheadP < closeP
 */
/**
 * @typedef {object} LadderBoard
 * @property {1} version
 * @property {string} method
 * @property {string} asOf
 * @property {number} totalLists
 * @property {number} weightedLists
 * @property {number} gate
 * @property {boolean} early fewer than 500 lists
 * @property {number} iterations Newton steps of the converged fit
 * @property {string[]} top10 the People's Top 10, in order
 * @property {string[]} computed10 the first ten ranked by score (the seat rule's confirmation)
 * @property {LadderRow[]} rows ranked (Top 10, then the rest), rising, then listed
 */
/**
 * @typedef {object} LadderPrev yesterday's board: all computeBoard reads of it
 * @property {string | null} asOf
 * @property {ReadonlyArray<{ key: string, tier: string, score: number | null, theta: number }>} [rows]
 * @property {readonly string[]} [top10]
 * @property {readonly string[]} [computed10]
 */

/**
 * The day's board. `prev` = yesterday's board (or null: the first board ever, S = raw and no confirmation).
 * Throws LadderFitError when the fit hits the iteration cap.
 * @param {LadderInputs} inputs
 * @param {LadderPrev | null} [prev]
 * @param {Readonly<LadderParams>} [P]
 * @returns {LadderBoard}
 */
export function computeBoard(inputs, prev = null, P = PARAMS) {
  if (prev && !prev.asOf) prev = null; // the empty board committed before the first publication: no history
  const items = inputs.items.filter((it) => it.weighted > 0).sort((x, y) => (x.key < y.key ? -1 : 1));
  const n = items.length;
  const idx = new Map(items.map((it, i) => [it.key, i]));
  const W = new Float64Array(n * n);
  const Q = new Float64Array(n * n);
  for (const p of inputs.pairs) {
    const a = idx.get(p.a);
    const b = idx.get(p.b);
    if (a === undefined || b === undefined) continue;
    W[a * n + b] = sig9(p.wab);
    W[b * n + a] = sig9(p.wba);
    Q[a * n + b] = Q[b * n + a] = sig9(p.q);
  }
  const prevRow = new Map((prev?.rows ?? []).map((r) => [r.key, r]));
  const theta0 = prev ? items.map((it) => prevRow.get(it.key)?.theta ?? 0) : null;
  const { theta, N, LinvT: Linv, iterations, converged } = fitStrength(W, n, P.c, theta0, P.tol);
  if (!converged) throw new LadderFitError(iterations);
  const rows = items.map((it, i) => {
    let r2 = 0;
    let opp = 0;
    for (let j = 0; j < n; j++) {
      const nij = N[i * n + j];
      if (!nij) continue;
      opp++;
      const p = Math.min(1 - 1e-9, Math.max(1e-9, sig(theta[i] - theta[j])));
      const q = Q[i * n + j];
      if (q > 0) r2 += (W[i * n + j] - nij * p) ** 2 / (q * p * (1 - p));
    }
    const phi = Math.max(1, (r2 + P.kappa) / (opp + P.kappa)); // review flag only
    const v = covOf(Linv, n, i, i);
    const sd = Math.sqrt(v);
    return {
      key: it.key,
      i,
      lists: it.lists,
      weighted: it.weighted,
      firsts: it.firsts,
      networks: it.networks,
      surging: !!it.surging,
      held: !!it.held,
      theta: theta[i],
      sd,
      phi,
      raw: theta[i] - P.z * Math.max(0, sd - P.floor),
      /** @type {boolean} */ ranked: false,
      /** @type {number} */ needs: 0,
      /** @type {boolean} */ inconsistent: false,
      /** @type {boolean} */ review: false,
      /** @type {boolean} */ frozen: false,
      /** @type {number} */ score: 0,
      /** @type {number | undefined} */ rank: undefined,
      /** @type {"ranked" | "rising" | undefined} */ tier: undefined,
      /** @type {number | undefined} */ aheadP: undefined,
      /** @type {boolean | undefined} */ closeToNext: undefined,
    };
  });
  // tiers
  const G = Math.min(P.gateMax, Math.max(P.gateMin, Math.ceil(P.gateFrac * inputs.weightedLists)));
  const hidden = new Set(inputs.hidden ?? []);
  const days = prev ? Math.max(1, Math.round((Date.parse(inputs.asOf) - Date.parse(/** @type {string} */ (prev.asOf))) / 864e5)) : 1;
  const step = P.step * Math.min(days, 4);
  for (const r of rows) {
    const pr = prevRow.get(r.key);
    const floorN = pr?.tier === "ranked" ? Math.ceil(P.keep * G) : G;
    r.ranked = !hidden.has(r.key) && r.weighted >= floorN && r.networks >= Math.ceil(P.netFrac * floorN);
    // lists short of the gate, or networks short of the network floor: each list from a new network adds ~1 to both
    r.needs = r.ranked ? 0 : Math.max(0, Math.ceil(G - r.weighted), Math.ceil(P.netFrac * G) - r.networks);
    r.inconsistent = r.phi >= P.phiFlag;
    r.review = (items[r.i].surgeLists ?? 0) >= P.bar * Math.max(1, r.lists) || r.held;
    r.frozen = (!!prev && r.surging) || r.held;
    let S = r6(r.raw);
    if (prev) {
      const base = pr?.tier === "ranked" ? /** @type {number} */ (pr.score) : Math.min(S, 0);
      const lo = r.frozen ? base : base - step;
      const hi = r.frozen ? base : base + step;
      S = r6(Math.min(hi, Math.max(lo, S)));
    }
    r.score = S;
  }
  /** @param {(typeof rows)[number]} x @param {(typeof rows)[number]} y */
  const byScore = (x, y) => y.score - x.score || y.theta - x.theta || (x.key < y.key ? -1 : 1);
  const ranked = rows.filter((r) => r.ranked).sort(byScore);
  const computed = ranked.slice(0, 10).map((r) => r.key);
  let top = ranked
    .filter((r) => !r.review)
    .slice(0, 10)
    .map((r) => r.key);
  if (prev) {
    // a new entry must be in the computed ten on two snapshots running, not under review
    const rk = new Map(ranked.map((r) => [r.key, r]));
    const at = (k) => /** @type {(typeof rows)[number]} */ (rk.get(k));
    const members = (prev.top10 ?? []).filter((k) => rk.has(k));
    const confirmed = new Set(prev.computed10 ?? []);
    for (const k of computed) {
      if (members.includes(k) || !confirmed.has(k) || at(k).review) continue;
      if (members.length < 10) {
        members.push(k);
        continue;
      }
      let w = 0;
      for (let m = 1; m < members.length; m++) if (byScore(at(members[m]), at(members[w])) > 0) w = m;
      if (at(k).score > at(members[w]).score + P.margin) members[w] = k;
    }
    for (const r of ranked) {
      if (members.length >= 10) break;
      if (!members.includes(r.key) && !r.review) members.push(r.key);
    }
    top = members
      .map(at)
      .sort(byScore)
      .map((r) => r.key);
  }
  const topSet = new Set(top);
  const rowOf = new Map(rows.map((r) => [r.key, r]));
  const order = [...top.map((k) => /** @type {(typeof rows)[number]} */ (rowOf.get(k))), ...ranked.filter((r) => !topSet.has(r.key))];
  order.forEach((r, i) => {
    r.rank = i + 1;
    r.tier = "ranked";
  });
  // adjacent verdicts: P(upper truly ahead) from the posterior covariance
  for (let k = 0; k + 1 < order.length && k < 50; k++) {
    const x = order[k];
    const y = order[k + 1];
    const va = covOf(Linv, n, x.i, x.i) + covOf(Linv, n, y.i, y.i) - 2 * covOf(Linv, n, x.i, y.i);
    x.aheadP = normCdf((x.theta - y.theta) / Math.sqrt(Math.max(va, 1e-12)));
    x.closeToNext = x.aheadP < P.closeP;
  }
  const rising = rows
    .filter((r) => !r.ranked && !hidden.has(r.key) && r.weighted >= P.risingMin)
    .sort((x, y) => y.raw - x.raw || (x.key < y.key ? -1 : 1));
  rising.forEach((r) => {
    r.tier = "rising";
    r.rank = undefined;
  });
  /** @returns {LadderRow} */
  const out = (r) => ({
    key: r.key,
    tier: r.tier ?? "listed",
    rank: r.rank ?? null,
    score: r.tier === "ranked" ? r.score : null,
    theta: r6(r.theta),
    sd: r6(r.sd),
    phi: r6(r.phi),
    raw: r6(r.raw),
    lists: r.lists,
    weighted: r6(r.weighted),
    firsts: r.firsts,
    networks: r.networks,
    needs: r.needs,
    surging: r.surging,
    inconsistent: r.inconsistent,
    held: r.held,
    review: r.review,
    frozen: r.frozen,
    aheadP: r.aheadP === undefined ? null : r6(r.aheadP),
    closeToNext: r.closeToNext ?? null,
  });
  return {
    version: 1,
    method: P.version,
    asOf: inputs.asOf,
    totalLists: inputs.totalLists,
    weightedLists: r6(inputs.weightedLists),
    gate: G,
    early: inputs.totalLists < 500,
    iterations,
    top10: top,
    computed10: computed,
    rows: [...order, ...rising, ...rows.filter((r) => !r.tier)].map(out),
  };
}

// ---------------------------------------------------------------- aggregates from raw lists (tests, audits)
/**
 * The public aggregates of a set of lists (the fit's lists: after the duplicate collapse), as the database builds
 * them. `f` = each list's surge weight (default 1), `nets` = each list's network (default: all different).
 * @param {ReadonlyArray<readonly string[]>} lists
 * @param {{ f?: ArrayLike<number> | null, nets?: ArrayLike<string | number> | null, asOf?: string,
 *   surging?: ReadonlySet<string>, held?: ReadonlySet<string> }} [opts]
 * @returns {LadderInputs}
 */
export function buildAggregates(lists, { f = null, nets = null, asOf = "2026-10-01", surging = new Set(), held = new Set() } = {}) {
  /** @type {Map<string, LadderPair>} */
  const pair = new Map();
  /** @type {Map<string, { key: string, lists: number, weighted: number, firsts: number, nets: Set<string | number> }>} */
  const item = new Map();
  let weightedLists = 0;
  lists.forEach((L, li) => {
    const k = L.length;
    const fl = f ? f[li] : 1;
    weightedLists += fl;
    L.forEach((key, p0) => {
      const it = item.get(key) ?? { key, lists: 0, weighted: 0, firsts: 0, nets: new Set() };
      it.lists++;
      it.weighted += fl;
      if (p0 === 0) it.firsts++;
      it.nets.add(nets ? nets[li] : li);
      item.set(key, it);
      for (let q0 = p0 + 1; q0 < k; q0++) {
        const w = fl * pairWeight(k, p0 + 1);
        const other = L[q0];
        const [a, b] = key < other ? [key, other] : [other, key];
        const id = a + "\u0000" + b;
        const e = pair.get(id) ?? { a, b, wab: 0, wba: 0, q: 0 };
        if (key === a) e.wab += w;
        else e.wba += w;
        e.q += w * w;
        pair.set(id, e);
      }
    });
  });
  return {
    asOf,
    totalLists: lists.length,
    weightedLists,
    items: [...item.values()].map(({ nets: s, ...it }) => ({ ...it, networks: s.size, surging: surging.has(it.key), held: held.has(it.key) })),
    pairs: [...pair.values()],
  };
}

// ---------------------------------------------------------------- the nightly refresh, in JS (tests, audits)
const DAY_MS = 864e5;
const dayNumber = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

/**
 * @typedef {object} SavedList an active list as the refresh sees it
 * @property {readonly string[]} items 3-25 distinct menu keys, best first
 * @property {string} day its New York save day, "YYYY-MM-DD"
 * @property {string | number} net its network (/24 or /48)
 */

/**
 * The JS twin of the database's nightly refresh (ranker_private.ranker_rebuild; FINAL.md 3.1-3.4, supabase/README.md),
 * mirroring the simulator's `final_surge`, which the database matches:
 *
 *   1. The lists saved through `asOf` count; pass active lists only, in save order (the earliest copy of a
 *      duplicate is kept).
 *   2. Surge damping from every counted list, before the duplicate collapse: for burger i on a save day d with
 *      lists, window d-6..d, share = (lists naming i saved before the window + 1) / (all saved before it + 1),
 *      factor = surgeFactor(day and window counts); off until `warmup` lists were saved before the window; 1 on
 *      the days an owner clear covers. A list's weight f = the smallest factor among its burgers on its day.
 *   3. A burger is **surging** when its factor on `asOf` is below 1 (the database's and the simulator's flag, so a
 *      4-list day at T = 3, whose factor is exactly 1, neither damps nor freezes).
 *   4. Identical ordered lists of `minDup`+ burgers count once in the fit (the first).
 *   5. The aggregates over the fit's lists; surge support = fit lists naming the burger in their top half
 *      (2p <= k + 1) saved on a day it was damped.
 *
 * Returns computeBoard's inputs plus `countedLists` (before the collapse), `weights` (f of each counted list, in
 * order) and `damped` (every (key, day) with a factor below 1).
 * @param {readonly SavedList[]} lists
 * @param {{ asOf: string, held?: Iterable<string>, cleared?: ReadonlyArray<{ key: string, from: string, to: string }>,
 *   surge?: Partial<typeof SURGE> }} opts
 */
export function refreshInputs(lists, { asOf, held = [], cleared = [], surge = {} }) {
  const S = { ...SURGE, ...surge };
  const counted = lists.filter((l) => l.day <= asOf);
  const dayOf = counted.map((l) => dayNumber(l.day));
  const asOfDay = dayNumber(asOf);
  // lists per save day, and per (burger, save day), before the collapse, as running totals over the days:
  // cum[x] = lists saved before day first + x
  const first = dayOf.reduce((m, d) => Math.min(m, d), Infinity);
  const span = counted.length ? dayOf.reduce((m, d) => Math.max(m, d), -Infinity) - first + 1 : 0;
  const cumAll = new Float64Array(span + 1);
  /** @type {Map<string, Float64Array>} */
  const cumKey = new Map();
  counted.forEach((l, li) => {
    const x = dayOf[li] - first + 1;
    cumAll[x]++;
    for (const key of l.items) {
      let c = cumKey.get(key);
      if (!c) cumKey.set(key, (c = new Float64Array(span + 1)));
      c[x]++;
    }
  });
  for (const c of [cumAll, ...cumKey.values()]) for (let x = 1; x <= span; x++) c[x] += c[x - 1];
  const upTo = (c, d) => c[Math.min(span, Math.max(0, d - first))]; // lists saved before day d
  const clearedDays = cleared.map((c) => ({ key: c.key, from: dayNumber(c.from), to: dayNumber(c.to) }));
  const isCleared = (key, d) => clearedDays.some((c) => c.key === key && d >= c.from && d <= c.to);
  /** @type {Map<number, Map<string, number>>} factors below 1, per save day */
  const phi = new Map();
  for (let d = first; d < first + span; d++) {
    const nDay = upTo(cumAll, d + 1) - upTo(cumAll, d);
    if (!nDay) continue; // only days with lists (sim.py final_surge)
    const w0 = d - (S.windowDays - 1);
    const before = upTo(cumAll, w0);
    if (before < S.warmup) continue;
    const nWeek = upTo(cumAll, d + 1) - before;
    /** @type {Map<string, number>} */
    const damped = new Map();
    for (const [key, c] of cumKey) {
      const n7 = upTo(c, d + 1) - upTo(c, w0);
      if (n7 === 0 || isCleared(key, d)) continue;
      const share = (upTo(c, w0) + 1) / (before + 1);
      const f = surgeFactor(upTo(c, d + 1) - upTo(c, d), n7, nDay, nWeek, share, S);
      if (f < 1) damped.set(key, f);
    }
    if (damped.size) phi.set(d, damped);
  }
  const factor = (key, d) => phi.get(d)?.get(key) ?? 1;
  const weights = counted.map((l, li) => l.items.reduce((f, key) => Math.min(f, factor(key, dayOf[li])), 1));
  // the duplicate collapse (the fit only)
  const seen = new Set();
  /** @type {number[]} */
  const fit = [];
  counted.forEach((l, li) => {
    if (l.items.length >= S.minDup) {
      const sigKey = l.items.join("\u0000");
      if (seen.has(sigKey)) return;
      seen.add(sigKey);
    }
    fit.push(li);
  });
  const inputs = buildAggregates(
    fit.map((li) => counted[li].items),
    {
      f: fit.map((li) => weights[li]),
      nets: fit.map((li) => counted[li].net),
      asOf,
      surging: new Set([...(phi.get(asOfDay)?.keys() ?? [])]),
      held: new Set(held),
    },
  );
  /** @type {Map<string, number>} */
  const support = new Map();
  for (const li of fit) {
    const L = counted[li].items;
    L.forEach((key, p0) => {
      if (2 * (p0 + 1) <= L.length + 1 && factor(key, dayOf[li]) < 1) support.set(key, (support.get(key) ?? 0) + 1);
    });
  }
  const iso = (d) => new Date(d * DAY_MS).toISOString().slice(0, 10);
  return {
    ...inputs,
    items: inputs.items.map((it) => ({ ...it, surgeLists: support.get(it.key) ?? 0 })),
    countedLists: counted.length,
    weights,
    damped: [...phi].flatMap(([d, m]) => [...m].map(([key, f]) => ({ key, day: iso(d), factor: f }))),
  };
}
