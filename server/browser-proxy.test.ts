import { describe, it, expect } from "vitest";
import http from "node:http";
import { startBrowserProxy } from "./browser-proxy";
describe("browser network isolation", () => {
  it.each([
    "127.0.0.1:443",
    "169.254.169.254:443",
    "[::1]:443",
    "example.com:8080",
  ])("denies CONNECT to %s", async (target) => {
    const proxy = await startBrowserProxy();
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const r = http.request(proxy.url, { method: "CONNECT", path: target });
        r.on("connect", (res, socket) => {
          socket.destroy();
          resolve(res.statusCode ?? 0);
        });
        r.on("error", reject);
        r.end();
      });
      expect(status).toBe(403);
    } finally {
      await proxy.close();
    }
  });
});
