# Adding Device Physics Records (DEVICE_PHYSICS)

## Pattern
Each device physics record in `src/lib/data/devicePhysics.ts` must match the `DevicePhysics` interface:

```typescript
{
  rNorm100: number,          // Rds(on) normalized at 100°C vs 25°C
  rNorm150: number,          // Rds(on) normalized at 150°C vs 25°C
  kDynHard: number,          // Dynamic Rds multiplier (hard switching)
  kDynSoft: number,          // Dynamic Rds multiplier (soft switching)
  gfsS: number,              // Transconductance at Miller plateau (Siemens)
  qgs2Nc: number,            // Gate-source plateau charge (nC)
  qgdNc: number,             // Gate-drain Miller charge (nC)
  rgIntOhm: number,          // Internal gate resistance (Ω)
  rgExtOnOhm: number,        // External gate ON resistance (Ω)
  rgExtOffOhm: number,       // External gate OFF resistance (Ω)
  vgsOffV: number,           // Off-state gate voltage (V)
  cossFit?: { c0F, gamma },  // Power-law Coss fit (Coss = c0F * v^-gamma)
  cossTable?: { vV, qossNc, eossUj }, // Tabular Coss (preferred if available)
  rrevFactor: number,        // Reverse conduction factor
  vsdBody25V?: number,       // SiC body diode drop (V) - SiC only
  provenance: string,        // Source documentation
}
```

## Temperature Scaling (rNorm100, rNorm150)

Extract from datasheet:
1. Find Rds(on) @ 25°C, 100°C, 150°C (or fit from RDS(on) vs Tj curve)
2. Calculate ratios:
   - rNorm100 = Rds(on)_100C / Rds(on)_25C
   - rNorm150 = Rds(on)_150C / Rds(on)_25C

Example (LMG3522):
- Rds(on) @ 25°C = 30 mΩ (typ)
- Rds(on) @ 100°C ≈ 43.5 mΩ (from normalized curve)
- Rds(on) @ 150°C ≈ 58.5 mΩ
- rNorm100 = 43.5 / 30 = 1.45
- rNorm150 = 58.5 / 30 = 1.95

## Gate Charge Breakdown (qgs2Nc, qgdNc)

From datasheet gate charge table:
- **Qgs2**: Post-threshold gate charge (current-rise phase). Usually ~30-40% of Qg after Vth
- **Qgd**: Gate-drain (Miller) charge. Usually largest phase during voltage swing
- Total Qg = Qgs1 + Qgs2 + Qgd

Example (LMG3522 with integrated driver):
- Total gate charge ≈ 2 nC (low due to integrated driver)
- Qgs2 ≈ 0.8 nC (post-threshold)
- Qgd ≈ 1.2 nC (Miller)

## Coss Modeling (Power-Law Fit)

If datasheet provides Coss(V) curve or discrete points:

### Power-Law Fit (simpler, for external gate drive)
1. Extract Qoss and Eoss at two voltages (usually Vds_max/2 and Vds_max)
2. Fit to Coss(v) = C0·v^−γ
3. Verify with ρ = V·Qoss/Eoss relation (ρ > 2 for valid Coss, ≤ 2 indicates nonlinear behavior)

Formula:
```
Qoss(V) = C0·V^(1−γ)/(1−γ)
Eoss(V) = C0·V^(2−γ)/(2−γ)
ρ = (2−γ)/(1−γ)
γ = (ρ−2)/(ρ−1)  [if ρ > 2]
C0 = Qoss(V)·(1−γ)/V^(1−γ)
```

Example (LMG3522):
- Qoss @ 325 V = 70 nC, Eoss = 10 µJ
- ρ = 325·70e-9 / 10e-6 = 2.275 > 2 ✓
- γ = (2.275−2)/(2.275−1) = 0.2157
- C0 = 70e-9·(1−0.2157)/325^(1−0.2157) = 5.88e-10 F

### Tabular Coss (more accurate, for detailed designs)
Integrate datasheet Coss vs V curve to create piecewise table:
```
vV: [0, 37.5, 75, ..., 1200],  // Drain voltage points
qossNc: [...],                  // ∫Coss dv (monotonic)
eossUj: [...],                  // ∫v·Coss dv (switching energy)
```

## Dynamic Rds(on) - k_dyn

From datasheet hard-switching loss (Eon/Eoff) curves or normalized Rds vs frequency:
- GaN (low trapping): kDynHard = 1.05–1.10, kDynSoft = 1.02–1.03
- SiC (no dynamic Ron): kDynHard = 1.0, kDynSoft = 1.0

Example (LMG3522 GaN):
- kDynHard = 1.10 (10% rise under hard switching)
- kDynSoft = 1.03 (3% rise under soft switching)

## Provenance Documentation

Include exact source:
```
"Infineon GAN650_40V datasheet rev 1.2, sheet 5: Qoss/Eoss @325V from curve; 
Rds(on) normalized from figure 3.2; gate charge table 3.5; k_dyn from hard-switching 
loss characteristic figure 4.1"
```

## Adding to DEVICE_PHYSICS

1. Find or create SWITCH_DEVICE entry for the part (if not in DB)
2. Add physics record with matching ID:
   ```typescript
   export const DEVICE_PHYSICS: Record<string, Partial<DevicePhysics>> = {
     // ... existing ...
     "INFINEON_GAN650_40V": {
       rNorm100: ...,
       // ... all required fields ...
       provenance: "...",
     },
   };
   ```
3. Update type constraints if using new format (e.g., tabular vs power-law Coss)
4. Run tests to verify no regressions

## Integration Checklist

- [ ] Extract all parameters from datasheet(s)
- [ ] Calculate rNorm100, rNorm150 from Tj curves or table
- [ ] Extract gate charge breakdown and verify sum
- [ ] Choose Coss model (power-law vs tabular based on accuracy needs)
- [ ] Calculate γ and C0 (power-law) or integrate table (tabular)
- [ ] Verify ρ > 2 for power-law (physical validity)
- [ ] Find or verify SWITCH_DEVICE ID match
- [ ] Add record to DEVICE_PHYSICS
- [ ] Document provenance with exact datasheet references
- [ ] Run `npm test -- src/lib/data/devicePhysics.test.ts`
- [ ] Run full test suite: `npm test`
- [ ] Verify calibration anchor deltas improve (especially A2)
