// Mock n8n 'items' with EDGE CASES to verify hardening
const items = [
  {
    json: {
      "success": true,
      "data": [
        {
          "id": 666,
          "name": "EdgeCase FC",
          "season": "2025/2026",
          "stats": {
            "seasonMatchesPlayed_overall": 10,
            "seasonMatchesPlayed_home": 5,
            "seasonMatchesPlayed_away": 5,
            
            // EDGE CASE: No "recorded" fields (should fallback to matches played)
            "shots_recorded_matches_num_overall": null, 
            
            // EDGE CASE: Conversion rate as percent (15 instead of 0.15)
            "shot_conversion_rate_overall": 15,
            "shots_per_goals_scored_overall": 6.66,
            "shots_on_target_per_goals_scored_overall": 2.2,

            // EDGE CASE: Missing "cards_for" but has "cardsTotal" (fallback logic)
            "cardsTotal_overall": 20,
            
            "seasonOver05Percentage_overall": 87,
            "additional_info": {
              "half_with_most_corners_is_2h_percentage_overall": 56,
              // Unified S check: this exists here, so need() shouldn't flag it missing
              "corners_fh_avg_overall": 3.43,
              "corners_2h_avg_overall": 4.91
            }
          }
        }
      ]
    }
  }
];

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

// ---- TWEAK 2: Denominator Fallback ----
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

const getDenom = (recVal, mpVal) => {
    const r = num(recVal);
    return (isNum(r) && r > 0) ? r : mpVal;
};

const addShotThresholdFamily = (features, S, scope, rec, mp, needFn) => {
  const den = getDenom(rec, mp); // Fallback used here
  const thresholds = [
    { out: `p_match_shots_over225_${scope}`, numKey: `match_shots_over225_num_${scope}` },
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

  // TWEAK 1: Unified S
  const S = { ...stats, ...add };

  const missing = [];
  const need = (k) => {
    if (S[k] === undefined || S[k] === null || S[k] === "") missing.push(k);
  };

  const mpO = num(S.seasonMatchesPlayed_overall);
  const shotsRecO = num(S.shots_recorded_matches_num_overall); // Expect null in test

  const features = {};

  // TWEAK 2: Shots with fallback denominator
  addShotThresholdFamily(features, S, "overall", shotsRecO, mpO, need);

  // TWEAK 3: Conversion Rate Scaling
  let rawConv = num(S.shot_conversion_rate_overall); // 15
  if (isNum(rawConv) && rawConv > 1) rawConv = rawConv / 100;
  features.shot_conversion_rate_overall = round(clamp01(rawConv), 6);

  // TWEAK 4: Cards Fallback
  let cardsForO = num(S.cards_for_overall);
  let cardsSource = "cards_for_overall";
  if (!isNum(cardsForO)) {
    cardsForO = num(S.cardsTotal_overall); // 20
    cardsSource = "cardsTotal_overall";
  }
  features.cards_for_pm_overall = round(safeDiv(cardsForO, mpO), 4);
  features.raw = { cards: { source: cardsSource } };

  return features;
};

const extractTeam = (x) => {
  if (Array.isArray(x) && x.length && x[0]?.stats) return x[0];
  if (x?.data?.[0]?.stats) return x.data[0]; // Wrapper handling
  return null;
};

// ---------------------- Main Execution ----------------------
const input = items[0].json;
const team = extractTeam(input);
const out = computeTeamFeatures(team);

console.log(JSON.stringify(out, null, 2));
