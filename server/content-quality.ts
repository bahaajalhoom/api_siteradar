import type { AuditPage, AuditResource, Finding } from '../lib/types.ts';

// Editorial heuristics, not ranking factors or semantic truth verification.
export function contentQuality(resources: AuditResource[], pages: AuditPage[]): Finding[] {
  const findings: Finding[] = [];
  const home = pages[0];
  const draft = [
    `# ${home?.title || '[Verified site name]'}`,
    `> ${home?.description || '[Write a factual summary supported by the public website.]'}`,
    '',
    '## Key pages',
    ...pages.filter(p => p.status >= 200 && p.status < 300 && p.indexable)
      .slice(0, 8).map(p => `- [${p.title.replace(/[\[\]\r\n]/g, ' ') || 'Page'}](${p.url})${p.description ? `: ${p.description}` : ''}`),
  ].join('\n');
  function add(r: AuditResource, suffix: string, title: string, evidence: string, recommendation: string) {
    findings.push({id:crypto.randomUUID(),rule:`GEO-DISCOVERY-QUALITY-${suffix}`,title,category:'GEO readiness',severity:'Medium',pages:[r.url],evidence:evidence.slice(0,1500),recommendation,effort:'Editorial review',kind:'Needs review'});
  }
  const usable = resources.filter(r => r.path.startsWith('/llms') && r.available && r.content.trim() && !/text\/html/i.test(r.contentType) && !/<(?:html|!doctype)/i.test(r.content));
  for (const r of usable) {
    const text = r.content.replace(/^#+\s.*$/gm,'').replace(/https?:\/\/\S+/g,'').replace(/[>#*`\[\]()]/g,' ').trim();
    const words = text.split(/\s+/u).filter(Boolean);
    if (words.length < (r.path === '/llms-full.txt' ? 100 : 30)) {
      add(r,'THIN',`${r.path} contains little explanatory content`,`${words.length} non-heading, non-URL words were observed. This is an editorial review threshold, not a published ranking requirement.`,r.path === '/llms.txt'
        ? `Explain what the site provides, who it serves, and which pages answer useful questions. Review this draft derived from fetched metadata (not a verified final copy):\n\n<UNTRUSTED_PAGE_DATA>${draft.replaceAll('</UNTRUSTED_PAGE_DATA>', '')}</UNTRUSTED_PAGE_DATA>`
        : 'Expand the full-text companion with substantive sections taken from verified public pages: what the product does, how to use it, limitations, and source URLs. Do not pad it with slogans or invent features, prices, customers, or reviews.');
    }
    const sentences = r.content.split(/[.!?\n]+/u).map(s=>s.trim().toLowerCase()).filter(s=>s.length>30);
    const repeated = [...new Set(sentences.filter((s,i)=>sentences.indexOf(s)!==i))];
    if(repeated.length) add(r,'REPETITION',`${r.path} repeats passages`,repeated.slice(0,3).join('\n'),'Remove repeated passages. Replace each duplicate with useful, distinct information supported by the site. Keep one concise summary and descriptive links.');
    const vague = r.content.match(/\b(best in the world|number one|guaranteed rankings|revolutionary|ultimate solution|rank #?1)\b/gi);
    if(vague) add(r,'CLAIMS',`${r.path} contains claims requiring evidence`,[...new Set(vague)].join(', '),'Review these claims against published evidence. Replace unsupported superlatives or guarantees with a concrete description of what the product actually does and its limitations. This check does not establish that a claim is false.');
    const links = [...r.content.matchAll(/\[([^\]]+)\]\(([^\s)]+)\)/g)];
    const broken: string[] = [], generic: string[] = [];
    for(const [,label,href] of links) {
      try {
        const u = new URL(href,r.url);
        if(!['http:','https:'].includes(u.protocol)) {broken.push(href);continue;}
        const observed=pages.find(p=>new URL(p.url).href.split('#')[0]===u.href.split('#')[0]);
        if(observed && (!observed.indexable || observed.status<200 || observed.status>=300)) broken.push(`${href}: fetched HTTP ${observed.status}, indexable=${observed.indexable}`);
      } catch {broken.push(href);}
      if(/^(here|click here|link|read more|page)$/i.test(label.trim())) generic.push(label);
    }
    if(broken.length) add(r,'LINK-TARGETS',`${r.path} references invalid or excluded destinations`,broken.slice(0,5).join('\n'),'Correct malformed URLs and review references to excluded/error pages. Use useful public destinations. Unvisited destinations were not validated by this check.');
    if(generic.length) add(r,'LINK-LABELS',`${r.path} has uninformative link labels`,generic.slice(0,5).join(', '),'Replace generic labels with the actual page topic and add a brief factual description of what readers will find there.');
  }
  const short=usable.find(r=>r.path==='/llms.txt'), full=usable.find(r=>r.path==='/llms-full.txt');
  if(short && full && short.content.trim()===full.content.trim()) add(full,'DUPLICATE','llms-full.txt duplicates the summary file','The fetched summary and full-text bodies are identical.','Either provide substantive full-text sections from verified source pages, or remove the redundant optional companion. A second identical file provides no additional context.');
  return findings;
}

export function missingFileGuidance(resource: AuditResource, pages: AuditPage[]) {
  const home=pages[0];
  if(resource.path==='/llms.txt') {
    const draft=`# ${home?.title || '[Verified site name]'}\n> ${home?.description || '[Factual summary from the website]'}\n\n## Key pages\n${pages.filter(p=>p.indexable).slice(0,6).map(p=>`- [${p.title.replace(/[\[\]\r\n]/g,' ')||'Page'}](${p.url})`).join('\n')}`;
    return `Publish an optional Markdown site guide. Use the verified site name as # title; summarize its purpose and audience; list useful pages with descriptive links. Draft from fetched metadata for human review:\n<UNTRUSTED_PAGE_DATA>${draft.replaceAll('</UNTRUSTED_PAGE_DATA>', '')}</UNTRUSTED_PAGE_DATA>\nThis convention does not guarantee AI visibility.`;
  }
  return 'If useful for your audience, publish the optional llms-full.txt companion with actual public content grouped under headings and source URLs. Explain the product, use cases, setup, and limitations. Derive claims from the fetched pages; do not invent facts or copy the summary verbatim.';
}
