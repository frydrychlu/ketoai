import { useEffect, useState } from "react";
import { Activity, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { BiomarkerReading } from "@/types";

/**
 * The browser's local calendar date as ISO YYYY-MM-DD.
 * Duplicated from MealLogger.tsx by design (cross-branch merge coordination) —
 * do NOT extract to @/lib/utils.
 */
function localDay(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

// Mirrors the route's Zod bounds (the server stays the source of truth; this
// just avoids a known-bad round-trip).
const KETONES_MIN = 0.1;
const KETONES_MAX = 20;
const GLUCOSE_MIN = 20;
const GLUCOSE_MAX = 600;

/** Round to one decimal place for display (mirrors DailyTotal's rounding). */
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

export default function BiomarkerLogger() {
  const [day] = useState(localDay);
  const [reading, setReading] = useState<BiomarkerReading | null>(null);
  const [ketones, setKetones] = useState("");
  const [glucose, setGlucose] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load today's reading on mount.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/biomarkers?day=${day}`, { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { reading: BiomarkerReading | null };
        if (data.reading) {
          setReading(data.reading);
          setKetones(String(data.reading.ketones_mmol_l));
          setGlucose(String(data.reading.glucose_mg_dl));
        }
      } catch {
        // Aborted on unmount or network error — leave the form empty.
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [day]);

  async function submit() {
    if (pending) return;

    const ketonesValue = Number(ketones);
    const glucoseValue = Number(glucose);

    // Client-side guard before POST (server stays the source of truth).
    if (ketones.trim() === "" || glucose.trim() === "") {
      setError("Podaj poziom ketonów i glukozy.");
      return;
    }
    if (!Number.isFinite(ketonesValue) || ketonesValue < KETONES_MIN || ketonesValue > KETONES_MAX) {
      setError(`Ketony muszą być w zakresie ${KETONES_MIN}–${KETONES_MAX} mmol/L.`);
      return;
    }
    if (!Number.isInteger(glucoseValue) || glucoseValue < GLUCOSE_MIN || glucoseValue > GLUCOSE_MAX) {
      setError(`Glukoza musi być liczbą całkowitą w zakresie ${GLUCOSE_MIN}–${GLUCOSE_MAX} mg/dL.`);
      return;
    }

    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/biomarkers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, ketones_mmol_l: ketonesValue, glucose_mg_dl: glucoseValue }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Coś poszło nie tak. Spróbuj ponownie.");
        return;
      }
      const data = (await res.json()) as { reading: BiomarkerReading };
      setReading(data.reading);
      setKetones(String(data.reading.ketones_mmol_l));
      setGlucose(String(data.reading.glucose_mg_dl));
    } catch {
      setError("Coś poszło nie tak. Spróbuj ponownie.");
    } finally {
      setPending(false);
    }
  }

  async function clear() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/biomarkers?day=${day}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Coś poszło nie tak. Spróbuj ponownie.");
        return;
      }
      setReading(null);
      setKetones("");
      setGlucose("");
    } catch {
      setError("Coś poszło nie tak. Spróbuj ponownie.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      {reading && (
        <section>
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-blue-100/70 uppercase">Today&apos;s reading</h2>
          <div className="grid grid-cols-3 gap-3">
            <Metric label="Ketones" value={round1(reading.ketones_mmol_l)} unit="mmol/L" />
            <Metric label="Glucose" value={round1(reading.glucose_mg_dl)} unit="mg/dL" />
            <Metric label="GKI" value={round1(reading.gki)} unit="index" />
          </div>
        </section>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="space-y-2"
      >
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label htmlFor="ketones" className="block text-sm text-blue-100/80">
              Ketones (mmol/L)
            </label>
            <input
              id="ketones"
              type="number"
              inputMode="decimal"
              step="0.1"
              min={KETONES_MIN}
              max={KETONES_MAX}
              value={ketones}
              onChange={(event) => {
                setKetones(event.target.value);
                if (error) setError(null);
              }}
              placeholder="np. 1.5"
              disabled={pending}
              className={cn(
                "w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40",
                "transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none",
              )}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="glucose" className="block text-sm text-blue-100/80">
              Glucose (mg/dL)
            </label>
            <input
              id="glucose"
              type="number"
              inputMode="numeric"
              step="1"
              min={GLUCOSE_MIN}
              max={GLUCOSE_MAX}
              value={glucose}
              onChange={(event) => {
                setGlucose(event.target.value);
                if (error) setError(null);
              }}
              placeholder="np. 90"
              disabled={pending}
              className={cn(
                "w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40",
                "transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none",
              )}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending || loading} className="bg-purple-600 hover:bg-purple-500">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Activity className="size-4" />}
            {reading ? "Update" : "Save"}
          </Button>
          {reading && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Delete reading"
              onClick={() => void clear()}
              disabled={pending}
              className="text-blue-100/50 hover:text-red-300"
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}
      </form>
    </div>
  );
}
