# VoltForge — agent notes

- Product: AI power-electronics design platform. Roadmap + iteration log: `GOAL.md`.
- Engineering core: pure TS in `src/lib/<module>/`; contracts in `src/lib/MODULES.md`;
  shared types in `src/lib/types.ts` (FROZEN — do not edit casually; if a change is
  unavoidable, update all consumers in the same commit).
- Units: SI unless the field name says otherwise (`rdsOnMohm25`, `qgNc`, `aeMm2`).
  Steinmetz: Pv[kW/m³] = k·f[Hz]^α·B[T]^β.
- Import alias: `@/*` → `src/*`.
- Verify: `npm run typecheck && npm test && npm run build` — all three must be
  green before any commit.
- Tests live next to code: `src/lib/<module>/*.test.ts`. Physics sanity beats
  snapshot tests: assert ranges, monotonicity, energy conservation.
- Branch: `claude/ai-power-delivery-platform-ghcmyl`. Never push elsewhere.
- Deploy target: Vercel.
