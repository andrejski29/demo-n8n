/**
 * n8n Code node (JavaScript) — TEAM LAST X MATCHES NORMALIZER
 *
 * Adapts the "Gold Standard" normalization logic to process
 * Last 5, Last 6, and Last 10 match snapshots.
 *
 * Output Structure:
 * {
 *   match_id: ...,
 *   side: ...,
 *   last_5: { features: ..., coverage: ... },
 *   last_6: { features: ..., coverage: ... },
 *   last_10: { features: ..., coverage: ... }
 * }
 */

// ------------------------- Helpers (Hardened) -------------------------
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

const safeDiv = (a, b) => {
  const A = num(a), B = num(b);
  if (!isNum(A) || !isNum(B) || B === 0) return null;
  return A / B;
};

const clamp01 = (x) => {
  if (!isNum(x)) return null;
  return Math.max(0, Math.min(1, x));
};

const asProbFromPct = (p) => {
  const v = num(p);
  if (!isNum(v)) return null;
  return clamp01(v / 100);
};

const round = (v, d = 4) => (isNum(v) ? Number(v.toFixed(d)) : null);

const sum = (arr) => {
  let s = 0, ok = false;
  for (const v of arr) {
    const n = num(v);
    if (isNum(n)) { s += n; ok = true; }
  }
  return ok ? s : null;
};

const diff = (a, b) => {
  const A = num(a), B = num(b);
  if (!isNum(A) || !isNum(B)) return null;
  return A - B;
};

const ratio = (a, b) => safeDiv(a, b);

const getPath = (obj, path, fallback = null) => {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur && Object.prototype.hasOwnProperty.call(cur, p)) cur = cur[p];
    else return fallback;
  }
  return cur ?? fallback;
};

// ---- Form parsing ----
const parseFormRun = (s) => {
  if (!s || typeof s !== "string") return null;
  const chars = s.trim().toLowerCase().split("");
  const mapPts = { w: 3, d: 1, l: 0 };
  const w = chars.filter(c => c === "w").length;
  const d = chars.filter(c => c === "d").length;
  const l = chars.filter(c => c === "l").length;
  const pts = chars.reduce((acc, c) => acc + (mapPts[c] ?? 0), 0);
  const n = chars.length || null;

  const streak = (target) => {
    let best = 0, cur = 0;
    for (const c of chars) {
      if (c === target) { cur++; best = Math.max(best, cur); }
      else cur = 0;
    }
    return best;
  };

  return {
    games: n, points: n ? pts : null, ppg: n ? pts / n : null,
    w, d, l, winRate: n ? w / n : null,
    longestW: streak("w"), longestL: streak("l"),
  };
};

const lastNForm = (s, n) => {
  const pf = parseFormRun(s);
  if (!pf || !pf.games) return null;
  const chars = s.trim().toLowerCase().split("").slice(-n);
  const mapPts = { w: 3, d: 1, l: 0 };
  const pts = chars.reduce((acc, c) => acc + (mapPts[c] ?? 0), 0);
  const g = chars.length || null;
  return {
    games: g, points: g ? pts : null, ppg: g ? pts / g : null,
    winRate: g ? chars.filter(c => c === "w").length / g : null,
    seq: chars.join(""),
  };
};

// ---- Goal timing bins helpers ----
const timingKeys15 = ["0_to_15","16_to_30","31_to_45","46_to_60","61_to_75","76_to_90"];
const timingSum = (stats, prefix, keys) => sum(keys.map(k => getPath(stats, `${prefix}${k}`, null)));
const timingShare = (stats, prefix, keys, segmentKeys) => {
  const total = timingSum(stats, prefix, keys);
  const seg = sum(segmentKeys.map(k => getPath(stats, `${prefix}${k}`, null)));
  if (!isNum(total) || total === 0 || !isNum(seg)) return null;
  return seg / total;
};

// ---- Generic probability builders ----
const probFromNumDen = (numVal, denVal) => {
  const n = num(numVal), d = num(denVal);
  const r = safeDiv(n, d);
  return r === null ? null : clamp01(r);
};

const addPctProbs = (out, srcObj, mappings, needFn) => {
  for (const m of mappings) {
    if (typeof needFn === "function") needFn(m.srcKey);
    const p = asProbFromPct(srcObj?.[m.srcKey]);
    out[m.outKey] = round(p, m.decimals ?? 4);
  }
};

