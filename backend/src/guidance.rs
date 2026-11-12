use axum::{routing::post,Json,Router};
use serde_json::Value;
use std::{process::{Command,Stdio},io::Write};
use crate::{err,Err};
async fn guide(axum::Extension(identity):axum::Extension<crate::accounts::Identity>,Json(input):Json<Value>)->Result<Json<Value>,Err>{run(input,"scripts/project_guide.py",identity).await}
async fn materials(axum::Extension(identity):axum::Extension<crate::accounts::Identity>,Json(input):Json<Value>)->Result<Json<Value>,Err>{run(input,"scripts/project_materials.py",identity).await}
async fn run(input:Value,script:&'static str,identity:crate::accounts::Identity)->Result<Json<Value>,Err>{
 let context=&input["context"];if !context["stage"].as_u64().is_some_and(|n|(1..=10).contains(&n)){return Err(err("阶段须为 1–10"))}
 if context["project"]["question"].as_str().unwrap_or("").trim().is_empty(){return Err(err("请先填写工程问题"))}
 if serde_json::to_vec(&input).unwrap_or_default().len()>150_000{return Err(err("项目摘要过大"))}
 let access=identity.access();
 let tenant=identity.tenant_root();
 if script=="scripts/project_materials.py"&&(!access.matches(&input["guide"]["access"])||input["guide"]["access_stale"]==true){return Err(err("会员等级或角色已变化，请先更新流程助手建议，再导入资料"))}
 let config=crate::model_config::load();tokio::task::spawn_blocking(move||{
  if !config.ready(){return Err(err("请先在模型配置中设置可用的大模型服务"))}
  let mut cmd=Command::new("python3");cmd.arg(script).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());config.command(&mut cmd);access.command(&mut cmd);cmd.env("PRIVATE_DATA_DIR",tenant).env("MODEL_LOCALE",input["locale"].as_str().unwrap_or("zh"));
  let mut child=cmd.spawn().map_err(|_|err("无法启动流程助手"))?;child.stdin.take().unwrap().write_all(&serde_json::to_vec(&input).unwrap()).map_err(|_|err("无法发送项目摘要"))?;
  let out=child.wait_with_output().map_err(|_|err("流程助手执行失败"))?;if !out.status.success(){return Err(err(&String::from_utf8_lossy(&out.stderr).chars().take(900).collect::<String>()))}
  let value:Value=serde_json::from_slice(&out.stdout).map_err(|_|err("流程建议格式无效"))?;Ok(Json(value))
 }).await.map_err(|_|err("流程助手任务失败"))?
}
pub fn router()->Router{Router::new().route("/api/project-guide",post(guide)).route("/api/project-materials",post(materials))}
