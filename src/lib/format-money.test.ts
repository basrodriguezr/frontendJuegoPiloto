import { describe, expect, it } from "vitest";
import { formatMoney } from "./format-money";

const fmt = {
  currency: "USD",
  decimals: 2,
  thousandSeparator: ",",
  decimalSeparator: ".",
};

describe("formatMoney", () => {
  it("formats with separators and decimals", () => {
    expect(formatMoney(12345.6, fmt)).toBe("USD 12,345.60");
  });

  it("handles zero decimals", () => {
    expect(formatMoney(1000, { ...fmt, decimals: 0 })).toBe("USD 1,000");
  });
});
