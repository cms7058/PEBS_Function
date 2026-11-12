export const fieldLabels={name:'项目名称',question:'工程问题',target:'目标与成功标准',scope:'分析对象与工序范围',constraints:'资源限制与瓶颈假设',plannedY:'结果变量 Y',plannedXs:'候选影响因素 X',owner:'负责人',action:'改善／确认实验计划',followup:'实际结果与下一步'};
export const stageFields={1:['name','question','target'],2:['scope','constraints'],3:['plannedY','plannedXs'],4:[],5:[],6:[],7:[],8:[],9:['action','owner'],10:['followup']};
export const variableLabel=v=>v.name.trim()+(v.unit.trim()&&!v.name.includes(v.unit.trim())?' '+v.unit.trim():'');
export function validateVariables(variables){
 if(!variables.length)throw Error('尚未定义连续型 X / Y，不能生成建模模拟数据。');
 if(variables.filter(v=>v.role==='Y').length!==1||variables.filter(v=>v.role==='X').length<1||variables.filter(v=>v.role==='X').length>6)throw Error('需定义一个 Y 和 1–6 个 X。');
 const names=variables.map(variableLabel);if(names.some(n=>!n)||new Set(names).size!==names.length)throw Error('变量名须填写且不能重复。');
 if(variables.some(v=>!['X','Y'].includes(v.role)||![v.min,v.max].every(n=>Number.isFinite(Number(n))&&Math.abs(Number(n))<=1e9)||Number(v.min)>=Number(v.max)))throw Error('请检查变量角色与模拟最小／最大值。');
}
export function simulate(variables){
 validateVariables(variables);const ordered=[...variables.filter(v=>v.role==='X'),...variables.filter(v=>v.role==='Y')];let seed=20261002;const rnd=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296};
 const k=ordered.length-1,yv=ordered[k];const rows=Array.from({length:100},()=>{const zs=Array.from({length:k},rnd);const fraction=.1+.8*zs.reduce((a,z)=>a+z,0)/k+(rnd()-.5)*.05;return [...zs.map((z,i)=>Number((+ordered[i].min+z*(ordered[i].max-ordered[i].min)).toPrecision(8))),Number((+yv.min+fraction*(yv.max-yv.min)).toPrecision(8))]});
 return {columns:ordered.map(variableLabel),rows,label:'模拟数据 · 100 条 · 非现场测量',issues:[],synthetic:true,simulation_rule:'教学假设：各 X 在填写范围内独立均匀采样，Y 随标准化 X 的平均值变化并加入少量噪声。该关系与数值不是现场证据，也不是推荐工艺参数。'};
}
export function applyMaterial(state,stage,preview,selected){
 const fields=preview.fields.filter(f=>selected.includes(f.key));if(fields.some(f=>!stageFields[stage].includes(f.key)))throw Error('导入字段不属于当前阶段。');
 const patch=Object.fromEntries(fields.map(f=>[f.key,f.value]));let xs=state.xs,y=state.y;
 if(stage===3&&preview.variables.length){validateVariables(preview.variables);patch.plannedY=variableLabel(preview.variables.find(v=>v.role==='Y'));patch.plannedXs=preview.variables.filter(v=>v.role==='X').map(variableLabel).join('\n');const indexes=preview.variables.filter(v=>v.role==='X').map(v=>state.data.columns.indexOf(variableLabel(v))),response=state.data.columns.indexOf(patch.plannedY);if(response>=0&&indexes.every(i=>i>=0)){xs=indexes;y=response}}
 const changed=Object.keys(patch).some(k=>state.project[k]!==patch[k]);const invalidate=changed&&stage<=3;
 return {...state,project:{...state.project,...patch},xs,y,model:invalidate?null:state.model,scenario:invalidate?{}:state.scenario,completed:changed?state.completed.filter(n=>n<stage):state.completed,materials:{...state.materials,[stage]:{...preview,imported_at:Date.now(),collection_rows:Array.from({length:5},()=>preview.collection_headers.map(()=>''))}}};
}
export function simulationProject(state,data,id){return {...state,project:{...state.project,name:(state.project.name+' · 模拟预览').slice(0,190)},mode:'demo',stage:4,completed:[1,2,3],data,xs:data.columns.slice(0,-1).map((_,i)=>i),y:data.columns.length-1,method:'linear',model:null,scenario:{},simulation_of:id,guidance:{},guideSettings:{web:false}}}
export function descriptive(data){return data.columns.map((name,j)=>{const ns=data.rows.map(r=>r[j]);const mean=ns.reduce((a,b)=>a+b,0)/ns.length;return [name,ns.length,Math.min(...ns),Math.max(...ns),mean,Math.sqrt(ns.reduce((a,b)=>a+(b-mean)**2,0)/(ns.length-1))]})}
