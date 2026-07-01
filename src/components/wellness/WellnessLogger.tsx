import { useEffect, useState } from "react";
import { HeartPulse, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { WellnessEntry } from "@/types";

/**
 * The browser's local calendar date as ISO YYYY-MM-DD.
 * Duplicated from MealLogger.tsx / BiomarkerLogger.tsx by design (cross-branch
 * merge coordination) — do NOT extract to @/lib/utils.
 */
function localDay(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

// Mirrors the route's Zod bounds (the server stays the source of truth; these
// just avoid a known-bad round-trip).
const RATING_MIN = 1;
const RATING_MAX = 10;
const WATER_MIN = 0;
const WATER_MAX = 20;
const NOTES_MAX = 2000;

/** A blank input maps to null (field left unset); otherwise the parsed number. */
function parseOptionalNumber(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

/** A blank/whitespace note maps to null; otherwise the trimmed string. */
function parseOptionalNotes(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn("rounded-xl border border-white/10 bg-white/5 p-4 text-center")}>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs text-blue-100/60">{label}</div>
    </div>
  );
}

export default function WellnessLogger() {
  const [day] = useState(localDay);
  const [entry, setEntry] = useState<WellnessEntry | null>(null);
  const [mood, setMood] = useState("");
  const [energy, setEnergy] = useState("");
  const [sleep, setSleep] = useState("");
  const [water, setWater] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Populate the form fields from a saved entry (null -> blank input).
  function hydrate(e: WellnessEntry) {
    setEntry(e);
    setMood(e.mood === null ? "" : String(e.mood));
    setEnergy(e.energy === null ? "" : String(e.energy));
    setSleep(e.sleep_quality === null ? "" : String(e.sleep_quality));
    setWater(e.water_liters === null ? "" : String(e.water_liters));
    setNotes(e.notes ?? "");
  }

  // Load today's entry on mount.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/wellness?day=${day}`, { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { entry: WellnessEntry | null };
        if (data.entry) {
          hydrate(data.entry);
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

  function isValidRating(value: number | null): boolean {
    return value === null || (Number.isInteger(value) && value >= RATING_MIN && value <= RATING_MAX);
  }

  async function submit() {
    if (pending) return;

    const payload = {
      day,
      mood: parseOptionalNumber(mood),
      energy: parseOptionalNumber(energy),
      sleep_quality: parseOptionalNumber(sleep),
      water_liters: parseOptionalNumber(water),
      notes: parseOptionalNotes(notes),
    };

    // Client-side guards before POST (server stays the source of truth).
    const allEmpty =
      payload.mood === null &&
      payload.energy === null &&
      payload.sleep_quality === null &&
      payload.water_liters === null &&
      payload.notes === null;
    if (allEmpty) {
      setError("Wypełnij przynajmniej jedno pole.");
      return;
    }
    if (!isValidRating(payload.mood) || !isValidRating(payload.energy) || !isValidRating(payload.sleep_quality)) {
      setError(`Nastrój, energia i jakość snu muszą być liczbą całkowitą ${RATING_MIN}–${RATING_MAX}.`);
      return;
    }
    if (
      payload.water_liters !== null &&
      (!Number.isFinite(payload.water_liters) || payload.water_liters < WATER_MIN || payload.water_liters > WATER_MAX)
    ) {
      setError(`Woda musi być w zakresie ${WATER_MIN}–${WATER_MAX} litrów.`);
      return;
    }

    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/wellness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Coś poszło nie tak. Spróbuj ponownie.");
        return;
      }
      const data = (await res.json()) as { entry: WellnessEntry };
      hydrate(data.entry);
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
      const res = await fetch(`/api/wellness?day=${day}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Coś poszło nie tak. Spróbuj ponownie.");
        return;
      }
      setEntry(null);
      setMood("");
      setEnergy("");
      setSleep("");
      setWater("");
      setNotes("");
    } catch {
      setError("Coś poszło nie tak. Spróbuj ponownie.");
    } finally {
      setPending(false);
    }
  }

  const ratingInputClass = cn(
    "w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40",
    "transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none",
  );

  return (
    <div className="space-y-6">
      {entry && (
        <section>
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-blue-100/70 uppercase">Today&apos;s entry</h2>
          <div className="grid grid-cols-4 gap-3">
            <Metric label="Mood" value={entry.mood === null ? "—" : `${entry.mood}/10`} />
            <Metric label="Energy" value={entry.energy === null ? "—" : `${entry.energy}/10`} />
            <Metric label="Sleep" value={entry.sleep_quality === null ? "—" : `${entry.sleep_quality}/10`} />
            <Metric label="Water" value={entry.water_liters === null ? "—" : `${entry.water_liters} L`} />
          </div>
          {entry.notes && <p className="mt-3 text-sm whitespace-pre-wrap text-blue-100/80">{entry.notes}</p>}
        </section>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="space-y-2"
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="space-y-1">
            <label htmlFor="mood" className="block text-sm text-blue-100/80">
              Mood (1–10)
            </label>
            <input
              id="mood"
              type="number"
              inputMode="numeric"
              step="1"
              min={RATING_MIN}
              max={RATING_MAX}
              value={mood}
              onChange={(event) => {
                setMood(event.target.value);
                if (error) setError(null);
              }}
              placeholder="np. 7"
              disabled={pending}
              className={ratingInputClass}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="energy" className="block text-sm text-blue-100/80">
              Energy (1–10)
            </label>
            <input
              id="energy"
              type="number"
              inputMode="numeric"
              step="1"
              min={RATING_MIN}
              max={RATING_MAX}
              value={energy}
              onChange={(event) => {
                setEnergy(event.target.value);
                if (error) setError(null);
              }}
              placeholder="np. 6"
              disabled={pending}
              className={ratingInputClass}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="sleep" className="block text-sm text-blue-100/80">
              Sleep (1–10)
            </label>
            <input
              id="sleep"
              type="number"
              inputMode="numeric"
              step="1"
              min={RATING_MIN}
              max={RATING_MAX}
              value={sleep}
              onChange={(event) => {
                setSleep(event.target.value);
                if (error) setError(null);
              }}
              placeholder="np. 8"
              disabled={pending}
              className={ratingInputClass}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="water" className="block text-sm text-blue-100/80">
              Water (L)
            </label>
            <input
              id="water"
              type="number"
              inputMode="decimal"
              step="0.1"
              min={WATER_MIN}
              max={WATER_MAX}
              value={water}
              onChange={(event) => {
                setWater(event.target.value);
                if (error) setError(null);
              }}
              placeholder="np. 2.5"
              disabled={pending}
              className={ratingInputClass}
            />
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor="notes" className="block text-sm text-blue-100/80">
            Notes
          </label>
          <textarea
            id="notes"
            rows={3}
            maxLength={NOTES_MAX}
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
              if (error) setError(null);
            }}
            placeholder="Cokolwiek wartego odnotowania dzisiaj…"
            disabled={pending}
            className={ratingInputClass}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending || loading} className="bg-purple-600 hover:bg-purple-500">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <HeartPulse className="size-4" />}
            {entry ? "Update" : "Save"}
          </Button>
          {entry && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Delete entry"
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
