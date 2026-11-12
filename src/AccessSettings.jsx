import {accountFetch as fetch} from './account-fetch';
import { t } from "./i18n";
import React, { useEffect, useState } from 'react';
import './skill-capabilities.css';
async function request(options) {
  const r = await fetch('/api/access-profile', options);
  const v = await r.json();
  if (!r.ok) throw Error(v.error || '权限配置请求失败');
  return v;
}
export default function AccessSettings() {
  const [profile, setProfile] = useState(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    request().then(setProfile).catch(e => setMessage(e.message));
  }, []);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const v = await request({
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tier: profile.tier,
          role: profile.role
        })
      });
      setProfile(v);
      window.dispatchEvent(new CustomEvent('access-profile-changed', {
        detail: v
      }));
      setMessage('预览身份已保存。请在工作台更新助手建议，查看对应等级的推荐。');
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return <section className="report-card access-settings" style={{
    maxWidth: 850,
    marginTop: 24
  }}><h2>{t("会员与角色策略")}</h2><p>{t("本机预览配置：用于验证不同会员的技能推荐和来源展示。当前尚未接入登录、订阅或支付，正式上线时由后端读取已登录用户的权益。")}</p>{profile && <form onSubmit={save}><div className="field"><label htmlFor="access-tier">{t("预览会员等级")}</label><select id="access-tier" value={profile.tier} disabled={busy} onChange={e => setProfile(p => ({
          ...p,
          tier: e.target.value
        }))}><option value="normal">{t("normal · 基础会员")}</option><option value="high">{t("high · 进阶会员")}</option><option value="ultra">{t("Ultra · 高级会员")}</option></select></div><div className="field"><label htmlFor="access-role">{t("预览用户角色")}</label><select id="access-role" value={profile.role} disabled={busy} onChange={e => setProfile(p => ({
          ...p,
          role: e.target.value
        }))}><option value="user">{t("普通用户 · 仅显示知识点")}</option><option value="researcher">{t("研究人员 · 显示书名与页码")}</option><option value="admin">{t("管理员 · 显示书名与页码")}</option></select></div><table className="tier-policy"><thead><tr><th>{t("会员等级")}</th><th>{t("可推荐的技能")}</th><th>{t("选择原则")}</th></tr></thead><tbody><tr><td>normal</td><td>normal</td><td rowSpan={3}>{t("同一能力优先选取权限范围内等级最高、证据更充分的已审核技能；缺少适用技能时明确提示。")}</td></tr><tr><td>high</td><td>normal、high</td></tr><tr><td>Ultra</td><td>normal、high、Ultra</td></tr></tbody></table><p className="footnote">{t("会员等级决定技能范围，用户角色单独决定是否显示书籍来源。两者互不替代。")}</p><button className="primary" disabled={busy}>{busy ? t("保存中…") : t("保存预览身份")}</button></form>}{message && <p role="status">{message}</p>}</section>;
}
