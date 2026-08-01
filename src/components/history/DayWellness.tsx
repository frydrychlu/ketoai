import { cn } from "@/lib/utils";
import type { WellnessEntry } from "@/types";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn("rounded-xl border border-white/10 bg-white/5 p-4 text-center")}>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs text-blue-100/60">{label}</div>
    </div>
  );
}

/**
 * Read-only wellness section for the past-day view: the day's singleton entry —
 * mood, energy, sleep, water, and notes — or an empty state. Null fields render
 * as "—" (not 0), matching the logger. No mutating controls (US-02).
 */
export default function DayWellness({ entry }: { entry: WellnessEntry | null }) {
  if (!entry) {
    return <p className="text-sm text-blue-100/50">No wellness data logged this day.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-3">
        <Metric label="Mood" value={entry.mood === null ? "—" : `${entry.mood}/10`} />
        <Metric label="Energy" value={entry.energy === null ? "—" : `${entry.energy}/10`} />
        <Metric label="Sleep" value={entry.sleep_quality === null ? "—" : `${entry.sleep_quality}/10`} />
        <Metric label="Water" value={entry.water_liters === null ? "—" : `${entry.water_liters} L`} />
      </div>
      {entry.notes && <p className="text-sm whitespace-pre-wrap text-blue-100/80">{entry.notes}</p>}
    </div>
  );
}
