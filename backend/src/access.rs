use axum::{routing::get, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::PathBuf, process::Command, sync::Mutex};
use crate::{err, Err};

// Local preview policy. A deployed service must resolve this from authenticated accounts.
static SAVE_LOCK: Mutex<()> = Mutex::new(());
#[derive(Clone, Serialize, Deserialize)]
pub struct Profile { pub tier: String, pub role: String }
fn path() -> PathBuf {
    PathBuf::from(std::env::var("DATA_DIR").unwrap_or_else(|_| "data".into())).join("catalog/access-profile.json")
}
pub fn rank(tier: &str) -> usize { match tier { "normal" => 0, "high" => 1, "ultra" => 2, _ => 3 } }
pub fn load() -> Profile {
    if let Ok(bytes) = std::fs::read(path()) {
        if let Ok(profile) = serde_json::from_slice::<Profile>(&bytes) {
            if valid(&profile) { return profile; }
        }
    }
    Profile { tier: "normal".into(), role: "user".into() }
}
fn valid(p: &Profile) -> bool { rank(&p.tier) < 3 && ["user", "researcher", "admin"].contains(&p.role.as_str()) }
impl Profile {
    pub fn show_book_names(&self) -> bool { self.role == "admin" }
    pub fn public(&self) -> Value { json!({"tier":self.tier,"role":self.role,"show_book_names":self.show_book_names(),"mode":"authenticated"}) }
    pub fn allows(&self, skill: &Value) -> bool {
        let mut needed=rank(skill["capability_tier"].as_str().unwrap_or("normal"));
        if let Some(capabilities)=skill["capabilities"].as_array(){for c in capabilities{needed=needed.max(rank(c["tier"].as_str().unwrap_or("normal")));}}
        needed <= rank(&self.tier)
    }
    pub fn matches(&self, access: &Value) -> bool {
        access["tier"] == self.tier && access["role"] == self.role && access["show_book_names"] == self.show_book_names()
    }
    pub fn command(&self, cmd: &mut Command) {
        cmd.env("MODEL_USER_TIER", &self.tier).env("MODEL_USER_ROLE", &self.role).env("MODEL_SOURCE_NAMES", if self.show_book_names() {"1"} else {"0"});
    }
}
async fn read() -> Json<Value> { Json(load().public()) }
async fn save(Json(mut p): Json<Profile>) -> Result<Json<Value>, Err> {
    p.tier = p.tier.trim().to_lowercase(); p.role = p.role.trim().to_lowercase();
    if !valid(&p) { return Err(err("会员等级须为 normal、high 或 Ultra；角色须为普通用户、研究人员或管理员")); }
    let _lock = SAVE_LOCK.lock().unwrap(); let file = path();
    std::fs::create_dir_all(file.parent().unwrap()).map_err(|_| err("无法创建权限配置目录"))?;
    let temp = file.with_extension("tmp");
    std::fs::write(&temp, serde_json::to_vec(&p).unwrap()).map_err(|_| err("无法保存权限配置"))?;
    std::fs::rename(temp, file).map_err(|_| err("无法保存权限配置"))?;
    Ok(Json(p.public()))
}
pub fn router() -> Router { Router::new().route("/api/access-profile", get(read).put(save)) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn tier_and_role_are_independent() {
        let p = Profile { tier: "normal".into(), role: "admin".into() };
        assert!(p.show_book_names()); assert!(!p.allows(&json!({"capability_tier":"ultra"})));
        assert!(!p.allows(&json!({"capability_tier":"unknown"})));
        assert!(!p.allows(&json!({"capability_tier":"normal","capabilities":[{"tier":"ultra"}]})));
        assert!(p.allows(&json!({"capability_tier":"normal"})));
        assert!(!Profile { tier:"ultra".into(), role:"user".into() }.show_book_names());
    }
}
