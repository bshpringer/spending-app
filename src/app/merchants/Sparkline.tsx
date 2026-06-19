interface Props {
  values: number[];
  months: string[];
  width?: number;
  height?: number;
  color?: string;
}

function formatInt(n: number): string {
  // Locale-stable thousands separator (server Node default vs browser locale would mismatch otherwise).
  const s = String(Math.trunc(n));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function Sparkline({ values, months, width = 96, height = 22, color = "#6366f1" }: Props) {
  if (values.length === 0) {
    return <span style={{ display: "inline-block", width, height, opacity: 0.3 }} />;
  }
  const max = Math.max(...values, 0.0001);
  const barW = width / values.length;
  const gap = Math.min(1, barW * 0.12);
  const innerW = barW - gap;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block" }}
      aria-label={`12-month spend trend, max $${formatInt(Math.round(max))}`}
    >
      {values.map((v, i) => {
        const h = max > 0 ? Math.max(1, (v / max) * (height - 2)) : 0;
        const x = i * barW + gap / 2;
        const y = height - h;
        const monthLabel = months[i] ?? "";
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={innerW}
            height={h}
            fill={color}
            opacity={v === 0 ? 0.15 : 0.85}
            rx={0.5}
          >
            <title>{`${monthLabel} · $${formatInt(Math.round(v))}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
