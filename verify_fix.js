// Mock n8n 'items'
const items = [
  {
    json: {
      "success": true,
      "data": [
        {
          "id": 156,
          "name": "Sunderland",
          "season": "2025/2026",
          "stats": {
            "seasonMatchesPlayed_overall": 23,
            "seasonMatchesPlayed_home": 11,
            "seasonMatchesPlayed_away": 12,
            "cornersRecorded_matches_overall": 23,
            "seasonOver05Percentage_overall": 87,
            "additional_info": {
              "half_with_most_corners_is_2h_percentage_overall": 56,
              "half_with_most_corners_is_1h_percentage_overall": 26,
              "half_with_most_corners_is_draw_percentage_overall": 17,
              "corners_fh_avg_overall": 3.43,
              "corners_2h_avg_overall": 4.91
            }
          }
        }
      ]
    }
  }
];

// ------------------------- Helpers (Copied from fix_node.js) -------------------------
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

const addPctProbs = (out, srcObj, mappings, needFn) => {
  for (const m of mappings) {
    if (typeof needFn === "function") needFn(m.srcKey);
    const p = asProbFromPct(srcObj?.[m.srcKey]);
    out[m.outKey] = round(p, m.decimals ?? 4);
  }
};

const coverageBlock = (stats, add, mpO, mpH, mpA) => {
  const cov = {};
  const cornersRecO = num(stats?.cornersRecorded_matches_overall);
  
  cov.corners_recorded = { overall: cornersRecO };
  
  // Explicit Coverage Percentages
  cov.coverage_pct = {
    corners_overall: round(safeDiv(cornersRecO, mpO) * 100, 1),
  };

  return cov;
};


// ---------------------- Core feature builder ----------------------
const computeTeamFeatures = (teamObj) => {
  const stats = teamObj?.stats || {};
  const add = stats?.additional_info || {};

  // Unified source (S) - The FIX
  const S = { ...stats, ...add };
  const features = {};
  const need = () => {};

  // Using 'S' fixes nulls for keys in additional_info
  addPctProbs(features, S, [
    { outKey: "p_half_with_most_corners_2h_overall", srcKey: "half_with_most_corners_is_2h_percentage_overall" },
  ], need);

  // Matches
  const mpO = num(S.seasonMatchesPlayed_overall);
  const mpH = num(S.seasonMatchesPlayed_home);
  const mpA = num(S.seasonMatchesPlayed_away);

  const coverage = coverageBlock(stats, add, mpO, mpH, mpA);
  return { features, coverage };
};

const extractTeam = (x) => {
  if (Array.isArray(x) && x.length && x[0]?.stats) return x[0];
  return null;
};

// ---------------------- Main Execution ----------------------
const input = items[0].json;
const team = extractTeam(input.data);
const out = computeTeamFeatures(team);

console.log(JSON.stringify(out, null, 2));
