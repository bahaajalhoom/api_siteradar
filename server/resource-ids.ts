import { createHash } from 'node:crypto';
import type { Audit } from '../lib/types';
export function pageResourceId(projectId:string,url:string){const normalized=new URL(url);normalized.hash='';return `page_${createHash('sha256').update(`${projectId}\n${normalized.href}`).digest('hex').slice(0,24)}`;}
export function withResourceIds(audit:Audit):Audit {
  return {...audit,pages:audit.pages.map(page=>({...page,id:page.id??pageResourceId(audit.projectId??audit.id,page.url)}))};
}
