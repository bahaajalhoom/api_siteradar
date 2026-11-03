import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), get: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ default: { get: mocks.get } }));
import { safeFetch } from "./safe-fetch";
function response(status: number, location?: string) {
  mocks.get.mockImplementationOnce((_url, options, callback) => {
    const req = new EventEmitter() as EventEmitter & {
      setTimeout: ReturnType<typeof vi.fn>;
    };
    req.setTimeout = vi.fn();
    const res = Object.assign(new EventEmitter(), {
      statusCode: status,
      headers: location ? { location } : { "content-type": "text/html" },
    });
    queueMicrotask(() => {
      callback(res);
      res.emit("data", Buffer.from("hello"));
      res.emit("end");
      req.emit("close");
    });
    // Node 24 requests all resolved addresses; verify pinning preserves that contract.
    const cb = vi.fn();
    options.lookup("example.com", { all: true }, cb);
    expect(cb).toHaveBeenCalledWith(null, [
      { address: "93.184.216.34", family: 4 },
    ]);
    return req;
  });
}
beforeEach(() => vi.resetAllMocks());
describe("safe HTTPS requests", () => {
  it("pins a vetted public IP and returns the observed response", async () => {
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    response(200);
    expect(
      (await safeFetch("https://example.com/", "https://example.com")).body,
    ).toBe("hello");
  });
  it("rejects private DNS before opening a socket", async () => {
    mocks.lookup.mockResolvedValue([{ address: "10.0.0.1", family: 4 }]);
    await expect(
      safeFetch("https://example.com/", "https://example.com"),
    ).rejects.toThrow("non-public");
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("resolves and validates DNS again on each redirect", async () => {
    mocks.lookup
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    response(302, "/next");
    await expect(
      safeFetch("https://example.com/", "https://example.com"),
    ).rejects.toThrow("non-public");
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it("blocks redirects outside the authorized origin", async () => {
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    response(302, "https://other.example/");
    await expect(
      safeFetch("https://example.com/", "https://example.com"),
    ).rejects.toThrow("outside the authorized origin");
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
});
