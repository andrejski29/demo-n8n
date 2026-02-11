/**
 * n8n Code node (JavaScript) — TEAM LAST X MATCHES NORMALIZER (FULL FEATURES) - AWAY VERSION
 *
 * Adapts the "Gold Standard" normalization logic to process
 * Last 5, Last 6, and Last 10 match snapshots.
 *
 * Output Structure:
 * {
 *   match_id: ...,
 *   side: "away", // Hardened default for this branch
 *   last_5: { features: ..., coverage: ... },
 *   last_6: { features: ..., coverage: ... },
 *   last_10: { features: ..., coverage: ... }
 * }
 */

// ------------------------- Helpers -------------------------
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

// ---- Coverage helper (data completeness signals) ----
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
  cov.offsides_recorded = { overall: offsRecO, home: offsRecH, away: offsRecA };
  cov.cards_recorded = { overall: cardsRecO, home: cardsRecH, away: cardsRecA };
  cov.corners_recorded = { overall: cornersRecO, home: cornersRecH, away: cornersRecA };
  cov.goals_timing_recorded = { overall: goalsTimingRecO, home: goalsTimingRecH, away: goalsTimingRecA };
  cov.goalkicks_recorded = { overall: gkRecO, home: gkRecH, away: gkRecA };
  cov.throwins_recorded = { overall: tiRecO, home: tiRecH, away: tiRecA };
  cov.freekicks_recorded = { overall: fkRecO, home: fkRecH, away: fkRecA };

  // Explicit Coverage Percentages (Safe calc)
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

