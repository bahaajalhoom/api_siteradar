import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./passwords";
describe("account passwords", () => {
  it("uses unique salts, verifies correct passwords, and rejects wrong passwords", async () => {
    const one = await hashPassword("siteradar-test-password");
    const two = await hashPassword("siteradar-test-password");
    expect(one).not.toBe(two);
    expect(one).not.toContain("siteradar-test-password");
    expect(await verifyPassword("siteradar-test-password", one)).toBe(true);
    expect(await verifyPassword("wrong-password", one)).toBe(false);
    expect(await verifyPassword("password", "invalid")).toBe(false);
  });
});
