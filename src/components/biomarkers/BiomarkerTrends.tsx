import { useEffect, useState } from "react";
import { Loader2, LineChart as LineChartIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import LineChart, { type ChartBand } from "@/components/biomarkers/LineChart";
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

// Series colors (also used by the HTML legends below).
const GKI_COLOR = "#a78bfa"; // violet — the hero metric
const KETONES_COLOR = "#34d399"; // emerald — left axis
const GLUCOSE_COLOR = "#fbbf24"; // amber — right axis

// Standard GKI ketosis zones as shaded background bands (guidance, not medical
// advice). Bounds are in GKI units; LineChart clamps them to the chart domain.
const GKI_BANDS: ChartBand[] = [
  { min: 0, max: 1, color: "rgb(52 211 153 / 0.16)", label: "<1 głęboka ketoza" },
  { min: 1, max: 3, color: "rgb(163 230 53 / 0.14)", label: "1–3 umiarkowana" },
  { min: 3, max: 6, color: "rgb(251 191 36 / 0.14)", label: "3–6 niska" },
  { min: 6, max: 1000, color: "rgb(248 113 113 / 0.14)", label: ">6 minimalna" },
];

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-blue-100/70">
      <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

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

  // The window shown, recomputed for the charts (localDay is stable per render).
  const to = localDay();
  const from = daysBefore(to, range - 1);

  const gkiSeries = [{ key: "gki", color: GKI_COLOR, points: readings.map((r) => ({ day: r.day, value: r.gki })) }];
  const dualSeries = [
    {
      key: "ketones",
      color: KETONES_COLOR,
      axis: "left" as const,
      points: readings.map((r) => ({ day: r.day, value: r.ketones_mmol_l })),
    },
    {
      key: "glucose",
      color: GLUCOSE_COLOR,
      axis: "right" as const,
      points: readings.map((r) => ({ day: r.day, value: r.glucose_mg_dl })),
    },
  ];

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
        <div className="space-y-8">
          {readings.length <= 2 && (
            <p className="text-xs text-blue-100/50">Loguj dalej, aby zobaczyć wyraźniejsze trendy.</p>
          )}

          {/* GKI hero chart with ketosis zones. */}
          <section>
            <h3 className="mb-2 text-sm font-semibold tracking-wide text-blue-100/70 uppercase">GKI</h3>
            <LineChart
              from={from}
              to={to}
              series={gkiSeries}
              leftAxis={{ label: "GKI", unit: "index" }}
              bands={GKI_BANDS}
              height={220}
            />
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {GKI_BANDS.map((band) => (
                <LegendSwatch key={band.label} color={band.color.replace(/0\.\d+/, "0.9")} label={band.label} />
              ))}
            </div>
            <p className="mt-1 text-xs text-blue-100/40">Orientacyjne zakresy — nie stanowią porady medycznej.</p>
          </section>

          {/* Combined ketones + glucose on two y-axes. */}
          <section>
            <h3 className="mb-2 text-sm font-semibold tracking-wide text-blue-100/70 uppercase">Ketony i glukoza</h3>
            <LineChart
              from={from}
              to={to}
              series={dualSeries}
              leftAxis={{ label: "Ketony", unit: "mmol/L" }}
              rightAxis={{ label: "Glukoza", unit: "mg/dL" }}
              height={200}
            />
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <LegendSwatch color={KETONES_COLOR} label="Ketony (mmol/L, lewa oś)" />
              <LegendSwatch color={GLUCOSE_COLOR} label="Glukoza (mg/dL, prawa oś)" />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
