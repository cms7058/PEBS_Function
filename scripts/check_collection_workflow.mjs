import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {collectionFingerprint,collectionPassed,editCollection,blockingCollection,collectionConfig} from '../src/collection-workflow.js';
const material={collection_headers:['批次','温度 °C','强度 MPa','日期'],variables:[{name:'温度',role:'X',unit:'°C',min:10,max:20},{name:'强度',role:'Y',unit:'MPa',min:1,max:2}],collection_rows:[['A','1200','50','2024-02-29']],collection_rules:[{column:'批次',required:true,type:'text',min:'',max:''},{column:'温度 °C',required:true,type:'number',min:'0',max:'2000'},{column:'强度 MPa',required:true,type:'number',min:'',max:''},{column:'日期',required:true,type:'date',min:'',max:''}]};
function run(value){const out=spawnSync('python3',['scripts/collection_workflow.py'],{input:JSON.stringify(value),encoding:'utf8'});assert.equal(out.status,0,out.stderr);return JSON.parse(out.stdout)}
const check=m=>run({action:'check',stage:3,material:m});
const before=JSON.stringify(material),good=check(material);assert(good.passed);assert.equal(good.dataset.rows[0][0],1200);assert.equal(good.fingerprint,collectionFingerprint(material,3));assert.equal(JSON.stringify(material),before);
let state={mode:'real',stage:3,project:{},data:{rows:[],columns:[]},model:{formula:'old'},scenario:{},completed:[1,2,3,4],materials:{3:{...material,collection_check:good,checked_dataset:good.dataset}}};assert.equal(blockingCollection(state),null);
state=editCollection(state,3,{collection_rows:[['A','1200','','2024-02-29']]});assert.equal(blockingCollection(state),3);assert.deepEqual(state.completed,[1,2]);assert.equal(state.model,null);assert.equal(state.materials[3].checked_dataset,null);assert(!collectionPassed(state.materials[3],3));const failed=check(state.materials[3]);assert(!failed.passed);assert(failed.issues.some(i=>i.row===2&&i.column==='强度 MPa'));
const clone=()=>structuredClone(material);
for(const [column,value] of [[1,'NaN'],[1,'9999'],[3,'2026-02-29'],[3,'20261002']]){let m=clone();m.collection_rows[0][column]=value;assert(!check(m).passed)}
let m=clone();m.collection_rows.push([...m.collection_rows[0]]);assert(check(m).issues.some(i=>i.row===3&&i.message.includes('重复')));
m=clone();m.collection_rows.push(['','','','']);assert(check(m).passed);
m=clone();m.collection_tables=collectionConfig(m).tables;m.collection_tables.push({...m.collection_tables[0],id:'extra',name:'其他批次.csv'});assert(check(m).issues.some(i=>i.file==='其他批次.csv'&&i.message.includes('重复')));
m=clone();m.collection_bindings={'温度 °C':'','强度 MPa':'强度 MPa'};assert(check(m).issues.some(i=>i.file==='变量映射'));
m=clone();m.collection_rows=[[' A ','１,２００','50','2024/02/29']];assert(!check(m).passed);let repaired=run({action:'repair',stage:3,material:m});assert.equal(repaired.change_count,3);assert.equal(repaired.fingerprint,collectionFingerprint(m,3));m.collection_tables=repaired.tables;assert(check(m).passed);assert.equal(repaired.tables[0].rows[0][1],'1200');
m=clone();m.collection_rows[0][2]='';repaired=run({action:'repair',stage:3,material:m});assert.equal(repaired.change_count,0);assert(!check({...m,collection_tables:repaired.tables}).passed);
m=clone();m.collection_rules=m.collection_rules.map(r=>r.column==='日期'?{...r,required:false}:r);m.collection_tables=[{id:'primary',name:'省略可选列.csv',kind:'collection',headers:m.collection_headers.slice(0,3),rows:[m.collection_rows[0].slice(0,3)]}];assert(check(m).passed);assert.equal(check(m).dataset.rows.length,1);
const uploaded=run({action:'upload',filename:'填报.csv',csv:'\uFEFF批次,温度 °C,强度 MPa,日期\nA,1200,50,2024-02-29',kind:'collection',table_id:'primary'});assert(uploaded.accepted);m=clone();m.collection_tables=[uploaded.table];assert(check(m).passed);
for(const csv of ['A,A\n1,2','A,B\n1,2,3','A,B\n"unclosed,2','A,B\n','A,B\n\ufffd,1'])assert(!run({action:'upload',filename:'错误.csv',csv}).accepted);
m=clone();m.upload_issues=[{file:'错误.csv',row:2,column:'',message:'请重新上传'}];assert(!check(m).passed);assert.equal(check(m).fingerprint,collectionFingerprint(m,3));
m=clone();m.collection_tables=collectionConfig(m).tables;m.collection_tables.push({id:'data',name:'数值.csv',kind:'data',headers:['温度 °C','强度 MPa'],rows:[['1200','50']]});assert(check(m).passed);m.collection_tables[1].rows[0][1]='60';assert(check(m).issues.some(i=>i.file==='数值数据表与采集表'));
assert.equal(blockingCollection({...state,mode:'demo'}),null);assert.equal(blockingCollection({...state,stage:4}),3);
console.log('PASS: Python/JS fingerprints, required values, ranges, dates, duplicates, CSV shape/encoding, safe format repair, table consistency, stale receipt, gating and model invalidation');
