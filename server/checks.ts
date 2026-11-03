import { load } from "cheerio";
import type { AuditPage, Finding, PositiveSignal, Category, Severity } from "../lib/types";
export function analyzeHtml(html: string, url: string, status: number) {
  const $ = load(html);
  const findings: Finding[] = [];
  const positives: PositiveSignal[] = [];
  const title = $("title").first().text().trim();
  const description =
    $('meta[name="description" i]').attr("content")?.trim() ?? "";
  const h1 = $("h1")
    .map((_, e) => $(e).text().trim())
    .get();
  const canonical = $('link[rel="canonical"]').attr("href") ?? "";
  const robots = $('meta[name="robots" i]').attr("content") ?? "";
  const add = (
    rule: string,
    name: string,
    category: Category,
    severity: Severity,
    evidence: string,
    recommendation: string,
    kind: Finding["kind"] = "Observed",
  ) =>
    findings.push({
      id: crypto.randomUUID(),
      rule,
      title: name,
      category,
      severity,
      pages: [url],
      evidence: evidence.slice(0, 1500),
      recommendation,
      effort: "15–45 min",
      kind,
    });
  const addPositive = (
    rule: string,
    title: string,
    category: Category,
    evidence: string,
  ) =>
    positives.push({
      id: crypto.randomUUID(),
      rule,
      title,
      category,
      pages: [url],
      evidence: evidence.slice(0, 1000),
    });
  if (status >= 200 && status < 300)
    addPositive("TECH-HTTP-001", "Page responded successfully", "Technical", `GET ${url} → HTTP ${status}`);
  if (status < 200 || status >= 300)
    add(
      "SEO-HTTP-001",
      "Page returned an unsuccessful HTTP status",
      "Technical",
      "High",
      `GET ${url} → HTTP ${status}`,
      "Fix the underlying route or server response and update internal links.",
    );
  if (!title)
    add(
      "SEO-META-001",
      "Page is missing a title",
      "SEO",
      "High",
      "No nonempty <title> was found.",
      "Add a unique title that describes the visible page content.",
    );
  else addPositive("SEO-META-001", "Page has a descriptive title", "SEO", `<title>${title}</title>`);
  if (!description)
    add(
      "SEO-META-003",
      "Page is missing a meta description",
      "SEO",
      "Medium",
      'No nonempty meta[name="description"] was found.',
      "Add a unique, factual summary of this page.",
    );
  else addPositive("SEO-META-003", "Page has a meta description", "SEO", `meta description: ${description}`);
  if (h1.length !== 1)
    add(
      "SEO-HEAD-001",
      h1.length
        ? "Page has multiple primary headings"
        : "Page is missing a primary heading",
      "SEO",
      "Medium",
      `Found ${h1.length} H1 elements.`,
      "Use one clear primary heading and a logical heading hierarchy.",
    );
  else addPositive("SEO-HEAD-001", "Page has one primary heading", "SEO", `H1: ${h1[0]}`);
  if (!canonical)
    add(
      "SEO-CAN-001",
      "Page has no declared canonical URL",
      "Technical",
      "Low",
      'No link[rel="canonical"] was found.',
      "Review duplicate URL variants and declare the preferred absolute URL when appropriate.",
    );
  else addPositive("SEO-CAN-001", "Page declares a canonical URL", "SEO", `canonical: ${canonical}`);
  if (/\bnoindex\b/i.test(robots))
    add(
      "SEO-INDEX-001",
      "Page asks search engines not to index it",
      "SEO",
      "High",
      `robots meta: ${robots}`,
      "Review whether this exclusion is intentional before removing noindex.",
      "Needs review",
    );
  else addPositive("SEO-INDEX-001", "Page is not marked noindex", "SEO", robots ? `robots meta: ${robots}` : "No noindex directive was observed.");
  const missingAlt = $("img:not([alt])").length;
  if (missingAlt)
    add(
      "A11Y-ALT-001",
      "Images are missing alternative text",
      "Accessibility",
      "Medium",
      `${missingAlt} image elements have no alt attribute.`,
      "Add descriptive alternative text to informative images and empty alt to decorative images.",
    );
  if (!$("html").attr("lang"))
    add(
      "A11Y-LANG-001",
      "Document language is not declared",
      "Accessibility",
      "Medium",
      "The html element has no lang attribute.",
      "Set the correct BCP 47 language on the html element.",
    );
  if (!$('meta[name="viewport"]').length)
    add(
      "TECH-VIEWPORT-001",
      "Mobile viewport is not configured",
      "Technical",
      "Medium",
      "No viewport meta element was found.",
      "Add width=device-width, initial-scale=1 without restricting zoom.",
    );
  else addPositive("TECH-VIEWPORT-001", "Mobile viewport is configured", "Technical", "A viewport meta element was observed.");
  const schema: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).text());
      const nodes = Array.isArray(parsed)
        ? parsed
        : parsed &&
            typeof parsed === "object" &&
            Array.isArray(parsed["@graph"])
          ? parsed["@graph"]
          : [parsed];
      for (const node of nodes)
        if (node?.["@type"])
          schema.push(
            ...[node["@type"]]
              .flat()
              .filter((v): v is string => typeof v === "string"),
          );
    } catch {
      add(
        "SEO-SCHEMA-001",
        "Structured data contains invalid JSON",
        "SEO",
        "Medium",
        "A JSON-LD block could not be parsed.",
        "Fix JSON syntax and validate the structured data against visible content.",
      );
    }
  });
  if (!schema.length)
    add(
      "GEO-SCHEMA-001",
      "No structured entities were detected",
      "GEO readiness",
      "Low",
      "No valid JSON-LD @type was found in the fetched HTML.",
      "Review whether Organization, Article, or Product schema fits the visible content.",
      "Needs review",
    );
  else addPositive("GEO-SCHEMA-001", "Structured entities were detected", "GEO readiness", `JSON-LD types: ${schema.join(", ")}`);
  if (!$("h2").length)
    add(
      "GEO-STRUCTURE-001",
      "Content has no secondary headings",
      "GEO readiness",
      "Low",
      "No H2 sections were found in the fetched HTML.",
      "Review whether concise, answerable sections would help readers.",
      "Needs review",
    );
  else addPositive("GEO-STRUCTURE-001", "Content has secondary headings", "GEO readiness", `Found ${$("h2").length} H2 sections.`);
  const links = $("a[href]")
    .map((_, el) => $(el).attr("href") ?? "")
    .get();
  $("script,style,noscript").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const page: AuditPage = {
    url,
    status,
    title: title.slice(0, 300),
    description: description.slice(0, 500),
    h1: h1.map((x) => x.slice(0, 300)),
    canonical,
    words: text ? text.split(/\s+/).length : 0,
    issues: findings.length,
    indexable: status >= 200 && status < 300 && !/\bnoindex\b/i.test(robots),
    schema,
  };
  return { page, findings, positives, links };
}
export function scoreCategory(
  findings: Finding[],
  category: Category,
  pageCount: number,
) {
  if (!pageCount) return null;
  const weights: Record<Severity, number> = {
    Critical: 25,
    High: 14,
    Medium: 7,
    Low: 3,
  };
  return Math.max(
    0,
    Math.round(
      100 -
        findings
          .filter((f) => f.category === category)
          .reduce((sum, f) => sum + weights[f.severity] * f.pages.length, 0) /
          pageCount,
    ),
  );
}
