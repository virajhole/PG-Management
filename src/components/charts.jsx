import { useMemo } from 'react';

/**
 * Minimal dependency-free SVG charts for the dashboard, drawn with the app's
 * semantic tokens so they theme automatically. Data sets are tiny (6-12
 * points), so plain SVG beats a charting library here.
 */

const AXIS_TEXT = 'fill-[var(--ink-subtle)] text-[11px]';
const PLOT_W = 300; // viewBox width; the svg scales it to the container
const PAD_X = 18; // room so the first/last axis labels never clip

/** Shared bottom baseline: labels sit under the plot area. */
function baseline(height) {
  return height - 18;
}

export function BarChart({ data, height = 140, format = (n) => n, ariaLabel = 'Bar chart' }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const innerW = PLOT_W - PAD_X * 2;
  const slot = innerW / Math.max(data.length, 1);
  const barW = Math.min(slot * 0.62, 34);
  const plotH = baseline(height) - 6;

  return (
    <svg
      viewBox={`0 0 ${PLOT_W} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-auto w-full"
      role="img"
      aria-label={ariaLabel}
    >
      <line x1={PAD_X - 6} y1={baseline(height)} x2={PLOT_W - PAD_X + 6} y2={baseline(height)} className="stroke-[var(--line)]" strokeWidth="1" />
      {data.map((d, i) => {
        // Minimum 3 units so a zero month still reads as "nothing", not "broken".
        const h = Math.max((d.value / max) * plotH, 3);
        const x = PAD_X + i * slot + (slot - barW) / 2;
        return (
          <g key={d.label}>
            <rect x={x} y={baseline(height) - h} width={barW} height={h} rx={3} className="fill-brand-500" opacity={0.9}>
              <animate attributeName="height" from="0" to={h} dur="0.5s" fill="freeze" />
              <animate attributeName="y" from={baseline(height)} to={baseline(height) - h} dur="0.5s" fill="freeze" />
            </rect>
            <text x={x + barW / 2} y={height - 4} textAnchor="middle" className={AXIS_TEXT}>
              {d.label}
            </text>
          </g>
        );
      })}
      <title>{data.map((d) => `${d.label}: ${format(d.value)}`).join(', ')}</title>
    </svg>
  );
}

export function LineChart({ data, height = 140, ariaLabel = 'Line chart' }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const innerW = PLOT_W - PAD_X * 2;
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;
  const plotH = baseline(height) - 10;
  const points = data.map((d, i) => [PAD_X + i * stepX, baseline(height) - (d.value / max) * plotH]);
  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${path} L${PAD_X + (data.length - 1) * stepX},${baseline(height)} L${PAD_X},${baseline(height)} Z`;

  return (
    <svg
      viewBox={`0 0 ${PLOT_W} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-auto w-full"
      role="img"
      aria-label={ariaLabel}
    >
      <line x1={PAD_X - 6} y1={baseline(height)} x2={PLOT_W - PAD_X + 6} y2={baseline(height)} className="stroke-[var(--line)]" strokeWidth="1" />
      <path d={area} className="fill-brand-500" opacity="0.12" />
      <path d={path} fill="none" stroke="var(--color-brand-500)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      {points.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3" className="fill-brand-500" />
      ))}
      {data.map((d, i) => (
        <text key={d.label} x={PAD_X + i * stepX} y={height - 4} textAnchor="middle" className={AXIS_TEXT}>
          {d.label}
        </text>
      ))}
      <title>{data.map((d) => `${d.label}: ${d.value}`).join(', ')}</title>
    </svg>
  );
}

export function DonutChart({ data, size = 130, thickness = 16, centerLabel, centerSub, ariaLabel = 'Donut chart' }) {
  const total = Math.max(
    data.reduce((sum, d) => sum + Math.max(d.value, 0), 0),
    1,
  );
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  const segments = useMemo(() => {
    let offset = 0;
    return data.map((d) => {
      const frac = Math.max(d.value, 0) / total;
      const seg = { ...d, frac, dash: frac * circumference, offset: offset * circumference };
      offset += frac;
      return seg;
    });
  }, [data, total, circumference]);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel}>
      {segments.map((s) => (
        <circle
          key={s.label}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={s.color}
          strokeWidth={thickness}
          strokeDasharray={`${s.dash} ${circumference - s.dash}`}
          strokeDashoffset={-s.offset}
          strokeLinecap="butt"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      ))}
      {centerLabel && (
        <text x="50%" y="47%" textAnchor="middle" className="fill-[var(--ink)] text-[13px] font-bold">
          {centerLabel}
        </text>
      )}
      {centerSub && (
        <text x="50%" y="61%" textAnchor="middle" className="fill-[var(--ink-subtle)] text-[9px]">
          {centerSub}
        </text>
      )}
      <title>{data.map((d) => `${d.label}: ${d.value}`).join(', ')}</title>
    </svg>
  );
}

/** Circular progress used by the hero card. */
export function CircularProgress({ percent, size = 120, thickness = 10, label, sub }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (clamped / 100) * circumference;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${Math.round(clamped)}% collected`}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgb(255 255 255 / 0.25)" strokeWidth={thickness} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#ffffff"
        strokeWidth={thickness}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference - dash}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      >
        <animate attributeName="stroke-dasharray" from={`0 ${circumference}`} to={`${dash} ${circumference - dash}`} dur="0.7s" fill="freeze" />
      </circle>
      {label && (
        <text x="50%" y="48%" textAnchor="middle" className="fill-white text-[17px] font-bold">
          {label}
        </text>
      )}
      {sub && (
        <text x="50%" y="63%" textAnchor="middle" className="fill-white/80 text-[9px] font-semibold">
          {sub}
        </text>
      )}
      <title>{`${Math.round(clamped)}%`}</title>
    </svg>
  );
}
