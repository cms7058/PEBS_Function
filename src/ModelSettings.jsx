import {accountFetch as fetch} from './account-fetch';
import { t } from "./i18n";
import React, { useEffect, useState } from 'react';
import AccessSettings from './AccessSettings.jsx';
const presets = {
  minimax: {
    model: 'MiniMax-M3',
    base_url: 'https://api.minimax.cn/v1'
  },
  openai: {
    model: '',
    base_url: 'https://api.openai.com/v1'
  },
  ollama: {
    model: '',
    base_url: 'http://127.0.0.1:11434'
  },
  codex: {
    model: '',
    base_url: ''
  }
};
async function request(url, options) {
  const r = await fetch(url, options);
  const v = await r.json();
  if (!r.ok) throw Error(v.error || '请求失败');
  return v;
}
export default function ModelSettings() {
  const [form, setForm] = useState(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    request('/api/model-config').then(v => setForm({
      ...v,
      api_key: ''
    })).catch(e => setMessage(e.message));
  }, []);
  function change(p) {
    setForm(f => ({
      ...f,
      ...p
    }));
    setDirty(true);
    setMessage('');
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const v = await request('/api/model-config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(form)
      });
      setForm({
        ...v,
        api_key: ''
      });
      setDirty(false);
      setMessage(v.ready ? '配置已保存，新的生成和调用立即生效。' : '配置已保存，请补充密钥或完成本机登录。');
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setMessage('正在测试…');
    try {
      const v = await request('/api/model-config/test', {
        method: 'POST'
      });
      setMessage(v.message);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return <><div className="page-heading"><div><div className="eyebrow">MODEL SETTINGS</div><h1>{t("模型配置")}</h1><p>{t("统一配置书籍 Skill 生成与已审核 Skill 的调用。切换模型无需重新生成 Skill。")}</p></div></div><section className="report-card model-settings" style={{
      maxWidth: 850
    }}>{form ? <form onSubmit={save}><div className="field"><label htmlFor="provider">{t("模型服务")}</label><select id="provider" disabled={busy} value={form.provider} onChange={e => change({
            provider: e.target.value,
            ...presets[e.target.value],
            api_key: '',
            has_api_key: false
          })}><option value="minimax">MiniMax</option><option value="openai">OpenAI</option><option value="ollama">{t("本地 Ollama")}</option><option value="codex">{t("本机 Codex")}</option></select></div>{form.provider !== 'codex' && <><div className="field"><label htmlFor="model">{t("模型名称")}</label><input id="model" required disabled={busy} value={form.model} onChange={e => change({
              model: e.target.value
            })} placeholder={form.provider === 'minimax' ? 'MiniMax-M3' : t("填写账户可用的模型名称")} /></div><div className="field"><label htmlFor="endpoint">{t("接口地址")}</label>{form.provider === 'minimax' ? <select id="endpoint" disabled={busy} value={form.base_url} onChange={e => change({
              base_url: e.target.value,
              api_key: '',
              has_api_key: false
            })}><option value="https://api.minimax.cn/v1">{t("中国站 · api.minimax.cn")}</option><option value="https://api.minimax.io/v1">{t("国际站 · api.minimax.io")}</option></select> : <input id="endpoint" readOnly value={form.base_url} />}</div>{form.provider !== 'ollama' && <div className="field"><label htmlFor="key">API Key</label><input id="key" type="password" autoComplete="new-password" disabled={busy} value={form.api_key} onChange={e => change({
              api_key: e.target.value
            })} placeholder={form.has_api_key ? t("已保存；留空保留当前密钥") : t("输入此服务的 API Key")} /><p>{t("仅保存在本机后端，不回显、不存入浏览器。切换服务或站点需要重新填写。")}</p></div>}</>}{form.provider === 'codex' && <p>{t("使用本机已登录的 Codex；适合管理员制作 Skill。连接测试仅检查登录状态。")}</p>}<div className="info"><p>{t("模型用于 Skill 生成、流程助手建议及资料整理；计算工具负责工程数据拟合与验证。网页和 iOS 可共用后端接口。")}</p></div><div style={{
          display: 'flex',
          gap: 12,
          marginTop: 24
        }}><button className="primary" disabled={busy}>{t("保存配置")}</button><button className="outline" type="button" onClick={test} disabled={busy || dirty}>{t("测试已保存的连接")}</button></div><p>{t("连接测试会发送一条简短请求，不发送书籍或项目资料。")}</p></form> : <p>{t("正在读取模型配置…")}</p>}{message && <p role="status">{message}</p>}</section></>;
}
