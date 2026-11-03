import { describe, it, expect } from 'vitest';
import { analyzeDiscovery } from './discovery-checks.ts';
import { scoreCategory } from './checks.ts';
import { repairPrompt } from '../lib/types.ts';
import type { AuditResource, Audit } from '../lib/types.ts';
const origin='https://site.test';
const resource=(path:string,content:string,status=200):AuditResource=>({path,url:origin+path,content,status,available:status===200,contentType:'text/plain'});
describe('discovery evidence',()=>{
  it('reports missing files and feeds evidence into a repair prompt',()=>{
    const result=analyzeDiscovery([resource('/llms.txt','',404),resource('/llms-full.txt','',404),resource('/sitemap.xml','',404)],origin);
    expect(result.findings).toHaveLength(3);
    expect(result.positives).toHaveLength(0);
    expect(scoreCategory(result.findings,'GEO readiness',1)).toBe(scoreCategory(result.findings,'GEO readiness',100));
    const prompt=repairPrompt({id:'test',url:origin,createdAt:'2026-11-04',config:{country:'test',language:'English',device:'Desktop'},findings:result.findings} as Audit);
    expect(prompt).toContain('GEO-DISCOVERY-FETCH');
    expect(prompt).toContain('UNTRUSTED_PAGE_DATA');
  });
  it('rejects HTML fallbacks, malformed XML and sitemap entries without loc',()=>{
    expect(analyzeDiscovery([resource('/llms.txt','<!doctype html><html>fallback</html>')],origin).findings[0].rule).toBe('GEO-DISCOVERY-HTML');
    expect(analyzeDiscovery([resource('/sitemap.xml','<urlset><url></urlset>')],origin).findings[0].rule).toBe('SEO-SITEMAP-XML');
    const xml='<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><lastmod>today</lastmod></url></urlset>';
    expect(analyzeDiscovery([resource('/sitemap.xml',xml)],origin).findings[0].rule).toBe('SEO-SITEMAP-ENTRIES');
  });
  it('checks bot policies and accepts well-formed sitemap content',()=>{
    const robots=analyzeDiscovery([resource('/robots.txt','User-agent: *\nDisallow: /\nSitemap: https://site.test/sitemap.xml')],origin);
    expect(robots.findings.some(f=>f.rule==='SEO-ROBOTS-BLOCK')).toBe(true);
    expect(robots.findings.some(f=>f.rule==='GEO-ROBOTS-GPTBOT')).toBe(true);
    const xml='<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://site.test/</loc></url></urlset>';
    const result=analyzeDiscovery([resource('/sitemap.xml',xml)],origin);
    expect(result.findings).toHaveLength(0);
    expect(result.positives).toHaveLength(1);
  });
});
