use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use crate::{err, Err};

#[derive(Deserialize)]
pub struct Input {
    columns: Vec<String>, rows: Vec<Vec<f64>>, x: Vec<usize>, y: usize,
    #[serde(default = "default_method")] method: String,
}
fn default_method() -> String { "linear".into() }

// Householder QR avoids forming normal equations for polynomial designs.
fn least_squares(mut a: Vec<Vec<f64>>, mut y: Vec<f64>) -> Option<Vec<f64>> {
    let n = a.len(); let p = a.first()?.len();
    if n < p { return None; }
    let norm = (0..p).map(|j| a.iter().map(|r| r[j]*r[j]).sum::<f64>().sqrt()).fold(0., f64::max);
    for j in 0..p {
        let length = a[j..].iter().map(|r| r[j]*r[j]).sum::<f64>().sqrt();
        if !length.is_finite() || length < 1e-10 * norm.max(1.) { return None; }
        let alpha = if a[j][j] >= 0. { -length } else { length };
        let mut v: Vec<f64> = a[j..].iter().map(|r| r[j]).collect(); v[0] -= alpha;
        let vv = v.iter().map(|x| x*x).sum::<f64>();
        for k in j..p {
            let dot = 2. * v.iter().enumerate().map(|(i, x)| x*a[j+i][k]).sum::<f64>() / vv;
            for (i, x) in v.iter().enumerate() { a[j+i][k] -= dot*x; }
        }
        let dot = 2. * v.iter().enumerate().map(|(i, x)| x*y[j+i]).sum::<f64>() / vv;
        for (i, x) in v.iter().enumerate() { y[j+i] -= dot*x; }
    }
    let mut b = vec![0.; p];
    for j in (0..p).rev() {
        b[j] = (y[j] - (j+1..p).map(|k| a[j][k]*b[k]).sum::<f64>()) / a[j][j];
    }
    if b.iter().all(|x| x.is_finite()) { Some(b) } else { None }
}

fn terms(k: usize, method: &str) -> Vec<Vec<usize>> {
    let mut t = vec![vec![]];
    t.extend((0..k).map(|j| vec![j]));
    if method == "quadratic" { t.extend((0..k).map(|j| vec![j,j])); }
    if method == "quadratic" || method == "interaction" {
        for j in 0..k { for l in j+1..k { t.push(vec![j,l]); } }
    }
    t
}
fn basis(z: &[f64], terms: &[Vec<usize>]) -> Vec<f64> {
    terms.iter().map(|t| t.iter().map(|&j| z[j]).product()).collect()
}
fn predict(b: &[f64], row: &[f64], exponential: bool) -> f64 {
    let eta = b.iter().zip(row).map(|(b,x)| b*x).sum::<f64>();
    if exponential { eta.exp() } else { eta }
}
fn loss(b: &[f64], a: &[Vec<f64>], y: &[f64]) -> f64 {
    a.iter().zip(y).map(|(r,y)| (y-predict(b,r,true)).powi(2)).sum()
}

