import http from "node:http";
import net from "node:net";
import { lookup } from "node:dns/promises";
import { isPublicAddress, validateTarget } from "./safe-fetch.ts";
export async function startBrowserProxy() {
  const sockets = new Set<net.Socket>();
  const server = http.createServer((_req, res) => {
    res.writeHead(403);
    res.end("Only public HTTPS is allowed.");
  });
  server.on("connect", (req, client, head) => {
    const socket = client as net.Socket;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    void (async () => {
      try {
        const target = validateTarget(`https://${req.url}`);
        const addresses = await lookup(
          target.hostname.replace(/^\[|\]$/g, ""),
          { all: true },
        );
        if (
          !addresses.length ||
          addresses.some((a) => !isPublicAddress(a.address))
        )
          throw new Error("Private network blocked");
        const upstream = net.connect({
          host: addresses[0].address,
          port: 443,
          family: addresses[0].family,
        });
        sockets.add(upstream);
        upstream.once("connect", () => {
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length) upstream.write(head);
          upstream.pipe(socket);
          socket.pipe(upstream);
        });
        upstream.setTimeout(30000, () => upstream.destroy());
        socket.setTimeout(30000, () => socket.destroy());
        upstream.on("error", () => socket.destroy());
        upstream.on("close", () => {
          sockets.delete(upstream);
          socket.destroy();
        });
        socket.on("close", () => upstream.destroy());
      } catch {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not start browser network boundary.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
