use axum::{routing::post,Json,Router};
use serde_json::{json,Value};
use std::{process::{Command,Stdio},io::Write};
use crate::{err,Err};
pub fn execute(input:&Value)->Result<Value,Err>{
 let mut child=Command::new("python3").arg("scripts/collection_workflow.py").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|_|err("无法启动本地数据检查"))?;
 child.stdin.take().unwrap().write_all(&serde_json::to_vec(input).map_err(|_|err("数据格式无效"))?).map_err(|_|err("无法发送待检查数据"))?;
 let output=child.wait_with_output().map_err(|_|err("数据检查失败"))?;
 if !output.status.success(){return Err(err(&String::from_utf8_lossy(&output.stderr).chars().take(600).collect::<String>()))}
 serde_json::from_slice(&output.stdout).map_err(|_|err("数据检查返回格式无效"))
}
async fn check(Json(mut value):Json<Value>)->Result<Json<Value>,Err>{value["action"]=json!("check");run(value).await}
async fn repair(Json(mut value):Json<Value>)->Result<Json<Value>,Err>{value["action"]=json!("repair");run(value).await}
async fn upload(Json(mut value):Json<Value>)->Result<Json<Value>,Err>{value["action"]=json!("upload");run(value).await}
async fn run(value:Value)->Result<Json<Value>,Err>{
 if serde_json::to_vec(&value).unwrap_or_default().len()>10*1024*1024{return Err(err("检查数据最多10 MB"))}
 tokio::task::spawn_blocking(move||execute(&value).map(Json)).await.map_err(|_|err("数据检查任务失败"))?
}
pub fn router()->Router{Router::new().route("/api/collection/check",post(check)).route("/api/collection/repair",post(repair)).route("/api/collection/upload",post(upload)).layer(axum::extract::DefaultBodyLimit::max(11*1024*1024))}
