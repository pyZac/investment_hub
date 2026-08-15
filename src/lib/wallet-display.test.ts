import { describe, expect, it } from "vitest";
import { walletDisplayLabel } from "./wallet-display";

describe("walletDisplayLabel", () => {
  it("maps SYSTEM_EXTERNAL to the admin-facing label 'Platform Reserve'", () => {
    expect(walletDisplayLabel("SYSTEM_EXTERNAL")).toBe("Platform Reserve");
  });

  it("leaves real user wallet types unchanged", () => {
    expect(walletDisplayLabel("A")).toBe("A");
    expect(walletDisplayLabel("B")).toBe("B");
    expect(walletDisplayLabel("C")).toBe("C");
    expect(walletDisplayLabel("SAVING")).toBe("SAVING");
  });
});