// Log-linear QR supplies initial values only. LM then minimizes squared errors
// on the original response scale; the holdout set never enters either fit.
fn nonlinear(a: &[Vec<f64>], y: &[f64]) -> Option<(Vec<f64>,usize)> {
    let mut b = least_squares(a.to_vec(), y.iter().map(|y| y.ln()).collect())?;
    let p = b.len(); let mut lambda = 1e-3;
    let scale = y.iter().map(|y| y*y).sum::<f64>().max(1.);
    let mut current = loss(&b,a,y);
    if !current.is_finite() { return None; }
    for iteration in 0..200 {
        if current/scale < 1e-20 { return Some((b,iteration)); }
        let mut jac = Vec::with_capacity(a.len()+p); let mut residual = Vec::with_capacity(a.len()+p);
        let mut diagonal = vec![0.;p]; let mut gradient = vec![0.;p];
        for (row,y) in a.iter().zip(y) {
            let predicted = predict(&b,row,true); let delta = y-predicted;
            let j:Vec<f64> = row.iter().map(|x| x*predicted).collect();
            for k in 0..p { diagonal[k] += j[k]*j[k]; gradient[k] += j[k]*delta; }
            jac.push(j); residual.push(delta);
        }
        if gradient.iter().map(|x| x.abs()).fold(0.,f64::max) / scale < 1e-10 {
            return Some((b,iteration));
        }
        for k in 0..p {
            let mut row=vec![0.;p];row[k]=(lambda*diagonal[k].max(1e-12)).sqrt();
            jac.push(row);residual.push(0.);
        }
        let step = least_squares(jac,residual)?;
        let candidate:Vec<f64> = b.iter().zip(&step).map(|(b,d)| b+d).collect();
        let next = loss(&candidate,a,y);
        if next.is_finite() && next < current {
            let improvement = current-next; b=candidate;current=next;lambda=(lambda/3.).max(1e-12);
            if improvement/scale < 1e-12 || step.iter().map(|x|x*x).sum::<f64>().sqrt() < 1e-9 {
                return Some((b,iteration+1));
            }
        } else { lambda*=10.; if lambda>1e16 { return None; } }
    }
    None
}

