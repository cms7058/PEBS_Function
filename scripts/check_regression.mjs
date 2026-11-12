import assert from 'node:assert/strict';
import {methods,scenarioPrediction,nonlinearSample} from '../src/regression.js';
const base=process.env.REGRESSION_TEST_BASE||'http://127.0.0.1:8787';
async function fit(body){const r=await fetch(base+'/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,value:await r.json()};}
const truths={linear:(x,z)=>3+2*x-.5*z,interaction:(x,z)=>3+2*x-z+.8*x*z,quadratic:(x,z)=>3+2*x-z+.8*x*z-.4*x*x+.6*z*z,exponential:(x,z)=>2*Math.exp(.3*x-.1*z),power:(x,z)=>2*x**1.2*z**(-.4)};
for(const {id} of methods){
 const rows=Array.from({length:160},(_,i)=>{const x=1+(i*17%97)/24,z=1+(i*29%89)/30;return [x,z,truths[id](x,z)];});
 const body={columns:['X1','X2','Y'],rows,x:[0,1],y:2,method:id};
 const {status,value:model}=await fit(body);assert.equal(status,200,JSON.stringify(model));assert.ok(model.rmse<1e-6,id);assert.equal(model.schema_version,2);
 for(const [j,row] of rows.entries()){const client=scenarioPrediction(model,{X1:row[0],X2:row[1]});assert.ok(Math.abs(client-model.points[j].predicted)<1e-9,id+' frontend/backend mismatch');}
 const candidate={X1:2.4,X2:1.7};assert.ok(Math.abs(scenarioPrediction(model,candidate)-truths[id](2.4,1.7))<1e-6,id+' scenario mismatch');
 const changed=structuredClone(body);for(const r of changed.rows.slice(128)){r[0]+=10;r[2]+=100;}
 const again=await fit(changed);assert.equal(again.status,200);assert.deepEqual(again.value.terms,model.terms);assert.deepEqual(again.value.factors,model.factors);
 if(id==='linear'){delete body.method;assert.equal((await fit(body)).value.model_type,'linear');}
 console.log('PASS '+id+': fit, independent holdout, client/server predictions, scenario');
}
const sample=nonlinearSample('quadratic');
const body={columns:sample.columns,rows:sample.rows,x:[0,1,2],y:3,method:'quadratic'};
const quadratic=(await fit(body)).value,linear=(await fit({...body,method:'linear'})).value;
assert.ok(quadratic.rmse<linear.rmse*.2,'quadratic sample should reveal curvature');
for(const id of ['exponential','power']){const s=nonlinearSample(id);const r=await fit({...body,columns:s.columns,rows:s.rows,method:id});assert.equal(r.status,200,JSON.stringify(r.value));assert.ok(r.value.rmse<1);}
for(const b of [{...body,method:'unknown'},{...body,method:'quadratic',rows:sample.rows.slice(0,15)},{...body,method:'power',rows:sample.rows.map((r,j)=>j===99?[0,...r.slice(1)]:r)},{...body,method:'exponential',rows:sample.rows.map((r,j)=>j===99?[...r.slice(0,3),-1]:r)},{...body,rows:sample.rows.map(r=>[r[0],r[0]*2,r[2],r[3]])}]){assert.equal((await fit(b)).status,400,'invalid model data should be rejected');}
assert.equal(scenarioPrediction({intercept:3,factors:[{name:'X',mean:2,coefficient:4}]},{X:5}),23,'legacy model scenario');
console.log(`PASS examples, invalid domains/designs, sample-size guards, legacy results; quadratic holdout RMSE ${quadratic.rmse.toFixed(4)}, linear ${linear.rmse.toFixed(4)}`);
