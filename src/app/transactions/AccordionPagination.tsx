"use client";

interface Props {
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  onPage: (p: number) => void;
}

export function AccordionPagination({ page, pageSize, total, loading, onPage }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const disabledPrev = page === 0 || loading;
  const disabledNext = (page + 1) * pageSize >= total || loading;
  return (
    <div style={{
      display: "flex",
      gap: "0.6rem",
      alignItems: "center",
      fontSize: "0.875rem",
      color: "#666",
    }}>
      <button
        type="button"
        disabled={disabledPrev}
        onClick={() => onPage(page - 1)}
        style={btnStyle(disabledPrev)}
      >
        ← Prev
      </button>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>
        {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total.toLocaleString()}
        <span style={{ opacity: 0.5, marginLeft: "0.5rem" }}>· page {page + 1}/{totalPages}</span>
      </span>
      <button
        type="button"
        disabled={disabledNext}
        onClick={() => onPage(page + 1)}
        style={btnStyle(disabledNext)}
      >
        Next →
      </button>
    </div>
  );
}

function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "0.25rem 0.6rem",
    fontSize: "0.875rem",
    borderRadius: 4,
    border: "1px solid #e5e7eb",
    background: "white",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
    color: "#374151",
  };
}
