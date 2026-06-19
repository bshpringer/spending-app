"use client";

import { useState, useTransition, useEffect } from "react";
import { createCategory } from "../../lib/actions.ts";
import { CATEGORY_ICONS, AVAILABLE_ICONS, getBestGuessIcon } from "../../lib/categoryIcons.ts";

const PRESET_COLORS = [
  "#6366f1", "#f59e0b", "#ef4444", "#10b981",
  "#3b82f6", "#f97316", "#8b5cf6", "#06b6d4",
  "#84cc16", "#ec4899", "#64748b",
];

export function CategoryCreateModal() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [classification, setClassification] = useState("expense");
  const [color, setColor] = useState<string | null>(null);
  const [icon, setIcon] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Auto-guess icon as the user types
  useEffect(() => {
    if (name.trim() && !icon) {
      const guess = getBestGuessIcon(name.trim());
      if (guess !== "Circle") {
        setIcon(guess);
      }
    }
  }, [name, icon]);

  function handleOpen() {
    setName("");
    setClassification("expense");
    setColor(null);
    setIcon(null);
    setOpen(true);
  }

  function handleSave() {
    if (!name.trim()) return;
    startTransition(async () => {
      await createCategory({
        displayName: name.trim(),
        classification,
        icon,
        color,
      });
      setOpen(false);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") setOpen(false);
  }

  return (
    <>
      <button
        onClick={handleOpen}
        style={{
          padding: "0.5rem 1rem",
          fontSize: "0.925rem",
          fontWeight: 600,
          borderRadius: 8,
          border: "1px solid #ccc",
          background: "white",
          cursor: "pointer",
        }}
      >
        + New Category
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => setOpen(false)}
          onKeyDown={handleKeyDown}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 8,
              padding: "1.5rem",
              width: 480,
              maxWidth: "90vw",
              maxHeight: "85vh",
              overflowY: "auto",
              boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 1rem", fontSize: "1.125rem", fontWeight: 600 }}>
              New Category
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ display: "flex", gap: "1rem" }}>
                <div style={{ flex: 2 }}>
                  <label style={{ display: "block", fontSize: "0.825rem", fontWeight: 600, color: "#666", marginBottom: "0.4rem", textTransform: "uppercase" }}>
                    Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Groceries"
                    autoFocus
                    style={{
                      width: "100%",
                      padding: "0.5rem 0.75rem",
                      fontSize: "0.975rem",
                      border: "1px solid #d1d5db",
                      borderRadius: 6,
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: "0.825rem", fontWeight: 600, color: "#666", marginBottom: "0.4rem", textTransform: "uppercase" }}>
                    Bucket
                  </label>
                  <select
                    value={classification}
                    onChange={(e) => setClassification(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.5rem 0.75rem",
                      fontSize: "0.975rem",
                      border: "1px solid #d1d5db",
                      borderRadius: 6,
                      background: "white",
                    }}
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                    <option value="ignored">Ignored</option>
                  </select>
                </div>
              </div>

              {/* Colors */}
              <div>
                <div style={{ fontSize: "0.825rem", fontWeight: 600, color: "#666", marginBottom: "0.4rem", textTransform: "uppercase" }}>Color</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {PRESET_COLORS.map((c) => (
                    <div
                      key={c}
                      onClick={() => setColor(c)}
                      style={{
                        width: 24, height: 24, borderRadius: "50%",
                        background: c, cursor: "pointer",
                        border: color === c ? "2px solid #111" : "2px solid transparent",
                      }}
                    />
                  ))}
                  <div
                    onClick={() => setColor(null)}
                    style={{
                      width: 24, height: 24, borderRadius: "50%",
                      background: "#f3f4f6", cursor: "pointer",
                      border: "1px solid #d1d5db",
                      fontSize: "0.75rem",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#666",
                    }}
                    title="Clear color"
                  >✕</div>
                </div>
              </div>

              {/* Icons */}
              <div>
                <div style={{ fontSize: "0.825rem", fontWeight: 600, color: "#666", marginBottom: "0.4rem", textTransform: "uppercase", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Icon</span>
                  {icon && (
                    <button 
                      onClick={() => setIcon(null)} 
                      style={{ background: "none", border: "none", fontSize: "0.75rem", color: "#6366f1", cursor: "pointer" }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 180, overflowY: "auto", paddingRight: 4 }}>
                  {AVAILABLE_ICONS.map((i) => {
                    const Ico = CATEGORY_ICONS[i];
                    const isSel = icon === i || (!icon && i === "Circle");
                    return (
                      <div
                        key={i}
                        onClick={() => setIcon(i)}
                        style={{
                          width: 32, height: 32, borderRadius: 6,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: "pointer",
                          background: isSel ? (color ?? "#e5e7eb") : "transparent",
                          color: isSel ? (color ? "#fff" : "#111") : "#6b7280",
                          border: isSel && !color ? "1px solid #d1d5db" : "1px solid transparent",
                        }}
                        title={i}
                      >
                        <Ico size={20} strokeWidth={isSel ? 2.5 : 2} />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1rem" }}>
                <button
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                  style={{
                    padding: "0.5rem 1rem",
                    fontSize: "0.925rem",
                    border: "1px solid #ccc",
                    borderRadius: 6,
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={isPending || !name.trim()}
                  style={{
                    padding: "0.5rem 1rem",
                    fontSize: "0.925rem",
                    border: "none",
                    borderRadius: 6,
                    background: name.trim() && !isPending ? "#111" : "#ccc",
                    color: "#fff",
                    cursor: name.trim() && !isPending ? "pointer" : "default",
                  }}
                >
                  {isPending ? "Saving..." : "Create"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
