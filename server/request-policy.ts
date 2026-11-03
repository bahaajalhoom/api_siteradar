import type { NextRequest } from "next/server";
import {configuredSiteUrl} from '../lib/site';
export function isLocalRequest(
  req: Pick<NextRequest, "headers">,
  write = false,
) {
  const host = req.headers.get("host");
  const deployment=configuredSiteUrl();
  if (!host) return false;
  if(deployment.public){if(host!==new URL(deployment.url).host)return false;}
  else if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))return false;
  if (!write) return true;
  try {
    const origin = new URL(req.headers.get("origin") ?? "");
    return deployment.public?origin.origin===deployment.url:origin.protocol === "http:" && origin.host === host;
  } catch {
    return false;
  }
}
