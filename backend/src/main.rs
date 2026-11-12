mod catalog;
mod model_config;
mod regression;
mod projects;
mod guidance;
mod collection;
mod access;
mod accounts;
use axum::{routing::{get,post},Json,Router,extract::{State,Query},http::StatusCode};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{sync::Arc,collections::HashMap};
#[derive(Clone)] struct App { pages:Arc<Vec<Page>>, library:Value }
#[derive(Clone,Deserialize,Serialize)] struct Page { page:usize,title:String,chapter:usize,url:String,text:String }
type Err = (StatusCode,Json<Value>);
fn err(s:&str)->Err{(StatusCode::BAD_REQUEST,Json(json!({"error":s})))}
async fn search(State(s):State<App>,Query(q):Query<HashMap<String,String>>)->Json<Value>{let query=q.get("q").cloned().unwrap_or_default().to_lowercase();let aliases=[("回归","regression"),("残差","residual"),("异常","outlier"),("实验","design"),("控制","control"),("验证","validation"),("测量","measurement"),("优化","optimization"),("可靠","reliability")];let mut terms:Vec<String>=query.split_whitespace().map(str::to_string).collect();for(a,b)in aliases{if query.contains(a){terms.push(b.into())}}let mut found:Vec<(usize,&Page)>=s.pages.iter().filter_map(|p|{let t=p.text.to_lowercase();let title=p.title.to_lowercase();let score:usize=terms.iter().filter(|t|!t.is_empty()).map(|term|t.matches(term).count().min(20)+if title.contains(term){30}else{0}).sum();if score>0{Some((score,p))}else{None}}).collect();found.sort_by(|a,b|b.0.cmp(&a.0));Json(json!({"results":found.iter().take(8).map(|(_,p)|json!({"page":p.page,"title":p.title,"chapter":p.chapter,"url":p.url,"excerpt":p.text.chars().take(650).collect::<String>()})).collect::<Vec<_>>(),"total":found.len()}))}
#[tokio::main] async fn main(){let root=std::env::var("DATA_DIR").unwrap_or_else(|_|"data".into());let port=std::env::var("PORT").unwrap_or_else(|_|"8787".into());let pages=serde_json::from_str(&std::fs::read_to_string(format!("{root}/pages.json")).expect("先运行 scripts/index_handbook.py")).unwrap();let library:Value=serde_json::from_str(&std::fs::read_to_string(format!("{root}/library.json")).unwrap()).unwrap();let catalog=catalog::router(&root);let state=App{pages:Arc::new(pages),library};let app=Router::new().route("/api/health",get(||async{Json(json!({"status":"ok","engine":"Rust / Axum"}))})).route("/api/library",get(|State(s):State<App>|async move{Json(s.library)})).route("/api/search",get(search)).route("/api/analyze",post(regression::analyze)).layer(axum::extract::DefaultBodyLimit::max(8*1024*1024)).with_state(state).merge(catalog).merge(model_config::router()).merge(projects::router(&root)).merge(guidance::router()).merge(collection::router()).merge(access::router()).merge(accounts::router()).layer(axum::middleware::from_fn(accounts::gate));accounts::bridge(json!({"action":"reconcile"})).expect("账号账本初始化失败，请检查Python依赖");let address=format!("127.0.0.1:{port}");let listener=tokio::net::TcpListener::bind(&address).await.unwrap();println!("NIST Model API: http://{address}");axum::serve(listener,app.into_make_service_with_connect_info::<std::net::SocketAddr>()).await.unwrap();}
