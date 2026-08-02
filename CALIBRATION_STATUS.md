# VoltForge Calibration Status — August 2, 2026

## Active Anchors (2/3 implemented)

| Anchor | Vendor | Topology | Spec | Published | Model | Δη | Status |
|--------|--------|----------|------|-----------|-------|-----|--------|
| **A1** | TI | Phase-Shifted FB + Active Clamp | 400V→12V, 3kW | 97.74% | 93.97% | −3.77% | **FAIL** (−0.5% gate) |
| **A2** | Infineon | ISOP Half-Bridge LLC | 400V→50V, 6kW | 98.00% | 95.00% | −3.00% | **FAIL** (−0.5% gate) |

## Key Findings

### 1. Systematic Physics Issue (Not Topology-Specific)
Both A1 and A2 show ~3% negative delta across different:
- Vendors (TI vs Infineon)
- Topologies (phase-shifted FB vs ISOP LLC)
- Power levels (3 kW vs 6 kW)
- Output voltages (12V vs 50V)

**Conclusion:** The underestimation is **systematic, not topology-specific**. Likely causes:
1. **Device physics overestimated** (Rds(on) temp coefficient, gate loss, switching transitions)
2. **Magnetics losses overestimated** (Dowell copper loss model, Steinmetz core loss, transformer efficiency)
3. **Soft-switching gains underestimated** (ZVS fraction, soft switching loss reduction)

### 2. Optimizer Limitation Discovered
6 kW designs with **12V output (500A current)** cause **numerical issues** in magnetics loss calculation:
- Tested: 400V→12V, 800V→12V both fail
- Root: Likely Dowell harmonic sum divergence or copper loss calculation at high current
- Workaround: Used 400V→50V representative (125A) which succeeds

**Implication:** Need to add guard against extreme current densities in magnetics design phase.

## Pending Anchors

- **A3 (Navitas NV6xxx):** Portal access blocked, requires direct vendor contact or design community materials
- **A4/A5 (TI Extended Series):** PMP23081, PMP23110 portals return 404

## Next Actions

### Priority 1: Identify Physics Tuning Target
With 2 anchors showing −3% systematically:
1. Get A3 (Navitas) if accessible → confirms pattern holds across 3 vendors
2. Run diagnostic on device physics (U1-U10 TECHPLAN):
   - Compare model Rds(on), gate charge, switching loss vs datasheet
   - Compare Coss energy loss calculation vs measured
3. Run diagnostic on magnetics (U11-U20 TECHPLAN):
   - Compare Dowell copper loss vs measured designs
   - Verify Steinmetz core loss α, β parameters vs. core vendor data
   - Check transformer efficiency assumptions

### Priority 2: Fix Optimizer for High-Current Designs
- Add safety checks in magnetics designer to catch numerical divergence
- Clamp output current to physically reasonable range or fall back to simpler model
- Document current density limits (e.g., <400A/cm² for litz wire)

### Priority 3: Expand Anchor Set
- Contact Navitas design community or sales for NV6xxx reference design specs
- Search for additional open-source reference designs (CERN, university labs, etc.)
- Target: ≥3 anchors at ±0.5% gate to unblock public accuracy claims

## Test Coverage
- Calibration harness: All 10 tests passing
- Full suite: 652 tests green, typecheck green, build green
- Regression suite on Rth magnetics clamp: Verified to hold across 150W–5kW range

## Iteration Summary
Discovered and fixed critical TI published efficiency value, added Infineon anchor, identified systematic −3% physics tuning direction (device or magnetics). User feedback on "giving up too easily" validated—research yielded concrete data guiding next phase.
