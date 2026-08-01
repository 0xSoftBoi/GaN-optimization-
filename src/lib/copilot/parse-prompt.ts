/**
 * VoltForge copilot — deterministic natural-language spec parser.
 *
 * `parsePrompt` turns a free-text design request ("5kW bidirectional
 * converter, 800V bus to 48V, forced air, 40C") into a complete
 * `DesignSpec`, recording every default it had to invent in
 * `assumptions[]`, scoring `confidence` by how many fields were explicit,
 * and collecting leftover odd tokens in `unrecognized[]`.
 *
 * Pure regex/heuristic NLP — no model calls, fully reproducible.
 */

import type { Cooling, CopilotParse, DesignSpec } from "@/lib/types";
import { clamp, roundSig, siFormat } from "@/lib/util";

// ---------------------------------------------------------------------------
// Scanner: matches consume their span so later, looser patterns can't re-read
// the same text, and whatever survives becomes the `unrecognized` pool.
// ---------------------------------------------------------------------------

class Scanner {
  masked: string;

  constructor(text: string) {
    this.masked = text.toLowerCase().replace(/\s+/g, " ");
  }

  /** All matches of `re` against the unconsumed text; consumes every match. */
  takeAll(re: RegExp): RegExpExecArray[] {
    const g = new RegExp(re.source, "g");
    const out: RegExpExecArray[] = [];
    const spans: Array<[number, number]> = [];
    let m: RegExpExecArray | null;
    while ((m = g.exec(this.masked)) !== null) {
      out.push(m);
      spans.push([m.index, m[0].length]);
      if (m[0].length === 0) g.lastIndex++;
    }
    for (const [i, len] of spans) {
      this.masked =
        this.masked.slice(0, i) + " ".repeat(len) + this.masked.slice(i + len);
    }
    return out;
  }

  /** First match (or undefined); consumes all matches. */
  take(re: RegExp): RegExpExecArray | undefined {
    return this.takeAll(re)[0];
  }

  has(re: RegExp): boolean {
    return this.takeAll(re).length > 0;
  }
}

