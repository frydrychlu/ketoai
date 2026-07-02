/**
 * A dependency-free SVG bar chart for sparse daily quantities — the diet
 * (stacked fat/protein/carbs) and activity (kcal burned) charts on the trends
 * dashboard. It is the bar-shaped sibling of `LineChart` and shares its exact
 * date-to-x mapping, view width, and plot padding, so a bar for a given day sits
 * in the SAME column as that day's point on the LineChart above it — the
 * alignment that makes the "small-multiples" correlation view readable.
 *
 * Each day draws one bar; a bar may be a stack of segments (drawn bottom-up in
 * array order) or a single segment. Only days present in `days` get a bar — an
 * un-logged day is a gap, never a zero-height bar (which would falsely imply
 * "logged, and it was zero"). Values are non-negative; the y-domain runs from 0
 * to the tallest day's stacked total.
 *
 * The date-scale helpers and layout constants are duplicated from LineChart by
 * design (same "do NOT extract" convention as the islands' localDay) so the two
 * primitives stay independently editable; the math must stay identical for
 * columns to line up.
 */

export interface BarSegment {
  /** Stable key for React lists. */
  key: string;
  /** Segment magnitude (non-negative), in left-axis units. */
  value: number;
  /** Fill color (any CSS color). */
  color: string;
}

export interface BarDay {
  /** ISO `YYYY-MM-DD` the bar sits on. */
  day: string;
  /** One segment (single bar) or several (stacked, drawn bottom-up in order). */
  segments: BarSegment[];
}

export interface BarAxisSpec {
  label: string;
  unit: string;
}

export interface BarChartProps {
  from: string;
  to: string;
  days: BarDay[];
  leftAxis: BarAxisSpec;
  height?: number;
}

const MS_PER_DAY = 86_400_000;
// Match LineChart's geometry exactly (VIEW_W, padLeft, and the no-right-axis
// padRight) so bars align with the GKI/line columns.
const VIEW_W = 640;
const N_TICKS = 4;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;
const PAD_LEFT = 44;
const PAD_RIGHT = 16;
// Fraction of the per-day column a bar fills, and clamps keeping it visible on a
// dense 30-day window without overflowing the axes on a sparse 7-day one.
const BAR_FILL = 0.7;
const BAR_MIN_W = 3;
const BAR_MAX_W = 22;

const AXIS_TEXT = "rgb(191 219 254 / 0.55)";
const GRID_STROKE = "rgb(255 255 255 / 0.08)";

function daysBetween(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / MS_PER_DAY;
}

/** Fraction of the window elapsed at `day`, scaled to `width` (matches LineChart). */
function dayToX(day: string, from: string, to: string, width: number): number {
  const span = daysBetween(from, to) || 1; // avoid /0 for a single-day window
  return (daysBetween(from, day) / span) * width;
}

function formatTick(value: number): string {
  return value >= 10 ? String(Math.round(value)) : (Math.round(value * 10) / 10).toFixed(1);
}

/** Bar y-domain: 0 to the tallest stacked total, with 10% headroom (min 1). */
function computeMax(totals: number[]): number {
  const hi = totals.length === 0 ? 0 : Math.max(...totals);
  return hi <= 0 ? 1 : hi * 1.1;
}

export default function BarChart({ from, to, days, leftAxis, height = 200 }: BarChartProps) {
  const plotW = VIEW_W - PAD_LEFT - PAD_RIGHT;
  const plotH = height - PAD_TOP - PAD_BOTTOM;

  const domainMax = computeMax(days.map((d) => d.segments.reduce((sum, s) => sum + s.value, 0)));

  // One day-column's pixel step; the bar fills a fraction of it, clamped.
  const span = daysBetween(from, to) || 1;
  const step = plotW / span;
  const barW = Math.min(BAR_MAX_W, Math.max(BAR_MIN_W, step * BAR_FILL));

  const px = (day: string): number => PAD_LEFT + dayToX(day, from, to, plotW);
  const py = (value: number): number => PAD_TOP + plotH - (value / domainMax) * plotH;

  const tickFractions = Array.from({ length: N_TICKS + 1 }, (_, i) => i / N_TICKS);
  const midDayIso = new Date((Date.parse(`${from}T00:00:00Z`) + Date.parse(`${to}T00:00:00Z`)) / 2)
    .toISOString()
    .slice(0, 10);

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${height}`} width="100%" role="img" preserveAspectRatio="xMidYMid meet">
      {/* Horizontal gridlines + y-axis tick labels (0 at the baseline). */}
      {tickFractions.map((f) => {
        const y = PAD_TOP + plotH - f * plotH;
        return (
          <g key={`grid-${f}`}>
            <line x1={PAD_LEFT} y1={y} x2={PAD_LEFT + plotW} y2={y} stroke={GRID_STROKE} strokeWidth={1} />
            <text x={PAD_LEFT - 6} y={y + 3} textAnchor="end" fontSize={10} fill={AXIS_TEXT}>
              {formatTick(f * domainMax)}
            </text>
          </g>
        );
      })}

      {/* X-axis date labels: start / mid / end (MM-DD). */}
      {[
        { day: from, anchor: "start" as const, x: PAD_LEFT },
        { day: midDayIso, anchor: "middle" as const, x: PAD_LEFT + plotW / 2 },
        { day: to, anchor: "end" as const, x: PAD_LEFT + plotW },
      ].map((t) => (
        <text
          key={`x-${t.day}-${t.anchor}`}
          x={t.x}
          y={height - 8}
          textAnchor={t.anchor}
          fontSize={10}
          fill={AXIS_TEXT}
        >
          {t.day.slice(5)}
        </text>
      ))}

      {/* Bars: one per logged day, segments stacked bottom-up. */}
      {days.map((d) => {
        const x = px(d.day) - barW / 2;
        let base = 0; // running stacked total (value units)
        return (
          <g key={d.day}>
            {d.segments.map((s) => {
              const yTop = py(base + s.value);
              const yBottom = py(base);
              base += s.value;
              const h = yBottom - yTop;
              if (h <= 0) {
                return null;
              }
              return <rect key={s.key} x={x} y={yTop} width={barW} height={h} fill={s.color} />;
            })}
          </g>
        );
      })}

      {/* Axis unit caption. */}
      <text x={PAD_LEFT} y={10} textAnchor="start" fontSize={10} fill={AXIS_TEXT}>
        {leftAxis.label} ({leftAxis.unit})
      </text>
    </svg>
  );
}
