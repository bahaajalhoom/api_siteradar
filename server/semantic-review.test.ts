import {it,expect,vi,afterEach} from 'vitest';
import {validateReview,semanticReview} from './semantic-review.ts';
import type {Audit} from '../lib/types.ts';
const source={id:'page-1',text:'We provide website audits with page-level evidence.'};
const entry={phrase:'SEO',fit:'relevant',reason:'Related to auditing',source:'page-1',quote:'website audits',suggestion:'Use a specific phrase'};
afterEach(()=>vi.unstubAllGlobals());
it('does not publish a positive keyword rating when the explanation contradicts it',()=>{
 const result=validateReview({summary:'Audits',keywords:[{...entry,reason:'This is not directly related to the site.'}],issues:[]},[source],['SEO']);
 expect(result.keywords[0].fit).toBe('uncertain');
});
it('rejects fabricated evidence and unknown keywords',()=>{
 const result=validateReview({summary:'Website audits',keywords:[entry,{...entry,phrase:'invented'},{...entry,quote:'fabricated quote'}],issues:[{title:'Claim',source:'page-2',quote:'website audits',recommendation:'Change'}]},[source],['SEO']);
 expect(result.keywords).toHaveLength(1);expect(result.issues).toHaveLength(0);expect(result.rejectedItems).toBe(3);
});
it('fails closed on malformed or truncated model output',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({done_reason:'length',message:{content:'{}'}})}));
 const result=await semanticReview({config:{keywords:['SEO']},resources:[]} as unknown as Audit,[{url:'https://site.test',text:source.text}]);
 expect(result.review.status).toBe('failed');expect(result.findings).toHaveLength(0);
});
