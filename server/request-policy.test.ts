import { describe, expect, it,vi,afterEach } from "vitest";
import { isLocalRequest } from "./request-policy";
const request = (host: string, origin?: string) => ({
  headers: new Headers({ host, ...(origin ? { origin } : {}) }),
});
describe("local workspace request boundary", () => {
  afterEach(()=>vi.unstubAllEnvs());
  it("accepts loopback reads and matching browser writes", () => {
    expect(isLocalRequest(request("127.0.0.1:3000"))).toBe(true);
    expect(
      isLocalRequest(request("127.0.0.1:3000", "http://127.0.0.1:3000"), true),
    ).toBe(true);
  });
  it("rejects cross-origin writes, missing origins, and rebinding hosts", () => {
    expect(
      isLocalRequest(
        request("127.0.0.1:3000", "https://attacker.example"),
        true,
      ),
    ).toBe(false);
    expect(isLocalRequest(request("127.0.0.1:3000"), true)).toBe(false);
    expect(isLocalRequest(request("attacker.example"))).toBe(false);
  });
  it('requires the configured HTTPS public origin and rejects localhost bypasses',()=>{vi.stubEnv('APP_BASE_URL','https://radar.example');expect(isLocalRequest(request('radar.example','https://radar.example'),true)).toBe(true);expect(isLocalRequest(request('radar.example','http://radar.example'),true)).toBe(false);expect(isLocalRequest(request('127.0.0.1:3000','http://127.0.0.1:3000'),true)).toBe(false);expect(isLocalRequest(request('other.example','https://other.example'),true)).toBe(false);});
});
