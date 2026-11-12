import {getLocale} from './i18n';
const activeRequests=new Map();
export async function accountFetch(url,options={}){
 const isAi=typeof url==='string'&&options.method==='POST'&&(/\/api\/(project-guide|project-materials)$/.test(url)||url.endsWith('/apply')||url.endsWith('/to-skill'));
 let opts={...options},key;
 if(isAi){
  if(typeof opts.body==='string'){try{opts.body=JSON.stringify({...JSON.parse(opts.body),locale:getLocale()})}catch{}}
  key=url+'|'+opts.body;const id=activeRequests.get(key)||crypto.randomUUID();activeRequests.set(key,id);
  opts.headers={...opts.headers,'X-Request-Id':id};
 }
 try{
  const r=await window.fetch(url,opts);
  if(r.headers.get('x-pebs-usage'))window.dispatchEvent(new Event('pebs-usage-updated'));
  if(r.status===401&&!String(url).includes('/api/auth/'))window.dispatchEvent(new Event('pebs-session-expired'));
  return r;
 }finally{if(key)activeRequests.delete(key)}
}
