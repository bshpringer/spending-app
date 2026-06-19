"use client";

import { useTransition } from "react";
import { setCategoryColor, setCategoryIcon } from "../../lib/actions.ts";
import { CATEGORY_ICONS, AVAILABLE_ICONS } from "../../lib/categoryIcons.ts";

const PRESET_COLORS = [
  "#6366f1", "#f59e0b", "#ef4444", "#10b981",
  "#3b82f6", "#f97316", "#8b5cf6", "#06b6d4",
  "#84cc16", "#ec4899", "#64748b",
];

interface Props {
  category: {
    displayName: string;
    color?: string | null;
    icon?: string | null;
  };
  size?: number;
}

export function CategoryIconPicker({ category, size = 18 }: Props) {
  const [colorPending, startColorTransition] = useTransition();
  const [iconPending, startIconTransition] = useTransition();

  function handleColor(color: string) {
    startColorTransition(() => setCategoryColor(category.displayName, color));
  }

  function handleIcon(icon: string) {
    startIconTransition(() => setCategoryIcon(category.displayName, icon));
  }

  const pending = colorPending || iconPending;
  const IconComp = CATEGORY_ICONS[category.icon || "Circle"] || CATEGORY_ICONS["Circle"];

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: category.color ?? "#d1d5db",
          opacity: pending ? 0.5 : 1,
        }}
        title="Click to change icon and color"
        onClick={(e) => {
          const picker = e.currentTarget.nextSibling as HTMLElement;
          picker.style.display = picker.style.display === "flex" ? "none" : "flex";
        }}
      >
        <IconComp size={size} strokeWidth={2.5} />
      </div>
      <div style={{
        display: "none",
        position: "absolute",
        top: size + 10,
        left: 0,
        zIndex: 50,
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: "0.75rem",
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        flexDirection: "column",
        gap: "0.75rem",
        width: 320,
      }}>
        {/* Colors */}
        <div>
          <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#888", marginBottom: "0.4rem", textTransform: "uppercase" }}>Color</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {PRESET_COLORS.map((c) => (
              <div
                key={c}
                onClick={() => handleColor(c)}
                style={{
                  width: 20, height: 20, borderRadius: "50%",
                  background: c, cursor: "pointer",
                  border: category.color === c ? "2px solid #111" : "2px solid transparent",
                }}
              />
            ))}
            <div
              onClick={() => handleColor("")}
              style={{
                width: 20, height: 20, borderRadius: "50%",
                background: "#f3f4f6", cursor: "pointer",
                border: "1px solid #d1d5db",
                fontSize: "0.725rem",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#666",
              }}
              title="Clear color"
            >✕</div>
          </div>
        </div>
        
        <div>
          <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#888", marginBottom: "0.4rem", textTransform: "uppercase" }}>Icon</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {AVAILABLE_ICONS.map((i) => {
              const Ico = CATEGORY_ICONS[i];
              const isSel = category.icon === i || (!category.icon && i === "Circle");
              return (
                <div
                  key={i}
                  onClick={() => handleIcon(i)}
                  style={{
                    width: 24, height: 24, borderRadius: 4,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer",
                    background: isSel ? "#f3f4f6" : "transparent",
                    color: isSel ? "#111" : "#6b7280",
                    border: isSel ? "1px solid #d1d5db" : "1px solid transparent",
                  }}
                  title={i}
                >
                  <Ico size={16} strokeWidth={isSel ? 2.5 : 2} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
