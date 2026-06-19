export const dynamic = "force-dynamic";

// Plain static help/FAQ page. Lives under Settings → Help & FAQ.
// Explains the app's less-obvious concepts in everyday language.

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details
      style={{
        borderBottom: "1px solid #eee",
        padding: "0.85rem 0",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          fontWeight: 600,
          fontSize: "1.02rem",
          listStyle: "revert",
        }}
      >
        {q}
      </summary>
      <div style={{ marginTop: "0.6rem", lineHeight: 1.6, opacity: 0.85, fontSize: "0.96rem" }}>
        {children}
      </div>
    </details>
  );
}

export default function HelpPage() {
  return (
    <main style={{ padding: "2rem", maxWidth: 820, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.625rem", margin: "0.5rem 0 0.5rem" }}>Help &amp; FAQ</h1>
      <p style={{ opacity: 0.7, fontSize: "1.02rem", marginBottom: "1.5rem" }}>
        Short answers to how the app thinks about your money. Click any question
        to expand it.
      </p>

      <Faq q="Where is my data stored? Is it private?">
        Everything lives in a single database file on your own computer
        (<code>data/budgeting.db</code>). There is no cloud account and no server
        — the app isn&apos;t deployed anywhere. Your bank keys live in a local
        <code>.env.local</code> file. Nothing about you is uploaded. If you ever
        want to wipe it, delete the <code>data/</code> folder and the app starts
        fresh.
      </Faq>

      <Faq q="What's the difference between a custom name and a canonical name?">
        A transaction&apos;s raw <strong>name</strong> is whatever the bank sent
        (e.g. <code>SQ *COFFEE 991</code>). You can override what shows for a
        single transaction with a <strong>custom name</strong>. A{" "}
        <strong>canonical name</strong> is the &ldquo;real&rdquo; merchant name
        applied across <em>all</em> of a merchant&apos;s transactions so they
        group together (e.g. every <code>SQ *COFFEE …</code> variant becomes{" "}
        <code>Local Coffee</code>). The app always displays{" "}
        <code>custom name → canonical name → raw name</code>, in that order of
        priority. Canonical names power merchant totals, recurring detection,
        and refund matching.
      </Faq>

      <Faq q="Why isn't some of my income (like interest) showing up in Trends?">
        Every category has a <strong>classification</strong>:{" "}
        <strong>Expense</strong>, <strong>Income</strong>, or{" "}
        <strong>Ignored</strong>. Trends only counts a category as income if
        it&apos;s classified as Income — and positive amounts sitting in an
        Expense category are treated as &ldquo;not spending&rdquo; and skipped,
        so they can disappear from both views. If, say, interest payments land in
        a category like <code>Transfer In</code> that&apos;s marked Expense, go
        to the <strong>Categories</strong> page and change that category&apos;s
        classification to <strong>Income</strong> (or <strong>Ignored</strong> if
        it&apos;s really just money moving between your own accounts). It will
        then show up correctly.
      </Faq>

      <Faq q="What do 'excluded' and 'one-time' mean on a transaction?">
        <strong>Excluded</strong> means &ldquo;this isn&apos;t real
        spending&rdquo; — like a credit-card payment or a transfer between your
        own accounts. Excluded transactions are hidden from all totals, charts,
        and trends (but still visible in lists, dimmed). <strong>One-time</strong>{" "}
        means &ldquo;real, but unusual&rdquo; — a car purchase, a big home
        repair, a wedding. One-time transactions still count in raw lists and
        category/year totals, but are left out of the monthly trend and pacing
        charts by default so they don&apos;t skew your normal months. You can
        toggle them back on.
      </Faq>

      <Faq q="What is refund netting?">
        When you link a refund to its original charge (on the Refunds page), the
        app &ldquo;nets&rdquo; the refund against that charge — so a $50 purchase
        you got fully refunded counts as $0 of spending in your totals and
        trends, instead of showing up as $50 spent and $50 of phantom income. The
        original transactions are never altered; the netting just makes your
        spending math reflect what you actually kept.
      </Faq>

      <Faq q="What are duplicates, and how are they detected?">
        Sometimes the same charge shows up twice (a pending entry plus the final
        posted one, or an accidental re-import). The Duplicates page flags pairs
        on the same account with the exact same amount within a few days of each
        other, and lets you keep both or delete one. It only suggests — nothing
        is deleted without you.
      </Faq>

      <Faq q="What are profiles?">
        A profile is a bucket for transactions belonging to one person or one
        shared household, so you can view (for example) your personal spending
        separately from joint-household spending. The app starts with a single{" "}
        <strong>Household</strong> profile. Add more under{" "}
        <strong>Settings → Profiles</strong>, then assign accounts to them on the
        Accounts page. The profile switcher in the top nav filters the whole app.
      </Faq>

      <Faq q="Why do some transactions show a slightly different date than my bank?">
        Each transaction has two dates: the day it <em>posted/settled</em> at the
        bank, and the day you actually <em>swiped/authorized</em> it. The app
        uses the swipe date everywhere for sorting and totals, because that&apos;s
        when the money was really spent. The posted date is kept as an
        unchangeable record. Only the swipe date is editable.
      </Faq>

      <Faq q="How does recurring (subscriptions &amp; bills) detection work?">
        It&apos;s automatic — no manual setup. The app looks back ~24 months,
        groups charges by merchant, and detects a steady rhythm (weekly, monthly,
        annual, etc.). Fixed amounts read as subscriptions; varying amounts read
        as bills. You can dismiss anything that isn&apos;t actually recurring.
      </Faq>

      <Faq q="How does connecting a bank work?">
        Under <strong>Settings → Plaid Import</strong> you link a bank through
        Plaid (the secure service that talks to your bank). Hitting{" "}
        <strong>Sync</strong> pulls new transactions into a review screen first —
        nothing is added to your books until you look it over and commit it. You
        can edit, skip, or merge rows during review.
      </Faq>

      <Faq q="What are tags?">
        Tags are free-form labels you can attach to accounts or individual
        transactions (e.g. <code>vacation-2026</code>, <code>business</code>,{" "}
        <code>shared</code>). A tag on an account is inherited by all its
        transactions. You can filter and group by any tag, giving you a flexible
        way to slice spending beyond categories.
      </Faq>
    </main>
  );
}