// ---- Coverage helper (Hardened) ----
const coverageBlock = (S, mpO, mpH, mpA) => {
  const cov = {};

  const shotsRecO = num(S.shots_recorded_matches_num_overall);
  const shotsRecH = num(S.shots_recorded_matches_num_home);
  const shotsRecA = num(S.shots_recorded_matches_num_away);

  const offsRecO = num(S.offsidesRecorded_matches_overall);
  const offsRecH = num(S.offsidesRecorded_matches_home);
  const offsRecA = num(S.offsidesRecorded_matches_away);

  const cardsRecO = num(S.cardsRecorded_matches_overall);
  const cardsRecH = num(S.cardsRecorded_matches_home);
  const cardsRecA = num(S.cardsRecorded_matches_away);

  const cornersRecO = num(S.cornersRecorded_matches_overall);
  const cornersRecH = num(S.cornersRecorded_matches_home);
  const cornersRecA = num(S.cornersRecorded_matches_away);

  const goalsTimingRecO = num(S.seasonMatchesPlayedGoalTimingRecorded_overall);
  const goalsTimingRecH = num(S.seasonMatchesPlayedGoalTimingRecorded_home);
  const goalsTimingRecA = num(S.seasonMatchesPlayedGoalTimingRecorded_away);

  const gkRecO = num(S.goal_kicks_recorded_matches_overall);
  const gkRecH = num(S.goal_kicks_recorded_matches_home);
  const gkRecA = num(S.goal_kicks_recorded_matches_away);

  const tiRecO = num(S.throwins_recorded_matches_overall);
  const tiRecH = num(S.throwins_recorded_matches_home);
  const tiRecA = num(S.throwins_recorded_matches_away);

  const fkRecO = num(S.freekicks_recorded_matches_overall);
  const fkRecH = num(S.freekicks_recorded_matches_home);
  const fkRecA = num(S.freekicks_recorded_matches_away);

  cov.matches_played = { overall: mpO, home: mpH, away: mpA };
  cov.shots_recorded = { overall: shotsRecO, home: shotsRecH, away: shotsRecA };

  // Safe Percentage Calculation
  const safePct = (n, d) => {
    const val = safeDiv(n, d);
    return isNum(val) ? round(val * 100, 1) : null;
  };

  cov.coverage_pct = {
    shots_overall: safePct(shotsRecO, mpO),
    cards_overall: safePct(cardsRecO, mpO),
    corners_overall: safePct(cornersRecO, mpO),
    offsides_overall: safePct(offsRecO, mpO),
    goals_timing_overall: safePct(goalsTimingRecO, mpO),
    goalkicks_overall: safePct(gkRecO, mpO),
    throwins_overall: safePct(tiRecO, mpO),
    freekicks_overall: safePct(fkRecO, mpO),
  };

  return cov;
};

// ---- Denominator Fallback (Hardened) ----
const getDenom = (recVal, mpVal) => {
  const r = num(recVal);
  return (isNum(r) && r > 0) ? r : mpVal;
};

const addShotThresholdFamily = (features, S, scope, rec, mp, needFn) => {
  const den = getDenom(rec, mp);
  const thresholds = [
    { out: `p_match_shots_over225_${scope}`, numKey: `match_shots_over225_num_${scope}` },
    { out: `p_match_shots_over235_${scope}`, numKey: `match_shots_over235_num_${scope}` },
    { out: `p_match_shots_over245_${scope}`, numKey: `match_shots_over245_num_${scope}` },
    { out: `p_match_shots_over255_${scope}`, numKey: `match_shots_over255_num_${scope}` },
    { out: `p_match_shots_over265_${scope}`, numKey: `match_shots_over265_num_${scope}` },
    { out: `p_match_sot_over75_${scope}`,  numKey: `match_shots_on_target_over75_num_${scope}` },
    { out: `p_match_sot_over85_${scope}`,  numKey: `match_shots_on_target_over85_num_${scope}` },
    { out: `p_match_sot_over95_${scope}`,  numKey: `match_shots_on_target_over95_num_${scope}` },
    { out: `p_team_shots_over105_${scope}`, numKey: `team_shots_over105_num_${scope}` },
    { out: `p_team_shots_over115_${scope}`, numKey: `team_shots_over115_num_${scope}` },
    { out: `p_team_shots_over125_${scope}`, numKey: `team_shots_over125_num_${scope}` },
    { out: `p_team_shots_over135_${scope}`, numKey: `team_shots_over135_num_${scope}` },
    { out: `p_team_shots_over145_${scope}`, numKey: `team_shots_over145_num_${scope}` },
    { out: `p_team_shots_over155_${scope}`, numKey: `team_shots_over155_num_${scope}` },
    { out: `p_team_sot_over35_${scope}`, numKey: `team_shots_on_target_over35_num_${scope}` },
    { out: `p_team_sot_over45_${scope}`, numKey: `team_shots_on_target_over45_num_${scope}` },
    { out: `p_team_sot_over55_${scope}`, numKey: `team_shots_on_target_over55_num_${scope}` },
    { out: `p_team_sot_over65_${scope}`, numKey: `team_shots_on_target_over65_num_${scope}` },
  ];
  for (const t of thresholds) {
    if (typeof needFn === "function") needFn(t.numKey);
    const p = probFromNumDen(S?.[t.numKey], den);
    features[t.out] = round(p, 4);
  }
};