pub fn run(i: Input) -> Result<Value, Err> {
    let n=i.rows.len(); let p=i.columns.len(); let method=i.method.as_str();
    if !["linear","interaction","quadratic","exponential","power"].contains(&method) { return Err(err("请选择支持的建模方法")); }
    if !(15..=20000).contains(&n) { return Err(err("需要 15–20,000 行完整数值数据")); }
    if i.x.is_empty() || i.x.len()>6 || i.y>=p || i.x.iter().any(|&x| x>=p || x==i.y) { return Err(err("请选择 1–6 个 X 和一个不同的 Y")); }
    let mut unique=i.x.clone();unique.sort();unique.dedup();
    if unique.len()!=i.x.len(){return Err(err("X 列不能重复"));}
    if i.rows.iter().any(|r|r.len()!=p || r.iter().any(|v|!v.is_finite() || v.abs()>1e12)) { return Err(err("数据包含空值、非数值或超出支持范围的值")); }
    let exponential = method=="exponential" || method=="power";
    if exponential && i.rows.iter().any(|r|r[i.y]<=0.) { return Err(err("指数和幂函数模型要求所有 Y 大于 0；请检查数据或选择其他方法")); }
    if method=="power" && i.rows.iter().any(|r|i.x.iter().any(|&k|r[k]<=0.)) { return Err(err("幂函数模型要求所有 X 大于 0；请检查数据或选择其他方法")); }
    let split=n*4/5;let train=&i.rows[..split];let t=terms(i.x.len(),method);
    if split<3*t.len(){return Err(err(&format!("当前模型有 {} 个参数，至少需要 {} 行数据；请补充样本、减少因素或选择简单模型",t.len(),(3*t.len()*5+3)/4)));}
    let mut means=Vec::new();let mut scales=Vec::new();let mut factors=Vec::new();
    for (j,&k) in i.x.iter().enumerate() {
        let values:Vec<f64>=train.iter().map(|r|if method=="power"{r[k].ln()}else{r[k]}).collect();
        let mean=values.iter().sum::<f64>()/split as f64;
        let scale=(values.iter().map(|v|(v-mean).powi(2)).sum::<f64>()/split as f64).sqrt();
        if scale<1e-12*mean.abs().max(1.){return Err(err("训练数据存在恒定或几乎恒定的因素，请移除该因素"));}
        means.push(mean);scales.push(scale);
        factors.push(json!({"name":i.columns[k],"index":j,"min":train.iter().map(|r|r[k]).fold(f64::INFINITY,f64::min),"max":train.iter().map(|r|r[k]).fold(f64::NEG_INFINITY,f64::max),"mean":train.iter().map(|r|r[k]).sum::<f64>()/split as f64,"center":mean,"scale":scale}));
    }
    let a:Vec<Vec<f64>>=i.rows.iter().map(|r|{
        let z:Vec<f64>=i.x.iter().enumerate().map(|(j,&k)|((if method=="power"{r[k].ln()}else{r[k]})-means[j])/scales[j]).collect();basis(&z,&t)
    }).collect();
    let y:Vec<f64>=train.iter().map(|r|r[i.y]).collect();
    let (b,iterations)=if exponential {
        nonlinear(&a[..split],&y).ok_or_else(||err("非线性拟合未收敛或因素共线；请检查数据、缩减因素或选择其他模型"))?
    }else{(least_squares(a[..split].to_vec(),y.clone()).ok_or_else(||err("模型项共线或无法估计：二次模型需要足够的不同因素水平，交互模型需要足够的联合组合"))?,0)};
    let trainmean=y.iter().sum::<f64>()/split as f64;
    let (mut sse,mut baseline,mut train_sse)=(0.,0.,0.);let mut points=Vec::new();
    for (idx,(r,features)) in i.rows.iter().zip(&a).enumerate() {
        let pred=predict(&b,features,exponential);
        if !pred.is_finite() {return Err(err("预测超出可计算范围，请检查数值跨度及模型适用性"));}
        let residual=r[i.y]-pred;
        if idx>=split{sse+=residual*residual;baseline+=(r[i.y]-trainmean).powi(2);}else{train_sse+=residual*residual;}
        points.push(json!({"actual":r[i.y],"predicted":pred,"residual":residual,"holdout":idx>=split}));
    }
    let rmse=(sse/(n-split)as f64).sqrt();let baseline_rmse=(baseline/(n-split)as f64).sqrt();
    let model_terms:Vec<Value>=t.iter().zip(&b).map(|(indices,coefficient)|{
        let label=if indices.is_empty(){"常数项".into()}else if indices.len()==2&&indices[0]==indices[1]{format!("z{}²",indices[0]+1)}else{indices.iter().map(|j|format!("z{}",j+1)).collect::<Vec<_>>().join(" × ")};
        json!({"name":label,"factors":indices,"coefficient":coefficient})
    }).collect();
    let name=match method{"quadratic"=>"二次响应面","interaction"=>"线性与交互项","exponential"=>"指数非线性回归","power"=>"幂函数非线性回归",_=>"多元线性回归"};
    let formula=format!("预测 Y = {}{}{}",if exponential{"exp("}else{""},model_terms.iter().map(|t|format!("{:.6}{}",t["coefficient"].as_f64().unwrap(),if t["factors"].as_array().unwrap().is_empty(){String::new()}else{format!(" × {}",t["name"].as_str().unwrap())})).collect::<Vec<_>>().join(" + "),if exponential{")"}else{""});
    let warnings=if exponential{vec!["使用对数拟合初始化，再在原始 Y 尺度最小化平方误差；收敛不保证全局最优。"]}else{vec![]};
    Ok(json!({"schema_version":2,"model_type":method,"n":n,"train":split,"test":n-split,"parameter_count":b.len(),"intercept":b[0],"terms":model_terms,"factors":factors,"response":i.columns[i.y],"rmse":rmse,"train_rmse":(train_sse/split as f64).sqrt(),"baseline_rmse":baseline_rmse,"r2":if baseline>1e-12{Some(1.-sse/baseline)}else{None},"points":points,"formula":formula,"prediction_spec":{"link":if exponential{"exp"}else{"identity"},"transform":if method=="power"{"log"}else{"identity"}},"solver":{"algorithm":if exponential{"Levenberg–Marquardt / 原始响应尺度"}else{"Householder QR / OLS"},"converged":true,"iterations":iterations},"warnings":warnings,"status":if rmse<baseline_rmse{"待现场验证"}else{"需要重新建模"},"method":format!("{name} / 前 80% 拟合，后 20% 留出验证"),"notice":"R² 使用训练均值作为留出基线，所有误差均在原始 Y 单位计算。变量标准化仅使用训练数据。模型只支持关联解释；仍需检查残差与现场适用性。未计算参数置信区间或预测区间。"}))
}

