//! Authenticated account gateway. Identity is injected by the server, never JSON.
use axum::{body::Bytes,extract::{Request,Path,ConnectInfo},http::{HeaderMap,StatusCode,header,Method},middleware::Next,response::{IntoResponse,Response},routing::{get,post},Json,Router};
use serde_json::{json,Value};
use std::{collections::HashMap,io::Write,process::{Command,Stdio},sync::{Mutex,OnceLock},path::PathBuf};
use tower::ServiceExt;
use crate::{err,Err};
#[derive(Clone)]pub struct Identity(pub Value);
impl Identity{
 pub fn id(&self)->&str{self.0["id"].as_str().unwrap_or("")}
 pub fn admin(&self)->bool{self.0["role"]=="admin"}
 pub fn access(&self)->crate::access::Profile{crate::access::Profile{tier:self.0["tier"].as_str().unwrap_or("normal").into(),role:if self.admin(){"admin"}else{"user"}.into()}}
 pub fn tenant_root(&self)->PathBuf{PathBuf::from(std::env::var("DATA_DIR").unwrap_or_else(|_|"data".into())).join("tenants").join(self.id())}
}
#[derive(Clone)]pub struct Lease(pub String);
static TENANTS:OnceLock<Mutex<HashMap<String,Router>>>=OnceLock::new();
pub fn bridge(input:Value)->Result<Value,Err>{
 let mut child=Command::new("python3").arg("scripts/accounts.py").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|_|err("账号服务启动失败 / Account service unavailable"))?;
 child.stdin.take().unwrap().write_all(&serde_json::to_vec(&input).unwrap()).map_err(|_|err("账号请求失败"))?;
 let out=child.wait_with_output().map_err(|_|err("账号服务失败"))?;
 let value:Value=serde_json::from_slice(&out.stdout).map_err(|_|err("账号服务配置异常，请检查Python依赖 / Account service dependencies unavailable"))?;
 let status=value["status"].as_u64().unwrap_or(500)as u16;
 if status!=200{return Err((StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),Json(value["value"].clone())))}
 Ok(value["value"].clone())
}
async fn call(input:Value)->Result<Value,Err>{tokio::task::spawn_blocking(move||bridge(input)).await.map_err(|_|err("账号任务失败"))?}
fn token(headers:&HeaderMap)->String{
 if let Some(value)=headers.get(header::AUTHORIZATION).and_then(|v|v.to_str().ok()).and_then(|v|v.strip_prefix("Bearer ")){return value.into()}
 headers.get(header::COOKIE).and_then(|v|v.to_str().ok()).unwrap_or("").split(';').find_map(|v|v.trim().strip_prefix("pebs_session=")).unwrap_or("").into()
}
fn protected_origin(headers:&HeaderMap)->bool{
 let origin=headers.get(header::ORIGIN).and_then(|v|v.to_str().ok());
 let configured=std::env::var("APP_URL").unwrap_or_else(|_|"http://127.0.0.1:5175".into());
 if origin==Some(configured.trim_end_matches('/')){return true}
 if std::env::var("APP_ENV").unwrap_or_default()!="production"&&origin.is_some_and(|v|["http://127.0.0.1:5175","http://localhost:5175","http://127.0.0.1:5173"].contains(&v)){return true}
 // Non-browser native clients authenticate through the Authorization header.
 origin.is_none()&&headers.contains_key(header::AUTHORIZATION)
}
fn cookie(value:&str)->String{format!("pebs_session={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}; {}",if value.is_empty(){0}else{604800},if std::env::var("APP_ENV").unwrap_or_default()=="production"{"Secure"}else{""})}
async fn public()->Result<Json<Value>,Err>{call(json!({"action":"public"})).await.map(Json)}
async fn endpoint(Path(action):Path<String>,headers:HeaderMap,peer:ConnectInfo<std::net::SocketAddr>,body:Bytes)->Result<Response,Err>{
 let action=match action.as_str(){"register"=>"register","login"=>"login","send-code"=>"send_code","reset-password"=>"reset","logout"=>"logout","setup"=>"bootstrap","me"=>"me",_=>return Err(err("未知账号操作"))};
 if action!="me"&&!protected_origin(&headers){return Err((StatusCode::FORBIDDEN,Json(json!({"error":"请求来源无效 / Invalid request origin"}))))}
 let body:Value=if body.is_empty(){json!({})}else{serde_json::from_slice(&body).map_err(|_|err("请求格式无效"))?};
 let mut result=call(json!({"action":action,"body":body,"token":token(&headers),"ip":peer.0.ip().to_string()})).await?;
 let session=result.as_object_mut().and_then(|v|v.remove("session_token")).and_then(|v|v.as_str().map(str::to_string));
 let mut response=Json(result).into_response();response.headers_mut().insert(header::CACHE_CONTROL,"no-store".parse().unwrap());
 if let Some(s)=session{response.headers_mut().insert(header::SET_COOKIE,cookie(&s).parse().unwrap());}
 if action=="logout"{response.headers_mut().insert(header::SET_COOKIE,cookie("").parse().unwrap());}
 Ok(response)
}
async fn billing(Path(action):Path<String>,headers:HeaderMap,body:Bytes)->Result<Json<Value>,Err>{
 let act=match action.as_str(){"account"=>"account","orders"=>"order","order"=>"order_read","profile"=>"profile",_=>return Err(err("未知账户操作"))};
 if !body.is_empty()&&!protected_origin(&headers){return Err((StatusCode::FORBIDDEN,Json(json!({"error":"请求来源无效"}))))}
 let body:Value=if body.is_empty(){json!({})}else{serde_json::from_slice(&body).map_err(|_|err("请求格式无效"))?};call(json!({"action":act,"body":body,"token":token(&headers)})).await.map(Json)
}
async fn admin(Path(action):Path<String>,headers:HeaderMap,method:Method,body:Bytes)->Result<Json<Value>,Err>{
 if method!=Method::GET&&!protected_origin(&headers){return Err((StatusCode::FORBIDDEN,Json(json!({"error":"请求来源无效"}))))}
 let act=match (action.as_str(),method==Method::GET){("overview",true)=>"admin_overview",("config",true)=>"admin_config",("config",false)=>"admin_config_save",("users",false)=>"admin_user",("plans",false)=>"admin_plan",("refunds",false)=>"admin_refund",_=>return Err(err("未知管理操作"))};
 let b=if body.is_empty(){json!({})}else{serde_json::from_slice(&body).map_err(|_|err("请求格式无效"))?};call(json!({"action":act,"body":b,"token":token(&headers)})).await.map(Json)
}
async fn webhook(Path(channel):Path<String>,headers:HeaderMap,body:Bytes)->Result<Response,Err>{
 if !["wechat","alipay","applepay"].contains(&channel.as_str()){return Err(err("未知支付渠道"))}
 // Base64 is encoded by Python-independent Rust without exposing the raw payload.
 let raw=body.iter().map(|b|*b as u64).collect::<Vec<_>>();
 let h:HashMap<String,String>=headers.iter().filter_map(|(k,v)|v.to_str().ok().map(|v|(k.to_string(),v.to_string()))).collect();
 let value=call(json!({"action":"webhook","channel":channel,"raw_bytes":raw,"headers":h})).await?;
 Ok(if channel=="alipay"{"success".into_response()}else{Json(value).into_response()})
}
pub fn router()->Router{Router::new().route("/api/public/config",get(public)).route("/api/auth/{action}",get(endpoint).post(endpoint)).route("/api/billing/{action}",get(billing).post(billing)).route("/api/admin/{action}",get(admin).post(admin)).route("/api/payments/webhook/{channel}",post(webhook)).layer(axum::extract::DefaultBodyLimit::max(128*1024))}
pub fn settle(id:&str,success:bool){if let Err(_)=bridge(json!({"action":"settle","body":{"lease_id":id,"success":success}})){eprintln!("任务额度结算失败，需要管理员核对");}}
pub async fn gate(mut req:Request,next:Next)->Response{
 let original=req.uri().path().to_string();
 if original=="/api/health"||original.starts_with("/api/public/")||original.starts_with("/api/auth/")||original.starts_with("/api/payments/webhook/"){return next.run(req).await}
 let credential=token(req.headers());let profile=match call(json!({"action":"authenticate","token":credential})).await{Ok(v)if v["user"].is_object()=>Identity(v["user"].clone()),_=>return (StatusCode::UNAUTHORIZED,Json(json!({"error":"请先登录 / Please sign in"}))).into_response()};
 if req.method()!=Method::GET&&!protected_origin(req.headers()){return (StatusCode::FORBIDDEN,Json(json!({"error":"请求来源无效 / Invalid request origin"}))).into_response()}
 if !profile.admin()&&(original.starts_with("/api/model-config")||original.starts_with("/api/admin/")||original=="/api/library"||original=="/api/search"||original=="/api/access-profile"&&req.method()!=Method::GET){return (StatusCode::FORBIDDEN,Json(json!({"error":"仅管理员可访问平台管理 / Administrator only"}))).into_response()}
 if original=="/api/access-profile"&&req.method()==Method::GET{return Json(profile.access().public()).into_response()}
 // Access profile editing is retired; authenticated membership must come from the ledger.
 if original=="/api/access-profile"{return (StatusCode::FORBIDDEN,Json(json!({"error":"请在用户管理中修改真实会员权益 / Use user management"}))).into_response()}
 let root=profile.tenant_root();std::fs::create_dir_all(&root).ok();
 let project_route=original.starts_with("/api/projects");
 if project_route&&req.method()==Method::POST&&original=="/api/projects"&& !profile.admin(){
  let count=std::fs::read_dir(root.join("projects")).map(|r|r.flatten().filter(|p|p.path().extension().is_some_and(|v|v=="json")).count()).unwrap_or(0);
  if count>=profile.0["limits"]["projects"].as_u64().unwrap_or(5)as usize{return (StatusCode::PAYMENT_REQUIRED,Json(json!({"error":"工程空间数量已达到套餐上限 / Project limit reached"}))).into_response()}
 }
 let catalog_route=original.starts_with("/api/books")||original.starts_with("/api/skills")||original.starts_with("/api/skill-")||original.starts_with("/api/knowledge/");
 if !profile.admin()&&(original=="/api/skills/evaluate"||original.ends_with("/classification")){return (StatusCode::FORBIDDEN,Json(json!({"error":"技能等级由管理员评估 / Administrator only"}))).into_response()}
 let ai=req.method()==Method::POST&&(original=="/api/project-guide"||original=="/api/project-materials"||original.ends_with("/apply")||original.ends_with("/to-skill"));
 if ai&&!profile.admin()&&crate::model_config::load().provider=="codex"{return (StatusCode::SERVICE_UNAVAILABLE,Json(json!({"error":"用户分析服务待管理员配置模型API / Administrator must configure a server model API"}))).into_response()}
 let mut lease=None;
 if ai{
  let units=if original.ends_with("/to-skill"){
   let book=original.trim_start_matches("/api/books/").trim_end_matches("/to-skill");
   if !book.bytes().all(|b|b.is_ascii_alphanumeric()){return (StatusCode::BAD_REQUEST,Json(json!({"error":"Invalid book ID"}))).into_response()}
   let data_root=if profile.admin(){PathBuf::from(std::env::var("DATA_DIR").unwrap_or_else(|_|"data".into()))}else{root.clone()};
   let p=data_root.join("catalog/skill_work").join(book).join("preview.json");
   let preview:Value=std::fs::read(p).ok().and_then(|b|serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
   let tokens=preview["estimated_input_tokens"].as_u64().unwrap_or(100000)+preview["estimated_output_tokens"].as_u64().unwrap_or(100000);
   ((tokens+1999)/2000).max(2)
  }else{2};
  let request_id=req.headers().get("x-request-id").and_then(|v|v.to_str().ok()).unwrap_or("");
  match call(json!({"action":"reserve","token":credential,"body":{"action":original,"units":units,"request_id":request_id}})).await{Ok(v)=>{let id=v["lease_id"].as_str().unwrap().to_string();req.extensions_mut().insert(Lease(id.clone()));lease=Some(id)},Err(e)=>return e.into_response()}
 }
 req.extensions_mut().insert(profile.clone());
 let mut response=if project_route||catalog_route&&!profile.admin(){
  let router={let mut routers=TENANTS.get_or_init(||Mutex::new(HashMap::new())).lock().unwrap();routers.entry(profile.id().into()).or_insert_with(||crate::projects::router(root.to_str().unwrap()).merge(crate::catalog::private_router(root.to_str().unwrap()))).clone()};
  // Re-routing must not carry the outer router's captured path parameters.
  req.extensions_mut().clear();req.extensions_mut().insert(profile.clone());
  if let Some(id)=&lease{req.extensions_mut().insert(Lease(id.clone()));}
  router.oneshot(req).await.unwrap()
 }else{next.run(req).await};
 if let Some(id)=lease{
  let success=response.status().is_success();let asynchronous=success&&original.ends_with("/to-skill");
  if !asynchronous{tokio::task::spawn_blocking(move||settle(&id,success)).await.ok();}
  response.headers_mut().insert("x-pebs-usage","updated".parse().unwrap());
 }
 response.headers_mut().insert(header::CACHE_CONTROL,"no-store".parse().unwrap());response
}
