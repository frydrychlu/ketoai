import { cn } from "@/lib/utils";
import type { Activity } from "@/types";

/**
 * Read-only activity section for the past-day view: the day's total estimated
 * expenditure plus a display-only list of activities. Calories are labeled
 * approximate, consistent with the logger. No mutating controls (US-02).
 */
export default function DayActivities({
  activities,
  total,
}: {
  activities: Activity[];
  total: { calories_kcal: number };
}) {
  return (
    <div className="space-y-4">
      <div className={cn("rounded-xl border border-white/10 bg-white/5 p-4 text-center")}>
        <div className="text-2xl font-bold text-white">~{Math.round(total.calories_kcal)} kcal</div>
        <div className="text-xs text-blue-100/60">Estimated calories burned (approximate)</div>
      </div>
      {activities.length === 0 ? (
        <p className="text-sm text-blue-100/50">No activity logged this day.</p>
      ) : (
        <ul className="space-y-2">
          {activities.map((activity) => (
            <li key={activity.id} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-white">{activity.description}</p>
              <p className="text-xs text-blue-100/50">~{Math.round(activity.calories_kcal)} kcal (estimate)</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
