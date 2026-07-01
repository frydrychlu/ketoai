import { useEffect, useState } from "react";
import { Loader2, LineChart as LineChartIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BiomarkerReading } from "@/types";

/**
 * The browser's local calendar date as ISO YYYY-MM-DD.
 * Duplicated from BiomarkerLogger/MealLogger by design (cross-branch merge
 * coordination) — do NOT extract to @/lib/utils.
 */
function localDay(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * The ISO YYYY-MM-DD `n` days before `base`, computed in local time so it lines
 * up with localDay() (no UTC drift across the date boundary).
 */
function daysBefore(base: string, n: number): string {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() - n);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

// Selectable trend windows, in days. 30 is the default (covers the 2-week+
// success horizon with headroom); 14 aligns with the AI-analysis window.
const RANGES = [7, 14, 30] as const;
type Range = (typeof RANGES)[number];
const DEFAULT_RANGE: Range = 30;

export default function BiomarkerTrends() {
  const [range, setRange] = useState<Range>(DEFAULT_RANGE);
  const [readings, setReadings] = useState<BiomarkerReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch the window on mount and whenever the range changes. The window is
  // [today − (range − 1), today] so it holds exactly `range` calendar days.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const to = localDay();
        const from = daysBefore(to, range - 1);
        const res = await fetch(`/api/biomarkers?from=${from}&to=${to}`, { signal: controller.signal });
        if (!res.ok) {
          setError("Nie udało się wczytać danych. Spróbuj ponownie.");
          return;
        }
        const data = (await res.json()) as { readings: BiomarkerReading[] };
        setReadings(data.readings);
      } catch {
        // Aborted on unmount or range change, or a network error — the error
        // state (if not aborted) is handled above; leave prior data in place.
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [range]);

  return (
    <div className="space-y-6">
      {/* Range toggle */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-blue-100/60">Zakres:</span>
        <div className="inline-flex rounded-lg border border-white/20 bg-white/5 p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setRange(r);
              }}
              aria-pressed={r === range}
              className={cn(
                "rounded-md px-3 py-1 text-sm transition-colors",
                r === range ? "bg-purple-600 text-white" : "text-blue-100/70 hover:bg-white/10",
              )}
            >
              {r} dni
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-blue-100/60">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">Wczytywanie…</span>
        </div>
      ) : error ? (
        <p className="py-12 text-center text-sm text-red-300">{error}</p>
      ) : readings.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <LineChartIcon className="size-8 text-blue-100/40" />
          <p className="text-sm text-blue-100/70">
            Brak pomiarów w tym zakresie. Zaloguj ketony i glukozę, aby zobaczyć trendy.
          </p>
          <a
            href="/dashboard"
            className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white transition-colors hover:bg-white/20"
          >
            Przejdź do logowania
          </a>
        </div>
      ) : (
        // Charts land here in Phase 3.
        <div className="py-8 text-center text-sm text-blue-100/50">
          {readings.length} pomiar(ów) w zakresie — wykresy pojawią się wkrótce.
        </div>
      )}
    </div>
  );
}
