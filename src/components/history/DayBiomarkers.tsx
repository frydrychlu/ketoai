import { cn } from "@/lib/utils";
import type { BiomarkerReading } from "@/types";

/** Round to one decimal place for display (mirrors the logger's rounding). */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function Metric({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className={cn("rounded-xl border border-white/10 bg-white/5 p-4 text-center")}>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs text-blue-100/60">
        {label} ({unit})
      </div>
    </div>
  );
}

/**
 * Read-only biomarker section for the past-day view: the day's single reading —
 * ketones, glucose, and computed GKI — or an empty state. No mutating controls
 * (US-02).
 */
export default function DayBiomarkers({ reading }: { reading: BiomarkerReading | null }) {
  if (!reading) {
    return <p className="text-sm text-blue-100/50">No biomarkers logged this day.</p>;
  }

  return (
    <div className="grid grid-cols-3 gap-3">
      <Metric label="Ketones" value={round1(reading.ketones_mmol_l)} unit="mmol/L" />
      <Metric label="Glucose" value={round1(reading.glucose_mg_dl)} unit="mg/dL" />
      <Metric label="GKI" value={round1(reading.gki)} unit="index" />
    </div>
  );
}
