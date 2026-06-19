export function formatMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Canonical account display label: prefer the user's custom name, fall back to
// the raw account name. Always suffixed with the last 4 so two accounts at the
// same institution remain distinguishable even after rename.
export function formatAccountLabel(account: {
  customName?: string | null;
  accountName: string;
  accountNumberLast4: string;
}): string {
  const name = account.customName?.trim() || account.accountName;
  return `${name} ••${account.accountNumberLast4}`;
}
