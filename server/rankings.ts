import type { AuditConfig, RankRecord } from "../lib/types.ts";
import { getSecret } from "./secrets.ts";
import { z } from "zod";
const resultSchema = z.object({
  organic_results: z
    .array(
      z.object({
        position: z.number().int().positive(),
        link: z.string().url(),
        title: z.string().default(""),
      }),
    )
    .optional(),
  error: z.string().optional(),
  serpapi_pagination: z.object({ next: z.string().optional() }).optional(),
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
  const domain = new URL(config.url).hostname.replace(/^www\./, "");
  // Bound usage of the shared service account. Personal integrations retain their own quota.
  const keywords = key === process.env.SERPAPI_API_KEY ? config.keywords.slice(0, 4) : config.keywords;
  for (const phrase of keywords) {
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
    const results: RankRecord['results'] = [];
    let context: RankRecord['context'];
    let offset = 0;
    let failure: string | undefined;
    try {
      for (let page = 0; page < 3 && results.length < 30; page++) {
        query.set('start', String(offset));
        const response = await fetch(`https://serpapi.com/search.json?${query}`, {
          signal: AbortSignal.timeout(25000),
          redirect: 'error',
        });
        if (!response.ok) throw new Error('Search request failed. Check the provider credentials and credits.');
        const data = resultSchema.parse(await response.json());
        if (data.error) throw new Error('The provider rejected the search query.');
        if (!data.organic_results) throw new Error('The provider returned no parseable organic results.');
        context ??= {
          requestedLocation: config.country,
          locationUsed: data.search_parameters?.location_used,
          googleDomain: data.search_parameters?.google_domain ?? "google.com",
          queryDisplayed: data.search_information?.query_displayed,
          spellingSuggestion: data.search_information?.spelling_fix,
          resultState: data.search_information?.organic_results_state,
        };
        for (const item of data.organic_results) {
          const url = new URL(item.link);
          const position = offset + item.position;
          if (position > 30 || !['https:', 'http:'].includes(url.protocol) || results.some(x => x.url === url.href)) continue;
          results.push({ position, url: url.href, title: item.title, domain: url.hostname.replace(/^www\./, '') });
        }
        const next = data.serpapi_pagination?.next;
        if (!next) break;
        // Keep the original request and credentials scoped to SerpApi.
        const nextOffset = Number(new URL(next).searchParams.get('start'));
        if (!Number.isInteger(nextOffset) || nextOffset <= offset || nextOffset >= 30) break;
        offset = nextOffset;
      }
    } catch (e) {
      failure = e instanceof Error && !e.message.includes(key) ? e.message : 'Search provider request failed.';
    }
    const observed = results.sort((a, b) => a.position - b.position).slice(0, 30);
    const match = observed.find(x => x.domain === domain || x.domain.endsWith(`.${domain}`));
    records.push({phrase, position:match?.position ?? null,url:match?.url ?? null,searched:observed.length,results:observed,checkedAt:new Date().toISOString(),context,
      ...(failure && (observed.length ? {coverageNote:'Partial snapshot. A later results page could not be checked.'} : {error:failure})),
    });
  }
  return records;
}
