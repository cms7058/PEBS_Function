use axum::{body::Bytes, extract::{Path,Query,State}, http::{header,StatusCode}, response::{IntoResponse,Response}, routing::{get,post}, Json,Router};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{collections::HashMap,io::Write,path::PathBuf,process::{Command,Stdio},sync::{Arc,Mutex},time::{SystemTime,UNIX_EPOCH}};
use crate::{err,Err};
#[derive(Clone)] pub struct Catalog{root:PathBuf,db:Arc<Mutex<Db>>,jobs:Arc<Mutex<HashMap<String,Value>>>}
#[derive(Clone,Serialize,Deserialize,Default)] struct Db{books:Vec<Book>,skills:Vec<Value>}
#[derive(Clone,Serialize,Deserialize)] struct Book{#[serde(default)] ocr:Option<Value>,id:String,title:String,uploaded_at:Option<u64>,created_at:u64,pages:usize,processed:bool,indexed:bool,#[serde(default)] stages:Vec<usize>,#[serde(default)] source_url:Option<String>,#[serde(default)] access:Option<String>}
#[derive(Serialize,Deserialize)] struct TextPage{page:usize,text:String}
#[derive(Deserialize)] struct Title{title:String,#[serde(default)] stages:Vec<usize>,#[serde(default)] source_url:Option<String>,#[serde(default)] access:Option<String>}
#[derive(Deserialize)] struct Prepare{#[serde(default="default_mode")] mode:String,#[serde(default)] ranges:Option<Value>}
#[derive(Deserialize)] struct Confirm{preview_id:String}
#[derive(Deserialize)] struct ApplyInput{question:String,#[serde(default)] stage:Option<usize>}
fn default_mode()->String{"text".into()}
fn model_setup_error()->Err{err("请配置执行宿主：本机 Codex 需先登录；OpenAI 需 API Key；Ollama 需本机模型")}
fn now()->u64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()}
fn valid_title(t:&str)->Result<String,Err>{let t=t.trim();if t.is_empty()||t.chars().count()>200{Err(err("书名须为 1–200 个字符"))}else{Ok(t.into())}}
fn ioerr(_:impl std::fmt::Display)->Err{(StatusCode::INTERNAL_SERVER_ERROR,Json(json!({"error":"文件存储失败，请检查磁盘空间和目录权限"})))}
impl Catalog{
 fn save(&self,db:&Db)->Result<(),Err>{let tmp=self.root.join("catalog.tmp");std::fs::write(&tmp,serde_json::to_vec(db).map_err(ioerr)?).map_err(ioerr)?;std::fs::rename(tmp,self.root.join("catalog.json")).map_err(ioerr)}
 fn pdf(&self,id:&str)->PathBuf{self.root.join(format!("{id}.pdf"))}
 fn ocr_work(&self,id:&str)->PathBuf{self.root.join("ocr").join(id)}
 fn readable_pdf(&self,id:&str)->PathBuf{let path=self.ocr_work(id).join("searchable.pdf");if self.db.lock().unwrap().books.iter().any(|b|b.id==id&&b.ocr.as_ref().is_some_and(|v|v["status"]=="done"))&&path.exists(){path}else{self.pdf(id)}}
 fn pages(&self,id:&str)->PathBuf{self.root.join(format!("{id}.json"))}
 fn work(&self,id:&str)->PathBuf{self.root.join("skill_work").join(id)}
 fn generated(&self,id:&str)->PathBuf{self.root.join("generated").join(id)}
 fn artifact(&self,skill:&Value)->String{skill["artifact_id"].as_str().or(skill["book_id"].as_str()).unwrap_or_default().to_string()}
}
pub fn router(data:&str)->Router{build_router(data,true)}
pub fn private_router(data:&str)->Router{build_router(data,false)}
fn build_router(data:&str,seed:bool)->Router{
 let root=PathBuf::from(data).join("catalog");std::fs::create_dir_all(&root).expect("创建书籍目录失败");
 let db=if root.join("catalog.json").exists(){serde_json::from_slice(&std::fs::read(root.join("catalog.json")).unwrap()).expect("书籍目录损坏")}else{
 let mut db=Db::default();if seed && std::path::Path::new("data/platform-source/handbook.pdf").exists(){std::fs::copy("data/platform-source/handbook.pdf",root.join("nist.pdf")).unwrap();let raw:Vec<Value>=serde_json::from_slice(&std::fs::read(format!("{data}/pages.json")).unwrap()).unwrap();let pages:Vec<TextPage>=raw.iter().map(|p|TextPage{page:p["page"].as_u64().unwrap()as usize,text:p["text"].as_str().unwrap_or("").into()}).collect();std::fs::write(root.join("nist.json"),serde_json::to_vec(&pages).unwrap()).unwrap();let modified=std::fs::metadata("data/platform-source/handbook.pdf").ok().and_then(|m|m.modified().ok()).and_then(|t|t.duration_since(UNIX_EPOCH).ok()).map(|d|d.as_secs()).unwrap_or_else(now);db.books.push(Book{ocr:None,id:"nist".into(),title:"NIST / SEMATECH Engineering Statistics Handbook".into(),uploaded_at:Some(modified),created_at:now(),pages:pages.len(),processed:false,indexed:true,stages:vec![3,4,5,6,7,8,10],source_url:Some("https://www.itl.nist.gov/div898/handbook/toolaids/pff/index.htm".into()),access:Some("免费·官方 PDF".into())});}db};
 let s=Catalog{root,db:Arc::new(Mutex::new(db)),jobs:Arc::new(Mutex::new(HashMap::new()))};s.save(&s.db.lock().unwrap()).expect("保存书籍目录失败");
 if s.db.lock().unwrap().skills.iter().any(|v|v["capability_assessment"].is_null()) { if let Err(_)=assess_catalog(&s,false){eprintln!("技能等级尚未完成初评，请在技能管理中重新评估");} }
 Router::new().route("/api/books",get(list).post(create)).route("/api/books/{id}",axum::routing::patch(rename).delete(remove)).route("/api/books/{id}/pdf",get(pdf).put(upload)).route("/api/books/{id}/chapters",get(chapters)).route("/api/books/{id}/ocr",get(ocr_status).post(start_ocr)).route("/api/books/{id}/ocr/text",get(ocr_text)).route("/api/books/{id}/original",get(original_pdf)).route("/api/books/{id}/to-skill/preview",post(preview)).route("/api/books/{id}/to-skill",post(convert)).route("/api/skill-engine",get(engine_status)).route("/api/skill-jobs/{id}",get(job)).route("/api/skills",get(skills)).route("/api/skills/evaluate",post(evaluate_skills)).route("/api/skills/{id}/classification",axum::routing::patch(grade_skill)).route("/api/skills/{id}",axum::routing::delete(remove_skill)).route("/api/skills/{id}/archive",get(skill_archive)).route("/api/skills/{id}/content",get(skill_content)).route("/api/skills/{id}/apply",post(apply_skill)).route("/api/skills/{id}/review",post(review)).route("/api/knowledge/search",get(search)).layer(axum::extract::DefaultBodyLimit::max(50*1024*1024)).with_state(s)
}
async fn engine_status(axum::Extension(identity):axum::Extension<crate::accounts::Identity>)->Json<Value>{let c=crate::model_config::load();let mut v=c.public();let ready=identity.admin()||c.provider!="codex"&&c.ready();v["ready"]=json!(ready);v["generator"]=json!("virgiliojr94/book-to-skill@726f336");v["message"]=json!(if ready{"模型已配置"}else if !identity.admin()&&c.provider=="codex"{"用户分析服务待管理员配置服务器模型 API"}else{"请在模型配置页面保存模型与密钥"});Json(v)}
async fn list(State(s):State<Catalog>)->Json<Value>{Json(json!(s.db.lock().unwrap().books))}
async fn skills(State(s):State<Catalog>)->Json<Value>{Json(json!(s.db.lock().unwrap().skills))}
async fn create(State(s):State<Catalog>,Json(t):Json<Title>)->Result<Json<Value>,Err>{let title=valid_title(&t.title)?;if t.stages.iter().any(|&n|n<1||n>10){return Err(err("层级必须在 1–10 之间"))}let id=format!("b{}",SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos());let book=Book{ocr:None,id,title,uploaded_at:None,created_at:now(),pages:0,processed:false,indexed:false,stages:t.stages,source_url:t.source_url,access:t.access};let mut guard=s.db.lock().unwrap();let mut db=guard.clone();db.books.push(book.clone());s.save(&db)?;*guard=db;Ok(Json(json!(book)))}
async fn rename(State(s):State<Catalog>,Path(id):Path<String>,Json(t):Json<Title>)->Result<Json<Value>,Err>{let title=valid_title(&t.title)?;let mut guard=s.db.lock().unwrap();let mut db=guard.clone();let b=db.books.iter_mut().find(|b|b.id==id).ok_or_else(||err("书籍不存在"))?;b.title=title.clone();if let Some(source_url)=t.source_url{b.source_url=Some(source_url)}for skill in &mut db.skills{if skill["book_id"]==id{skill["book_title"]=json!(title)}}s.save(&db)?;*guard=db;Ok(Json(json!({"ok":true})))}
async fn remove(State(s):State<Catalog>,Path(id):Path<String>)->Result<Json<Value>,Err>{if s.jobs.lock().unwrap().iter().any(|(key,v)|key==&format!("ocr:{id}")||(v["book_id"]==id&&v["status"]=="running")){return Err(err("书籍正在提取、生成或 OCR，请等待完成后删除"))}let mut guard=s.db.lock().unwrap();if !guard.books.iter().any(|b|b.id==id){return Err(err("书籍不存在"))}let mut db=guard.clone();let artifacts:Vec<String>=db.skills.iter().filter(|v|v["book_id"]==id&&v["mode"]=="book-to-skill").map(|v|s.artifact(v)).collect();db.books.retain(|b|b.id!=id);db.skills.retain(|v|v["book_id"]!=id);s.save(&db)?;*guard=db;for artifact in artifacts{let _=std::fs::remove_dir_all(s.generated(&artifact));let _=std::fs::remove_file(s.root.join("generated").join(format!("{artifact}.zip")));}let _=std::fs::remove_file(s.root.join(format!("{id}-chapters.json")));let _=std::fs::remove_file(s.pdf(&id));let _=std::fs::remove_file(s.pages(&id));let _=std::fs::remove_dir_all(s.ocr_work(&id));let _=std::fs::remove_dir_all(s.generated(&id));let _=std::fs::remove_file(s.root.join("generated").join(format!("{id}.zip")));Ok(Json(json!({"ok":true})))}
async fn pdf(State(s):State<Catalog>,Path(id):Path<String>)->Result<Response,Err>{let db=s.db.lock().unwrap();if !db.books.iter().any(|b|b.id==id&&b.uploaded_at.is_some()){return Err(err("PDF 尚未上传"))}drop(db);let bytes=std::fs::read(s.readable_pdf(&id)).map_err(ioerr)?;Ok(([(header::CONTENT_TYPE,"application/pdf"),(header::CONTENT_DISPOSITION,"inline; filename=book.pdf"),(header::CACHE_CONTROL,"no-store")],bytes).into_response())}
async fn upload(State(s):State<Catalog>,Path(id):Path<String>,axum::Extension(identity):axum::Extension<crate::accounts::Identity>,bytes:Bytes)->Result<Json<Value>,Err>{
 tokio::task::spawn_blocking(move||{
 let mut guard=s.db.lock().unwrap();let mut db=guard.clone();if !identity.admin(){let used=db.books.iter().filter_map(|book|std::fs::metadata(s.pdf(&book.id)).ok().map(|m|m.len())).sum::<u64>();let limit=identity.0["limits"]["storage_mb"].as_u64().unwrap_or(500)*1024*1024;if used+bytes.len() as u64>limit{return Err((StatusCode::PAYMENT_REQUIRED,Json(json!({"error":"私人文件容量达到套餐上限 / Storage limit reached"}))))}}let b=db.books.iter_mut().find(|b|b.id==id).ok_or_else(||err("书籍不存在"))?;if b.uploaded_at.is_some(){return Err(err("本书已上传，请新建书籍记录上传其他版本"))}if !bytes.starts_with(b"%PDF-"){return Err(err("请选择有效的 PDF 文件"))}
 
 let tmp=s.root.join(format!("{id}-upload.pdf"));std::fs::write(&tmp,&bytes).map_err(ioerr)?;
 let out=std::process::Command::new("pdftotext").arg("-layout").arg(&tmp).arg("-").output();
 let out=match out{Ok(o) if o.status.success()=>o,_=>{let _=std::fs::remove_file(tmp);return Err(err("PDF 解析失败：请使用未加密的有效 PDF，并确认已安装 pdftotext"))}};
 let text=String::from_utf8_lossy(&out.stdout);let pages:Vec<TextPage>=text.trim_end_matches('\x0c').split('\x0c').enumerate().map(|(i,t)|TextPage{page:i+1,text:t.trim().to_string()}).collect();b.pages=Command::new("pdfinfo").arg(&tmp).output().ok().filter(|o|o.status.success()).and_then(|o|String::from_utf8_lossy(&o.stdout).lines().find_map(|line|line.strip_prefix("Pages:").and_then(|n|n.trim().parse::<usize>().ok()))).unwrap_or(pages.len());b.indexed=pages.iter().any(|p|!p.text.trim().is_empty());b.uploaded_at=Some(now());std::fs::write(s.pages(&id),serde_json::to_vec(&pages).map_err(ioerr)?).map_err(ioerr)?;std::fs::rename(tmp,s.pdf(&id)).map_err(ioerr)?;let result=json!(b);s.save(&db)?;*guard=db;Ok(Json(result))
 }).await.map_err(ioerr)?
}
fn bridge(args:&[String])->Result<Value,Err>{bridge_config(args,&crate::model_config::load())}
fn bridge_config(args:&[String],config:&crate::model_config::Config)->Result<Value,Err>{
 let mut cmd=Command::new("python3");cmd.arg("scripts/book_to_skill_bridge.py").args(args);config.command(&mut cmd);let output=cmd.output().map_err(ioerr)?;
 if !output.status.success(){let detail=String::from_utf8_lossy(&output.stderr);return Err(err(&format!("book-to-skill 处理失败：{}",detail.chars().take(900).collect::<String>())))}
 serde_json::from_slice(&output.stdout).map_err(ioerr)
}
fn assess(payload:Value)->Result<Value,Err>{
 let mut child=Command::new("python3").arg("scripts/skill_capabilities.py").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(ioerr)?;
 child.stdin.take().ok_or_else(||err("无法启动能力评估"))?.write_all(&serde_json::to_vec(&payload).map_err(ioerr)?).map_err(ioerr)?;
 let out=child.wait_with_output().map_err(ioerr)?;if !out.status.success(){return Err(err("技能内容评估失败，请重试"))}
 serde_json::from_slice(&out.stdout).map_err(ioerr)
}
fn merge_assessment(skill:&mut Value,value:&Value){for key in ["capability_tier","capabilities","capability_assessment"]{skill[key]=value[key].clone()}}
fn assess_catalog(s:&Catalog,force:bool)->Result<Value,Err>{
 let assessments=assess(json!({"action":"classify_catalog","root":s.root}))?;
 let mut guard=s.db.lock().unwrap();let mut db=guard.clone();let mut updated=0;
 for skill in &mut db.skills{
  if skill["capability_assessment"]["method"]=="manual"||(!force&&!skill["capability_assessment"].is_null()){continue}
  let id=skill["id"].as_str().unwrap_or_default();if let Some(value)=assessments.get(id){merge_assessment(skill,value);updated+=1;}
 }
 s.save(&db)?;*guard=db;Ok(json!({"ok":true,"updated":updated}))
}
async fn evaluate_skills(State(s):State<Catalog>)->Result<Json<Value>,Err>{tokio::task::spawn_blocking(move||assess_catalog(&s,true).map(Json)).await.map_err(ioerr)?}
#[derive(Deserialize)] struct CapabilityGrade{id:String,tier:String}
#[derive(Deserialize)] struct GradeInput{capabilities:Vec<CapabilityGrade>,reason:String}
async fn grade_skill(State(s):State<Catalog>,Path(id):Path<String>,Json(input):Json<GradeInput>)->Result<Json<Value>,Err>{
 let reason=input.reason.trim();if reason.is_empty()||reason.chars().count()>1000{return Err(err("请填写 1–1000 字的等级确认理由"))}
 let mut guard=s.db.lock().unwrap();let mut db=guard.clone();let skill=db.skills.iter_mut().find(|v|v["id"]==id).ok_or_else(||err("Skill 不存在"))?;
 let capabilities=skill["capabilities"].as_array_mut().ok_or_else(||err("请先评估技能能力"))?;
 let mut seen=std::collections::HashSet::new();
 if capabilities.is_empty()||input.capabilities.len()!=capabilities.len()||input.capabilities.iter().any(|c|crate::access::rank(&c.tier)>2||!seen.insert(&c.id)||!capabilities.iter().any(|v|v["id"]==c.id)){return Err(err("能力或等级无效，请刷新技能详情后重试"))}
 for c in capabilities.iter_mut(){c["tier"]=json!(input.capabilities.iter().find(|v|c["id"]==v.id).unwrap().tier);}
 let tier=capabilities.iter().map(|c|c["tier"].as_str().unwrap()).max_by_key(|t|crate::access::rank(t)).unwrap().to_string();
 skill["capability_tier"]=json!(tier);skill["capability_assessment"]["method"]=json!("manual");skill["capability_assessment"]["review_required"]=json!(false);skill["capability_assessment"]["note"]=json!(format!("人工确认：{reason}"));skill["capability_assessment"]["confirmed_at"]=json!(now());
 let result=skill.clone();s.save(&db)?;*guard=db;Ok(Json(result))
}
async fn preview(State(s):State<Catalog>,Path(id):Path<String>,Json(input):Json<Prepare>)->Result<Json<Value>,Err>{
 if input.mode!="text"&&input.mode!="technical"{return Err(err("提取方式必须是 text 或 technical"))}
 let book=s.db.lock().unwrap().books.iter().find(|b|b.id==id).cloned().ok_or_else(||err("书籍不存在"))?;
 if book.uploaded_at.is_none()||!book.indexed{return Err(err("请先上传具有可提取文字的 PDF；扫描件需要 OCR"))}
 let prepare_key=format!("prepare:{id}");{let mut jobs=s.jobs.lock().unwrap();if jobs.values().any(|v|v["book_id"]==id&&v["status"]=="running"){return Err(err("这本书正在提取或生成 Skill"))}jobs.insert(prepare_key.clone(),json!({"book_id":id,"status":"running"}));}
 let worker=s.clone();let result=
 tokio::task::spawn_blocking(move||{
  let s=worker;
  let work=s.work(&id);if work.exists(){std::fs::remove_dir_all(&work).map_err(ioerr)?}
  std::fs::create_dir_all(&work).map_err(ioerr)?;
  let mut args=vec!["prepare".into(),"--pdf".into(),s.readable_pdf(&id).to_string_lossy().into_owned(),"--workdir".into(),work.to_string_lossy().into_owned(),"--title".into(),book.title,"--mode".into(),input.mode];
  if let Some(ranges)=input.ranges{args.extend(["--ranges".into(),ranges.to_string()]);}
  bridge(&args).map(Json)
 }).await.map_err(ioerr).and_then(|v|v);
 s.jobs.lock().unwrap().remove(&prepare_key);result
}
async fn convert(State(s):State<Catalog>,Path(id):Path<String>,lease:Option<axum::Extension<crate::accounts::Lease>>,body:Bytes)->Result<Json<Value>,Err>{
 let book=s.db.lock().unwrap().books.iter().find(|b|b.id==id).cloned().ok_or_else(||err("书籍不存在"))?;
 if book.uploaded_at.is_none()||!book.indexed{return Err(err("请先上传具有可提取文字的 PDF；扫描件需要 OCR"))}
 if !s.work(&id).join("preview.json").exists(){return Err(err("请先预览 book-to-skill 提取结果和预计用量"))}
 if !body.is_empty(){let confirm:Confirm=serde_json::from_slice(&body).map_err(|_|err("生成确认参数无效"))?;let preview:Value=serde_json::from_slice(&std::fs::read(s.work(&id).join("preview.json")).map_err(ioerr)?).map_err(ioerr)?;if preview["preview_id"]!=confirm.preview_id{return Err(err("预估已更新，请重新提取并确认生成"))}}
 let config=crate::model_config::load();if !config.ready(){return Err(model_setup_error())}
 let job_id=format!("j{}",SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos());
 {let mut jobs=s.jobs.lock().unwrap();if jobs.values().any(|v|v["book_id"]==id&&v["status"]=="running"){return Err(err("这本书正在生成 Skill"))}jobs.insert(job_id.clone(),json!({"id":job_id,"book_id":id,"status":"running"}));}
 let handle=s.clone();let target=id.clone();let job=job_id.clone();
 tokio::spawn(async move{
  let worker=handle.clone();let worker_id=target.clone();let artifact_job=job.clone();
  let result=tokio::task::spawn_blocking(move||{
   let artifact=format!("{worker_id}-{artifact_job}");
   let output=worker.generated(&artifact);std::fs::create_dir_all(output.parent().unwrap()).map_err(ioerr)?;
   if output.exists(){std::fs::remove_dir_all(&output).map_err(ioerr)?}
   let args=vec!["generate".into(),"--workdir".into(),worker.work(&worker_id).to_string_lossy().into_owned(),"--outputdir".into(),output.to_string_lossy().into_owned(),"--slug".into(),artifact.clone()];
   let mut generated=bridge_config(&args,&config)?;generated["artifact_id"]=json!(artifact);
   let assessment=assess(json!({"action":"classify","skill":generated,"folder":output}))?;merge_assessment(&mut generated,&assessment);Ok::<Value,Err>(generated)
  }).await.map_err(ioerr).and_then(|v|v);
  let status=match result{
   Ok(mut generated)=>{
    let mut guard=handle.db.lock().unwrap();let mut db=guard.clone();
    if let Some(b)=db.books.iter_mut().find(|b|b.id==target){
     generated["id"]=generated["artifact_id"].clone();generated["book_id"]=json!(target);generated["book_title"]=json!(b.title);generated["created_at"]=json!(now());generated["status"]=json!("draft");generated["stages"]=json!(b.stages);
     b.processed=true;db.skills.push(generated.clone());
     match handle.save(&db){Ok(())=>{*guard=db;json!({"id":job,"book_id":target,"status":"done","skill":generated})},Err(_)=>json!({"id":job,"book_id":target,"status":"failed","error":"保存生成结果失败"})}
    }else{json!({"id":job,"book_id":target,"status":"failed","error":"书籍已删除或已处理，结果未保存"})}
   },
   Err((_,Json(v)))=>json!({"id":job,"book_id":target,"status":"failed","error":v["error"]})
  };
  if let Some(axum::Extension(lease))=lease { let ok=status["status"]=="done"; tokio::task::spawn_blocking(move||crate::accounts::settle(&lease.0,ok)).await.ok(); }
  handle.jobs.lock().unwrap().insert(job,status);
 });
 Ok(Json(json!({"job_id":job_id,"status":"running"})))
}
async fn job(State(s):State<Catalog>,Path(id):Path<String>)->Result<Json<Value>,Err>{
 let mut value=s.jobs.lock().unwrap().get(&id).cloned().ok_or_else(||err("任务不存在或服务已重启"))?;
 if value["status"]=="running"{if let Some(book_id)=value["book_id"].as_str(){if let Ok(bytes)=std::fs::read(s.work(book_id).join("progress.json")){if let Ok(progress)=serde_json::from_slice::<Value>(&bytes){value["progress"]=progress}}}}
 Ok(Json(value))
}
async fn skill_archive(State(s):State<Catalog>,Path(id):Path<String>)->Result<Response,Err>{
 let db=s.db.lock().unwrap();let skill=db.skills.iter().find(|v|v["id"]==id).ok_or_else(||err("Skill 不存在"))?;
 if skill["mode"]!="book-to-skill"{return Err(err("这条 Skill 没有生成的技能包"))}
 let _book_id=skill["book_id"].as_str().ok_or_else(||err("来源书籍无效"))?;
 let path=s.root.join("generated").join(format!("{}.zip",s.artifact(skill)));let bytes=std::fs::read(path).map_err(ioerr)?;
 Ok(([(header::CONTENT_TYPE,"application/zip"),(header::CONTENT_DISPOSITION,"attachment; filename=book-skill.zip")],bytes).into_response())
}
async fn skill_content(State(s):State<Catalog>,Path(id):Path<String>)->Result<Response,Err>{
 let db=s.db.lock().unwrap();let skill=db.skills.iter().find(|v|v["id"]==id).ok_or_else(||err("Skill 不存在"))?;
 if skill["mode"]!="book-to-skill"{return Err(err("这条 Skill 没有生成的 SKILL.md"))}
 let _book_id=skill["book_id"].as_str().ok_or_else(||err("来源书籍无效"))?;
 let bytes=std::fs::read(s.generated(&s.artifact(skill)).join("SKILL.md")).map_err(ioerr)?;
 Ok(([(header::CONTENT_TYPE,"text/markdown; charset=utf-8")],bytes).into_response())
}
async fn apply_skill(State(s):State<Catalog>,Path(id):Path<String>,axum::Extension(identity):axum::Extension<crate::accounts::Identity>,Json(input):Json<ApplyInput>)->Result<Json<Value>,Err>{
 let question=input.question.trim();if question.is_empty()||question.chars().count()>3000{return Err(err("问题长度须为 1–3000 个字符"))}
 if input.stage.is_some_and(|n|n<1||n>10){return Err(err("流程层级必须在 1–10 之间"))}
 let skill={let db=s.db.lock().unwrap();db.skills.iter().find(|v|v["id"]==id).cloned().ok_or_else(||err("Skill 不存在"))?};
 if skill["status"]!="reviewed"{return Err(err("请先审核这条 Skill，再供用户调用"))}
 if !identity.access().allows(&skill){return Err((StatusCode::FORBIDDEN,Json(json!({"error":"这条 Skill 超出当前会员等级；可在模型配置中切换本机预览身份"}))))}
 let config=crate::model_config::load();if !config.ready(){return Err(model_setup_error())}
 let folder=if skill["mode"]=="book-to-skill"{let _book_id=skill["book_id"].as_str().ok_or_else(||err("来源书籍无效"))?;Some(s.generated(&s.artifact(&skill)).to_string_lossy().into_owned())}else{None};
 let payload=json!({"skill":skill,"question":question,"stage":input.stage,"folder":folder});
 tokio::task::spawn_blocking(move||{
  let mut cmd=Command::new("python3");cmd.arg("scripts/use_book_skill.py").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());config.command(&mut cmd);let mut child=cmd.spawn().map_err(ioerr)?;
  child.stdin.take().ok_or_else(||err("模型进程启动失败"))?.write_all(&serde_json::to_vec(&payload).map_err(ioerr)?).map_err(ioerr)?;
  let output=child.wait_with_output().map_err(ioerr)?;
  if !output.status.success(){let message=String::from_utf8_lossy(&output.stderr);return Err(err(&format!("Skill 调用失败：{}",message.chars().take(900).collect::<String>())))}
  serde_json::from_slice::<Value>(&output.stdout).map(Json).map_err(ioerr)
 }).await.map_err(ioerr)?
}
async fn review(State(s):State<Catalog>,Path(id):Path<String>)->Result<Json<Value>,Err>{let mut guard=s.db.lock().unwrap();let mut db=guard.clone();let v=db.skills.iter_mut().find(|v|v["id"]==id).ok_or_else(||err("Skill 不存在"))?;v["status"]=json!("reviewed");s.save(&db)?;*guard=db;Ok(Json(json!({"ok":true})))}
async fn remove_skill(State(s):State<Catalog>,Path(id):Path<String>)->Result<Json<Value>,Err>{let mut guard=s.db.lock().unwrap();let mut db=guard.clone();let position=db.skills.iter().position(|v|v["id"]==id).ok_or_else(||err("Skill 不存在"))?;let book_id=db.skills[position]["book_id"].as_str().unwrap_or_default().to_string();let artifact=s.artifact(&db.skills[position]);let was_generated=db.skills[position]["mode"]=="book-to-skill";db.skills.remove(position);let has_other_skills=db.skills.iter().any(|v|v["book_id"]==book_id);if let Some(book)=db.books.iter_mut().find(|b|b.id==book_id){book.processed=has_other_skills} s.save(&db)?;*guard=db;if was_generated{let _=std::fs::remove_dir_all(s.generated(&artifact));let _=std::fs::remove_file(s.root.join("generated").join(format!("{artifact}.zip")));}Ok(Json(json!({"ok":true})))}
async fn search(State(s):State<Catalog>,Query(q):Query<HashMap<String,String>>)->Result<Json<Value>,Err>{let query=q.get("q").cloned().unwrap_or_default().trim().to_lowercase();if query.is_empty(){return Ok(Json(json!({"total":0,"results":[]})))}let mut terms:Vec<String>=query.split_whitespace().map(str::to_string).collect();for(a,b)in [("回归","regression"),("残差","residual"),("异常","outlier"),("实验","design"),("控制","control"),("验证","validation"),("测量","measurement"),("优化","optimization"),("可靠","reliability")]{if query.contains(a){terms.push(b.into())}}
 let db=s.db.lock().unwrap();let mut results=vec![];for b in db.books.iter().filter(|b|b.indexed){let pages:Vec<TextPage>=serde_json::from_slice(&std::fs::read(s.pages(&b.id)).map_err(ioerr)?).map_err(ioerr)?;for p in pages{let lower=p.text.to_lowercase();let score:usize=terms.iter().map(|t|lower.matches(t).count().min(20)).sum();if score>0{results.push((score,json!({"book_id":b.id,"title":b.title,"page":p.page,"excerpt":p.text.chars().take(650).collect::<String>(),"url":format!("/api/books/{}/pdf#page={}",b.id,p.page)})))}}}results.sort_by(|a,b|b.0.cmp(&a.0));Ok(Json(json!({"total":results.len(),"results":results.iter().take(12).map(|r|&r.1).collect::<Vec<_>>()})))}

