import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getSecret: vi.fn() }));
vi.mock("./secrets.ts", () => ({ getSecret: mocks.getSecret }));
import { checkRankings } from "./rankings";
const exampleAudit = {config:{url:'https://formandfield.example/',country:'United States',language:'English',device:'Mobile',maxPages:1,authorized:true,keywords:['desk accessories']}};
beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
describe("contextual keyword positions", () => {
  it('records the absolute position from a later page and preserves actual depth', async () => {
    mocks.getSecret.mockReturnValue('unit-test-key');
    const page = (next?: number, match = false) => new Response(JSON.stringify({
      organic_results: [{position: 1, link: match ? exampleAudit.config.url : `https://other.example/${next}`}],
      serpapi_pagination: next ? {next: `https://serpapi.com/search.json?start=${next}`} : {},
    }));
    const request = vi.fn().mockResolvedValueOnce(page(10)).mockResolvedValueOnce(page(20)).mockResolvedValueOnce(page(undefined, true));
    vi.stubGlobal('fetch',request);
    const [result] = (await checkRankings('owner',exampleAudit.config))!;
    expect(result.position).toBe(21);
    expect(result.searched).toBe(3);
    expect(request.mock.calls[2][0]).toContain('start=20');
  });
  it('labels partial data when a later provider page fails', async () => {
    mocks.getSecret.mockReturnValue('unit-test-key');
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      organic_results:[{position:1,link:'https://other.example/'}],
      serpapi_pagination:{next:'https://serpapi.com/search.json?start=10'},
    }))).mockRejectedValueOnce(new Error('Timeout')));
    const [result] = (await checkRankings('owner',exampleAudit.config))!;
    expect(result.searched).toBe(1);
    expect(result.position).toBeNull();
    expect(result.coverageNote).toMatch(/partial/i);
  });
  it("keeps rankings unavailable without a key and makes no requests", async () => {
    mocks.getSecret.mockReturnValue("");
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    expect(await checkRankings("owner", exampleAudit.config)).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
  it("matches domains and records actual depth, context and results", async () => {
    mocks.getSecret.mockReturnValue("unit-test-key");
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          organic_results: [
            {
              position: 1,
              link: "https://competitor.example/",
              title: "Competitor",
            },
            {
              position: 2,
              link: "https://www.formandfield.example/products",
              title: "Actual page",
            },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", request);
    const records = await checkRankings("owner", {
      ...exampleAudit.config,
      keywords: ["desk accessories"],
    });
    expect(records?.[0].position).toBe(2);
    expect(records?.[0].searched).toBe(2);
    expect(request.mock.calls[0][0]).toContain("gl=us");
    expect(request.mock.calls[0][0]).toContain("device=mobile");
    expect(request.mock.calls[0][0]).toContain("location=United+States");
    expect(records?.[0]).not.toHaveProperty("api_key");
  });
  it("does not report provider failures as missing ranks", async () => {
    mocks.getSecret.mockReturnValue("unit-test-key");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "out of credits" })),
        ),
    );
    const records = await checkRankings("owner", {
      ...exampleAudit.config,
      keywords: ["desk"],
    });
    expect(records?.[0].error).toBeTruthy();
    expect(records?.[0].searched).toBe(0);
  });
  it("records a completed search without claiming a position beyond returned results", async () => {
    mocks.getSecret.mockReturnValue("unit-test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            organic_results: [
              {
                position: 1,
                link: "https://other.example/",
                title: "Another domain",
              },
            ],
          }),
        ),
      ),
    );
    const records = await checkRankings("owner", {
      ...exampleAudit.config,
      keywords: ["desk"],
    });
    expect(records?.[0].position).toBeNull();
    expect(records?.[0].searched).toBe(1);
    expect(records?.[0].error).toBeUndefined();
  });
  it("recognizes the first result on a subpage and retains provider context", async () => {
    mocks.getSecret.mockReturnValue("unit-test-key");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              search_parameters: {
                location_used: "Israel",
                google_domain: "google.com",
              },
              search_information: {
                query_displayed: "ahmad saleh layaqa",
                spelling_fix: "ahmed saleh layaqa",
                organic_results_state:
                  "Showing results for exact spelling despite spelling suggestion",
              },
              organic_results: [
                {
                  position: 1,
                  title: "Terms",
                  link: "https://www.ahmedsaleh.website/terms/",
                },
              ],
            }),
          ),
        ),
    );
    const records = await checkRankings("owner", {
      ...exampleAudit.config,
      url: "https://ahmedsaleh.website",
      country: "Israel",
      keywords: ["ahmad saleh layaqa"],
    });
    expect(records?.[0].position).toBe(1);
    expect(records?.[0].url).toBe("https://www.ahmedsaleh.website/terms/");
    expect(records?.[0].context?.locationUsed).toBe("Israel");
    expect(records?.[0].context?.spellingSuggestion).toBe("ahmed saleh layaqa");
  });
});
