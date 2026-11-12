use axum::{extract::{Path,State},routing::get,Json,Router};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{path::PathBuf,sync::{Arc,Mutex},time::{SystemTime,UNIX_EPOCH}};
use crate::{err,Err};

#[derive(Clone)] struct Store{root:PathBuf,lock:Arc<Mutex<()>>}
#[derive(Serialize,Deserialize)] struct Project{
 id:String,created_at:u64,updated_at:u64,state:Value,
 #[serde(default="draft_status")] status:String,
 #[serde(default)] draft_at:Option<u64>,
 #[serde(default)] saved_at:Option<u64>,
 #[serde(default)] saved_state:Option<Value>,
 #[serde(default)] save_count:u64,
}
fn draft_status()->String{"draft".into()}
#[derive(Deserialize)] struct Create{name:String,#[serde(default)] question:String,#[serde(default)] target:String,#[serde(default)] state:Option<Value>}
#[derive(Deserialize)] struct Update{state:Value,#[serde(default="auto_action")] action:String}
fn auto_action()->String{"autosave".into()}
fn now()->u64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis()as u64}
fn safe_id(id:&str)->Result<(),Err>{if id.starts_with('p')&&id.len()<80&&id.bytes().all(|c|c.is_ascii_alphanumeric()){Ok(())}else{Err(err("项目编号无效"))}}
fn blank(name:&str,question:&str,target:&str)->Value{json!({"project":{"name":name,"question":question,"target":target,"scope":"","constraints":"","owner":"","action":"","followup":"","plannedY":"","plannedXs":""},"stage":1,"completed":[],"data":{"columns":[],"rows":[],"label":"尚未上传项目数据","issues":[],"synthetic":false},"xs":[],"y":null,"model":null,"method":"linear","scenario":{},"mode":"real"})}
fn validate(s:&Value)->Result<(),Err>{
 let name=s["project"]["name"].as_str().unwrap_or("").trim();if name.is_empty()||name.chars().count()>200{return Err(err("项目名称须为 1–200 个字符"))}
 if !s["project"].is_object()||!["real","demo"].contains(&s["mode"].as_str().unwrap_or("")){return Err(err("项目状态无效"))}
 let stage=s["stage"].as_u64().unwrap_or(0);if !(1..=10).contains(&stage){return Err(err("项目阶段须为 1–10"))}
 let completed=s["completed"].as_array().ok_or_else(||err("项目进度无效"))?;if completed.len()>10||completed.iter().any(|v|!v.as_u64().is_some_and(|n|(1..=10).contains(&n))){return Err(err("项目进度无效"))}
 let columns=s["data"]["columns"].as_array().ok_or_else(||err("项目数据缺少列定义"))?;let rows=s["data"]["rows"].as_array().ok_or_else(||err("项目数据格式无效"))?;
 if rows.len()>20000||columns.len()>100||columns.iter().any(|c|!c.is_string()){return Err(err("项目数据最多 20,000 行、100 列"))}
 if rows.iter().any(|r|!r.as_array().is_some_and(|r|r.len()==columns.len()&&r.iter().all(|v|v.is_null()||v.is_number()))){return Err(err("项目数据行格式无效"))}
 if s["mode"]=="real"&&s["data"]["synthetic"]!=false{return Err(err("实际工程项目不能使用模拟数据，请上传项目 CSV"))}
 if !s["model"].is_null()&&(rows.is_empty()||columns.is_empty()){return Err(err("没有项目数据，不能保存模型结果"))}
 if serde_json::to_vec(s).map_err(|_|err("项目状态无效"))?.len()>12*1024*1024{return Err(err("项目数据过大，请减少行数或列数"))}Ok(())
}
impl Store{
 fn path(&self,id:&str)->PathBuf{self.root.join(format!("{id}.json"))}
 fn read(&self,id:&str)->Result<Project,Err>{safe_id(id)?;let b=std::fs::read(self.path(id)).map_err(|_|err("工程项目不存在"))?;serde_json::from_slice(&b).map_err(|_|err("工程项目文件损坏"))}
 fn save(&self,p:&Project)->Result<(),Err>{let tmp=self.root.join(format!("{}.tmp",p.id));let b=serde_json::to_vec(p).map_err(|_|err("项目序列化失败"))?;std::fs::write(&tmp,b).map_err(|_|err("保存工程项目失败，请检查磁盘空间"))?;std::fs::rename(tmp,self.path(&p.id)).map_err(|_|err("保存工程项目失败"))}
}
fn summary(p:&Project)->Value{json!({"id":p.id,"name":p.state["project"]["name"],"question":p.state["project"]["question"],"mode":p.state["mode"],"stage":p.state["stage"],"completed":p.state["completed"].as_array().map_or(0,|r|r.len()),"created_at":p.created_at,"updated_at":p.updated_at,"rows":p.state["data"]["rows"].as_array().map_or(0,|r|r.len()),"status":p.status,"draft_at":p.draft_at,"saved_at":p.saved_at,"save_count":p.save_count,"has_saved_version":p.saved_state.is_some()} )}
// JavaScript serializes 1.0 as 1. Opening a saved model must not count that
// representation change as an edit to its data or coefficients.
fn state_equal(a:&Value,b:&Value)->bool{
 match (a,b){
  (Value::Number(a),Value::Number(b))=>a==b||a.as_f64()==b.as_f64(),
  (Value::Array(a),Value::Array(b))=>a.len()==b.len()&&a.iter().zip(b).all(|(a,b)|state_equal(a,b)),
  (Value::Object(a),Value::Object(b))=>a.len()==b.len()&&a.iter().all(|(k,a)|b.get(k).is_some_and(|b|state_equal(a,b))),
  _=>a==b,
 }
}
fn enforce_collection_progress(previous:&Value,next:&Value)->Result<(),Err>{
 if next["mode"]!="real"{return Ok(())}
 let old=previous["completed"].as_array().cloned().unwrap_or_default();
 let completed=next["completed"].as_array().cloned().unwrap_or_default();
 let advancing=next["stage"].as_u64()>previous["stage"].as_u64()||completed.iter().any(|n|!old.contains(n));
 if !advancing{return Ok(())}
 for stage in 1..=10u64{
  let key=stage.to_string();let m=&next["materials"][&key];
  if !previous["materials"][&key].is_null()&&m.is_null(){return Err(err("继续流程时不能移除已有采集资料"))}
  if m.is_null()||!(stage<next["stage"].as_u64().unwrap_or(1)||completed.contains(&json!(stage))){continue}
  if m["collection_check"]["passed"]!=true{return Err(err(&format!("第{stage}步采集资料尚未检查通过，请先检查全部表格")))}
  let report=crate::collection::execute(&json!({"action":"check","stage":stage,"material":m}))?;
  if report["passed"]!=true||report["fingerprint"]!=m["collection_check"]["fingerprint"]{return Err(err(&format!("第{stage}步采集数据或规则已变化／有问题，请重新检查后继续")))}
 }
 Ok(())
}
fn apply_update(p:&mut Project,i:Update)->Result<(),Err>{
 if !["autosave","draft","save"].contains(&i.action.as_str()){return Err(err("请选择暂存或保存操作"))}
 validate(&i.state)?;
 enforce_collection_progress(&p.state,&i.state)?;
 if i.action=="autosave"&&state_equal(&i.state,&p.state){return Ok(())}
 p.state=i.state;p.updated_at=now();
 if i.action=="save"{
  p.status="saved".into();p.saved_at=Some(p.updated_at);p.saved_state=Some(p.state.clone());p.save_count+=1;
 }else{p.status="draft".into();p.draft_at=Some(p.updated_at)}
 Ok(())
}
async fn list(State(s):State<Store>)->Result<Json<Value>,Err>{
 let _guard=s.lock.lock().unwrap();let mut items=Vec::new();
 for file in std::fs::read_dir(&s.root).map_err(|_|err("无法读取项目列表"))?{
  let file=file.map_err(|_|err("无法读取项目列表"))?;if file.path().extension().and_then(|s|s.to_str())!=Some("json"){continue}
  let p:Project=serde_json::from_slice(&std::fs::read(file.path()).map_err(|_|err("无法读取项目文件"))?).map_err(|_|err("项目文件损坏"))?;
  items.push(summary(&p));
 }
 items.sort_by(|a,b|b["updated_at"].as_u64().cmp(&a["updated_at"].as_u64()));Ok(Json(json!(items)))
}
async fn create(State(s):State<Store>,axum::Extension(identity):axum::Extension<crate::accounts::Identity>,Json(i):Json<Create>)->Result<Json<Value>,Err>{
 let _guard=s.lock.lock().unwrap();if !identity.admin(){let count=std::fs::read_dir(&s.root).map_err(|_|err("无法读取工程空间"))?.flatten().filter(|p|p.path().extension().is_some_and(|v|v=="json")).count();if count>=identity.0["limits"]["projects"].as_u64().unwrap_or(5)as usize{return Err(err("工程空间达到套餐上限 / Project limit reached"))}}let state=i.state.unwrap_or_else(||blank(i.name.trim(),i.question.trim(),i.target.trim()));validate(&state)?;
 let time=now();let p=Project{id:format!("p{}",SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()),created_at:time,updated_at:time,state,status:draft_status(),draft_at:Some(time),saved_at:None,saved_state:None,save_count:0};s.save(&p)?;Ok(Json(json!(p)))
}
async fn read(State(s):State<Store>,Path(id):Path<String>)->Result<Json<Value>,Err>{let _guard=s.lock.lock().unwrap();Ok(Json(json!(s.read(&id)?)))}
async fn update(State(s):State<Store>,Path(id):Path<String>,Json(i):Json<Update>)->Result<Json<Value>,Err>{
 let _guard=s.lock.lock().unwrap();let mut p=s.read(&id)?;apply_update(&mut p,i)?;s.save(&p)?;let mut result=summary(&p);result["ok"]=json!(true);Ok(Json(result))
}
pub fn router(data:&str)->Router{
 let root=PathBuf::from(data).join("projects");std::fs::create_dir_all(&root).expect("创建工程目录失败");
 Router::new().route("/api/projects",get(list).post(create)).route("/api/projects/{id}",get(read).put(update)).layer(axum::extract::DefaultBodyLimit::max(14*1024*1024)).with_state(Store{root,lock:Arc::new(Mutex::new(()))})
}

