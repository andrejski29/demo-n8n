// Mock n8n inputs
const items = [
  {
    json: {
      side: "home",
      match_id: 12345,
      data: [
        {
          id: 156,
          name: "Sunderland",
          stats: {
            seasonMatchesPlayed_overall: 10,
            shots_recorded_matches_num_overall: null, // Test denominator fallback
            shot_conversion_rate_overall: 15, // Test auto-scaling
            cardsTotal_overall: 5, // Test cards fallback
            additional_info: {
              corners_fh_avg_overall: 2.5
            }
          }
        }
      ]
    }
  }
];

// Load the code from final_node.js (simulated by reading file content and eval-ing relevant parts or just verifying logic structure via regex/grep if full eval is tricky due to n8n specific 'return' statements)
// Actually, since final_node.js has a top-level return, I can't just require it. 
// I will copy the core logic into this test file to verify it runs correctly in Node environment.

// ------------------------- COPIED LOGIC FROM final_node.js -------------------------

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

const parseFormRun = (s) => {
  if (!s || typeof s !== "string") return null;
  const chars = s.trim().toLowerCase().split("");
  const n = chars.length || null;
  return { games: n };
};

const lastNForm = (s, n) => { return null; }; // simplified for test

const timingKeys15 = ["0_to_15","16_to_30","31_to_45","46_to_60","61_to_75","76_to_90"];
const timingSum = (stats, prefix, keys) => sum(keys.map(k => getPath(stats, `${prefix}${k}`, null)));
const timingShare = (stats, prefix, keys, segmentKeys) => { return null; }; // simplified

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

const coverageBlock = (S, mpO, mpH, mpA) => {
  const cov = {};
  const shotsRecO = num(S.shots_recorded_matches_num_overall);
  const safePct = (n, d) => {
    const val = safeDiv(n, d);
    return isNum(val) ? round(val * 100, 1) : null;
  };
  cov.coverage_pct = {
    shots_overall: safePct(shotsRecO, mpO),
  };
  return cov;
};

const getDenom = (recVal, mpVal) => {
  const r = num(recVal);
  return (isNum(r) && r > 0) ? r : mpVal; 
};

const addShotThresholdFamily = (features, S, scope, rec, mp, needFn) => {
  const den = getDenom(rec, mp);
  // Just testing one threshold for brevity
  const thresholds = [
    { out: `p_match_shots_over225_${scope}`, numKey: `match_shots_over225_num_${scope}` },
  ];
  for (const t of thresholds) {
    if (typeof needFn === "function") needFn(t.numKey);
    const p = probFromNumDen(S?.[t.numKey], den);
    features[t.out] = round(p, 4);
  }
};

const computeTeamFeatures = (teamObj) => {
  const stats = teamObj?.stats || {};
  const add = stats?.additional_info || {};
  const S = { ...stats, ...add };
  const missing = [];
  const need = (k) => { if (S[k] === undefined || S[k] === null || S[k] === "") missing.push(k); };
  
  const mpO = num(S.seasonMatchesPlayed_overall);
  const shotsRecO = num(S.shots_recorded_matches_num_overall);

  const features = {};
  
  // TWEAK 2: Shots with fallback denominator
  // S.match_shots_over225_num_overall is undefined in mock, so prob should be null, but denominator logic runs
  addShotThresholdFamily(features, S, "overall", shotsRecO, mpO, need);

  // TWEAK 3: Conversion Rate Scaling
  let rawConv = num(S.shot_conversion_rate_overall); // 15
  if (isNum(rawConv) && rawConv > 1) rawConv = rawConv / 100;
  features.shot_conversion_rate_overall = round(clamp01(rawConv), 6);

  // TWEAK 4: Cards Fallback
  let cardsForO = num(S.cards_for_overall);
  let cardsSource = "cards_for_overall";
  if (!isNum(cardsForO)) {
    cardsForO = num(S.cardsTotal_overall); // 5
    cardsSource = "cardsTotal_overall";
  }
  features.cards_for_pm_overall = round(safeDiv(cardsForO, mpO), 4);
  features.raw = { cards: { source: cardsSource } };

  const coverage = coverageBlock(S, mpO, null, null);
  return { features, coverage };
};

const extractTeam = (x) => {
  if (!x) return null;
  if (Array.isArray(x)) x = x[0];
  if (x.data && Array.isArray(x.data)) return x.data[0];
  if (x.json) {
      if (x.json.data && Array.isArray(x.json.data)) return x.json.data[0];
      return x.json;
  }
  if (x.stats) return x;
  return x;
};

// ---------------------- Main Simulation ----------------------
const item = items[0];
const input = item.json;

// New: Identity & Side extraction
const side = input?.side || null;
const match_id = input?.match_id || input?.fixture_id || null;

const team = extractTeam(input) || extractTeam(item);
const out = computeTeamFeatures(team);

const finalOutput = {
    match_id, // Pass through
    side,     // Pass through
    team: { id: team.id, name: team.name },
    coverage: out.coverage,
    features: out.features
};

console.log(JSON.stringify(finalOutput, null, 2));
