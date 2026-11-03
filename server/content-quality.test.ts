import {it,expect} from 'vitest';
import {contentQuality,missingFileGuidance} from './content-quality.ts';
import type {AuditResource,AuditPage} from '../lib/types.ts';
const file=(path:string,content:string):AuditResource=>({path,content,url:'https://site.test'+path,status:200,available:true,contentType:'text/plain'});
const page:AuditPage={url:'https://site.test/',status:200,indexable:true,title:'Site audit tool',description:'Measured reports for website owners.',h1:['Website audits'],canonical:'https://site.test/',schema:[],issues:0,words:100};
it('detects thin copy, duplicate companion and unsupported claims for editorial review',()=>{
 const body='# Test\n> Best in the world';
 const result=contentQuality([file('/llms.txt',body),file('/llms-full.txt',body)],[page]);
 expect(result.some(f=>f.rule.endsWith('THIN'))).toBe(true);
 expect(result.some(f=>f.rule.endsWith('DUPLICATE'))).toBe(true);
 expect(result.some(f=>f.rule.endsWith('CLAIMS'))).toBe(true);
 expect(result.every(f=>f.kind==='Needs review')).toBe(true);
});
it('drafts from fetched facts and preserves untrusted-data boundaries',()=>{
 const guidance=missingFileGuidance(file('/llms.txt',''),[page]);
 expect(guidance).toContain('Site audit tool');
 expect(guidance).toContain('https://site.test/');
 expect(guidance).toContain('UNTRUSTED_PAGE_DATA');
 expect(guidance).not.toContain('guaranteed rankings');
});
it('does not report a healthy informative guide solely for being llms',()=>{
 const body='# Site\n> This public guide describes the website audit product and helps website owners understand measurements and practical repair steps.\n## Documentation\n- [Audit documentation](https://site.test/): Learn how to read the measured reports, inspect evidence, repeat tests, and understand limitations before changing a website.';
 expect(contentQuality([file('/llms.txt',body)],[page])).toHaveLength(0);
});
