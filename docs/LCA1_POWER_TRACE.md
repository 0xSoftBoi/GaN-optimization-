# LCA-1 workload power → VoltForge

This integration turns an accelerator activity trace into two separate outputs:

1. a normal VoltForge `DesignSpec` sized from trace peak power, shared-rail load,
   and explicit engineering headroom; and
2. a transient summary that preserves energy, average/peak/P95 power, load step,
   slew, peak activity state, and state duty cycle.

That separation matters. The converter optimizer is presently a steady-state
design engine; passing its checks does not prove that decoupling, control-loop
response, protection, or thermal impedance can survive a cryptographic burst.

## Contract

The consumer in `src/lib/workload-power/` implements LCA-1 power-trace schema
v1.0. Each trace identifies its source, hardware, bridge operation, metadata,
and strictly increasing samples. A sample carries:

- state: `idle`, `kem`, `dsa`, `dma`, `zeroize`, or `fault`;
- active lane count and clock;
- estimated watts, measured watts, or both.

The default analysis path requires `measured_watts`. A caller must explicitly
select `series: "estimated"` to use estimates, so simulated data cannot silently
become a hardware-efficiency claim.

## Use

```ts
import {
  converterSpecFromPowerTrace,
  parsePowerTrace,
} from "@/lib/workload-power";
import { designConverter } from "@/lib/optimizer";

const trace = parsePowerTrace(JSON.parse(payload));
const input = converterSpecFromPowerTrace(
  trace,
  {
    name: "LCA-1 core rail",
    conversion: "dc-dc",
    vinMinV: 11.4,
    vinNomV: 12,
    vinMaxV: 12.6,
    voutV: 0.8,
    bidirectional: false,
    isolated: false,
    ambientC: 40,
    cooling: "forced-air",
  },
  {
    otherLoadW: 15,
    transientHeadroomPct: 20,
  },
);

const steadyStateCandidate = designConverter(input.spec);
console.log(input.trace.maxRiseW, input.trace.maxSlewWPerUs);
```

## Evidence ladder

| Trace source | Legitimate use | Not yet justified |
|---|---|---|
| activity model | topology and sensitivity exploration | board-energy claim |
| post-synthesis estimate | preliminary rail sizing | measured efficiency |
| FPGA board instrument | FPGA energy and transient qualification | ASIC PPA |
| calibrated lab instrument | repeatable hardware comparison | certification |

The next integration gate is a real ETP ML-KEM/ML-DSA workload trace plus a
named FPGA rail and measurement setup. VoltForge should then compare the trace
against regulator efficiency, transient response, decoupling, thermal, and
protection limits—not collapse it into one marketing TDP.
