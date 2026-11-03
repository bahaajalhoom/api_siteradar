import type { AuditConfig, RankRecord } from "../lib/types";
import { getSecret } from "./secrets.ts";
import { z } from "zod";
const resultSchema = z.object({
  organic_results: z
    .array(
      z.object({
        position: z.number(),
        link: z.string().url(),
        title: z.string().default(""),
      }),
    )
    .optional(),
  error: z.string().optional(),
  search_parameters: z
    .object({
      location_used: z.string().optional(),
      google_domain: z.string().optional(),
    })
    .optional(),
  search_information: z
    .object({
      query_displayed: z.string().optional(),
      spelling_fix: z.string().optional(),
      organic_results_state: z.string().optional(),
    })
    .optional(),
});
const countries: Record<string, string> = {
  "United States": "us",
  "United Kingdom": "uk",
  Israel: "il",
  "Saudi Arabia": "sa",
  "United Arab Emirates": "ae",
  Germany: "de",
};
const languages: Record<string, string> = {
  English: "en",
  Arabic: "ar",
  Hebrew: "he",
  German: "de",
};
export async function checkRankings(
  owner: string,
  config: AuditConfig,
): Promise<RankRecord[] | null> {
  const key = getSecret(owner, "serpapi");
  if (!key) return null;
  const records: RankRecord[] = [];
  for (const phrase of config.keywords) {
    const query = new URLSearchParams({
      engine: "google",
      q: phrase,
      gl: countries[config.country] ?? "us",
      hl: languages[config.language] ?? "en",
      device: config.device.toLowerCase(),
      location: config.country,
      google_domain: "google.com",
      api_key: key,
    });
    try {
      const r = await fetch(`https://serpapi.com/search.json?${query}`, {
        signal: AbortSignal.timeout(25000),
      });
      if (!r.ok)
        throw new Error(
          "Provider request failed. Check the key, account credits, and connection.",
        );
      const data = resultSchema.parse(await r.json());
      if (data.error)
        throw new Error(
          "The search provider rejected this query. Check your API account.",
        );
      if (!data.organic_results)
        throw new Error(
          "The search provider returned no parseable organic results.",
        );
      const results = data.organic_results.map((x) => ({
        ...x,
        url: x.link,
        domain: new URL(x.link).hostname.replace(/^www\./, ""),
      }));
      const domain = new URL(config.url).hostname.replace(/^www\./, "");
      const match = results.find(
        (x) => x.domain === domain || x.domain.endsWith(`.${domain}`),
      );
      records.push({
        phrase,
        position: match?.position ?? null,
        url: match?.url ?? null,
        searched: results.length,
        results,
        checkedAt: new Date().toISOString(),
        context: {
          requestedLocation: config.country,
          locationUsed: data.search_parameters?.location_used,
          googleDomain: data.search_parameters?.google_domain ?? "google.com",
          queryDisplayed: data.search_information?.query_displayed,
          spellingSuggestion: data.search_information?.spelling_fix,
          resultState: data.search_information?.organic_results_state,
        },
      });
    } catch (e) {
      records.push({
        phrase,
        position: null,
        url: null,
        searched: 0,
        results: [],
        checkedAt: new Date().toISOString(),
        error:
          e instanceof Error && !e.message.includes(key)
            ? e.message
            : "Search provider request failed.",
      });
    }
  }
  return records;
}
