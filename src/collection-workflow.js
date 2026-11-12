import {variableLabel} from './stage-materials.js';
const norm=s=>String(s).replace(/[\s（）()\[\]【】,，:：/·°%_-]/g,'').toLowerCase();
export function defaultBinding(v,headers){const matches=headers.filter(h=>[norm(variableLabel(v)),norm(v.name)].includes(norm(h)));return matches.length===1?matches[0]:''}
export function collectionConfig(m){
 const headers=m.collection_headers,variables=m.variables||[],bindings=m.collection_bindings||Object.fromEntries(variables.map(v=>[variableLabel(v),defaultBinding(v,headers)]));
 const rules=m.collection_rules||headers.map(h=>({column:h,required:true,type:Object.values(bindings).includes(h)?'number':'text',min:'',max:''}));
 const tables=m.collection_tables||[{id:'primary',name:'本阶段采集表',kind:'collection',headers,rows:m.collection_rows||[]}];return {headers,variables,bindings,rules,tables};
}
export function collectionFingerprint(m,stage){
 const {headers,variables,bindings,rules,tables}=collectionConfig(m);
 const seq=[String(stage),headers,rules.map(r=>[r.column,r.required?'1':'0',r.type||'text',String(r.min??''),String(r.max??'')]),variables.map(v=>[v.name,v.role,v.unit||'']),variables.map(v=>[variableLabel(v),bindings[variableLabel(v)]||'']),tables.map(t=>[t.id,t.name,t.kind||'collection',t.headers,t.rows.map(row=>row.map(v=>v==null?'':String(v)))]),(m.upload_issues||[]).map(i=>[i.file||'',String(i.row??''),String(i.column??''),i.message])];let h=14695981039346656037n;for(const b of new TextEncoder().encode(JSON.stringify(seq)))h=BigInt.asUintN(64,(h^BigInt(b))*1099511628211n);return h.toString(16).padStart(16,'0');
}
export function collectionPassed(m,stage){return !!m&&m.collection_check?.passed===true&&m.collection_check.fingerprint===collectionFingerprint(m,stage)}
export function blockingCollection(state){if(state.mode==='demo')return null;return Object.entries(state.materials||{}).map(([n,m])=>[+n,m]).filter(([n])=>n<=state.stage).sort((a,b)=>a[0]-b[0]).find(([n,m])=>!collectionPassed(m,n))?.[0]??null}
export function editCollection(state,stage,change){const old=state.materials[stage];const edited={...old,...change,collection_check:old.collection_check?{...old.collection_check,passed:false,stale:true}:null,checked_dataset:null};const tables=change.collection_tables||old.collection_tables;if(tables?.find(t=>t.kind==='collection'))edited.collection_rows=tables.find(t=>t.kind==='collection').rows;
 return {...state,materials:{...state.materials,[stage]:edited},completed:state.completed.filter(n=>n<stage),...(stage<=4?{model:null,scenario:{}}:{})};
}
