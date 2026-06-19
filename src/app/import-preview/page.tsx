"use client";

import { useState } from "react";
import { parseCsv } from "@/lib/csv-import";
import type { CsvParseResult } from "@/lib/types";
import { formatMoney } from "@/lib/format";

export default function ImportPreviewPage() {
  const [result, setResult] = useState<CsvParseResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      setResult(parseCsv(text));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    }
  }

  return (
    <main style={{ padding: "2rem", maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.625rem", margin: "0 0 1.5rem" }}>
        CSV Import Preview
      </h1>

      <p style={{ opacity: 0.7, marginBottom: "1rem", fontSize: "1.025rem" }}>
        Drop a Rocket Money CSV export below. Nothing is saved — this is a
        parser sanity check. Verify the sign convention, account inference, and
        tag extraction look right before we wire up storage.
      </p>

      <FileDrop onFile={handleFile} />

      {fileName && (
        <p style={{ marginTop: "0.75rem", fontSize: "0.975rem", opacity: 0.7 }}>
          Loaded: <code>{fileName}</code>
        </p>
      )}

      {error && (
        <p
          style={{
            marginTop: "1rem",
            padding: "0.75rem",
            background: "#fee",
            color: "#900",
            borderRadius: 4,
          }}
        >
          {error}
        </p>
      )}

      {result && <ResultDisplay result={result} />}
    </main>
  );
}

function FileDrop({ onFile }: { onFile: (file: File) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) onFile(file);
      }}
      style={{
        display: "block",
        padding: "2rem",
        border: `2px dashed ${isDragging ? "#06f" : "#888"}`,
        borderRadius: 8,
        textAlign: "center",
        cursor: "pointer",
        background: isDragging ? "rgba(0,102,255,0.05)" : "transparent",
      }}
    >
      <p>Drop a CSV here, or click to choose a file</p>
      <input
        type="file"
        accept=".csv,text/csv"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

function ResultDisplay({ result }: { result: CsvParseResult }) {
  const totalSigned = result.transactions.reduce((sum, t) => sum + t.amount, 0);
  return (
    <div style={{ marginTop: "1.5rem" }}>
      <SummaryRow
        items={[
          ["Transactions", result.transactions.length],
          ["Accounts", result.accounts.length],
          ["Distinct tags", result.tagDisplayNames.length],
          ["Net total (signed)", formatMoney(totalSigned)],
        ]}
      />

      {result.warnings.length > 0 && (
        <section style={{ marginTop: "1rem" }}>
          <h2 style={{ fontSize: "1.125rem", marginBottom: "0.5rem" }}>Warnings</h2>
          <ul style={{ paddingLeft: "1.25rem" }}>
            {result.warnings.map((w, i) => (
              <li key={i} style={{ color: "#a60" }}>
                {w}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section style={{ marginTop: "1.5rem" }}>
        <h2 style={{ fontSize: "1.125rem", marginBottom: "0.5rem" }}>
          Accounts inferred ({result.accounts.length})
        </h2>
        <Table
          headers={["Last 4", "Institution", "Account Name", "Type", "Natural Key"]}
          rows={result.accounts.map((a) => [
            a.accountNumberLast4,
            a.institutionName,
            a.accountName,
            a.accountType,
            a.naturalKey,
          ])}
        />
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2 style={{ fontSize: "1.125rem", marginBottom: "0.5rem" }}>
          Tags extracted ({result.tagDisplayNames.length})
        </h2>
        {result.tagDisplayNames.length === 0 ? (
          <p style={{ opacity: 0.6, fontSize: "1.025rem" }}>None.</p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {result.tagDisplayNames.map((t) => (
              <span
                key={t}
                style={{
                  padding: "0.25rem 0.6rem",
                  border: "1px solid currentColor",
                  borderRadius: 999,
                  fontSize: "0.975rem",
                }}
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2 style={{ fontSize: "1.125rem", marginBottom: "0.5rem" }}>
          Transactions ({result.transactions.length})
        </h2>
        <Table
          headers={[
            "Date",
            "Account",
            "Name",
            "Category",
            "CSV Amt",
            "Signed Amt",
            "Tags",
          ]}
          rows={result.transactions.map((t) => [
            t.date,
            t.accountNaturalKey,
            t.name,
            t.category,
            formatMoney(t.csvAmount),
            <span
              key="amt"
              style={{ color: t.amount < 0 ? "#a00" : "#070" }}
            >
              {formatMoney(t.amount)}
            </span>,
            t.tags.join(", "),
          ])}
        />
      </section>
    </div>
  );
}

function SummaryRow({ items }: { items: Array<[string, string | number]> }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: "0.75rem",
      }}
    >
      {items.map(([label, value]) => (
        <div
          key={label}
          style={{
            padding: "0.75rem",
            border: "1px solid #ccc",
            borderRadius: 6,
          }}
        >
          <div style={{ fontSize: "0.875rem", opacity: 0.6, textTransform: "uppercase" }}>
            {label}
          </div>
          <div style={{ fontSize: "1.375rem", marginTop: "0.25rem" }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: Array<Array<React.ReactNode>>;
}) {
  return (
    <div style={{ overflowX: "auto", border: "1px solid #ddd", borderRadius: 6 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.975rem" }}>
        <thead>
          <tr style={{ background: "rgba(127,127,127,0.1)" }}>
            {headers.map((h) => (
              <th
                key={h}
                style={{
                  padding: "0.5rem 0.75rem",
                  textAlign: "left",
                  fontWeight: 600,
                  borderBottom: "1px solid #ddd",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
              {r.map((cell, j) => (
                <td key={j} style={{ padding: "0.5rem 0.75rem", verticalAlign: "top" }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

