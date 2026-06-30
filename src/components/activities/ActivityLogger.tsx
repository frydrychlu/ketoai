import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Activity, DailyExpenditureTotal } from "@/types";

const ZERO: DailyExpenditureTotal = { calories_kcal: 0 };

/** The browser's local calendar date as ISO YYYY-MM-DD. */
function localDay(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

interface ActivitiesResponse {
  activities: Activity[];
  total: DailyExpenditureTotal;
}

export default function ActivityLogger() {
  const [day] = useState(localDay);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [total, setTotal] = useState<DailyExpenditureTotal>(ZERO);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the current local day's activities on mount.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/activities?day=${day}`, { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as ActivitiesResponse;
        setActivities(data.activities);
        setTotal(data.total);
      } catch {
        // Aborted on unmount or network error — leave the list empty.
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [day]);

  async function submit() {
    const text = description.trim();
    if (!text || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: text, day }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Coś poszło nie tak. Spróbuj ponownie.");
        return;
      }
      const data = (await res.json()) as { activity: Activity; total: DailyExpenditureTotal };
      setActivities((prev) => [...prev, data.activity]);
      setTotal(data.total);
      setDescription("");
    } catch {
      setError("Coś poszło nie tak. Spróbuj ponownie.");
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/activities/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      const data = (await res.json()) as { total: DailyExpenditureTotal };
      setActivities((prev) => prev.filter((activity) => activity.id !== id));
      setTotal(data.total);
    } catch {
      // Network error — leave state as-is.
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-blue-100/70 uppercase">Daily expenditure</h2>
        <div className={cn("rounded-xl border border-white/10 bg-white/5 p-4 text-center")}>
          <div className="text-2xl font-bold text-white">~{Math.round(total.calories_kcal)} kcal</div>
          <div className="text-xs text-blue-100/60">Estimated calories burned (approximate)</div>
        </div>
      </section>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="space-y-2"
      >
        <label htmlFor="activity" className="block text-sm text-blue-100/80">
          Log an activity
        </label>
        <div className="flex gap-2">
          <input
            id="activity"
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              if (error) setError(null);
            }}
            placeholder="np. 45 min spokojny rower"
            disabled={pending}
            className={cn(
              "flex-1 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40",
              "transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none",
            )}
          />
          <Button
            type="submit"
            disabled={pending || description.trim().length === 0}
            className="bg-purple-600 hover:bg-purple-500"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {pending ? "Szacuję…" : "Add"}
          </Button>
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}
      </form>

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-blue-100/70 uppercase">Activities</h2>
        {loading ? (
          <p className="text-sm text-blue-100/50">Loading…</p>
        ) : activities.length === 0 ? (
          <p className="text-sm text-blue-100/50">No activities logged yet today.</p>
        ) : (
          <ul className="space-y-2">
            {activities.map((activity) => (
              <li
                key={activity.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-white">{activity.description}</p>
                  <p className="text-xs text-blue-100/50">~{Math.round(activity.calories_kcal)} kcal (estimate)</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Delete activity"
                  onClick={() => void remove(activity.id)}
                  className="text-blue-100/50 hover:text-red-300"
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
