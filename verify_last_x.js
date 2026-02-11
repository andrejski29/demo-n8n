// Mock input for Last X verification
const items = [
  {
    json: {
      match_id: 123,
      side: "home",
      data: [
        {
          id: 156,
          name: "Sunderland",
          last_x_match_num: 5,
          stats: {
            seasonMatchesPlayed_overall: 5,
            seasonGoals_overall: 5,
            shots_recorded_matches_num_overall: 5,
            shotsTotal_overall: 59,
            shot_conversion_rate_overall: 8, // Should auto-scale to 0.08
            cards_for_overall: 17 // Cards For present
          },
          additional_info: {
            formRun_overall: "dldwl"
          }
        },
        {
          id: 156,
          name: "Sunderland",
          last_x_match_num: 10,
          stats: {
            seasonMatchesPlayed_overall: 10,
            seasonGoals_overall: 7,
            shots_recorded_matches_num_overall: 10,
            shotsTotal_overall: 104,
            shot_conversion_rate_overall: 0.07, // Already scaled
            // Missing cards_for, checking fallback? (Not needed if logic is robust, but good to know)
             cardsTotal_overall: 28 
          },
          additional_info: {
             formRun_overall: "lwddddldwl"
          }
        }
      ]
    }
  }
];

// --- PASTE normalize_last_x.js LOGIC HERE (Simulated) ---

// (Re-declaring helpers for simulation context)
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const safeDiv = (a, b) => { const A = num(a), B = num(b); if (!isNum(A) || !isNum(B) || B === 0) return null; return A / B; };
const clamp01 = (x) => { if (!isNum(x)) return null; return Math.max(0, Math.min(1, x)); };
const asProbFromPct = (p) => { const v = num(p); if (!isNum(v)) return null; return clamp01(v / 100); };
const round = (v, d = 4) => (isNum(v) ? Number(v.toFixed(d)) : null);
const sum = (arr) => { let s = 0, ok = false; for (const v of arr) { const n = num(v); if (isNum(n)) { s += n; ok = true; } } return ok ? s : null; };
const getPath = (obj, path, fallback = null) => { const parts = path.split("."); let cur = obj; for (const p of parts) { if (cur && Object.prototype.hasOwnProperty.call(cur, p)) cur = cur[p]; else return fallback; } return cur ?? fallback; };
const parseFormRun = (s) => { if (!s) return null; return { ppg: 1.5 }; }; // Stub
const coverageBlock = (S, mpO, mpH, mpA) => { return { matches_played: mpO }; }; // Stub
const addShotThresholdFamily = () => {}; // Stub
const addPctProbs = () => {}; // Stub

const computeTeamFeatures = (teamObj) => {
  const stats = teamObj?.stats || {};
  const add = stats?.additional_info || {};
  const S = { ...stats, ...add };
  
  const mpO = num(S.seasonMatchesPlayed_overall);
  const features = {};
  
  features.mp_overall = mpO;
  features.goals_scored_pm_overall = round(safeDiv(num(S.seasonGoals_overall), mpO), 4);
  features.shots_pm_overall = round(safeDiv(num(S.shotsTotal_overall), mpO), 4);
  
  let rawConv = num(S.shot_conversion_rate_overall);
  if (isNum(rawConv) && rawConv > 1) rawConv = rawConv / 100;
  features.shot_conversion_rate_overall = round(clamp01(rawConv), 6);

  let cardsForO = num(S.cards_for_overall);
  let cardsSource = "cards_for_overall";
  if (!isNum(cardsForO)) {
    cardsForO = num(S.cardsTotal_overall);
    cardsSource = "cardsTotal_overall";
  }
  features.cards_for_pm_overall = round(safeDiv(cardsForO, mpO), 4);
  features.raw = { cards: { source: cardsSource } };

  return { features, coverage: {} };
};

// --- MAIN LOOP SIMULATION ---
const input = items[0].json;
const dataArray = input.data;
const result = {
    match_id: input.match_id,
    side: input.side,
    team_id: dataArray[0].id
};

for (const snap of dataArray) {
    const x = snap.last_x_match_num;
    if (!x) continue;
    const computed = computeTeamFeatures(snap);
    result[`last_${x}`] = computed;
}

console.log(JSON.stringify(result, null, 2));
