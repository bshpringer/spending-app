"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { DetailBucket } from "@/lib/detailChart.ts";

interface Props {
  data: DetailBucket[];
  color: string;
  label: string; // "Spent" | "Income"
  // Bucket keys currently selected (highlighted); others dim. Keyed by
  // DetailBucket.key (period key), not a raw month.
  selectedKeys?: string[];
  onBarToggle?: (key: string) => void;
}

function formatDollar(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export function CategoryTrendChart({ data, color, label, selectedKeys, onBarToggle }: Props) {
  const [obscured, setObscured] = useState(false);

  useEffect(() => {
    setObscured(document.body.classList.contains("obscure-mode"));
    const observer = new MutationObserver(() => {
      setObscured(document.body.classList.contains("obscure-mode"));
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  if (data.length === 0) return null;

  // Map label → key so the tooltip/click can recover the period key from the
  // (pre-formatted) x-axis label recharts hands back.
  const keyByLabel = new Map(data.map((d) => [d.label, d.key]));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 13 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={obscured ? () => "•••" : formatDollar}
          tick={{ fontSize: 13 }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        {!obscured && (
          <Tooltip
            formatter={(v) => {
              const n = typeof v === "number" ? v : 0;
              return [`$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, label];
            }}
            contentStyle={{ fontSize: 14, borderRadius: 6 }}
          />
        )}
        <Bar
          dataKey="amount"
          fill={color}
          radius={[3, 3, 0, 0]}
          maxBarSize={40}
          onClick={onBarToggle ? (d) => {
            const lbl = (d as unknown as DetailBucket).label;
            const key = keyByLabel.get(lbl) ?? lbl;
            onBarToggle(key);
          } : undefined}
          cursor={onBarToggle ? "pointer" : undefined}
        >
          {data.map((entry) => {
            const isFiltering = selectedKeys && selectedKeys.length > 0;
            const isActive = !isFiltering || selectedKeys!.includes(entry.key);
            return <Cell key={entry.key} fill={color} fillOpacity={isActive ? 1 : 0.25} />;
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