pub async fn analyze(Json(i):Json<Input>)->Result<Json<Value>,Err>{
    tokio::task::spawn_blocking(move||run(i).map(Json)).await.map_err(|_|err("建模计算任务失败"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input(method:&str, f:impl Fn(f64,f64)->f64)->Input {
        let rows=(0..160).map(|i|{let x=1.+(i*17%97)as f64/24.;let z=1.+(i*29%89)as f64/30.;vec![x,z,f(x,z)]}).collect();
        Input{columns:vec!["X1".into(),"X2".into(),"Y".into()],rows,x:vec![0,1],y:2,method:method.into()}
    }
    #[test] fn recover_known_models(){
        for (m,f) in [("linear",( |x:f64,z:f64|3.+2.*x-0.5*z) as fn(f64,f64)->f64),("interaction",|x,z|3.+2.*x-z+0.8*x*z),("quadratic",|x,z|3.+2.*x-z+0.8*x*z-0.4*x*x+0.6*z*z),("exponential",|x,z|2.*(0.3*x-0.1*z).exp()),("power",|x,z|2.*x.powf(1.2)*z.powf(-0.4))]{
            let out=run(input(m,f)).unwrap();assert!(out["rmse"].as_f64().unwrap()<1e-6,"{m}: {out}");assert!(out["solver"]["converged"].as_bool().unwrap());
        }
    }
    #[test] fn nonlinear_minimizes_original_scale(){
        let mut i=input("exponential",|x,z|2.*(0.4*x-0.2*z).exp());
        for (j,r) in i.rows.iter_mut().enumerate(){r[2]+=(j as f64*1.7).sin()*0.8;}
        let a:Vec<Vec<f64>>=i.rows[..128].iter().map(|r|vec![1.,r[0],r[1]]).collect();
        let y:Vec<f64>=i.rows[..128].iter().map(|r|r[2]).collect();
        let initial=least_squares(a.clone(),y.iter().map(|y|y.ln()).collect()).unwrap();
        let initial_loss=loss(&initial,&a,&y);
        let o=run(i).unwrap();assert!(o["solver"]["iterations"].as_u64().unwrap()>0);assert!(o["rmse"].as_f64().unwrap()<0.8);
        assert!(o["train_rmse"].as_f64().unwrap().powi(2)*128. < initial_loss-1e-4);
    }
    #[test] fn quadratic_requires_levels_and_samples(){
        let mut i=input("quadratic",|x,z|x+z);for r in &mut i.rows{r[0]=if r[0]>3.{1.}else{0.};}assert!(run(i).is_err());
        let mut i=input("quadratic",|x,z|x+z);i.rows.truncate(15);assert!(run(i).is_err());
    }
    #[test] fn reject_invalid_domains_and_collinearity(){
        let mut i=input("power",|x,z|x+z);i.rows[159][0]=0.;assert!(run(i).is_err());
        let mut i=input("exponential",|x,z|x+z);i.rows[0][2]=-1.;assert!(run(i).is_err());
        let mut i=input("linear",|x,z|x+z);for r in &mut i.rows{r[1]=2.*r[0];}assert!(run(i).is_err());
    }
    #[test] fn holdout_does_not_change_fit(){
        let i=input("quadratic",|x,z|x*x+z);let mut changed=input("quadratic",|x,z|x*x+z);
        for r in &mut changed.rows[128..]{r[0]+=10.;r[2]+=100.;}
        let a=run(i).unwrap();let b=run(changed).unwrap();assert_eq!(a["terms"],b["terms"]);assert_eq!(a["factors"],b["factors"]);assert!(b["rmse"].as_f64().unwrap()>a["rmse"].as_f64().unwrap());
    }
}
