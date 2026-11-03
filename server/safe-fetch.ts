import { lookup } from "node:dns/promises";
import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import ipaddr from "ipaddr.js";
export function isPublicAddress(address: string) {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}
export function validateTarget(raw: string) {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new Error("Use a public HTTPS URL on port 443, without credentials.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    (ipaddr.isValid(host) && !isPublicAddress(host))
  )
    throw new Error("Private and local network targets are not allowed.");
  url.hash = "";
  return url;
}
export type SafeResponse = {
  url: string;
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
};
export async function safeFetch(
  raw: string,
  origin: string,
  redirects = 0,
): Promise<SafeResponse> {
  const url = validateTarget(raw);
  if (url.origin !== origin)
    throw new Error(
      "Redirect or request outside the authorized origin was blocked.",
    );
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ""), {
    all: true,
  });
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new Error("DNS resolved to a non-public address.");
  const pinned = addresses[0];
  const response = await new Promise<SafeResponse>((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "SiteRadar/0.1 (+authorized site audit)",
          Accept: "text/html,application/xml,text/plain",
          "Accept-Encoding": "identity",
        },
        lookup: (_host, opts, cb) => {
          if (opts.all) cb(null, [pinned]);
          else cb(null, pinned.address, pinned.family);
        },
      },
      (res) => {
        res.on("error", reject);
        if (
          res.headers["content-encoding"] &&
          res.headers["content-encoding"] !== "identity"
        ) {
          res.destroy(
            new Error(
              "Compressed responses are not supported by this HTML collector.",
            ),
          );
          reject(
            new Error(
              "Compressed responses are not supported by this HTML collector.",
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2_000_000) {
            res.destroy(new Error("Response exceeds the 2 MB limit."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("aborted", () =>
          reject(new Error("The response was interrupted.")),
        );
        res.on("end", () =>
          resolve({
            url: url.href,
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.setTimeout(12_000, () =>
      req.destroy(new Error("Request timed out after 12 seconds.")),
    );
    const deadline = setTimeout(
      () => req.destroy(new Error("Request exceeded the 12-second deadline.")),
      12_000,
    );
    req.once("close", () => clearTimeout(deadline));
    req.on("error", reject);
  });
  if (
    response.status >= 300 &&
    response.status < 400 &&
    response.headers.location
  ) {
    if (redirects >= 4) throw new Error("Too many redirects.");
    return safeFetch(
      new URL(response.headers.location, url).href,
      origin,
      redirects + 1,
    );
  }
  return response;
}
