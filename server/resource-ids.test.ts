import {describe,it,expect} from 'vitest';
import {pageResourceId,withResourceIds} from './resource-ids';
import {exampleAudit} from '../lib/example';
describe('stable page identifiers',()=>{
 it('keeps a URL identity across scan snapshots and removes fragments',()=>{expect(pageResourceId('p1','https://example.com/#section')).toBe(pageResourceId('p1','https://example.com/'));expect(pageResourceId('p1','https://example.com/')).not.toBe(pageResourceId('p2','https://example.com/'));});
 it('adds IDs without changing existing page IDs or deleting evidence',()=>{const audit=withResourceIds(exampleAudit);expect(audit.pages[0].id).toMatch(/^page_/);expect(audit.findings).toEqual(exampleAudit.findings);expect(withResourceIds(audit).pages[0].id).toBe(audit.pages[0].id);});
});
