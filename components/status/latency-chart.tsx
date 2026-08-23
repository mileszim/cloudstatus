import type { LatencyPoint } from "@/lib/status/queries";

/**
 * Response-time trend for one component.
 *
 * Hand-rolled SVG rather than a charting library: this renders on the server
 * with zero client JavaScript, which matters on the one page people load while
 * something is already broken. Hover detail comes from <title> elements, so it
 * works without hydration too.
 */

const WIDTH = 600;
const HEIGHT = 120;
const PAD_TOP = 8;
const PAD_BOTTOM = 18;
const PAD_LEFT = 40;

function niceCeil(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(value, 1)));
  return Math.ceil(value / magnitude) * magnitude;
}

export function LatencyChart({ points, id }: { points: LatencyPoint[]; id: string }) {
  if (points.length < 2) {
    return (
      <p className="text-muted-foreground py-8 text-center text-xs">
        Not enough history to chart response times yet.
      </p>
    );
  }

  const max = niceCeil(Math.max(...points.map((p) => p.ms)));
  const plotW = WIDTH - PAD_LEFT;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const x = (i: number) => PAD_LEFT + (i / (points.length - 1)) * plotW;
  const y = (ms: number) => PAD_TOP + plotH - (ms / max) * plotH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.ms).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${PAD_TOP + plotH} L${PAD_LEFT},${PAD_TOP + plotH} Z`;

  const gradientId = `latency-fill-${id}`;
  const first = points[0];
  const last = points[points.length - 1];
  const average = Math.round(points.reduce((sum, p) => sum + p.ms, 0) / points.length);

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-32 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Average response time over ${points.length} days: ${average}ms mean, ${last.ms}ms most recently.`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Two reference lines: the ceiling and the midpoint. */}
        {[max, max / 2].map((value) => (
          <g key={value}>
            <line
              x1={PAD_LEFT}
              x2={WIDTH}
              y1={y(value)}
              y2={y(value)}
              stroke="var(--border)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={PAD_LEFT - 6}
              y={y(value) + 3}
              textAnchor="end"
              fontSize="9"
              fill="var(--muted-foreground)"
            >
              {Math.round(value)}ms
            </text>
          </g>
        ))}

        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Invisible hit areas carry the per-day tooltip. */}
        {points.map((p, i) => (
          <rect
            key={p.day}
            x={x(i) - plotW / (points.length - 1) / 2}
            y={PAD_TOP}
            width={plotW / (points.length - 1)}
            height={plotH}
            fill="transparent"
          >
            <title>{`${p.day} — ${p.ms}ms average`}</title>
          </rect>
        ))}

        <text x={PAD_LEFT} y={HEIGHT - 4} fontSize="9" fill="var(--muted-foreground)">
          {first.day}
        </text>
        <text x={WIDTH} y={HEIGHT - 4} fontSize="9" textAnchor="end" fill="var(--muted-foreground)">
          {last.day}
        </text>
      </svg>

      <figcaption className="text-muted-foreground tnum mt-1 text-center text-[11px]">
        {average}ms average · {last.ms}ms latest
      </figcaption>
    </figure>
  );
}
