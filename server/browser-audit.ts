import { chromium, type Browser, type BrowserContext } from "playwright";
import { launch, type LaunchedChrome } from "chrome-launcher";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/lr-desktop-config.js";
import AxeBuilder from "@axe-core/playwright";
import { startBrowserProxy } from "./browser-proxy.ts";
import type { AuditConfig, Finding, PerformanceReport } from "../lib/types";
export async function startAuditBrowser(config: AuditConfig) {
  const proxy = await startBrowserProxy();
  let chrome: LaunchedChrome | undefined,
    browser: Browser | undefined,
    context: BrowserContext | undefined;
  try {
    chrome = await launch({
      chromePath: chromium.executablePath(),
      maxConnectionRetries: 40,
      connectionPollInterval: 250,
      chromeFlags: [
        "--headless=new",
        `--proxy-server=${proxy.url}`,
        "--proxy-bypass-list=<-loopback>",
        "--disable-quic",
        "--disable-background-networking",
        "--disable-component-update",
        "--no-first-run",
        "--disable-dev-shm-usage",
      ],
    });
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${chrome.port}`, {
      timeout: 15000,
    });
    context = await browser.newContext({
      viewport:
        config.device === "Mobile"
          ? { width: 390, height: 844 }
          : { width: 1440, height: 1000 },
      isMobile: config.device === "Mobile",
      hasTouch: config.device === "Mobile",
      locale:
        { English: "en-US", Arabic: "ar", Hebrew: "he", German: "de" }[
          config.language
        ] ?? "en-US",
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    const origin = new URL(config.url).origin;
    await context.route("**/*", async (route) => {
      const r = route.request();
      if (
        r.isNavigationRequest() &&
        r.frame() === r.frame().page().mainFrame() &&
        new URL(r.url()).origin !== origin
      )
        await route.abort();
      else await route.continue();
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(25000);
    async function render(url: string) {
      if (new URL(url).origin !== origin)
        throw new Error("Page is outside project scope.");
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(700);
      return await page.content();
    }
    async function measure(): Promise<{
      performance: PerformanceReport;
      findings: Finding[];
    }> {
      await render(config.url);
      const axe = await new AxeBuilder({ page }).analyze();
      const findings: Finding[] = axe.violations.map((v) => ({
        id: crypto.randomUUID(),
        rule: `AXE-${v.id}`,
        title: v.help,
        category: "Accessibility",
        severity:
          v.impact === "critical"
            ? "Critical"
            : v.impact === "serious"
              ? "High"
              : v.impact === "moderate"
                ? "Medium"
                : "Low",
        pages: [config.url],
        evidence: v.nodes
          .slice(0, 5)
          .map(
            (n) =>
              `${n.target.join(" ")}: ${n.failureSummary ?? v.description}`,
          )
          .join("\n"),
        recommendation: `${v.description} Reference: ${v.helpUrl}`,
        effort: "Review required",
        kind: "Observed",
      }));
      const result = await lighthouse(
        config.url,
        {
          port: chrome!.port,
          output: "json",
          onlyCategories: [
            "performance",
            "accessibility",
            "seo",
            "best-practices",
          ],
          logLevel: "error",
          maxWaitForLoad: 35000,
        },
        config.device === "Desktop" ? desktopConfig : undefined,
      );
      if (!result || result.lhr.runtimeError)
        throw new Error(
          result?.lhr.runtimeError?.message ??
            "Lighthouse did not produce a report.",
        );
      const lhr = result.lhr;
      const metric = (id: string) => lhr.audits[id]?.numericValue ?? null;
      const performance: PerformanceReport = {
        score: Math.round((lhr.categories.performance?.score ?? 0) * 100),
        accessibility: Math.round(
          (lhr.categories.accessibility?.score ?? 0) * 100,
        ),
        seo: Math.round((lhr.categories.seo?.score ?? 0) * 100),
        bestPractices: Math.round(
          (lhr.categories["best-practices"]?.score ?? 0) * 100,
        ),
        lcp: metric("largest-contentful-paint"),
        cls: metric("cumulative-layout-shift"),
        tbt: metric("total-blocking-time"),
        fcp: metric("first-contentful-paint"),
        speedIndex: metric("speed-index"),
        measuredAt: lhr.fetchTime,
        url: lhr.finalDisplayedUrl,
        device: config.device,
        source: "Lighthouse",
        warnings: (lhr.runWarnings ?? []).map(String),
      };
      for (const [id, a] of Object.entries(lhr.audits)) {
        if (
          a.score !== null &&
          a.score < 0.5 &&
          a.scoreDisplayMode !== "notApplicable" &&
          a.details?.type === "opportunity"
        )
          findings.push({
            id: crypto.randomUUID(),
            rule: `LH-${id}`,
            title: a.title,
            category: "Performance",
            severity: (a.numericValue ?? 0) > 1000 ? "High" : "Medium",
            pages: [config.url],
            evidence: `Lighthouse: ${a.displayValue ?? "Failed opportunity check"}. Measured ${lhr.fetchTime}.`,
            recommendation: a.description,
            effort: "Review required",
            kind: "Observed",
          });
      }
      return { performance, findings };
    }
    return {
      render,
      measure,
      close: async () => {
        await context?.close().catch(() => {});
        await chrome?.kill();
        await proxy.close();
      },
    };
  } catch (e) {
    await context?.close().catch(() => {});
    await chrome?.kill();
    await proxy.close();
    throw e;
  }
}
