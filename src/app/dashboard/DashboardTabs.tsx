import Link from "next/link";

export type DashboardTab = "this-month" | "net-worth";

interface Props {
  active: DashboardTab;
  profile?: string;
}

const TABS: { key: DashboardTab; label: string }[] = [
  { key: "this-month", label: "This Month" },
  { key: "net-worth", label: "Net Worth" },
];

export function DashboardTabs({ active, profile }: Props) {
  return (
    <div
      style={{
        display: "flex",
        gap: "0.5rem",
        marginBottom: "1.5rem",
        background: "#f3f4f6",
        padding: 4,
        borderRadius: 10,
      }}
    >
      {TABS.map((t) => {
        const isActive = t.key === active;
        const params = new URLSearchParams();
        if (t.key !== "this-month") params.set("tab", t.key);
        if (profile && profile !== "all") params.set("profile", profile);
        const href = `/dashboard${params.toString() ? `?${params.toString()}` : ""}`;
        return (
          <Link
            key={t.key}
            href={href}
            style={{
              flex: 1,
              textAlign: "center",
              padding: "0.75rem 1rem",
              fontSize: "1rem",
              fontWeight: isActive ? 700 : 500,
              color: isActive ? "#fff" : "#4b5563",
              background: isActive ? "#e29b17" : "transparent",
              borderRadius: 8,
              textDecoration: "none",
              boxShadow: isActive ? "0 1px 3px rgba(226,155,23,0.4)" : "none",
              transition: "background 0.15s, color 0.15s",
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
