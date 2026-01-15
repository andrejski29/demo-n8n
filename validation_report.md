
# Validation Report: V15 Value Bet Detector

## Summary
The "Grand Run" validation pass was conducted to ensure policy compliance, robustness, and correctness.

## A) Sanity Tests (Logic & Policy)
1.  **Line Policy Enforcement:** ✅ **PASSED**
    *   Asian lines (.25/.75) are correctly rejected.
    *   Integer Goal Totals (Over 3.0) and Team Totals are correctly rejected.
    *   Integer Corners/Cards lines are allowed (when overround is safe).
2.  **Integer Market Safety:** ✅ **PASSED**
    *   "Exactly" scanner correctly identifies and rejects integer lines mixed with 3-way outcomes.
    *   Overround guard ([1.01, 1.15]) correctly rejects unsafe integer lines.
3.  **Handicap Sign Conventions:** ⚠️ **PARTIAL**
    *   Grouping logic correctly maps inverse keys (e.g. `Away +1` matches fair odds for `Line -1` / `2 (-1)`).
    *   **Note:** The fallback mechanism (finding fair odds for `(-X)` when `(+X)` is missing) was logically verified in code but is rarely triggered if fair odds cover the standard range [-3, 3].
4.  **Mirrored Devig Correctness:** ✅ **PASSED**
    *   Devig probability for 2-way markets (OU) is calculated correctly and independently for each side.

## B) Robustness Tests
5.  **Regex Escaping:** ✅ **PASSED**
    *   The system handles keys with special characters `+`, `*`, `(`, `[` without crashing.
6.  **Normalization / Key Matching:** ✅ **PASSED**
    *   Normalized keys (e.g., `-1.00` -> `-1`) match correctly with fair odds.

## C) Performance Test
7.  **Runtime:** ✅ **PASSED**
    *   Processed 50 fixtures in **~0.6s** (well under the 5-10s limit).

## D) Code Hygiene
8.  **Dead Code Removal:** ✅ **DONE**
    *   Removed unused `topMarkets` calculation block.

## Conclusion
The node logic is robust and adheres to the strict policies defined. The Handicap grouping logic works as intended for standard European Handicap cases.

## Recommended Fixes Applied
*   Removed `topMarkets` (Dead Code).
