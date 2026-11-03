import robotsParser from "robots-parser";
import { claimAudit, getAudit, saveAudit, db } from "./db.ts";
import { safeFetch, validateTarget } from "./safe-fetch.ts";
import { analyzeHtml, scoreCategory } from "./checks.ts";
import { categories, type Audit } from "../lib/types.ts";
import { startAuditBrowser } from "./browser-audit.ts";
import { checkRankings } from "./rankings.ts";
import { saveProject } from "./db.ts";
import {
  acquireWorkerLease,
  renewWorkerLease,
  releaseWorkerLease,
} from "./worker-lease.ts";
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT")
      console.error(`Could not load ${file}. Check its format.`);
  }
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function event(a: Audit, message: string) {
  if (getAudit(a.id)?.status === "cancelled") a.status = "cancelled";
  a.events.push({ time: new Date().toISOString(), message });
  saveAudit(a);
}
// A single local worker owns jobs; interrupted work fails explicitly rather than remaining stuck.
let ownsLease = false;
async function recoverInterruptedRuns() {
  for (const row of db
    .prepare("SELECT id FROM audits WHERE status='running'")
    .all()) {
    const a = getAudit(String(row.id));
    if (a) {
      a.status = "failed";
      a.error = "Worker restarted during this scan. Run a new scan to retry.";
      saveAudit(a);
    }
  }
}
async function run(a: Audit) {
  let runtime: Awaited<ReturnType<typeof startAuditBrowser>> | undefined;
  try {
    const start = validateTarget(a.url);
    const origin = start.origin;
    const started = Date.now();
    event(a, "Validating public DNS and checking robots.txt");
    const robotsResponse = await safeFetch(`${origin}/robots.txt`, origin);
    if (
      robotsResponse.status !== 404 &&
      (robotsResponse.status < 200 || robotsResponse.status >= 300)
    )
      throw new Error(
        `robots.txt returned HTTP ${robotsResponse.status}; scan stopped conservatively.`,
      );
    const robots = robotsParser(
      `${origin}/robots.txt`,
      robotsResponse.status === 404 ? "" : robotsResponse.body,
    );
    if (!robots.isAllowed(start.href, "SiteRadar"))
      throw new Error("The homepage is blocked by robots.txt.");
    event(a, "Opening isolated Chromium for rendered-page checks");
    try {
      runtime = await startAuditBrowser(a.config);
    } catch (e) {
      a.measurementError = `Browser could not start: ${e instanceof Error ? e.message : "Unknown error"}`;
      event(a, a.measurementError);
    }
    const queue = [start.href];
    const seen = new Set<string>();
    const limit = Math.min(
      a.config.maxPages || 10000,
      Number(process.env.CRAWLER_MAX_PAGES) || 10000,
    );
    while (
      queue.length &&
      a.pages.length < limit &&
      Date.now() - started <
        (Number(process.env.CRAWLER_MAX_SECONDS) || 300) * 1000
    ) {
      if (getAudit(a.id)?.status === "cancelled") {
        a.status = "cancelled";
        event(a, "Scan cancelled; partial observations preserved.");
        return;
      }
      const target = queue.shift()!;
      if (seen.has(target)) continue;
      seen.add(target);
      if (!robots.isAllowed(target, "SiteRadar")) {
        event(a, `Skipped robots-disallowed URL: ${new URL(target).pathname}`);
        continue;
      }
      event(a, `Fetching ${new URL(target).pathname}`);
      try {
        const response = await safeFetch(target, origin);
        if (!String(response.headers["content-type"]).includes("text/html")) {
          event(a, "Skipped a non-HTML response.");
          continue;
        }
        let html = response.body;
        if (runtime) {
          try {
            html = await runtime.render(response.url);
            a.browserRendered = true;
          } catch (e) {
            event(
              a,
              `Rendered check unavailable for this page; using HTML: ${e instanceof Error ? e.message : "Browser error"}`,
            );
          }
        }
        const result = analyzeHtml(html, response.url, response.status);
        a.pages.push(result.page);
        a.findings.push(...result.findings);
        if (a.pages.length === 1 && !a.config.keywords.length) {
          a.config.keywords = [
            ...new Set(
              [result.page.title.split(/[|—–]/)[0], ...result.page.h1]
                .map((s) => s.trim())
                .filter((s) => s.length >= 3 && s.length <= 120),
            ),
          ].slice(0, 8);
          event(
            a,
            `Saved ${a.config.keywords.length} initial keyword phrases from page content.`,
          );
        }
        for (const href of result.links) {
          try {
            const u = new URL(href, response.url);
            u.hash = "";
            if (
              u.origin === origin &&
              !u.search &&
              !/\.(pdf|zip|png|jpg|webp|svg|mp4)$/i.test(u.pathname) &&
              !seen.has(u.href) &&
              queue.length < 10000
            )
              queue.push(u.href);
          } catch {
            /* Invalid links are not crawl targets. */
          }
        }
        event(
          a,
          `Analyzed ${a.pages.length} page${a.pages.length === 1 ? "" : "s"}; ${a.findings.length} observations collected.`,
        );
      } catch (e) {
        event(
          a,
          `Page unavailable: ${e instanceof Error ? e.message : "Network error"}`,
        );
      }
      await pause(500);
    }
    if (getAudit(a.id)?.status === "cancelled") {
      a.status = "cancelled";
      event(a, "Scan cancelled; partial observations preserved.");
      return;
    }
    if (!a.pages.length)
      throw new Error(
        "No HTML pages could be analyzed. Review robots.txt, access restrictions, or the URL.",
      );
    if (runtime) {
      event(
        a,
        `Running ${a.config.device.toLowerCase()} Lighthouse and axe on the homepage`,
      );
      try {
        const measured = await runtime.measure();
        a.performance = measured.performance;
        a.findings.push(...measured.findings);
        event(
          a,
          `Homepage performance measured: ${a.performance.score}/100. Automated accessibility: ${a.performance.accessibility}/100.`,
        );
      } catch (e) {
        a.measurementError =
          e instanceof Error ? e.message : "The browser measurement failed.";
        event(a, `Measurement needs retry: ${a.measurementError}`);
      }
    }
    if (getAudit(a.id)?.status === "cancelled") {
      a.status = "cancelled";
      event(a, "Scan cancelled; collected evidence preserved.");
      return;
    }
    if (a.ownerId) {
      saveProject(a.ownerId, a.config);
      event(a, "Checking keyword search-provider connection");
      const ranks = await checkRankings(a.ownerId, a.config);
      a.rankings = ranks ?? [];
      a.rankingStatus = ranks
        ? ranks.length === 0 || ranks.some((r) => !r.error)
          ? "ready"
          : "failed"
        : "not_connected";
      event(
        a,
        ranks
          ? `Recorded ${ranks.length} search queries.`
          : "Keywords saved. Connect SerpApi to measure search positions.",
      );
    }
    const grouped = new Map<string, (typeof a.findings)[number]>();
    for (const finding of a.findings) {
      const existing = grouped.get(finding.rule);
      if (existing) {
        existing.pages.push(...finding.pages);
        existing.evidence += `\n${finding.pages[0]}: ${finding.evidence}`;
      } else grouped.set(finding.rule, { ...finding });
    }
    a.findings = [...grouped.values()];
    const severity = ["Critical", "High", "Medium", "Low"];
    a.findings.sort(
      (x, y) => severity.indexOf(x.severity) - severity.indexOf(y.severity),
    );
    a.scores = categories.map((category) => ({
      category,
      value:
        category === "Performance"
          ? (a.performance?.score ?? null)
          : category === "Accessibility" && a.performance
            ? a.performance.accessibility
            : scoreCategory(a.findings, category, a.pages.length),
      note:
        category === "Performance"
          ? a.performance
            ? `${a.config.device} homepage · Lighthouse lab`
            : "Measurement unavailable · retry scan"
          : category === "Accessibility"
            ? a.performance
              ? "Lighthouse + axe · automated homepage checks"
              : "HTML checks only · browser unavailable"
            : category === "GEO readiness"
              ? "Content structure only · not AI visibility"
              : a.browserRendered
                ? "Rendered-page observations"
                : "HTML observations",
    }));
    const scores = a.scores.flatMap((s) => (s.value === null ? [] : [s.value]));
    a.score = scores.length
      ? Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length)
      : null;
    a.status = "completed";
    a.completedAt = new Date().toISOString();
    event(
      a,
      `Report ready. ${a.pages.length} pages, ${a.findings.length} grouped findings. ${a.performance ? "Lighthouse measured." : "Performance needs retry."}`,
    );
  } catch (e) {
    a.status = "failed";
    a.error = e instanceof Error ? e.message : "The scan failed.";
    event(a, a.error);
  } finally {
    await runtime?.close().catch(() => {});
  }
}
console.log("SiteRadar local worker ready");
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
const heartbeat = setInterval(() => {
  if (ownsLease) renewWorkerLease();
}, 10000);
while (!stopping) {
  if (!ownsLease) {
    ownsLease = acquireWorkerLease();
    if (!ownsLease) {
      await pause(3000);
      continue;
    }
    await recoverInterruptedRuns();
    console.log("Worker lease acquired. Processing saved queue.");
  }
  const a = claimAudit();
  if (a) await run(a);
  else await pause(1000);
}
clearInterval(heartbeat);
if (ownsLease) releaseWorkerLease();
db.close();