#[cfg(test)]mod tests{use super::*;
 #[test]fn real_project_starts_empty(){let s=blank("新工程","降低波动","降低不良率");validate(&s).unwrap();assert_eq!(s["data"]["rows"],json!([]));assert_eq!(s["model"],Value::Null);assert_eq!(s["stage"],1);}
 #[test]fn reject_simulated_data_in_real_project(){let mut s=blank("新工程",""," ");s["data"]["synthetic"]=json!(true);assert!(validate(&s).is_err());s["mode"]=json!("demo");validate(&s).unwrap();}
 #[test]fn reject_orphan_model_and_invalid_id(){let mut s=blank("新工程","","");s["model"]=json!({"rmse":1});assert!(validate(&s).is_err());assert!(safe_id("../../data").is_err());}
 #[test]fn drafts_preserve_saved_snapshot(){
  let mut p=Project{id:"p1".into(),created_at:1,updated_at:1,state:blank("工程","初始问题","目标"),status:draft_status(),draft_at:Some(1),saved_at:None,saved_state:None,save_count:0};
  let state=p.state.clone();apply_update(&mut p,Update{state,action:"save".into()}).unwrap();
  let saved=p.saved_state.clone();let time=p.saved_at;assert_eq!(p.status,"saved");
  let state=p.state.clone();apply_update(&mut p,Update{state,action:"autosave".into()}).unwrap();assert_eq!(p.status,"saved");assert_eq!(p.saved_at,time);assert_eq!(p.save_count,1);
  let mut edited=p.state.clone();edited["project"]["question"]=json!("新问题");
  apply_update(&mut p,Update{state:edited.clone(),action:"draft".into()}).unwrap();assert_eq!(p.status,"draft");assert_eq!(p.saved_state,saved);assert_eq!(p.saved_at,time);
  apply_update(&mut p,Update{state:edited,action:"save".into()}).unwrap();assert_eq!(p.status,"saved");assert_eq!(p.save_count,2);assert_eq!(p.saved_state.as_ref(),Some(&p.state));
 }
 #[test]fn old_project_files_remain_readable(){
  let p:Project=serde_json::from_value(json!({"id":"p1","created_at":1,"updated_at":1,"state":blank("旧工程","","")})).unwrap();assert_eq!(p.status,"draft");assert!(p.saved_state.is_none());
 }
 #[test]fn browser_number_format_keeps_saved_status(){
  let mut state=blank("工程","问题","目标");state["data"]["columns"]=json!(["X","Y"]);state["data"]["rows"]=json!([[1.0,7.0]]);
  let mut p=Project{id:"p1".into(),created_at:1,updated_at:1,state:state.clone(),status:draft_status(),draft_at:Some(1),saved_at:None,saved_state:None,save_count:0};
  apply_update(&mut p,Update{state:state.clone(),action:"save".into()}).unwrap();let time=p.updated_at;
  state["data"]["rows"]=json!([[1,7]]);apply_update(&mut p,Update{state,action:"autosave".into()}).unwrap();assert_eq!(p.status,"saved");assert_eq!(p.updated_at,time);
 }
}