// ---------------------- Core feature builder ----------------------
const computeTeamFeatures = (teamObj) => {
  const stats = teamObj?.stats || {};
  const add = stats?.additional_info || {};
  const S = { ...stats, ...add };
  const missing = [];
  const need = (k) => { if (S[k] === undefined || S[k] === null || S[k] === "") missing.push(k); };

  const mpO = num(S.seasonMatchesPlayed_overall);
  const mpH = num(S.seasonMatchesPlayed_home);
  const mpA = num(S.seasonMatchesPlayed_away);

  // Denominators
  const shotsRecO = num(S.shots_recorded_matches_num_overall);
  const shotsRecH = num(S.shots_recorded_matches_num_home);
  const shotsRecA = num(S.shots_recorded_matches_num_away);

  const features = {};

  // Basic Results
  features.mp_overall = mpO;
  features.w_overall = num(S.seasonWinsNum_overall);
  features.d_overall = num(S.seasonDrawsNum_overall);
  features.l_overall = num(S.seasonLossesNum_overall);
  features.ppg_overall = num(S.seasonPPG_overall);

  features.goals_scored_pm_overall = round(safeDiv(num(S.seasonGoals_overall), mpO), 4);
  features.goals_conceded_pm_overall = round(safeDiv(num(S.seasonConceded_overall), mpO), 4);

  // xG
  features.xg_for_avg_overall = num(S.xg_for_avg_overall);
  features.xg_against_avg_overall = num(S.xg_against_avg_overall);

  // Shots (with hardened thresholds)
  features.shots_pm_overall = round(safeDiv(num(S.shotsTotal_overall), mpO), 4);
  features.sot_pm_overall = round(safeDiv(num(S.shotsOnTargetTotal_overall), mpO), 4);

  let rawConv = num(S.shot_conversion_rate_overall);
  if (isNum(rawConv) && rawConv > 1) rawConv = rawConv / 100;
  features.shot_conversion_rate_overall = round(clamp01(rawConv), 6);

  addShotThresholdFamily(features, S, "overall", shotsRecO, mpO, need);

  // Corners
  const cForO = num(S.cornersTotal_overall);
  features.corners_for_pm_overall = round(safeDiv(cForO, mpO), 4);
  features.corners_total_pm_overall = round(num(S.cornersTotalAVG_overall), 4);

  addPctProbs(features, S, [
    { outKey: "p_over85_corners_overall", srcKey: "over85CornersPercentage_overall" },
    { outKey: "p_over95_corners_overall", srcKey: "over95CornersPercentage_overall" },
    { outKey: "p_over105_corners_overall", srcKey: "over105CornersPercentage_overall" },
  ], need);

  // Cards (with prioritization fix)
  let cardsForO = num(S.cards_for_overall);
  let cardsSource = "cards_for_overall";
  if (!isNum(cardsForO)) {
    cardsForO = num(S.cardsTotal_overall);
    cardsSource = "cardsTotal_overall";
  }
  features.cards_for_pm_overall = round(safeDiv(cardsForO, mpO), 4);
  features.raw = { cards: { source: cardsSource } };

  // Form (Last X specific logic)
  const formRunOverall = S.formRun_overall;
  const formO = parseFormRun(formRunOverall);
  if (formO) {
      features.form_ppg_overall = round(formO.ppg, 4);
      features.form_winrate_overall = round(formO.winRate, 4);
  }
  features.form_run = formRunOverall;

  const coverage = coverageBlock(S, mpO, mpH, mpA);
  return { features, coverage };
};

// ---------------------- Main ----------------------
const item = (typeof items !== 'undefined' && items.length) ? items[0] : null;
const input = item ? item.json : {};

// Extract match identity (pass-through)
const match_id = input?.match_id ?? input?.fixture_id ?? null;
const side = input?.side ?? "home"; // Default to home if used in home branch

// Input is expected to be { data: [ { id:..., stats:..., last_x_match_num: 5 }, { ... last_x: 6 }, ... ] }
// or wrapped in an array.
let dataArray = [];

if (input?.data && Array.isArray(input.data)) {
    dataArray = input.data;
} else if (Array.isArray(input)) {
    // Sometimes raw array output
    dataArray = input;
} else if (input?.json?.data && Array.isArray(input.json.data)) {
    // Nested n8n item
    dataArray = input.json.data;
}

if (!dataArray.length) {
    return [{ json: { error: "No data array found for Last X matches." } }];
}

// Result Object
const result = {
    match_id,
    side,
    team_id: dataArray[0].id,
    team_name: dataArray[0].name
};

// Iterate through the 3 snapshots (5, 6, 10)
for (const snap of dataArray) {
    const x = snap.last_x_match_num; // 5, 6, or 10
    if (!x) continue;

    const computed = computeTeamFeatures(snap);
    result[`last_${x}`] = {
        features: computed.features,
        coverage: computed.coverage
    };
}

return [{ json: result }];
