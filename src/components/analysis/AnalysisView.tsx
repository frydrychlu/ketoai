import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnalysisResponse, AnalysisResult, AnalysisWindowDays } from "@/types";
import { ANALYSIS_WINDOWS } from "@/types";

/**
 * The browser's local calendar date as ISO YYYY-MM-DD. Duplicated from the
 * logger islands by design (matches how `day`/`to` are built everywhere) — do
 * NOT extract to @/lib/utils. Using local get-year/month/date (not toISOString)
 * keeps the window anchored to the user's calendar day, with no UTC off-by-one
 * near midnight.
 */
function localDay(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

type Status = "idle" | "loading" | "error" | "result" | "empty";

const CONFIDENCE_LABEL: Record<AnalysisResult["confidence"], string> = {
  low: "Niska pewność",
  medium: "Średnia pewność",
  high: "Wysoka pewność",
};

const CONFIDENCE_CLASS: Record<AnalysisResult["confidence"], string> = {
  low: "bg-amber-500/20 text-amber-200 border-amber-400/30",
  medium: "bg-blue-500/20 text-blue-200 border-blue-400/30",
  high: "bg-emerald-500/20 text-emerald-200 border-emerald-400/30",
};

export default function AnalysisView() {
  const [windowDays, setWindowDays] = useState<AnalysisWindowDays>(14);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runAnalysis() {
    setStatus("loading");
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ window_days: windowDays, to: localDay() }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Nie udało się wygenerować analizy. Spróbuj ponownie.");
        setStatus("error");
        return;
      }

      const data = (await response.json()) as AnalysisResponse;
      if (data.status === "empty") {
        setStatus("empty");
        return;
      }
      setResult(data.result);
      setStatus("result");
    } catch {
      setError("Nie udało się połączyć z serwerem. Spróbuj ponownie.");
      setStatus("error");
    }
  }

  const loading = status === "loading";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="analysis-window" className="text-sm text-blue-100/80">
          Zakres analizy
        </label>
        <select
          id="analysis-window"
          value={windowDays}
          disabled={loading}
          onChange={(event) => {
            setWindowDays(Number(event.target.value) as AnalysisWindowDays);
          }}
          className={cn(
            "rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white",
            "transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none disabled:opacity-50",
          )}
        >
          {ANALYSIS_WINDOWS.map((n) => (
            <option key={n} value={n} className="bg-slate-900">
              Ostatnie {n} dni
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void runAnalysis()}
          disabled={loading}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg border border-purple-400/40 bg-purple-500/20 px-4 py-2",
            "text-sm font-medium text-purple-100 transition-colors hover:bg-purple-500/30",
            "focus:ring-2 focus:ring-purple-400 focus:outline-none disabled:opacity-50",
          )}
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {loading ? "Analizuję…" : "Analizuj"}
        </button>
      </div>

      {status === "loading" ? (
        <div className="flex items-center gap-2 py-12 text-blue-100/60">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">Analizuję Twoje dane… to może potrwać kilkanaście sekund.</span>
        </div>
      ) : status === "error" ? (
        <p className="py-12 text-center text-sm text-red-300">{error}</p>
      ) : status === "empty" ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center">
          <p className="text-sm text-blue-100/80">
            Brak danych w wybranym zakresie. Zaloguj posiłki, aktywność lub biomarkery przez kilka dni, aby otrzymać
            analizę.
          </p>
        </div>
      ) : status === "result" && result ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold tracking-wide text-blue-100/70 uppercase">Podsumowanie</h2>
            <span
              className={cn("rounded-full border px-3 py-1 text-xs font-medium", CONFIDENCE_CLASS[result.confidence])}
            >
              {CONFIDENCE_LABEL[result.confidence]}
            </span>
          </div>
          <p className="text-blue-50">{result.summary}</p>

          <section className="border-t border-white/10 pt-6">
            <h2 className="mb-4 text-sm font-semibold tracking-wide text-blue-100/70 uppercase">
              Prawdopodobne przyczyny
            </h2>
            {result.causes.length === 0 ? (
              <p className="text-sm text-blue-100/60">Nie zidentyfikowano wyraźnych przyczyn odchyleń.</p>
            ) : (
              <ul className="space-y-4">
                {result.causes.map((c, i) => (
                  <li key={i} className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <p className="font-medium text-white">{c.cause}</p>
                    <p className="mt-1 text-sm text-blue-100/70">{c.evidence}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-4">
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-amber-200/80 uppercase">
              Ograniczenia danych
            </h2>
            <p className="text-sm text-amber-100/90">{result.data_limitations}</p>
          </section>
        </div>
      ) : (
        <p className="py-12 text-center text-sm text-blue-100/60">
          Wybierz zakres i kliknij „Analizuj”, aby otrzymać analizę AI swoich danych.
        </p>
      )}
    </div>
  );
}
