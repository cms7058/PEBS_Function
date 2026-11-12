export const DEFAULT_ACCESS={tier:'normal',role:'user',show_book_names:false};
export const tierLabel=value=>value==='ultra'?'Ultra':value==='high'?'high':'normal';
export function normalizeAccess(value){
 const tier=['normal','high','ultra'].includes(value?.tier)?value.tier:'normal';
 const role=['user','researcher','admin'].includes(value?.role)?value.role:'user';
 return {tier,role,show_book_names:value?.show_book_names===true&&role==='admin'};
}
export const accessSignature=value=>JSON.stringify(normalizeAccess(value));
export function matchingAccess(saved,profile){return !!saved?.access&&!saved.access_stale&&accessSignature(saved.access)===accessSignature(profile)}
export function visibleRecommendations(saved,profile){
 if(!matchingAccess(saved,profile))return [];
 const rank={normal:0,high:1,ultra:2},limit=rank[normalizeAccess(profile).tier];
 return (saved.recommendations||[]).filter(item=>Object.hasOwn(rank,item.tier)&&rank[item.tier]<=limit);
}
export function visibleSources(saved,profile){
 const rank={normal:0,high:1,ultra:2},limit=rank[normalizeAccess(profile).tier];
 return (saved?.sources||[]).filter(source=>!source.tier||(Object.hasOwn(rank,source.tier)&&rank[source.tier]<=limit));
}
export function sourcePresentation(source,saved,profile){
 const knowledge=(typeof source.knowledge_point==='string'&&source.knowledge_point.trim())||((source.kind==='web'?'联网研究':source.kind==='skill'?'方法':'工程统计')+'知识点 '+(source.id||''));
 const mayShowBook=normalizeAccess(profile).show_book_names&&matchingAccess(saved,profile);
 const bookTitle=typeof source.book_title==='string'?source.book_title:(source.kind==='book'&&typeof source.title==='string'?source.title:'');
 const title=mayShowBook?bookTitle:'';
 let url='';
 if(typeof source.url==='string'){
  if(mayShowBook&&/^\/reader\.html\?/.test(source.url))url=source.url;
  if(source.kind==='web'&&/^https:\/\//.test(source.url))url=source.url;
 }
 return {knowledge,title,url,page:title&&Number.isInteger(source.page)&&source.page>0?source.page:null};
}
