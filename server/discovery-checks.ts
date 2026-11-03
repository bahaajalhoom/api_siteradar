import { XMLParser, XMLValidator } from 'fast-xml-parser';
import robotsParser from 'robots-parser';
import type { AuditResource, Finding, PositiveSignal } from '../lib/types.ts';
// The package's ambient declaration is incompatible with NodeNext; runtime exports a function.
const parseRobots = robotsParser as unknown as (url: string, content: string) => { isAllowed(url: string, agent: string): boolean | undefined };

const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';
export function sitemapDeclarations(content: string) {
  return [...content.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map(m => m[1]);
}
export function analyzeDiscovery(resources: AuditResource[], origin: string) {
  const findings: Finding[] = [], positives: PositiveSignal[] = [];
  function issue(resource: AuditResource, rule: string, title: string, category: Finding['category'], evidence: string, recommendation: string, review = false) {
    findings.push({id:crypto.randomUUID(),rule,title,category,severity:review?'Low':'Medium',pages:[resource.url],evidence:evidence.slice(0,1500),recommendation,effort:'Review required',kind:review?'Needs review':'Observed'});
  }
  function pass(resource: AuditResource, rule: string, title: string, category: Finding['category'], evidence: string) {
    positives.push({id:crypto.randomUUID(),rule,title,category,pages:[resource.url],evidence});
  }
  for (const r of resources) {
    const geo = r.path.startsWith('/llms');
    const sitemap = r.path !== '/robots.txt' && !geo;
    const category = geo ? 'GEO readiness' : 'SEO';
    const prefix = geo ? 'GEO-DISCOVERY' : sitemap ? 'SEO-SITEMAP' : 'SEO-ROBOTS';
    if (!r.available) {
      issue(r,`${prefix}-FETCH`,`${r.path} could not be read`,category,`GET ${r.url} → ${r.status || 'network error'}. ${r.status === 0 ? r.content : ''}`,
        geo ? `Review publishing ${r.path} with factual site information. This is an optional discovery convention, not proof of AI visibility.` : `Review publishing an accessible ${sitemap?'XML sitemap of canonical public URLs':'robots.txt with intentional crawl rules'}. Check the HTTP response; do not bypass TLS or access restrictions.`, true);
      continue;
    }
    if (/text\/html/i.test(r.contentType) || /<(?:!doctype\s+html|html|body)\b/i.test(r.content)) {
      issue(r,`${prefix}-HTML`,`${r.path} returns HTML instead of its expected content`,category,`HTTP ${r.status}; Content-Type: ${r.contentType}. Body: ${r.content.slice(0,400)}`,`Fix routing so ${r.path} serves ${sitemap?'XML':'plain text/Markdown'} instead of an HTML page or fallback.`);
      continue;
    }
    if (!r.content.trim()) {
      issue(r,`${prefix}-EMPTY`,`${r.path} is empty`,category,'The response body is empty.',`Populate ${r.path} with intentional, site-specific content.`);
      continue;
    }
    const before = findings.length;
    if (r.path === '/robots.txt') {
      const lines = r.content.split(/\r?\n/).map(l=>l.replace(/#.*/, '').trim()).filter(Boolean);
      if (!lines.some(l=>/^user-agent\s*:\s*\S+/i.test(l)))
        issue(r,'SEO-ROBOTS-GROUP','robots.txt has no user-agent group','SEO',r.content.slice(0,500),'Add user-agent groups and intentional Allow/Disallow directives.');
      let group = false;
      const malformed: string[] = [];
      for (const line of lines) {
        if (/^user-agent\s*:/i.test(line)) group = true;
        if (/^(allow|disallow)\s*:/i.test(line) && !group) malformed.push(line);
        if (!/^[\w-]+\s*:/.test(line)) malformed.push(line);
      }
      if (malformed.length) issue(r,'SEO-ROBOTS-SYNTAX','robots.txt contains misplaced or malformed directives','SEO',malformed.slice(0,5).join('\n'),'Place Allow/Disallow under a user-agent group and use directive: value syntax.');
      const robots = parseRobots(r.url,r.content);
      if (robots.isAllowed(`${origin}/`,'Googlebot') === false)
        issue(r,'SEO-ROBOTS-BLOCK','robots.txt blocks Googlebot from the homepage','SEO','Googlebot is disallowed for the site root.','Review whether this block is intentional before allowing crawling.',true);
      for (const agent of ['GPTBot','OAI-SearchBot','ChatGPT-User','ClaudeBot'])
        if (robots.isAllowed(`${origin}/`,agent) === false)
          issue(r,`GEO-ROBOTS-${agent.toUpperCase()}`,`robots.txt blocks ${agent} at the homepage`,'GEO readiness',`${agent}: Disallow applies to ${origin}/`,'Review this agent-specific crawl policy with the site owner. Training and search/retrieval agents have different purposes; do not remove deliberate exclusions automatically.',true);
      const declared = sitemapDeclarations(r.content);
      if (!declared.length) issue(r,'SEO-ROBOTS-SITEMAP','robots.txt has no sitemap declaration','SEO','No Sitemap: directive found.','Consider adding the absolute URL of the valid sitemap. A declaration is a discovery aid, not an indexing guarantee.',true);
      for (const value of declared) { try { const u=new URL(value); if (!['https:','http:'].includes(u.protocol)) throw Error(); if(u.origin!==origin) issue(r,'SEO-ROBOTS-SITEMAP-SCOPE','Declared sitemap is outside the audited origin','SEO',value,'Review the canonical host and any cross-site sitemap submission. The collector did not fetch this destination outside its authorized origin.',true); } catch { issue(r,'SEO-ROBOTS-SITEMAP-URL','robots.txt declares an invalid sitemap URL','SEO',value,'Use an absolute HTTP(S) sitemap URL.'); } }
    } else if (sitemap) {
      const validation=XMLValidator.validate(r.content);
      if (validation !== true) {
        issue(r,'SEO-SITEMAP-XML','Sitemap XML is malformed','SEO',JSON.stringify(validation),'Repair XML syntax and escape reserved characters in URL values.');
        continue;
      }
      if (/<!DOCTYPE|<!ENTITY/i.test(r.content)) {
        issue(r,'SEO-SITEMAP-DOCTYPE','Sitemap contains unsupported entity declarations','SEO','DOCTYPE or ENTITY declaration detected.','Publish a plain sitemap without DTD or custom entities.');
        continue;
      }
      const parsed=new XMLParser({ignoreAttributes:false,parseTagValue:false,trimValues:true}).parse(r.content);
      const root=parsed.urlset ?? parsed.sitemapindex;
      const index=Boolean(parsed.sitemapindex);
      if (!root || root['@_xmlns'] !== NS) {
        issue(r,'SEO-SITEMAP-ROOT','Sitemap root or namespace is invalid','SEO','Expected urlset or sitemapindex with xmlns="'+NS+'".','Use the Sitemaps protocol root element and namespace.');
        continue;
      }
      const raw=root[index?'sitemap':'url'];
      const entries=raw ? (Array.isArray(raw)?raw:[raw]) : [];
      if (!entries.length) issue(r,'SEO-SITEMAP-EMPTY','Sitemap contains no entries','SEO','No url or sitemap entries found.','List canonical public URLs, or child sitemap URLs in a sitemap index.');
      const invalid: string[] = [], seen = new Set<string>();
      for (const entry of entries) {
        const loc=entry?.loc;
        try { if(typeof loc!=='string') throw Error(); const u=new URL(loc); if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.hash||u.origin!==origin) throw Error(); if(seen.has(loc)) invalid.push(`Duplicate: ${loc}`); seen.add(loc); } catch { invalid.push(`Invalid or outside audited origin: ${String(loc)}`); }
        if (entry?.lastmod && !/^\d{4}-\d{2}-\d{2}(?:T.+)?$/.test(String(entry.lastmod))) invalid.push(`Invalid lastmod: ${entry.lastmod}`);
      }
      if(invalid.length) issue(r,'SEO-SITEMAP-ENTRIES','Sitemap entries need review','SEO',invalid.slice(0,8).join('\n'),'Use unique, absolute canonical URLs from the audited origin and valid lastmod dates. Review cross-site submissions separately.',true);
      if(entries.length>50000) issue(r,'SEO-SITEMAP-LIMIT','Sitemap exceeds the URL entry limit','SEO',`${entries.length} entries`,'Split into sitemaps of at most 50,000 entries and reference them from an index.');
    } else {
      if(!/^#\s+\S/m.test(r.content)) issue(r,`${prefix}-TITLE`,`${r.path} has no Markdown title`,category,r.content.slice(0,400),'Add a clear # title naming the site or document.',true);
      if(r.path==='/llms.txt') {
        if(!/^>\s+\S/m.test(r.content)) issue(r,`${prefix}-SUMMARY`,'llms.txt has no short site summary',category,r.content.slice(0,400),'Add a concise blockquote summary based on the visible site content.',true);
        if(!/\[[^\]]+\]\(https?:\/\/[^)]+\)/i.test(r.content)) issue(r,`${prefix}-LINKS`,'llms.txt has no absolute content links',category,'No absolute Markdown links were detected.','Include descriptive Markdown links to useful public documentation and key pages; check their destinations.',true);
      }
      if(/\b(lorem ipsum|todo|your[- ](?:website|company|domain)|example\.com)\b/i.test(r.content)) issue(r,`${prefix}-PLACEHOLDER`,`${r.path} contains possible template content`,category,r.content.match(/.{0,50}(?:lorem ipsum|todo|your[- ](?:website|company|domain)|example\.com).{0,80}/i)?.[0]??'', 'Review template text and replace it with verified site information.',true);
    }
    if(findings.length===before) pass(r,`${prefix}-CONTENT`,`${r.path} passed the available content checks`,category,`HTTP ${r.status}; ${r.content.length} characters. ${sitemap?'XML structure and listed URL syntax checked. Child sitemaps and linked pages are not verified by this check.':geo?'Markdown content checks only; this does not measure AI visibility.':'Crawl directives inspected.'}`);
  }
  return {findings,positives};
}