fn read_ocr(s:&Catalog,id:&str)->Value{
 let path=s.ocr_work(id).join("status.json");let mut v=std::fs::read(path).ok().and_then(|b|serde_json::from_slice::<Value>(&b).ok()).unwrap_or(json!({"status":"pending","completed":0,"total":0}));
 if v["status"]=="running"&&!s.jobs.lock().unwrap().contains_key(&format!("ocr:{id}")){v["status"]=json!("interrupted");v["message"]=json!("处理已中断，点击继续 OCR 可从已完成页恢复")}v
}
async fn ocr_status(State(s):State<Catalog>,Path(id):Path<String>)->Result<Json<Value>,Err>{if !s.db.lock().unwrap().books.iter().any(|b|b.id==id){return Err(err("书籍不存在"))}Ok(Json(read_ocr(&s,&id)))}
async fn original_pdf(State(s):State<Catalog>,Path(id):Path<String>)->Result<Response,Err>{if !s.db.lock().unwrap().books.iter().any(|b|b.id==id&&b.uploaded_at.is_some()){return Err(err("PDF 尚未上传"))}let bytes=std::fs::read(s.pdf(&id)).map_err(ioerr)?;Ok(([(header::CONTENT_TYPE,"application/pdf"),(header::CONTENT_DISPOSITION,"attachment; filename=original.pdf")],bytes).into_response())}
async fn ocr_text(State(s):State<Catalog>,Path(id):Path<String>,Query(q):Query<HashMap<String,String>>)->Result<Json<Value>,Err>{if !s.db.lock().unwrap().books.iter().any(|b|b.id==id&&b.ocr.as_ref().is_some_and(|v|v["status"]=="done")){return Err(err("请先完成 OCR"))}let pages:Vec<TextPage>=serde_json::from_slice(&std::fs::read(s.pages(&id)).map_err(ioerr)?).map_err(ioerr)?;let page=q.get("page").and_then(|p|p.parse::<usize>().ok()).unwrap_or(1);let p=pages.iter().find(|p|p.page==page).ok_or_else(||err("页码超出范围"))?;Ok(Json(json!({"page":p.page,"total":pages.len(),"text":p.text})))}
async fn start_ocr(State(s):State<Catalog>,Path(id):Path<String>)->Result<Json<Value>,Err>{
 let book=s.db.lock().unwrap().books.iter().find(|b|b.id==id).cloned().ok_or_else(||err("书籍不存在"))?;
 if book.uploaded_at.is_none(){return Err(err("请先上传 PDF"))}if book.indexed{return Err(err("书籍已有可提取文字，无需 OCR"))}
 let tess=std::env::var("OCR_TESSDATA_DIR").unwrap_or_else(|_|"data/ocr/tessdata".into());
 for lang in ["chi_sim","chi_tra","eng"]{if !PathBuf::from(&tess).join(format!("{lang}.traineddata")).exists(){return Err(err("OCR 中文语言包尚未安装"))}}
 let key=format!("ocr:{id}");{let mut jobs=s.jobs.lock().unwrap();if jobs.contains_key(&key){return Err(err("这本书正在 OCR"))}if jobs.keys().any(|k|k.starts_with("ocr:")){return Err(err("已有书籍正在 OCR，请等待完成后再开始"))}jobs.insert(key.clone(),json!({"status":"running"}));}
 let work=s.ocr_work(&id);if let Err(e)=std::fs::create_dir_all(&work){s.jobs.lock().unwrap().remove(&key);return Err(ioerr(e))}
 let initial=json!({"status":"running","completed":0,"total":book.pages,"message":"正在准备识别"});if let Err(e)=std::fs::write(work.join("status.json"),initial.to_string()){s.jobs.lock().unwrap().remove(&key);return Err(ioerr(e))}
 tokio::task::spawn_blocking(move||{
  let result=(||->Result<Value,String>{
   let output=Command::new("python3").arg("scripts/ocr_book.py").args(["--pdf",&s.pdf(&id).to_string_lossy(),"--work",&work.to_string_lossy(),"--tessdata",&tess]).output().map_err(|e|e.to_string())?;
   if !output.status.success(){return Err(read_ocr(&s,&id)["error"].as_str().unwrap_or("OCR 处理失败，请检查工具、文件和磁盘空间").chars().take(600).collect())}
   let pages:Vec<TextPage>=serde_json::from_slice(&std::fs::read(work.join("pages.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
   let total=pages.len();let mut guard=s.db.lock().unwrap();let mut db=guard.clone();let b=db.books.iter_mut().find(|b|b.id==id).ok_or("书籍不存在")?;
   let done=json!({"status":"done","completed":total,"total":total,"finished_at":now()});b.pages=total;b.indexed=true;b.ocr=Some(done.clone());
   std::fs::copy(work.join("pages.json"),s.pages(&id)).map_err(|e|e.to_string())?;s.save(&db).map_err(|_|"OCR 目录保存失败")?;*guard=db;Ok(done)
  })();
  let status=match result{Ok(v)=>v,Err(e)=>{let mut v=read_ocr(&s,&id);v["status"]=json!("failed");v["error"]=json!(e);v}};
  let _=std::fs::write(work.join("status.tmp"),status.to_string());let _=std::fs::rename(work.join("status.tmp"),work.join("status.json"));s.jobs.lock().unwrap().remove(&key);
 });Ok(Json(initial))
}

async fn chapters(State(s):State<Catalog>,Path(id):Path<String>)->Result<Json<Value>,Err>{
 let book=s.db.lock().unwrap().books.iter().find(|b|b.id==id).cloned().ok_or_else(||err("书籍不存在"))?;
 if book.uploaded_at.is_none(){return Err(err("请先上传 PDF"))}
 tokio::task::spawn_blocking(move||{
  let pdf=s.pdf(&id);let meta=std::fs::metadata(&pdf).map_err(ioerr)?;
  let index_stamp=std::fs::metadata(s.pages(&id)).ok().and_then(|m|m.modified().ok()).and_then(|t|t.duration_since(UNIX_EPOCH).ok()).map_or(0,|t|t.as_nanos());
  let signature=format!("v4:{}:{}:{}:{}",pdf.display(),meta.len(),meta.modified().map_err(ioerr)?.duration_since(UNIX_EPOCH).map_err(ioerr)?.as_nanos(),index_stamp);
  let cache=s.root.join(format!("{id}-chapters.json"));
  if let Ok(raw)=std::fs::read(&cache){if let Ok(value)=serde_json::from_slice::<Value>(&raw){if value["signature"]==signature{return Ok(Json(value["toc"].clone()))}}}
  let output=Command::new("node").arg("scripts/book_chapters.mjs").arg(&pdf).arg(s.pages(&id)).output().map_err(ioerr)?;
  if !output.status.success(){return Err(err("目录识别失败，请确认 PDF 可读取，扫描书先进行 OCR"))}
  let toc:Value=serde_json::from_slice(&output.stdout).map_err(ioerr)?;
  let value=json!({"signature":signature,"toc":toc});std::fs::write(cache,value.to_string()).map_err(ioerr)?;
  Ok(Json(value["toc"].clone()))
 }).await.map_err(ioerr)?
}
