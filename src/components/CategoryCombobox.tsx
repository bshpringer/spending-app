"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Lightweight combobox: text input + chevron. Clicking the input or chevron
 * always shows the full option list; typing filters. Free-text entry is
 * allowed via the "+ Use" row. Previously duplicated in the reconcile-merchants
 * and merchant-aliases clients — this is the single shared copy.
 */
export function CategoryCombobox({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFilter(null);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const filtered = useMemo(() => {
    if (filter === null || filter === "") return options;
    const f = filter.toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(f));
  }, [filter, options]);

  const displayed = open && filter !== null ? filter : value;
  const showCreate =
    filter !== null &&
    filter.trim().length > 0 &&
    !options.some((o) => o.toLowerCase() === filter.trim().toLowerCase());

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <div
        style={{
          display: "flex",
          border: "1px solid rgba(0,0,0,0.2)",
          borderRadius: 4,
          background: "#fff",
        }}
      >
        <input
          type="text"
          value={displayed}
          onChange={(e) => {
            const v = e.target.value;
            setFilter(v);
            setOpen(true);
            onChange(v);
          }}
          onFocus={() => {
            setFilter("");
            setOpen(true);
          }}
          placeholder={placeholder}
          style={{
            flex: 1,
            padding: "5px 8px",
            border: "none",
            outline: "none",
            font: "inherit",
            fontSize: 13,
            background: "transparent",
            minWidth: 0,
          }}
        />
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            if (open) {
              setOpen(false);
              setFilter(null);
            } else {
              setFilter("");
              setOpen(true);
            }
          }}
          aria-label="Toggle list"
          style={{
            background: "transparent",
            border: "none",
            padding: "0 8px",
            cursor: "pointer",
            color: "inherit",
            font: "inherit",
          }}
        >
          ▾
        </button>
      </div>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 50,
            marginTop: 2,
            background: "#fff",
            border: "1px solid #ccc",
            borderRadius: 4,
            maxHeight: 240,
            overflowY: "auto",
            boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
          }}
        >
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              onChange("");
              setOpen(false);
              setFilter(null);
            }}
            style={{
              padding: "6px 10px",
              cursor: "pointer",
              fontSize: 13,
              opacity: value === "" ? 1 : 0.55,
              borderBottom: "1px solid #eee",
              background: value === "" ? "rgba(0,102,255,0.08)" : "transparent",
            }}
          >
            (none)
          </div>
          {showCreate && (
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                const v = filter!.trim();
                onChange(v);
                setOpen(false);
                setFilter(null);
              }}
              style={{
                padding: "6px 10px",
                cursor: "pointer",
                fontSize: 13,
                borderBottom: "1px solid #eee",
                color: "#06f",
              }}
            >
              + Use &ldquo;{filter!.trim()}&rdquo;
            </div>
          )}
          {filtered.length === 0 && !showCreate && (
            <div style={{ padding: "6px 10px", opacity: 0.5, fontSize: 13 }}>(no matches)</div>
          )}
          {filtered.map((opt) => (
            <div
              key={opt}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(opt);
                setOpen(false);
                setFilter(null);
              }}
              style={{
                padding: "6px 10px",
                cursor: "pointer",
                fontSize: 13,
                background: opt === value ? "rgba(0,102,255,0.08)" : "transparent",
              }}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
