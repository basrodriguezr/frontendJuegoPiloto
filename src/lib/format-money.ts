import type { MoneyFormat } from "@/api/types";

export function formatMoney(amount: number, format: MoneyFormat): string {
  const { currency, decimals, thousandSeparator, decimalSeparator } = format;
  const fixed = amount.toFixed(decimals);
  const [intPart, decimalPart] = fixed.split(".");
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSeparator);
  return `${currency} ${withThousands}${decimalPart ? `${decimalSeparator}${decimalPart}` : ""}`;
}