// ---- Denominator Fallback (Hardening #2) ----
const getDenom = (recVal, mpVal) => {
  const r = num(recVal);
  return (isNum(r) && r > 0) ? r : mpVal; // Fallback to MP if Rec is missing/0
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

// ---------------------- Core feature builder (FULL GOLD STANDARD) ----------------------
const computeTeamFeatures = (teamObj) => {
  const stats = teamObj?.stats || {};
  const add = stats?.additional_info || {};

  // Unified source (S)
  const S = { ...stats, ...add };

  // QA: track keys we expect but are missing
  const missing = [];
  const need = (k) => {
    if (S[k] === undefined || S[k] === null || S[k] === "") missing.push(k);
  };
  const needPath = (obj, path) => {
    const v = getPath(obj, path, undefined);
    if (v === undefined || v === null || v === "") missing.push(path);
  };

  // Matches
  need("seasonMatchesPlayed_overall");
  need("seasonMatchesPlayed_home");
  need("seasonMatchesPlayed_away");
  const mpO = num(S.seasonMatchesPlayed_overall);
  const mpH = num(S.seasonMatchesPlayed_home);
  const mpA = num(S.seasonMatchesPlayed_away);

  // Denominators (recorded)
  need("shots_recorded_matches_num_overall");
  const shotsRecO = num(S.shots_recorded_matches_num_overall);
  const shotsRecH = num(S.shots_recorded_matches_num_home);
  const shotsRecA = num(S.shots_recorded_matches_num_away);

  // Goals basic
  const goalsO = num(S.seasonGoals_overall);
  const concO  = num(S.seasonConceded_overall);
  const gTotO  = num(S.seasonGoalsTotal_overall);
  const gdO    = num(S.seasonGoalDifference_overall);

  const goalsH = num(S.seasonScoredNum_home);
  const goalsA = num(S.seasonScoredNum_away);
  const concH  = num(S.seasonConcededNum_home);
  const concA  = num(S.seasonConcededNum_away);
  const gdH    = num(S.seasonGoalDifference_home);
  const gdA    = num(S.seasonGoalDifference_away);

  // Results
  const wO = num(S.seasonWinsNum_overall);
  const dO = num(S.seasonDrawsNum_overall);
  const lO = num(S.seasonLossesNum_overall);
  const wH = num(S.seasonWinsNum_home);
  const dH = num(S.seasonDrawsNum_home);
  const lH = num(S.seasonLossesNum_home);
  const wA = num(S.seasonWinsNum_away);
  const dA = num(S.seasonDrawsNum_away);
  const lA = num(S.seasonLossesNum_away);

  // PPG
  const ppgO = num(S.seasonPPG_overall);
  const ppgH = num(S.seasonPPG_home);
  const ppgA = num(S.seasonPPG_away);

  // BTTS / CS / FTS
  const bttsO = num(S.seasonBTTSPercentage_overall);
  const bttsH = num(S.seasonBTTSPercentage_home);
  const bttsA = num(S.seasonBTTSPercentage_away);
  const csO = num(S.seasonCSPercentage_overall);
  const csH = num(S.seasonCSPercentage_home);
  const csA = num(S.seasonCSPercentage_away);
  const ftsO = num(S.seasonFTSPercentage_overall);
  const ftsH = num(S.seasonFTSPercentage_home);
  const ftsA = num(S.seasonFTSPercentage_away);

  // xG (avg)
  const xgForAvgO = num(S.xg_for_avg_overall);
  const xgForAvgH = num(S.xg_for_avg_home);
  const xgForAvgA = num(S.xg_for_avg_away);

  const xgAgAvgO  = num(S.xg_against_avg_overall);
  const xgAgAvgH  = num(S.xg_against_avg_home);
  const xgAgAvgA  = num(S.xg_against_avg_away);

  // xG totals
  const xgForTotO = num(S.xg_for_overall);
  const xgForTotH = num(S.xg_for_home);
  const xgForTotA = num(S.xg_for_away);

  const xgAgTotO  = num(S.xg_against_overall);
  const xgAgTotH  = num(S.xg_against_home);
  const xgAgTotA  = num(S.xg_against_away);

  // Shots (raw totals)
  const shotsO = num(S.shotsTotal_overall);
  const shotsH = num(S.shotsTotal_home);
  const shotsA = num(S.shotsTotal_away);

  const sotO = num(S.shotsOnTargetTotal_overall);
  const sotH = num(S.shotsOnTargetTotal_home);
  const sotA = num(S.shotsOnTargetTotal_away);

  const soffO = num(S.shotsOffTargetTotal_overall);
  const soffH = num(S.shotsOffTargetTotal_home);
  const soffA = num(S.shotsOffTargetTotal_away);

  // Corners raw
  const cForO = num(S.cornersTotal_overall);
  const cAgO  = num(S.cornersAgainst_overall);

  // Cards raw (Hardening #4: Ambiguity handling)
  let cardsForO = num(S.cards_for_overall);
  let cardsSource = "cards_for_overall";
  if (!isNum(cardsForO)) {
    cardsForO = num(S.cardsTotal_overall);
    cardsSource = "cardsTotal_overall";
  }
  const cardsAgO  = num(S.cards_against_overall);
  const cardsTotO = num(S.cards_total_overall);

  // Possession / fouls / offsides
  const possO = num(S.possessionAVG_overall);
  const possH = num(S.possessionAVG_home);
  const possA = num(S.possessionAVG_away);

  const foulsO = num(S.foulsAVG_overall);
  const foulsH = num(S.foulsAVG_home);
  const foulsA = num(S.foulsAVG_away);

  const foulsAgO = num(S.fouls_against_avg_overall);

  const offsTeamO = num(S.offsidesTeamAVG_overall);
  const offsTeamH = num(S.offsidesTeamAVG_home);
  const offsTeamA = num(S.offsidesTeamAVG_away);

  const dangAttO = num(S.dangerous_attacks_avg_overall);
  const dangAttH = num(S.dangerous_attacks_avg_home);
  const dangAttA = num(S.dangerous_attacks_avg_away);

  const attO = num(S.attacks_avg_overall);
  const attH = num(S.attacks_avg_home);
  const attA = num(S.attacks_avg_away);

  // Over/Under goals probabilities
  const ou = {
    over05: asProbFromPct(S.seasonOver05Percentage_overall),
    over15: asProbFromPct(S.seasonOver15Percentage_overall),
    over25: asProbFromPct(S.seasonOver25Percentage_overall),
    over35: asProbFromPct(S.seasonOver35Percentage_overall),
    under25: asProbFromPct(S.seasonUnder25Percentage_overall),
  };
  const ouHome = {
    over05: asProbFromPct(S.seasonOver05Percentage_home),
    over15: asProbFromPct(S.seasonOver15Percentage_home),
    over25: asProbFromPct(S.seasonOver25Percentage_home),
    over35: asProbFromPct(S.seasonOver35Percentage_home),
    under25: asProbFromPct(S.seasonUnder25Percentage_home),
  };
  const ouAway = {
    over05: asProbFromPct(S.seasonOver05Percentage_away),
    over15: asProbFromPct(S.seasonOver15Percentage_away),
    over25: asProbFromPct(S.seasonOver25Percentage_away),
    over35: asProbFromPct(S.seasonOver35Percentage_away),
    under25: asProbFromPct(S.seasonUnder25Percentage_away),
  };

  // Form
  need("formRun_overall");
  const formRunOverall = S.formRun_overall;
  const formO = parseFormRun(formRunOverall);
  const formO5  = formRunOverall ? lastNForm(formRunOverall, 5) : null;
  const formO10 = formRunOverall ? lastNForm(formRunOverall, 10) : null;

  // Goal timing shares
  for (const k of timingKeys15) {
    need(`goals_scored_min_${k}`);
    need(`goals_conceded_min_${k}`);
  }
  const scoredLateShare = timingShare(S, "goals_scored_min_", timingKeys15, ["76_to_90"]);
  const concededLateShare = timingShare(S, "goals_conceded_min_", timingKeys15, ["76_to_90"]);
  const scoredEarlyShare = timingShare(S, "goals_scored_min_", timingKeys15, ["0_to_15"]);
  const concededEarlyShare = timingShare(S, "goals_conceded_min_", timingKeys15, ["0_to_15"]);

  // 2nd half / HT identity
  const g2hAvgO = num(S.AVG_2hg_overall);
  const scored2hAvgO = num(S.scored_2hg_avg_overall);
  const conc2hAvgO   = num(S.conceded_2hg_avg_overall);

  const htPPG = num(S.HTPPG_overall);
  const scoredHTAvg = num(S.scoredAVGHT_overall);
  const concHTAvg   = num(S.concededAVGHT_overall);
  const totalHTAvg  = num(S.AVGHT_overall);

  // ---------------- Derived features ----------------
  const features = {};

  // ---- Volume & results ----
  features.mp_overall = mpO;
  features.mp_home = mpH;
  features.mp_away = mpA;

  features.w_overall = wO; features.d_overall = dO; features.l_overall = lO;
  features.w_home = wH; features.d_home = dH; features.l_home = lH;
  features.w_away = wA; features.d_away = dA; features.l_away = lA;

  features.ppg_overall = ppgO;
  features.ppg_home = ppgH;
  features.ppg_away = ppgA;
  features.ppg_home_minus_away = round(diff(ppgH, ppgA), 4);

  features.win_rate_overall = round(safeDiv(wO, mpO), 4);
  features.draw_rate_overall = round(safeDiv(dO, mpO), 4);
  features.lose_rate_overall = round(safeDiv(lO, mpO), 4);

  // ---- Goals / defence ----
  features.goals_scored_total_overall = goalsO;
  features.goals_conceded_total_overall = concO;
  features.goals_total_events_overall = gTotO;
  features.gd_total_overall = gdO;

  features.goals_scored_pm_overall = round(safeDiv(goalsO, mpO), 4);
  features.goals_conceded_pm_overall = round(safeDiv(concO, mpO), 4);
  features.goals_total_pm_overall = round(safeDiv(gTotO, mpO), 4);
  features.gd_pm_overall = round(safeDiv(gdO, mpO), 4);

  features.goals_scored_pm_home = round(safeDiv(goalsH, mpH), 4);
  features.goals_scored_pm_away = round(safeDiv(goalsA, mpA), 4);
  features.goals_conceded_pm_home = round(safeDiv(concH, mpH), 4);
  features.goals_conceded_pm_away = round(safeDiv(concA, mpA), 4);

  features.gd_pm_home = round(safeDiv(gdH, mpH), 4);
  features.gd_pm_away = round(safeDiv(gdA, mpA), 4);

  features.goals_total_pm_home = round(num(S.seasonAVG_home), 4);
  features.goals_total_pm_away = round(num(S.seasonAVG_away), 4);
  features.goals_total_pm_home_minus_away = round(diff(features.goals_total_pm_home, features.goals_total_pm_away), 4);

  features.attack_home_vs_away_ratio = round(ratio(features.goals_scored_pm_home, features.goals_scored_pm_away), 4);
  features.defence_home_vs_away_ratio = round(ratio(features.goals_conceded_pm_home, features.goals_conceded_pm_away), 4);

  // ---- BTTS / CS / FTS ----
  features.btts_pct_overall = bttsO;
  features.btts_pct_home = bttsH;
  features.btts_pct_away = bttsA;
  features.btts_home_minus_away = round(diff(bttsH, bttsA), 4);

  features.cs_pct_overall = csO;
  features.cs_pct_home = csH;
  features.cs_pct_away = csA;
  features.cs_home_minus_away = round(diff(csH, csA), 4);

  features.fts_pct_overall = ftsO;
  features.fts_pct_home = ftsH;
  features.fts_pct_away = ftsA;
  features.fts_home_minus_away = round(diff(ftsH, ftsA), 4);

  // ---- Goal O/U style ----
  features.p_over05_goals_overall = round(ou.over05, 4);
  features.p_over15_goals_overall = round(ou.over15, 4);
  features.p_over25_goals_overall = round(ou.over25, 4);
  features.p_over35_goals_overall = round(ou.over35, 4);
  features.p_under25_goals_overall = round(ou.under25, 4);

  features.p_over25_goals_home = round(ouHome.over25, 4);
  features.p_over25_goals_away = round(ouAway.over25, 4);
  features.over25_prob_home_minus_away = round(diff(ouHome.over25, ouAway.over25), 4);

  // ---- xG ----
  features.xg_for_avg_overall = xgForAvgO;
  features.xg_against_avg_overall = xgAgAvgO;
  features.xg_diff_avg_overall = round(diff(xgForAvgO, xgAgAvgO), 4);

  features.xg_for_avg_home = xgForAvgH;
  features.xg_for_avg_away = xgForAvgA;
  features.xg_against_avg_home = xgAgAvgH;
  features.xg_against_avg_away = xgAgAvgA;

  features.goals_minus_xg_avg_overall = round(diff(features.goals_scored_pm_overall, xgForAvgO), 4);
  features.conceded_minus_xg_against_avg_overall = round(diff(features.goals_conceded_pm_overall, xgAgAvgO), 4);

  features.xg_for_total_overall = xgForTotO;
  features.xg_against_total_overall = xgAgTotO;
  features.xg_diff_total_overall = round(diff(xgForTotO, xgAgTotO), 4);

  features.xg_per_shot_overall = round(safeDiv(xgForTotO, shotsO), 6);
  features.shots_per_xg_overall = round(safeDiv(shotsO, xgForTotO), 6);

  // ---- Shots efficiency ----
  features.shots_pm_overall = round(safeDiv(shotsO, mpO), 4);
  features.sot_pm_overall = round(safeDiv(sotO, mpO), 4);
  features.sot_share_overall = round(safeDiv(sotO, shotsO), 4);

  features.shots_pm_home = round(safeDiv(shotsH, mpH), 4);
  features.sot_pm_home = round(safeDiv(sotH, mpH), 4);
  features.shots_off_target_pm_home = round(safeDiv(soffH, mpH), 4);
  features.sot_share_home = round(safeDiv(sotH, shotsH), 4);

  // Conversion metrics (Hardening #3: Auto-scaling)
  need("shot_conversion_rate_overall");
  let rawConv = num(S.shot_conversion_rate_overall);
  if (isNum(rawConv) && rawConv > 1) rawConv = rawConv / 100; // Auto-scale
  features.shot_conversion_rate_overall = round(clamp01(rawConv), 6);
  features.shot_conversion_rate_pct_overall = isNum(features.shot_conversion_rate_overall)
    ? round(features.shot_conversion_rate_overall * 100, 4)
    : null;

  features.shots_per_goal_overall = num(S.shots_per_goals_scored_overall);
  features.sot_per_goal_overall = num(S.shots_on_target_per_goals_scored_overall);

  // Fallbacks
  if (!isNum(features.shots_per_goal_overall)) {
    features.shots_per_goal_overall = round(safeDiv(shotsO, goalsO), 6);
  }
  if (!isNum(features.sot_per_goal_overall)) {
    features.sot_per_goal_overall = round(safeDiv(sotO, goalsO), 6);
  }
  if (!isNum(features.shot_conversion_rate_overall)) {
    features.shot_conversion_rate_overall = round(clamp01(safeDiv(goalsO, shotsO)), 6);
    features.shot_conversion_rate_pct_overall = isNum(features.shot_conversion_rate_overall)
      ? round(features.shot_conversion_rate_overall * 100, 4)
      : null;
  }

  features.implied_goal_per_shot_overall = round(safeDiv(features.goals_scored_pm_overall, features.shots_pm_overall), 6);
  features.implied_goal_per_sot_overall = round(safeDiv(features.goals_scored_pm_overall, features.sot_pm_overall), 6);

  // ---- Shots thresholds ----
  addShotThresholdFamily(features, S, "overall", shotsRecO, mpO, need);
  addShotThresholdFamily(features, S, "home", shotsRecH, mpH, need);
  addShotThresholdFamily(features, S, "away", shotsRecA, mpA, need);

  // ---- Corners (team vs against) ----
  features.corners_for_pm_overall = round(safeDiv(cForO, mpO), 4);
  features.corners_against_pm_overall = round(safeDiv(cAgO, mpO), 4);
  features.corners_total_pm_overall = round(num(S.cornersTotalAVG_overall), 4);
  features.corners_for_share_overall = round(safeDiv(cForO, sum([cForO, cAgO])), 4);

  features.corners_diff_pm_overall = round(diff(features.corners_for_pm_overall, features.corners_against_pm_overall), 4);
  features.corners_total_pm_calc_overall = round(safeDiv(sum([cForO, cAgO]), mpO), 4);

  addPctProbs(features, S, [
    { outKey: "p_over85_corners_overall", srcKey: "over85CornersPercentage_overall" },
    { outKey: "p_over95_corners_overall", srcKey: "over95CornersPercentage_overall" },
    { outKey: "p_over105_corners_overall", srcKey: "over105CornersPercentage_overall" },
    { outKey: "p_team_over35_corners_for_overall", srcKey: "over35CornersForPercentage_overall" },
    { outKey: "p_team_over45_corners_for_overall", srcKey: "over45CornersForPercentage_overall" },
    { outKey: "p_team_over55_corners_for_overall", srcKey: "over55CornersForPercentage_overall" },
  ], need);

  // Corners timing
  need("corners_fh_avg_overall");
  need("corners_2h_avg_overall");
  features.corners_fh_avg_overall = num(S.corners_fh_avg_overall);
  features.corners_2h_avg_overall = num(S.corners_2h_avg_overall);
  features.corners_2h_vs_fh_ratio = round(ratio(features.corners_2h_avg_overall, features.corners_fh_avg_overall), 4);

  addPctProbs(features, S, [
    { outKey: "p_corners_2h_over4_overall", srcKey: "corners_2h_over4_percentage_overall" },
    { outKey: "p_corners_2h_over5_overall", srcKey: "corners_2h_over5_percentage_overall" },
    { outKey: "p_corners_2h_over6_overall", srcKey: "corners_2h_over6_percentage_overall" },
    { outKey: "p_half_with_most_corners_2h_overall", srcKey: "half_with_most_corners_is_2h_percentage_overall" },
    { outKey: "p_half_with_most_corners_1h_overall", srcKey: "half_with_most_corners_is_1h_percentage_overall" },
    { outKey: "p_half_with_most_corners_tie_overall", srcKey: "half_with_most_corners_is_draw_percentage_overall" },
  ], need);

  // ---- Cards ----
  features.cards_for_pm_overall = round(safeDiv(cardsForO, mpO), 4);
  features.cards_against_pm_overall = round(safeDiv(cardsAgO, mpO), 4);
  features.cards_total_pm_overall = round(safeDiv(cardsTotO, mpO), 4);
  features.cards_for_share_overall = round(safeDiv(cardsForO, sum([cardsForO, cardsAgO])), 4);
  features.cards_diff_pm_overall = round(diff(features.cards_for_pm_overall, features.cards_against_pm_overall), 4);

  addPctProbs(features, S, [
    { outKey: "p_over35_cards_overall", srcKey: "over35CardsPercentage_overall" },
    { outKey: "p_over45_cards_overall", srcKey: "over45CardsPercentage_overall" },
    { outKey: "p_over55_cards_overall", srcKey: "over55CardsPercentage_overall" },
  ], need);

  need("fh_cards_total_avg_overall");
  need("2h_cards_total_avg_overall");
  features.fh_cards_total_avg_overall = num(S.fh_cards_total_avg_overall);
  features.sh_cards_total_avg_overall = num(S["2h_cards_total_avg_overall"]);
  features.sh_vs_fh_cards_ratio = round(ratio(features.sh_cards_total_avg_overall, features.fh_cards_total_avg_overall), 4);

  addPctProbs(features, S, [
    { outKey: "p_half_with_most_cards_2h_overall", srcKey: "2h_half_with_most_cards_total_percentage_overall" },
    { outKey: "p_half_with_most_cards_1h_overall", srcKey: "fh_half_with_most_cards_total_percentage_overall" },

    { outKey: "p_fh_total_cards_under2_overall", srcKey: "fh_total_cards_under2_percentage_overall" },
    { outKey: "p_fh_total_cards_2to3_overall", srcKey: "fh_total_cards_2to3_percentage_overall" },
    { outKey: "p_fh_total_cards_over3_overall", srcKey: "fh_total_cards_over3_percentage_overall" },

    { outKey: "p_2h_total_cards_under2_overall", srcKey: "2h_total_cards_under2_percentage_overall" },
    { outKey: "p_2h_total_cards_2to3_overall", srcKey: "2h_total_cards_2to3_percentage_overall" },
    { outKey: "p_2h_total_cards_over3_overall", srcKey: "2h_total_cards_over3_percentage_overall" },
  ], need);

  // ---- Tempo / physical ----
  features.possession_avg_overall = possO;
  features.possession_avg_home = possH;
  features.possession_avg_away = possA;

  features.fouls_avg_overall = foulsO;
  features.fouls_avg_home = foulsH;
  features.fouls_avg_away = foulsA;

  features.fouls_against_avg_overall = foulsAgO;
  features.fouls_for_minus_against_avg_overall = round(diff(foulsO, foulsAgO), 4);

  features.offsides_team_avg_overall = offsTeamO;
  features.offsides_team_avg_home = offsTeamH;
  features.offsides_team_avg_away = offsTeamA;

  features.attacks_avg_overall = attO;
  features.attacks_avg_home = attH;
  features.attacks_avg_away = attA;

  features.dangerous_attacks_avg_overall = dangAttO;
  features.dangerous_attacks_avg_home = dangAttH;
  features.dangerous_attacks_avg_away = dangAttA;

  features.dangerous_to_attacks_ratio = round(ratio(dangAttO, attO), 4);

  addPctProbs(features, S, [
    { outKey: "p_over15_offsides_total_overall", srcKey: "over15OffsidesPercentage_overall" },
    { outKey: "p_over25_offsides_total_overall", srcKey: "over25OffsidesPercentage_overall" },
    { outKey: "p_over15_offsides_team_overall", srcKey: "over15OffsidesTeamPercentage_overall" },
  ], need);

  // ---- Set-piece / stoppage proxies ----
  features.goal_kicks_team_avg_overall = num(S.goal_kicks_team_avg_overall);
  features.goal_kicks_total_avg_overall = num(S.goal_kicks_total_avg_overall);

  addPctProbs(features, S, [
    { outKey: "p_goal_kicks_total_over125_overall", srcKey: "goal_kicks_total_over125_overall" },
    { outKey: "p_goal_kicks_total_over145_overall", srcKey: "goal_kicks_total_over145_overall" },
    { outKey: "p_goal_kicks_total_over165_overall", srcKey: "goal_kicks_total_over165_overall" },
  ], need);

  features.throwins_team_avg_overall = num(S.throwins_team_avg_overall);
  features.throwins_total_avg_overall = num(S.throwins_total_avg_overall);

  addPctProbs(features, S, [
    { outKey: "p_throwins_total_over385_overall", srcKey: "throwins_total_over385_overall" },
    { outKey: "p_throwins_total_over405_overall", srcKey: "throwins_total_over405_overall" },
    { outKey: "p_throwins_total_over425_overall", srcKey: "throwins_total_over425_overall" },
  ], need);

  features.freekicks_team_avg_overall = num(S.freekicks_team_avg_overall);
  features.freekicks_total_avg_overall = num(S.freekicks_total_avg_overall);

  addPctProbs(features, S, [
    { outKey: "p_freekicks_total_over205_overall", srcKey: "freekicks_total_over205_overall" },
    { outKey: "p_freekicks_total_over235_overall", srcKey: "freekicks_total_over235_overall" },
    { outKey: "p_freekicks_total_over265_overall", srcKey: "freekicks_total_over265_overall" },
  ], need);

  // ---- Penalties ----
  features.penalties_won_pm_overall = num(S.penalties_won_per_match_overall);
  features.penalties_conceded_overall = num(S.penalties_conceded_overall);
  features.p_penalty_in_match_overall = round(asProbFromPct(S.penalty_in_a_match_percentage_overall), 4);

  // ---- Timing / game-state ----
  features.scored_early_share = round(scoredEarlyShare, 4);
  features.scored_late_share = round(scoredLateShare, 4);
  features.conceded_early_share = round(concededEarlyShare, 4);
  features.conceded_late_share = round(concededLateShare, 4);

  // ---- HT / 2H profiles ----
  features.ht_ppg_overall = htPPG;
  features.ht_scored_avg_overall = scoredHTAvg;
  features.ht_conceded_avg_overall = concHTAvg;
  features.ht_goals_total_avg_overall = totalHTAvg;

  features.goals_2h_avg_overall = g2hAvgO;
  features.scored_2h_avg_overall = scored2hAvgO;
  features.conceded_2h_avg_overall = conc2hAvgO;

  addPctProbs(features, S, [
    { outKey: "p_half_with_most_goals_2h_overall", srcKey: "half_with_most_goals_is_2h_percentage_overall" },
    { outKey: "p_half_with_most_goals_1h_overall", srcKey: "half_with_most_goals_is_1h_percentage_overall" },
    { outKey: "p_half_with_most_goals_tie_overall", srcKey: "half_with_most_goals_is_tie_percentage_overall" },
  ], need);

  addPctProbs(features, S, [
    { outKey: "p_over05_2h_goals_overall", srcKey: "over05_2hg_percentage_overall" },
    { outKey: "p_over15_2h_goals_overall", srcKey: "over15_2hg_percentage_overall" },
    { outKey: "p_over25_2h_goals_overall", srcKey: "over25_2hg_percentage_overall" },
  ], need);

  addPctProbs(features, S, [
    { outKey: "p_leading_at_ht_overall", srcKey: "leadingAtHTPercentage_overall" },
    { outKey: "p_drawing_at_ht_overall", srcKey: "drawingAtHTPercentage_overall" },
    { outKey: "p_trailing_at_ht_overall", srcKey: "trailingAtHTPercentage_overall" },
  ], need);

  // ---- Exact team goals (percentages) ----
  addPctProbs(features, S, [
    { outKey: "p_team_goals_0_ft_overall", srcKey: "exact_team_goals_0_ft_percentage_overall" },
    { outKey: "p_team_goals_1_ft_overall", srcKey: "exact_team_goals_1_ft_percentage_overall" },
    { outKey: "p_team_goals_2_ft_overall", srcKey: "exact_team_goals_2_ft_percentage_overall" },
    { outKey: "p_team_goals_3_ft_overall", srcKey: "exact_team_goals_3_ft_percentage_overall" },
  ], need);

  // ---- Exact total goals (COUNTS -> compute probs) ----
  const exactTotalCounts = [
    ["exact_total_goals_0_ft_overall", "p_total_goals_0_ft_overall"],
    ["exact_total_goals_1_ft_overall", "p_total_goals_1_ft_overall"],
    ["exact_total_goals_2_ft_overall", "p_total_goals_2_ft_overall"],
    ["exact_total_goals_3_ft_overall", "p_total_goals_3_ft_overall"],
    ["exact_total_goals_4_ft_overall", "p_total_goals_4_ft_overall"],
    ["exact_total_goals_5_ft_overall", "p_total_goals_5_ft_overall"],
    ["exact_total_goals_6_ft_overall", "p_total_goals_6_ft_overall"],
    ["exact_total_goals_7_ft_overall", "p_total_goals_7_ft_overall"],
  ];
  for (const [k, outK] of exactTotalCounts) {
    need(k);
    const c = num(S[k]);
    features[outK] = round(probFromNumDen(c, mpO), 4);
  }

  // ---- First goal scored tendency ----
  addPctProbs(features, S, [
    { outKey: "p_first_goal_scored_overall", srcKey: "firstGoalScoredPercentage_overall" },
    { outKey: "p_first_goal_scored_home", srcKey: "firstGoalScoredPercentage_home" },
    { outKey: "p_first_goal_scored_away", srcKey: "firstGoalScoredPercentage_away" },
  ], need);

  // ---- Form / momentum ----
  if (formO) {
    features.form_games_overall = formO.games;
    features.form_ppg_overall = round(formO.ppg, 4);
    features.form_winrate_overall = round(formO.winRate, 4);
    features.form_longest_w_streak = formO.longestW;
    features.form_longest_l_streak = formO.longestL;
  }
  if (formO5) {
    features.form5_ppg = round(formO5.ppg, 4);
    features.form5_winrate = round(formO5.winRate, 4);
    features.form5_seq = formO5.seq;
  }
  if (formO10) {
    features.form10_ppg = round(formO10.ppg, 4);
    features.form10_winrate = round(formO10.winRate, 4);
    features.form10_seq = formO10.seq;
  }

  // ---- Risk & misc ----
  features.prediction_risk = num(teamObj.prediction_risk ?? teamObj.risk ?? S.risk);
  features.home_attack_advantage = num(S.homeAttackAdvantage);
  features.home_defence_advantage = num(S.homeDefenceAdvantage);
  features.home_overall_advantage = num(S.homeOverallAdvantage);

  // ---------------- RAW block ----------------
  features.raw = {
    matches: { mp_overall: mpO, mp_home: mpH, mp_away: mpA },
    results: { wO, dO, lO, wH, dH, lH, wA, dA, lA, ppgO, ppgH, ppgA },
    goals: {
      goalsO, concO, gTotO, gdO,
      goalsH, goalsA, concH, concA, gdH, gdA,
      seasonAVG_home: num(S.seasonAVG_home),
      seasonAVG_away: num(S.seasonAVG_away),
    },
    xg: {
      xgForAvgO, xgAgAvgO, xgForAvgH, xgForAvgA, xgAgAvgH, xgAgAvgA,
      xgForTotO, xgAgTotO, xgForTotH, xgForTotA, xgAgTotH, xgAgTotA,
    },
    shots: {
      shotsO, shotsH, shotsA,
      sotO, sotH, sotA,
      soffO, soffH, soffA,
      shotsRecO, shotsRecH, shotsRecA,
      shot_conversion_rate_pct_overall: features.shot_conversion_rate_pct_overall,
      shot_conversion_rate_overall: features.shot_conversion_rate_overall,
      shots_per_goal_overall: features.shots_per_goal_overall,
      sot_per_goal_overall: features.sot_per_goal_overall,
    },
    corners: {
      cForO, cAgO,
      cornersTotalAVG_overall: num(S.cornersTotalAVG_overall),
      corners_fh_avg_overall: num(S.corners_fh_avg_overall),
      corners_2h_avg_overall: num(S.corners_2h_avg_overall),
    },
    cards: {
      cardsForO, cardsAgO, cardsTotO,
      fh_cards_total_avg_overall: num(S.fh_cards_total_avg_overall),
      sh_cards_total_avg_overall: num(S["2h_cards_total_avg_overall"]),
      source: cardsSource, // QA trace
    },
    tempo: {
      possO, possH, possA,
      foulsO, foulsH, foulsA,
      fouls_against_avg_overall: foulsAgO,
      offsTeamO, offsTeamH, offsTeamA,
      attO, attH, attA,
      dangAttO, dangAttH, dangAttA,
    },
    ht_2h: {
      htPPG,
      scoredHTAvg,
      concHTAvg,
      totalHTAvg,
      g2hAvgO,
      scored2hAvgO,
      conc2hAvgO,
    },
    timing_bins_15m: (() => {
      const out = { goals_scored: {}, goals_conceded: {} };
      for (const k of timingKeys15) {
        out.goals_scored[k] = num(getPath(S, `goals_scored_min_${k}`, null));
        out.goals_conceded[k] = num(getPath(S, `goals_conceded_min_${k}`, null));
      }
      return out;
    })(),
    form: { formRun_overall: formRunOverall ?? null },
  };

  // QA: attach missing keys list
  features.coverage_missing_keys = missing.length ? Array.from(new Set(missing)) : [];

  // Keep numeric stable
  for (const k of Object.keys(features)) {
    const v = features[k];
    if (isNum(v)) features[k] = v;
  }

  const coverage = coverageBlock(S, mpO, mpH, mpA);
  return { features, coverage };
};

// ---------------------- Main ----------------------
const item = (typeof items !== 'undefined' && items.length) ? items[0] : null;
const input = item ? item.json : {};

// Extract match identity (pass-through)
const match_id = input?.match_id ?? input?.fixture_id ?? null;
const side = input?.side ?? "away"; // Hard-default for Away Branch

// Input normalization
let dataArray = [];

if (input?.data && Array.isArray(input.data)) {
    dataArray = input.data;
} else if (Array.isArray(input)) {
    dataArray = input;
} else if (input?.json?.data && Array.isArray(input.json.data)) {
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

// Iterate through snapshots
for (const snap of dataArray) {
    const x = snap.last_x_match_num; // 5, 6, 10
    if (!x) continue;

    const computed = computeTeamFeatures(snap);
    result[`last_${x}`] = {
        features: computed.features,
        coverage: computed.coverage
    };
}

return [{ json: result }];
