export const methods = [
  {id:'linear',name:'多元线性回归',formula:'Y = β₀ + Σ βᵢXᵢ',description:'作为简单基线，分析近似直线关系。',condition:'连续型 Y；因素有足够变化，模型项不共线。'},
  {id:'interaction',name:'线性与交互项',formula:'Y = β₀ + Σ βᵢXᵢ + Σ βᵢⱼXᵢXⱼ',description:'分析一个因素的影响是否随另一个因素变化。',condition:'需要多种因素联合组合；不包含平方项。'},
  {id:'quadratic',name:'二次响应面',formula:'Y = β₀ + Σ βᵢXᵢ + Σ βᵢᵢXᵢ² + Σ βᵢⱼXᵢXⱼ',description:'描述曲率和交互，探索工艺参数的候选区域。',condition:'每个因素需要至少三个不同水平及足够的联合组合。'},
  {id:'exponential',name:'指数非线性回归',formula:'Y = a · exp(Σ bᵢXᵢ)，a > 0',description:'描述正值响应随因素指数增长或衰减。',condition:'所有 Y > 0；当前形式不含额外偏置或饱和上限。'},
  {id:'power',name:'幂函数非线性回归',formula:'Y = a · ∏ Xᵢᵇⁱ，a > 0',description:'描述正值因素与结果之间的尺度关系。',condition:'所有 X > 0 且 Y > 0；指数可为正或负。'},
];
export function parameterCount(method,k){return 1+k+(method==='quadratic'?k:0)+(['interaction','quadratic'].includes(method)?k*(k-1)/2:0)}
export function scenarioPrediction(model,values={}){
  if(!model)return null;
  const xs=model.factors.map(f=>values[f.name]??f.mean);
  if(xs.some(v=>!Number.isFinite(v)))return null;
  if(!model.prediction_spec)return model.intercept+model.factors.reduce((s,f,j)=>s+f.coefficient*xs[j],0);
  const log=model.prediction_spec.transform==='log';
  if(log&&xs.some(v=>v<=0))return null;
  const z=model.factors.map((f,j)=>((log?Math.log(xs[j]):xs[j])-f.center)/f.scale);
  const eta=model.terms.reduce((sum,t)=>sum+t.coefficient*t.factors.reduce((product,j)=>product*z[j],1),0);
  const result=model.prediction_spec.link==='exp'?Math.exp(eta):eta;
  return Number.isFinite(result)?result:null;
}
export function nonlinearSample(kind='quadratic'){
  const rows=Array.from({length:100},(_,i)=>{
    const t=160+(i*17%61),p=2+(i*7%21)/10,m=10+(i*11%21);
    const u=(t-190)/20,v=(p-3),w=(m-20)/10;
    const noise=Math.sin(i*1.71)*.45+Math.cos(i*.47)*.15;
    const strength=kind==='exponential'?30*Math.exp(.4*u+.25*v+.2*w):kind==='power'?45*Math.pow(t/190,1.8)*Math.pow(p/3,.5)*Math.pow(m/20,.3):70+5*u+3*v+2*w-7*u*u-4*v*v-2*w*w+5*u*v;
    return [t,p,m,Number((strength+noise).toFixed(4))];
  });
  const name={quadratic:'二次响应面',exponential:'指数',power:'幂函数'}[kind];
  return{columns:['温度 °C','压力 MPa','保温时间 min','强度 MPa'],rows,label:`模拟${name}数据 · 100 条`,issues:[],synthetic:true};
}
