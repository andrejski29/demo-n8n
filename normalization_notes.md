# Home Team Normalization (V2) - Documentation

## 1. Overview
The V2 Normalization redesign transforms the massive, noisy FootyStats `Home_Team.json` payload into a compact, high-signal object optimized for the Poisson predictor engine.

## 2. Dropped Fields & Rationale

We aggressively filtered the raw dataset (~200+ keys) down to ~60 critical fields.

| Category | Dropped Example | Rationale |
| :--- | :--- | :--- |
| **Granular Thresholds** | `seasonOver05Percentage_home` ... `seasonOver55Percentage_home` | We only need standard betting lines (1.5, 2.5, 3.5). The extremes (0.5, 5.5) add noise. |
| **Redundant Totals** | `seasonGoalsTotal_home` | Mathematically redundant if we have `MatchesPlayed` + `GoalsScored` + `GoalsConceded`. |
| **Min/Max Stats** | `seasonGoalsMin_home`, `cornersHighest_overall` | These are outliers, not central tendencies useful for Poisson distribution. |
| **Verbose Names** | `seasonMatchesPlayedGoalTimingRecorded_home` | Replaced with compact `quality.matches_home`. |
| **Raw Arrays** | `last_5_matches` (Raw) | Form data is handled via the separate `Form` branch, not embedded in the Team Season object. |

## 3. Optional Future Expansions

These fields are **available** in the raw data but **omitted** from V2 to keep it lean. They can be re-enabled if specific models require them:

1.  **Throw-ins:** `throwins_team_avg_home` (Available but low predictive value for core markets).
2.  **Free Kicks:** `freekicks_team_avg_home` (Available).
3.  **Goal Kicks:** `goal_kicks_team_avg_home` (Available).
4.  **Exact Goal Counts:** `exact_total_goals_X_ft` (The Poisson model generates these probabilities itself; raw historic counts are less stable).
5.  **Time-Segmented Goals:** `goals_scored_min_0_to_15` (Useful for live betting models, but overkill for pre-match V1).

## 4. Architecture Recommendation

**We strictly recommend "Option 2: Normalize Per-Branch".**

*   **Process:** Run `normalizeHomeTeam()` inside the `Home Team API` branch *before* it reaches the Merge node.
*   **Benefit:** Reduces JSON payload size by ~80% before the memory-intensive Merge step.
*   **Safety:** Isolates data parsing errors to the specific branch (Home/Away) rather than crashing the main engine.