/** First defined capture group as a number (regexes use alternation groups). */
function num(m: RegExpExecArray | undefined): number | undefined {
  if (!m) return undefined;
  for (let i = 1; i < m.length; i++) {
    if (m[i] !== undefined) return Number(m[i].replace(/,/g, ""));
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Standard DC bus nominals — used to snap a stated input range ("36-75V in")
 *  to its conventional nominal (telecom 48 V, aerospace 28 V, HVDC 800 V…). */
const STANDARD_NOMINALS_V = [
  3.3, 5, 12, 24, 28, 36, 48, 110, 125, 270, 325, 380, 400, 540, 600, 800,
];

/** Filler + already-understood domain words that should NOT count as
 *  unrecognized tokens when they survive extraction. */
const STOPWORDS = new Set(
  (
    "a an the and or but of to for from with without into onto at in on by per via as " +
    "is are be being been was were it its this that these those i we you they me my our your their us " +
    "need needs needed want wants wanted would should could can cannot must will shall please lets let " +
    "hey hi hello thanks thank design designs designed designing build builds built building make makes " +
    "making create creates creating generate give gives get gets use using new help me spec specs " +
    "specification specifications requirement requirements target targets targeting about around approx " +
    "approximately roughly under over below above between within up down out step steps stepping keep kept " +
    "converter converters convertor convertors conversion convert converting regulator regulators supply " +
    "supplies psu smps vrm ibc pol power powered front end ends stage stages module modules board boards " +
    "brick bricks unit units system systems shelf tray blade chassis input inputs output outputs bus buses " +
    "rail rails link volt volts voltage voltages current currents amp amps watt watts wattage load loads " +
    "budget cost costs price priced cheap max maximum min minimum nominal nom high low wide narrow range " +
    "ranges efficiency efficient ripple ambient temp temps temperature temperatures deg degc degree degrees " +
    "cooling cooled cool cooler air airflow thermal heat heatsink telecom datacom data center centre server " +
    "servers industrial automotive aerospace military medical battery batteries charger chargers charging " +
    "charge buck boost flyback forward llc dab psfb totem pole bridge half full resonant interleaved sync " +
    "synchronous phase phases single three also really very quite some any all only just ideally preferably " +
    "prefer preferred point circuit topology gan sic silicon mosfet fet fets switch switching switches " +
    "frequency khz mhz ghz max min running runs run"
  ).split(/\s+/),
);

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parsePrompt(prompt: string): CopilotParse {
  const s = new Scanner(prompt);
  const assumptions: string[] = [];

  // Explicit-field tracker for confidence scoring.
  const ex = {
    pout: false,
    vin: false,
    vout: false,
    cooling: false,
    ambient: false,
    conv: false,
    iso: false,
    bidir: false,
    fsw: false,
    eff: false,
    cost: false,
    ripple: false,
    idiom: false,
  };

  // -- 1. Explicit isolation negation (before the positive keyword sweep) ----
  let isolated: boolean | undefined;
  if (
    s.has(
      /\bnon[\s-]?isolated\b|\bnot\s+isolated\b|\bno\s+(?:galvanic\s+)?isolation\b|\bnon[\s-]?isolation\b/,
    )
  ) {
    isolated = false;
    ex.iso = true;
  }

  // -- 2. Bidirectional / regen ----------------------------------------------
  let acdc = false;
  let bidirectional = false;
  const mBidir = s.take(
    /\bbi[\s-]?directional\b|\bregen(?:erative|eration|erating)?\b|\bv2g\b|\bvehicle[\s-]to[\s-]grid\b|\btwo[\s-]quadrant\b|\bcharge\s+and\s+discharge\b/,
  );
  if (mBidir) {
    bidirectional = true;
    ex.bidir = true;
    // V2G is grid-connected by definition.
    if (/v2g|grid/.test(mBidir[0])) {
      acdc = true;
      ex.conv = true;
    }
  }

  // -- 3. AC grid voltage ("230Vac", "120 V AC") -----------------------------
  let gridVacRms: number | undefined;
  const mVac = s.take(/(\d{2,3}(?:\.\d+)?)\s*v\s*ac\b/);
  if (mVac) {
    gridVacRms = num(mVac);
    acdc = true;
    ex.conv = true;
    ex.vin = true; // the AC voltage pins down the input side
  }

  // -- 4. Other AC-DC / DC-DC cues -------------------------------------------
  if (
    s.has(
      /\bpfc\b|\btotem[\s-]?pole\b|\bgrid(?:[\s-]tied)?\b|\bmains\b|\bac[\s-\/]?dc\b|\boffline\b|\butility\b|\brectifi\w*\b|\bsingle[\s-]phase\b|\bthree[\s-]phase\b/,
    )
  ) {
    acdc = true;
    ex.conv = true;
  }
  if (!acdc && s.has(/\bdc[\s-\/]?dc\b/)) {
    ex.conv = true; // explicitly dc-dc
  }

  // -- 5. Positive isolation keywords ----------------------------------------
  if (
    isolated === undefined &&
    s.has(
      /\bisolat(?:ed|ion|ing)\b|\bgalvanic(?:ally)?\b|\btransformer\b|\bsafety\b|\bselv\b|\breinforced\b|\bhipot\b/,
    )
  ) {
    isolated = true;
    ex.iso = true;
  }

  // -- 6. Switching frequency ("at 500kHz") ----------------------------------
  let fswHz: number | undefined;
  const mF = s.take(/(?:at\s+|@\s*)?(\d+(?:\.\d+)?)\s*(k|m)?hz\b/);
  if (mF) {
    const mult = mF[2] === "m" ? 1e6 : mF[2] === "k" ? 1e3 : 1;
    const f = Number(mF[1]) * mult;
    // < 10 kHz is line frequency (50/60 Hz mains), not a switching frequency.
    if (f >= 10e3) {
      fswHz = f;
      ex.fsw = true;
    }
  }

  // -- 7. Tagged junction temperature ("Tj 150C") ----------------------------
  let maxJunctionC: number | undefined;
  const mTj = s.take(
    /(?:\btj\b|\bjunction(?:\s+temp(?:erature)?)?\b)\s*(?:of|=|:)?\s*(\d{2,3})\s*(?:°|deg(?:rees)?\s*)?\s*c\b|(\d{2,3})\s*(?:°|deg(?:rees)?\s*)?\s*c\b\s*(?:junction|tj)\b/,
  );
  if (mTj) maxJunctionC = num(mTj);

  // -- 8. Tagged ambient ("40C ambient", "ambient of 45 C") ------------------
  let ambientC: number | undefined;
  const mAmb = s.take(
    /(?:\bambient\b|\bamb\.?)\s*(?:temp(?:erature)?)?\s*(?:of|=|:)?\s*(\d{1,3}(?:\.\d+)?)\s*(?:°|deg(?:rees)?\s*)?\s*c\b|(\d{1,3}(?:\.\d+)?)\s*(?:°|deg(?:rees)?\s*)?\s*c\b\s*ambient\b/,
  );
  if (mAmb) {
    ambientC = num(mAmb);
    ex.ambient = true;
  }

  // -- 9. Input range ("36-75V in", "36 to 75V input") -----------------------
  let vinMinV: number | undefined;
  let vinNomV: number | undefined;
  let vinMaxV: number | undefined;
  let voutV: number | undefined;

  const mRange =
    s.take(
      /(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\s*v(?:olts?)?\b\s*(?:dc\s+)?(?:in\b|input|bus|supply|nom(?:inal)?)?/,
    ) ??
    s.take(
      /(\d+(?:\.\d+)?)\s+to\s+(\d+(?:\.\d+)?)\s*v(?:olts?)?\s*(?:dc\s+)?(?:in\b|input|bus|supply)\b/,
    );
  if (mRange) {
    const a = Number(mRange[1]);
    const b = Number(mRange[2]);
    if (a < b) {
      vinMinV = a;
      vinMaxV = b;
      ex.vin = true;
      const mid = (a + b) / 2;
      const inside = STANDARD_NOMINALS_V.filter((v) => v >= a && v <= b);
      if (inside.length > 0) {
        vinNomV = inside.reduce((best, v) =>
          Math.abs(v - mid) < Math.abs(best - mid) ? v : best,
        );
        assumptions.push(
          `Nominal input taken as ${vinNomV} V — the standard bus voltage inside the stated ${a}–${b} V range.`,
        );
      } else {
        vinNomV = roundSig(mid, 3);
        assumptions.push(
          `Nominal input taken as the midpoint ${vinNomV} V of the stated ${a}–${b} V range.`,
        );
      }
    } else {
      // "400 to 48V" reads as a conversion pair, not a range.
      vinNomV = a;
      voutV = b;
      ex.vin = true;
      ex.vout = true;
    }
  }

  // -- 10. Voltage pair ("800V bus to 48V", "from 400 V down to 12V") --------
  const mPair = s.take(
    /(?:from\s+)?(\d+(?:\.\d+)?)\s*v(?:olts?)?\s*(?:dc[\s-]+)?(?:bus|input|in|supply|dc[\s-]?link|link|nom(?:inal)?|side|rail)?\s*,?\s*(?:down\s+|up\s+)?to\s+(\d+(?:\.\d+)?)\s*v(?:olts?)?\b/,
  );
  if (mPair && vinNomV === undefined && voutV === undefined) {
    vinNomV = Number(mPair[1]);
    voutV = Number(mPair[2]);
    ex.vin = true;
    ex.vout = true;
  }

  // -- 11. Tagged output voltage ---------------------------------------------
  if (voutV === undefined) {
    const m =
      s.take(/(\d+(?:\.\d+)?)\s*v(?:olts?)?[\s-]*(?:out(?:put)?|rail|load)\b/) ??
      s.take(
        /(?:\bout(?:put)?\b|\bvout\b|\brail\b)\s*(?:voltage\s*)?(?:of|=|:)?\s*(\d+(?:\.\d+)?)\s*v(?:olts?)?\b/,
      ) ??
      s.take(
        /\b(?:down\s+)?to\s+(\d+(?:\.\d+)?)\s*v(?:olts?)?\b(?!\s*(?:input|in\b|bus|supply))/,
      );
    if (m) {
      voutV = num(m);
      ex.vout = true;
    }
  }

  // -- 12. Tagged input voltage ("800V bus", "48V input", "from 400V") -------
  if (vinNomV === undefined) {
    const m =
      s.take(
        /(\d+(?:\.\d+)?)\s*v(?:olts?)?[\s-]*(?:dc[\s-]+)?(?:bus|input|in\b|supply|dc[\s-]?link|link|nom(?:inal)?)\b/,
      ) ??
      s.take(
        /(?:\binput\b|\bvin\b|\bbus\b|\bsupply\b)\s*(?:voltage\s*)?(?:of|=|:)?\s*(\d+(?:\.\d+)?)\s*v(?:olts?)?\b/,
      ) ??
      s.take(/\bfrom\s+(?:a\s+|the\s+)?(\d+(?:\.\d+)?)\s*v(?:olts?)?\b/);
    if (m) {
      vinNomV = num(m);
      ex.vin = true;
    }
  }

  // -- 13. Bare voltages left over -------------------------------------------
  const bare = s
    .takeAll(/(\d+(?:\.\d+)?)\s*v(?:olts?)?\b/)
    .map((m) => Number(m[1]))
    .filter((v) => v >= 0.5 && v <= 1500);
  if (bare.length > 0) {
    if (vinNomV === undefined && voutV === undefined && bare.length >= 2) {
      vinNomV = Math.max(...bare);
      voutV = Math.min(...bare);
      ex.vin = true;
      ex.vout = true;
      assumptions.push(
        `Two untagged voltages found — read ${vinNomV} V as input and ${voutV} V as output.`,
      );
    } else if (vinNomV === undefined && voutV !== undefined) {
      vinNomV = bare[0];
      ex.vin = true;
    } else if (voutV === undefined && vinNomV !== undefined) {
      voutV = bare[0];
      ex.vout = true;
    } else if (vinNomV === undefined && voutV === undefined) {
      if (bare[0] >= 100) {
        vinNomV = bare[0];
        ex.vin = true;
        assumptions.push(`Untagged ${bare[0]} V read as the input bus.`);
      } else {
        voutV = bare[0];
        ex.vout = true;
        assumptions.push(`Untagged ${bare[0]} V read as the output.`);
      }
    }
  }

  // -- 14. Power ("5kW", "3.3 kW", "500W") -----------------------------------
  let poutW: number | undefined;
  const mKw = s.take(/(\d+(?:\.\d+)?)\s*k(?:ilo)?[\s-]?w(?:att)?s?\b/);
  if (mKw) {
    poutW = Number(mKw[1]) * 1000;
    ex.pout = true;
  } else {
    const mW = s.take(/(\d+(?:\.\d+)?)\s*w(?:att)?s?\b/);
    if (mW) {
      poutW = Number(mW[1]);
      ex.pout = true;
    }
  }

  // -- 15. Bare temperature ("70 °C", trailing "40C") ------------------------
  const mT = s.take(/(\d{1,3}(?:\.\d+)?)\s*(?:°|deg(?:rees)?\s*)?\s*c\b/);
  if (mT) {
    const t = num(mT)!;
    if (t <= 90 && ambientC === undefined) {
      ambientC = t; // plausible ambient
      ex.ambient = true;
    } else if (t > 90 && maxJunctionC === undefined) {
      maxJunctionC = t; // only silicon runs that hot
    }
  }

  // -- 16. Ripple ("1% ripple", "50mV ripple") -------------------------------
  let rippleVoutPct: number | undefined;
  let rippleMvpp: number | undefined;
  const mRipPct = s.take(
    /(\d+(?:\.\d+)?)\s*%\s*(?:output\s+|vout\s+)?ripple\b|\bripple\b\s*(?:of|<|under|below|:)?\s*(\d+(?:\.\d+)?)\s*%/,
  );
  if (mRipPct) {
    rippleVoutPct = num(mRipPct);
    ex.ripple = true;
  } else {
    const mRipMv = s.take(
      /(\d+(?:\.\d+)?)\s*mv(?:pp|p-p)?\s*(?:output\s+)?ripple\b|\bripple\b\s*(?:of|<|under|below|:)?\s*(\d+(?:\.\d+)?)\s*mv\b/,
    );
    if (mRipMv) {
      rippleMvpp = num(mRipMv);
      ex.ripple = true;
    }
  }

  // -- 17. Efficiency target ("97% efficiency", bare "97%") ------------------
  let targetEfficiencyPct: number | undefined;
  const mEff = s.take(
    /(\d{2}(?:\.\d+)?)\s*%\s*(?:peak\s+)?efficien(?:cy|t)\b|\befficiency\b\s*(?:of|target|:|at\s+least|>=?|≥)?\s*(\d{2}(?:\.\d+)?)\s*%/,
  );
  if (mEff) {
    targetEfficiencyPct = num(mEff);
    ex.eff = true;
  } else {
    const mPct = s.take(/(\d{2}(?:\.\d+)?)\s*%/);
    const v = num(mPct);
    if (v !== undefined && v >= 80 && v <= 99.9) {
      targetEfficiencyPct = v; // a bare 80–99.9 % reads as an efficiency target
      ex.eff = true;
    }
  }

  // -- 18. Cost ceiling ("$200 budget", "under 150 USD") ---------------------
  let costCeilingUsd: number | undefined;
  const mCost =
    s.take(/\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/) ??
    s.take(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:usd|dollars?|bucks)\b/);
  if (mCost) {
    costCeilingUsd = num(mCost);
    ex.cost = true;
  }

  // -- 19. Cooling -----------------------------------------------------------
  let cooling: Cooling | undefined;
  if (s.has(/\bcold[\s-]?plate\b/)) cooling = "cold-plate";
  else if (s.has(/\bliquid\b|\bwater[\s-]?cool\w*\b/)) cooling = "liquid";
  else if (
    s.has(/\bforced[\s-]?(?:air|convection)\b|\bfan(?:s|[\s-]?cooled)?\b|\blfm\b|\bcfm\b/)
  )
    cooling = "forced-air";
  else if (
    s.has(/\bnatural(?:\s+convection)?\b|\bpassive(?:ly)?(?:\s+cool\w*)?\b|\bfanless\b|\bconvection[\s-]?(?:only|cooled)?\b/)
  )
    cooling = "natural";
  if (cooling !== undefined) ex.cooling = true;

  // -- 20. Datacenter idioms -------------------------------------------------
  const gpuIdiom = s.has(/\bgpu[\s-]?(?:rail|core|vrm)?s?\b|\bxpu\b|\baccelerator(?:s)?\b/);
  const rackIdiom = s.has(/\brack[\s-]?(?:power|level|mount(?:ed)?)?\b/);
  const dcIdiom = s.has(/\bdata[\s-]?cent(?:er|re)s?\b|\bhyperscal\w*\b|\bserver(?:s)?\b/);
  if (gpuIdiom || rackIdiom || dcIdiom) ex.idiom = true;

  if (gpuIdiom) {
    if (voutV === undefined) {
      voutV = 12;
      assumptions.push('"GPU rail" idiom — assumed a 12 V intermediate-bus output.');
    }
    if (vinNomV === undefined && !acdc) {
      vinNomV = 48;
      assumptions.push('"GPU rail" idiom — assumed the 48 V datacenter bus as input.');
    }
    if (poutW === undefined) {
      poutW = 1000;
      assumptions.push('"GPU rail" idiom — assumed 1 kW per-module power.');
    }
  }
  if (rackIdiom) {
    if (voutV === undefined) {
      voutV = 48;
      assumptions.push('"Rack power" idiom — assumed 48 V rack distribution output.');
    }
    if (poutW === undefined) {
      poutW = 3000;
      assumptions.push('"Rack power" idiom — assumed a 3 kW power-shelf rating.');
    }
  }
  if (dcIdiom && vinNomV === undefined && voutV === undefined && !acdc) {
    vinNomV = 48;
    assumptions.push("Datacenter context — assumed the 48 V distribution bus as input.");
  }

  // -------------------------------------------------------------------------
  // Defaults + assumption bookkeeping
  // -------------------------------------------------------------------------

  const conversion: DesignSpec["conversion"] = acdc ? "ac-dc" : "dc-dc";
  if (!ex.conv) {
    assumptions.push("Assumed dc-dc conversion — no AC/grid cues in the prompt.");
  }

  if (acdc) {
    if (gridVacRms === undefined) {
      gridVacRms = 230;
      assumptions.push("AC input implied but no grid voltage given — assumed 230 Vac single-phase.");
    }
    if (vinNomV === undefined) {
      // Spec convention: for ac-dc, vin* is the rectified bus feeding the PFC.
      vinNomV = roundSig(gridVacRms * Math.SQRT2, 3);
      vinMinV = roundSig(gridVacRms * 0.85 * Math.SQRT2, 3);
      vinMaxV = roundSig(gridVacRms * 1.1 * Math.SQRT2, 3);
      assumptions.push(
        `Rectified-mains bus derived from ${gridVacRms} Vac (−15 %/+10 % grid tolerance): ${vinMinV}–${vinMaxV} V, ${vinNomV} V nominal.`,
      );
    }
    if (voutV === undefined) {
      voutV = 400;
      assumptions.push("PFC/AC-DC output bus not specified — assumed the standard 400 V DC link.");
    }
  }

  if (vinNomV === undefined && voutV === undefined) {
    vinNomV = 48;
    voutV = 12;
    assumptions.push("No voltages found — assumed a 48 V bus to 12 V datacenter step-down.");
  } else if (vinNomV === undefined && voutV !== undefined) {
    vinNomV = voutV <= 1.8 ? 12 : voutV <= 16 ? 48 : voutV <= 60 ? 400 : 800;
    assumptions.push(
      `Input voltage not stated — assumed the ${vinNomV} V bus that conventionally feeds a ${voutV} V rail.`,
    );
  } else if (voutV === undefined && vinNomV !== undefined) {
    voutV = vinNomV >= 300 ? 48 : vinNomV >= 40 ? 12 : 5;
    assumptions.push(
      `Output voltage not stated — assumed ${voutV} V (typical next bus below ${vinNomV} V).`,
    );
  }
  // Degenerate 1:1 reading — re-derive the output.
  if (vinNomV === voutV) {
    voutV = vinNomV! >= 300 ? 48 : vinNomV! >= 40 ? 12 : 5;
    assumptions.push(
      `Input and output both read as ${vinNomV} V — reinterpreted the output as ${voutV} V.`,
    );
  }

  if (vinMinV === undefined || vinMaxV === undefined) {
    vinMinV = roundSig(vinNomV! * 0.9, 3);
    vinMaxV = roundSig(vinNomV! * 1.1, 3);
    assumptions.push(
      `Input range not stated — assumed ±10 % around ${vinNomV} V nominal (${vinMinV}–${vinMaxV} V).`,
    );
  }
  // Invariant: min ≤ nom ≤ max even for odd inputs.
  vinMinV = Math.min(vinMinV!, vinNomV!);
  vinMaxV = Math.max(vinMaxV!, vinNomV!);

  if (poutW === undefined) {
    poutW = 1000;
    assumptions.push("Power level not stated — assumed 1 kW.");
  }

  if (ambientC === undefined) {
    ambientC = 45;
    assumptions.push("Ambient not stated — assumed 45 °C (datacenter hot-aisle worst case).");
  }

  if (cooling === undefined) {
    cooling = poutW > 500 ? "forced-air" : "natural";
    assumptions.push(
      poutW > 500
        ? `Cooling not stated — assumed forced air (${siFormat(poutW, "W")} is beyond natural convection).`
        : "Cooling not stated — assumed natural convection at this power level.",
    );
  }

  if (isolated === undefined) {
    const ratio = Math.max(vinNomV!, voutV!) / Math.min(vinNomV!, voutV!);
    if (acdc) {
      isolated = true;
      assumptions.push("Isolation not stated — enabled by default for a mains-connected (ac-dc) design.");
    } else if (ratio > 8) {
      isolated = true;
      assumptions.push(
        `Isolation not stated — enabled because the ${roundSig(ratio, 3)}:1 conversion ratio exceeds 8:1.`,
      );
    } else {
      isolated = false;
      assumptions.push("Isolation not stated — assumed non-isolated (dc-dc, conversion ratio ≤ 8:1).");
    }
  }

  if (maxJunctionC === undefined) {
    maxJunctionC = 125;
    assumptions.push("Max junction temperature not stated — using 125 °C.");
  }

  if (rippleVoutPct === undefined && rippleMvpp !== undefined) {
    rippleVoutPct = roundSig(clamp(rippleMvpp / (10 * voutV!), 0.01, 20), 2);
  }
  if (rippleVoutPct === undefined) {
    rippleVoutPct = 1;
    assumptions.push("Output ripple not specified — assumed 1 % pk-pk of Vout.");
  }

  if (fswHz === undefined) {
    assumptions.push("Switching frequency not stated — left to the optimizer sweep.");
  }

  // -------------------------------------------------------------------------
  // Unrecognized leftovers + confidence
  // -------------------------------------------------------------------------

  const leftovers = s.masked.match(/[a-z][a-z0-9'-]{2,}/g) ?? [];
  const unrecognized = [...new Set(leftovers.filter((t) => !STOPWORDS.has(t)))];

  let confidence = 0;
  if (ex.pout) confidence += 0.22;
  if (ex.vin) confidence += 0.2;
  if (ex.vout) confidence += 0.2;
  if (ex.cooling) confidence += 0.08;
  if (ex.ambient) confidence += 0.08;
  if (ex.conv) confidence += 0.06;
  if (ex.iso) confidence += 0.06;
  if (ex.bidir) confidence += 0.05;
  if (ex.fsw) confidence += 0.04;
  if (ex.eff) confidence += 0.03;
  if (ex.cost) confidence += 0.02;
  if (ex.ripple) confidence += 0.02;
  if (ex.idiom) confidence += 0.05;
  confidence -= Math.min(0.15, unrecognized.length * 0.03);
  confidence = roundSig(clamp(confidence, 0.05, 0.98), 2);

  const spec: DesignSpec = {
    name: `${siFormat(poutW, "W")} ${roundSig(vinNomV!, 3)} V to ${roundSig(voutV!, 3)} V ${conversion}`,
    conversion,
    vinMinV: vinMinV!,
    vinNomV: vinNomV!,
    vinMaxV: vinMaxV!,
    voutV: voutV!,
    poutW,
    bidirectional,
    isolated,
    ...(fswHz !== undefined ? { fswHz } : {}),
    ambientC,
    maxJunctionC,
    cooling,
    rippleVoutPct,
    ...(targetEfficiencyPct !== undefined ? { targetEfficiencyPct } : {}),
    ...(costCeilingUsd !== undefined ? { costCeilingUsd } : {}),
    ...(gridVacRms !== undefined && conversion === "ac-dc" ? { gridVacRms } : {}),
    notes: prompt.trim().slice(0, 240),
  };

  return { spec, assumptions, confidence, unrecognized };
}
