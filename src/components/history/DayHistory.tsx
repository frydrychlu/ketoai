import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Activity, BiomarkerReading, DailyMacroTotal, Meal, WellnessEntry } from "@/types";
import DayMeals from "./DayMeals";
import DayActivities from "./DayActivities";
import DayBiomarkers from "./DayBiomarkers";
import DayWellness from "./DayWellness";

const ZERO_MACROS: DailyMacroTotal = { fat_g: 0, protein_g: 0, carbs_g: 0, calories_kcal: 0 };

/**
 * The browser's local calendar date as ISO YYYY-MM-DD. Duplicated from the
 * logger islands by design (matches how `day` is built everywhere) — do NOT
 * extract to @/lib/utils. Using local get-year/month/date (not toISOString)
 * keeps the picker default and `max` on the user's calendar day, with no UTC
 * off-by-one near midnight.
 */
function localDay(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

interface MealsResponse {
  meals: Meal[];
  total: DailyMacroTotal;
}

interface ActivitiesResponse {
  activities: Activity[];
  total: { calories_kcal: number };
}

export default function DayHistory() {
  // `max` is fixed to the local today at mount; the picker cannot exceed it.
  const [today] = useState(localDay);
  const [selectedDay, setSelectedDay] = useState(today);

  const [meals, setMeals] = useState<Meal[]>([]);
  const [macroTotal, setMacroTotal] = useState<DailyMacroTotal>(ZERO_MACROS);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [expenditure, setExpenditure] = useState<number>(0);
  const [reading, setReading] = useState<BiomarkerReading | null>(null);
  const [wellness, setWellness] = useState<WellnessEntry | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch all four entry types for the selected day in parallel. Runs on mount
  // and on every date change. A single loading flag covers the batch; any non-ok
  // response surfaces the single error state. Prior day's data is cleared up
  // front so stale sections never linger under a new date while in flight.
  useEffect(() => {
    const controller = new AbortController();
    const opts = { signal: controller.signal };
    void (async () => {
      setLoading(true);
      setError(null);
      setMeals([]);
      setMacroTotal(ZERO_MACROS);
      setActivities([]);
      setExpenditure(0);
      setReading(null);
      setWellness(null);
      try {
        const qs = `day=${selectedDay}`;
        const [mealsRes, activitiesRes, biomarkersRes, wellnessRes] = await Promise.all([
          fetch(`/api/meals?${qs}`, opts),
          fetch(`/api/activities?${qs}`, opts),
          fetch(`/api/biomarkers?${qs}`, opts),
          fetch(`/api/wellness?${qs}`, opts),
        ]);

        if (!mealsRes.ok || !activitiesRes.ok || !biomarkersRes.ok || !wellnessRes.ok) {
          setError("Nie udało się wczytać danych. Spróbuj ponownie.");
          return;
        }

        const mealsData = (await mealsRes.json()) as MealsResponse;
        const activitiesData = (await activitiesRes.json()) as ActivitiesResponse;
        const biomarkersData = (await biomarkersRes.json()) as { reading: BiomarkerReading | null };
        const wellnessData = (await wellnessRes.json()) as { entry: WellnessEntry | null };

        setMeals(mealsData.meals);
        setMacroTotal(mealsData.total);
        setActivities(activitiesData.activities);
        setExpenditure(activitiesData.total.calories_kcal);
        setReading(biomarkersData.reading);
        setWellness(wellnessData.entry);
      } catch {
        // Aborted on unmount or date change, or a network error — leave the
        // cleared state; a non-aborted error is already surfaced above.
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [selectedDay]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="history-day" className="text-sm text-blue-100/80">
          Wybierz dzień
        </label>
        <input
          id="history-day"
          type="date"
          value={selectedDay}
          max={today}
          onChange={(event) => {
            setSelectedDay(event.target.value);
          }}
          className={cn(
            "rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white",
            "transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none",
          )}
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-blue-100/60">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">Wczytywanie…</span>
        </div>
      ) : error ? (
        <p className="py-12 text-center text-sm text-red-300">{error}</p>
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-4 text-sm font-semibold tracking-wide text-blue-100/70 uppercase">Meals</h2>
            <DayMeals meals={meals} total={macroTotal} />
          </section>
          <section className="border-t border-white/10 pt-6">
            <h2 className="mb-4 text-sm font-semibold tracking-wide text-blue-100/70 uppercase">Activity</h2>
            <DayActivities activities={activities} total={{ calories_kcal: expenditure }} />
          </section>
          <section className="border-t border-white/10 pt-6">
            <h2 className="mb-4 text-sm font-semibold tracking-wide text-blue-100/70 uppercase">Biomarkers</h2>
            <DayBiomarkers reading={reading} />
          </section>
          <section className="border-t border-white/10 pt-6">
            <h2 className="mb-4 text-sm font-semibold tracking-wide text-blue-100/70 uppercase">Wellness</h2>
            <DayWellness entry={wellness} />
          </section>
        </div>
      )}
    </div>
  );
}
