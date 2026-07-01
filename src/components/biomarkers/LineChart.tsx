/**
 * A dependency-free SVG line chart for sparse daily time-series. Points are
 * positioned by their real calendar date within [from, to] (not by array index),
 * so a run of skipped days reads as a longer segment; each real reading gets a
 * dot so interpolated stretches stay visually distinct. Supports two independent
 * y-scales (left/right) for the dual-axis ketones+glucose chart, and optional
 * shaded background bands (the GKI ketosis zones), clamped to the left domain.
 *
 * Kept generic and pure-ish so the GKI hero chart, the dual-axis chart, and
 * later S-07's correlation charts can all reuse it.
 */

export interface ChartSeries {
  /** Stable key for React lists. */
  key: string;
  /** Stroke/dot color (any CSS color). */
  color: string;
  /** Readings, already sorted by day ascending. */
  points: { day: string; value: number }[];
  /** Which y-scale to read against. Defaults to "left". */
  axis?: "left" | "right";
}

export interface ChartBand {
  /** Band bounds in left-axis units; clamped to the left domain before drawing. */
  min: number;
  max: number;
  color: string;
  label: string;
}

export interface AxisSpec {
  label: string;
  unit: string;
}

export interface LineChartProps {
  from: string;
  to: string;
  series: ChartSeries[];
  leftAxis: AxisSpec;
  rightAxis?: AxisSpec;
  bands?: ChartBand[];
  height?: number;
}

const MS_PER_DAY = 86_400_000;
const VIEW_W = 640;
const N_TICKS = 4;

function daysBetween(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / MS_PER_DAY;
}

/** Fraction of the window elapsed at `day`, scaled to `width`. */
function dayToX(day: string, from: string, to: string, width: number): number {
  const span = daysBetween(from, to) || 1; // avoid /0 for a single-day window
  return (daysBetween(from, day) / span) * width;
}

/** Inverted linear scale (SVG y grows downward). */
function valueToY(value: number, min: number, max: number, height: number): number {
  return height - ((value - min) / (max - min || 1)) * height;
}

function buildPath(coords: { x: number; y: number }[]): string {
  return coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
}

/** Domain from data with 10% headroom, floored at 0 (all metrics are non-negative). */
function computeDomain(values: number[]): [number, number] {
  if (values.length === 0) {
    return [0, 1];
  }
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (lo === hi) {
    return [Math.max(0, lo - 1), hi + 1];
  }
  const pad = (hi - lo) * 0.1;
  return [Math.max(0, lo - pad), hi + pad];
}

function formatTick(value: number): string {
  return value >= 10 ? String(Math.round(value)) : (Math.round(value * 10) / 10).toFixed(1);
}

const AXIS_TEXT = "rgb(191 219 254 / 0.55)";
const GRID_STROKE = "rgb(255 255 255 / 0.08)";

export default function LineChart({ from, to, series, leftAxis, rightAxis, bands, height = 200 }: LineChartProps) {
  const padTop = 16;
  const padBottom = 28;
  const padLeft = 44;
  const padRight = rightAxis ? 48 : 16;
  const plotW = VIEW_W - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const leftValues = series.filter((s) => s.axis !== "right").flatMap((s) => s.points.map((p) => p.value));
  const rightValues = series.filter((s) => s.axis === "right").flatMap((s) => s.points.map((p) => p.value));
  const [leftLo, leftHi] = computeDomain(leftValues);
  const [rightLo, rightHi] = computeDomain(rightValues);

  const px = (day: string): number => padLeft + dayToX(day, from, to, plotW);
  const py = (value: number, axis: "left" | "right"): number => {
    const [lo, hi] = axis === "right" ? [rightLo, rightHi] : [leftLo, leftHi];
    return padTop + valueToY(value, lo, hi, plotH);
  };

  const tickFractions = Array.from({ length: N_TICKS + 1 }, (_, i) => i / N_TICKS);
  const midDayIso = new Date((Date.parse(`${from}T00:00:00Z`) + Date.parse(`${to}T00:00:00Z`)) / 2)
    .toISOString()
    .slice(0, 10);

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${height}`} width="100%" role="img" preserveAspectRatio="xMidYMid meet">
      {/* Ketosis bands (behind everything), clamped to the left domain. */}
      {bands?.map((band) => {
        const lo = Math.max(band.min, leftLo);
        const hi = Math.min(band.max, leftHi);
        if (hi <= lo) {
          return null;
        }
        const yTop = py(hi, "left");
        const yBottom = py(lo, "left");
        return <rect key={band.label} x={padLeft} y={yTop} width={plotW} height={yBottom - yTop} fill={band.color} />;
      })}

      {/* Horizontal gridlines + y-axis tick labels. */}
      {tickFractions.map((f) => {
        const y = padTop + plotH - f * plotH;
        const leftVal = leftLo + f * (leftHi - leftLo);
        const rightVal = rightLo + f * (rightHi - rightLo);
        return (
          <g key={`grid-${f}`}>
            <line x1={padLeft} y1={y} x2={padLeft + plotW} y2={y} stroke={GRID_STROKE} strokeWidth={1} />
            <text x={padLeft - 6} y={y + 3} textAnchor="end" fontSize={10} fill={AXIS_TEXT}>
              {formatTick(leftVal)}
            </text>
            {rightAxis && (
              <text x={padLeft + plotW + 6} y={y + 3} textAnchor="start" fontSize={10} fill={AXIS_TEXT}>
                {formatTick(rightVal)}
              </text>
            )}
          </g>
        );
      })}

      {/* X-axis date labels: start / mid / end (MM-DD). */}
      {[
        { day: from, anchor: "start" as const, x: padLeft },
        { day: midDayIso, anchor: "middle" as const, x: padLeft + plotW / 2 },
        { day: to, anchor: "end" as const, x: padLeft + plotW },
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

      {/* Series paths + dots. */}
      {series.map((s) => {
        const axis = s.axis ?? "left";
        const coords = s.points.map((p) => ({ x: px(p.day), y: py(p.value, axis) }));
        return (
          <g key={s.key}>
            {coords.length > 1 && (
              <path d={buildPath(coords)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
            )}
            {coords.map((c, i) => (
              <circle key={`${s.key}-${i}`} cx={c.x} cy={c.y} r={3} fill={s.color} />
            ))}
          </g>
        );
      })}

      {/* Axis unit captions. */}
      <text x={padLeft} y={10} textAnchor="start" fontSize={10} fill={AXIS_TEXT}>
        {leftAxis.label} ({leftAxis.unit})
      </text>
      {rightAxis && (
        <text x={padLeft + plotW} y={10} textAnchor="end" fontSize={10} fill={AXIS_TEXT}>
          {rightAxis.label} ({rightAxis.unit})
        </text>
      )}
    </svg>
  );
}
