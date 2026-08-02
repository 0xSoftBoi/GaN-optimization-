"use client";

/**
 * Side-by-side spec sheet for up to 4 selected switches, with the
 * normalized FoM bar chart underneath.
 */

import type { SwitchDevice } from "@/lib/types";
import FomBarChart from "./FomBarChart";
import TechBadge from "./TechBadge";
import { fmtNum, fmtUsd } from "./format";
import { fomMohmNc } from "./switch-logic";

interface SpecRow {
  label: string;
  value: (d: SwitchDevice) => React.ReactNode;
}

const ROWS: SpecRow[] = [
  { label: "Manufacturer", value: (d) => d.mfr },
  { label: "Technology", value: (d) => <TechBadge tech={d.tech} /> },
  { label: "Vds max (V)", value: (d) => fmtNum(d.vdsMaxV) },
  { label: "Id max (A)", value: (d) => fmtNum(d.idMaxA) },
  { label: "Rds(on) 25 °C (mΩ)", value: (d) => fmtNum(d.rdsOnMohm25) },
  { label: "Rds tempco (/°C)", value: (d) => fmtNum(d.rdsOnTempco) },
  { label: "Qg (nC)", value: (d) => fmtNum(d.qgNc) },
  { label: "Qoss (nC)", value: (d) => fmtNum(d.qossNc) },
  { label: "Eoss (µJ)", value: (d) => fmtNum(d.eossUj) },
  { label: "Qrr (nC)", value: (d) => (d.qrrNc === 0 ? "0 (no body diode)" : fmtNum(d.qrrNc)) },
  { label: "FoM Rds·Qg (mΩ·nC)", value: (d) => fmtNum(fomMohmNc(d)) },
  { label: "Vgs drive (V)", value: (d) => fmtNum(d.vgsDriveV) },
  { label: "Vth (V)", value: (d) => fmtNum(d.vthV) },
  { label: "RthJC (°C/W)", value: (d) => fmtNum(d.rthJCcPerW) },
  { label: "Package", value: (d) => d.pkg },
  { label: "Price @1k", value: (d) => fmtUsd(d.priceUsd1k) },
  { label: "Suppliers", value: (d) => d.suppliers.join(", ") },
  { label: "Notes", value: (d) => d.notes ?? "—" },
];

export default function CompareTray({
  devices,
  onRemove,
  onClear,
}: {
  devices: SwitchDevice[];
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  if (devices.length === 0) return null;
  return (
    <div className="panel">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="panel-title mb-0">
          Compare tray · {devices.length}/4
        </h2>
        <button type="button" className="text-xs text-slate-500 hover:text-rose-400" onClick={onClear}>
          clear all
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="table-terminal min-w-[480px]">
          <thead>
            <tr>
              <th className="w-44">Parameter</th>
              {devices.map((d) => (
                <th key={d.id}>
                  <div className="flex items-center gap-2 normal-case">
                    <span className="text-slate-200">{d.id}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${d.id} from compare`}
                      className="text-slate-500 hover:text-rose-400"
                      onClick={() => onRemove(d.id)}
                    >
                      ×
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label}>
                <td className="text-slate-500">{row.label}</td>
                {devices.map((d) => (
                  <td key={d.id}>{row.value(d)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {devices.length >= 2 && (
        <div className="mt-4">
          <FomBarChart devices={devices} />
        </div>
      )}
    </div>
  );
}
