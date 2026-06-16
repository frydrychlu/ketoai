import { cn } from "@/lib/utils";
import type { DailyMacroTotal } from "@/types";

const ITEMS: { key: keyof DailyMacroTotal; label: string; unit: string }[] = [
  { key: "calories_kcal", label: "Calories", unit: "kcal" },
  { key: "fat_g", label: "Fat", unit: "g" },
  { key: "protein_g", label: "Protein", unit: "g" },
  { key: "carbs_g", label: "Carbs", unit: "g" },
];

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function DailyTotal({ total }: { total: DailyMacroTotal }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {ITEMS.map((item) => (
        <div key={item.key} className={cn("rounded-xl border border-white/10 bg-white/5 p-4 text-center")}>
          <div className="text-2xl font-bold text-white">{round(total[item.key])}</div>
          <div className="text-xs text-blue-100/60">
            {item.label} ({item.unit})
          </div>
        </div>
      ))}
    </div>
  );
}
