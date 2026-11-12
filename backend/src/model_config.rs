use axum::{routing::{get,post},Json,Router};
use serde::{Serialize,Deserialize};
use serde_json::{json,Value};
use std::{path::PathBuf,process::Command,io::Write,sync::Mutex};
use crate::{Err,err};
static SAVE_LOCK:Mutex<()>=Mutex::new(());
#[derive(Clone,Serialize,Deserialize)]
pub struct Config { pub provider:String, pub model:String, pub base_url:String, #[serde(default)] pub api_key:String }
fn path()->PathBuf { PathBuf::from(std::env::var("DATA_DIR").unwrap_or_else(|_|"data".into())).join("catalog/model-config.json") }
pub fn load()->Config {
 if let Ok(bytes)=std::fs::read(path()){if let Ok(c)=serde_json::from_slice(&bytes){return c}}
 let provider=std::env::var("BOOK_TO_SKILL_PROVIDER").unwrap_or_else(|_|"openai".into());
 Config{model:std::env::var("BOOK_TO_SKILL_MODEL").unwrap_or_default(),base_url:std::env::var(if provider=="ollama"{"BOOK_TO_SKILL_OLLAMA_BASE"}else{"BOOK_TO_SKILL_API_BASE"}).unwrap_or_else(|_|match provider.as_str(){"minimax"=>"https://api.minimax.cn/v1","ollama"=>"http://127.0.0.1:11434",_=>"https://api.openai.com/v1"}.into()),api_key:std::env::var(if provider=="minimax"{"MINIMAX_API_KEY"}else{"OPENAI_API_KEY"}).unwrap_or_default(),provider}
}
impl Config {
 pub fn ready(&self)->bool { if self.provider=="codex" {return Command::new("codex").args(["login","status"]).output().map(|o|o.status.success()).unwrap_or(false)} !self.model.trim().is_empty() && (self.provider=="ollama" || !self.api_key.is_empty()) }
 pub fn public(&self)->Value {json!({"provider":self.provider,"model":self.model,"base_url":self.base_url,"has_api_key":!self.api_key.is_empty(),"ready":self.ready()})}
 pub fn command(&self,cmd:&mut Command){cmd.env("BOOK_TO_SKILL_PROVIDER",&self.provider).env("BOOK_TO_SKILL_MODEL",&self.model).env("BOOK_TO_SKILL_API_BASE",&self.base_url).env("BOOK_TO_SKILL_OLLAMA_BASE",&self.base_url).env("OPENAI_API_KEY",if self.provider=="openai"{&self.api_key}else{""}).env("MINIMAX_API_KEY",if self.provider=="minimax"{&self.api_key}else{""});}
}
async fn read()->Json<Value>{Json(load().public())}
async fn save(Json(mut c):Json<Config>)->Result<Json<Value>,Err>{
 let _lock=SAVE_LOCK.lock().unwrap();let old=load();c.provider=c.provider.trim().to_lowercase();c.model=c.model.trim().into();c.base_url=c.base_url.trim().trim_end_matches('/').into();c.api_key=c.api_key.trim().into();
 let allowed=match c.provider.as_str(){"minimax"=>["https://api.minimax.cn/v1","https://api.minimax.io/v1"].contains(&c.base_url.as_str()),"openai"=>c.base_url=="https://api.openai.com/v1","ollama"=>["http://127.0.0.1:11434","http://localhost:11434"].contains(&c.base_url.as_str()),"codex"=>true,_=>false};
 if !allowed{return Err(err("请选择支持的模型服务与接口地址"))}if c.provider!="codex"&&(c.model.is_empty()||c.model.len()>120){return Err(err("请输入模型名称（最多 120 字节）"))}
 if c.api_key.is_empty()&&c.provider==old.provider&&c.base_url==old.base_url{c.api_key=old.api_key}if c.api_key.len()>4096{return Err(err("API Key 长度无效"))}
 let p=path();std::fs::create_dir_all(p.parent().unwrap()).map_err(|_|err("无法创建配置目录"))?;let temp=p.with_extension("tmp");
 use std::os::unix::fs::OpenOptionsExt;
 let mut f=std::fs::OpenOptions::new().create(true).truncate(true).write(true).mode(0o600).open(&temp).map_err(|_|err("无法保存配置"))?;
 f.write_all(&serde_json::to_vec(&c).unwrap()).map_err(|_|err("无法保存配置"))?;std::fs::rename(temp,p).map_err(|_|err("无法保存配置"))?;Ok(Json(c.public()))
}
async fn test()->Result<Json<Value>,Err>{let c=load();tokio::task::spawn_blocking(move||{
 if !c.ready(){return Err(err("请先保存完整配置；Codex 需要本机登录"))}if c.provider=="codex"{return Ok(Json(json!({"ok":true,"message":"本机 Codex 登录有效（未发送模型请求）"})))}
 let mut cmd=Command::new("python3");cmd.args(["scripts/test_model_connection.py"]);c.command(&mut cmd);let out=cmd.output().map_err(|_|err("无法启动连接测试"))?;if !out.status.success(){return Err(err(&String::from_utf8_lossy(&out.stderr)))}Ok(Json(json!({"ok":true,"message":"模型连接与结构化回答测试通过"})))
 }).await.map_err(|_|err("连接测试任务失败"))?}
pub fn router()->Router{Router::new().route("/api/model-config",get(read).put(save)).route("/api/model-config/test",post(test))}
