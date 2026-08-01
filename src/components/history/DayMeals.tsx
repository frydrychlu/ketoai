import type { DailyMacroTotal, Meal } from "@/types";
import { DailyTotal } from "@/components/meals/DailyTotal";

/**
 * Read-only meals section for the past-day view: the daily macro summary (reused
 * from the dashboard) plus a display-only list of the day's meals. No inputs,
 * forms, or mutating controls — read-only by construction (US-02).
 */
export default function DayMeals({ meals, total }: { meals: Meal[]; total: DailyMacroTotal }) {
  return (
    <div className="space-y-4">
      <DailyTotal total={total} />
      {meals.length === 0 ? (
        <p className="text-sm text-blue-100/50">No meals logged this day.</p>
      ) : (
        <ul className="space-y-2">
          {meals.map((meal) => (
            <li key={meal.id} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-white">{meal.description}</p>
              <p className="text-xs text-blue-100/50">
                {Math.round(meal.calories_kcal)} kcal · F {Math.round(meal.fat_g)}g · P {Math.round(meal.protein_g)}g ·
                C {Math.round(meal.carbs_g)}g
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
