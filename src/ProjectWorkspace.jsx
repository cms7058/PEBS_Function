import {accountFetch as fetch} from './account-fetch';
import { t } from "./i18n";
import React, { useEffect, useRef, useState } from 'react';
import { FolderPlus, X, Save, Archive, History } from 'lucide-react';
async function request(url, options) {
  let r;
  try {
    r = await fetch(url, options);
  } catch {
    throw Error('无法连接项目服务，请启动应用服务后重试。填写的内容会保留。');
  }
  const v = await r.json().catch(() => null);
  if (!r.ok) throw Error(v?.error || (r.status >= 500 ? '项目服务暂时不可用，请恢复服务后重试。填写的内容会保留。' : '工程项目请求失败'));
  if (!v) throw Error('项目服务返回了无效结果，请重试');
  return v;
}
const json = (method, value) => ({
  method,
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(value)
});
const projectMeta = p => ({
  status: p.status || 'draft',
  saved_at: p.saved_at,
  draft_at: p.draft_at,
  save_count: p.save_count || 0,
  has_saved_version: p.has_saved_version ?? !!p.saved_state
});
export function useProjectWorkspace(legacyFactory, accountId) {
  const [initial] = useState(legacyFactory),
    [session, setSession] = useState(null),
    [projects, setProjects] = useState([]),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [status, setStatus] = useState('正在读取项目'),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const current = useRef(null),
    queue = useRef(Promise.resolve());
  current.current = session;
  async function refresh() {
    const list = await request('/api/projects');
    setProjects(list);
    return list;
  }
  function adopt(p) {
    let state = p.state,
      meta = projectMeta(p);
    try {
      const draft = JSON.parse(localStorage.getItem('pebs:' + accountId + ':draft:' + p.id));
      if (draft?.dirty && draft.updated_at >= p.updated_at) {
        state = draft.state;
        meta.status = 'draft';
      }
      localStorage.setItem('pebs:' + accountId + ':activeProject', p.id);
    } catch {}
    const next = {
      id: p.id,
      state,
      meta,
      revision: Date.now()
    };
    current.current = next;
    setSession(next);
    setStatus('项目已加载');
    setError('');
    setNotice('');
  }
  function persist(s, action = 'autosave') {
    if (!s) return Promise.resolve();
    const task = queue.current.catch(() => {}).then(async () => {
      if (current.current?.id === s.id) setStatus(action === 'save' ? '正在保存项目' : '正在暂存');
      const result = await request('/api/projects/' + s.id, json('PUT', {
        state: s.state,
        action
      }));
      try {
        const key = 'pebs:' + accountId + ':draft:' + s.id,
          draft = JSON.parse(localStorage.getItem(key));
        if (draft?.revision === s.revision) localStorage.removeItem(key);
      } catch {}
      setProjects(list => list.map(p => p.id === s.id ? {
        ...p,
        ...result
      } : p));
      if (current.current?.id === s.id) {
        setSession(active => active?.id === s.id ? {
          ...active,
          meta: {
            ...projectMeta(result),
            status: active.revision === s.revision ? result.status : 'draft'
          }
        } : active);
        if (current.current.revision === s.revision) {
          setStatus(result.status === 'saved' ? '项目已保存' : '已暂存到后端');
          setError('');
        }
      }
    });
    queue.current = task;
    return task;
  }
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const list = await request('/api/projects');
        if (cancelled) return;
        setProjects(list);
        const active = localStorage.getItem('pebs:' + accountId + ':activeProject');
        const chosen = list.find(p => p.id === active) || list.find(p => p.mode === 'real') || list[0];
        const p = chosen ? await request('/api/projects/' + chosen.id) : await request('/api/projects', json('POST', {
          name: initial.project.name,
          state: initial
        }));
        if (cancelled) return;
        adopt(p);
        await refresh();
      } catch (e) {
        if (!cancelled) {
          setError(e.message);
          setStatus('项目加载失败');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);
  useEffect(() => {
    if (!session || loading) return;
    try {
      localStorage.setItem('pebs:' + accountId + ':draft:' + session.id, JSON.stringify({
        ...session,
        dirty: true,
        updated_at: Date.now()
      }));
    } catch {
      setError('浏览器无法保存临时草稿，请保持网络连接并等待后端暂存');
    }
    setStatus('待自动暂存');
    const t = setTimeout(() => persist(session).catch(e => {
      setStatus('暂存失败');
      setError(e.message);
    }), 500);
    return () => clearTimeout(t);
  }, [session?.id, session?.revision, loading]);
  function setField(key, value) {
    setNotice('');
    setSession(s => s ? {
      ...s,
      meta: {
        ...s.meta,
        status: 'draft'
      },
      revision: s.revision + 1,
      state: {
        ...s.state,
        [key]: typeof value === 'function' ? value(s.state[key]) : value
      }
    } : s);
  }
  async function mark(action) {
    if (!current.current) return false;
    setSaving(true);
    setNotice('');
    try {
      await persist(current.current, action);
      setNotice(action === 'save' ? '项目已保存，可在历史项目中查看本次保存的版本。' : '项目已暂存，可随时从历史项目继续。');
      return true;
    } catch (e) {
      setStatus('保存失败');
      setError(e.message);
      return false;
    } finally {
      setSaving(false);
    }
  }
  async function select(id) {
    if (id === session?.id) return true;
    setLoading(true);
    try {
      await persist(current.current);
      const p = await request('/api/projects/' + id);
      adopt(p);
      await refresh();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }
  async function create(values) {
    setLoading(true);
    try {
      await persist(current.current);
      const p = await request('/api/projects', json('POST', values));
      adopt(p);
      await refresh();
      return p;
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      setLoading(false);
    }
  }
  function patchState(fn) {
    setNotice('');
    setSession(s => s ? {
      ...s,
      meta: {
        ...s.meta,
        status: 'draft'
      },
      revision: s.revision + 1,
      state: fn(s.state)
    } : s);
  }
  return {
    state: session?.state || initial,
    id: session?.id,
    meta: session?.meta,
    projects,
    loading,
    saving,
    status,
    error,
    notice,
    setField,
    patchState,
    select,
    create,
    refresh,
    mark,
    reload: () => setLoadAttempt(n => n + 1),
    flush: () => persist(current.current)
  };
}
export function ProjectToolbar({
  workspace,
  locked = false,
  onHistory
}) {
  const [open, setOpen] = useState(false),
    [form, setForm] = useState({
      name: '',
      question: '',
      target: ''
    }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await workspace.create(form);
      setOpen(false);
      setForm({
        name: '',
        question: '',
        target: ''
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return <><div className="project-toolbar"><div><label htmlFor="active-project">{t("当前工程项目")}</label><select id="active-project" value={workspace.id || ''} disabled={workspace.loading || workspace.saving || locked} onChange={e => workspace.select(e.target.value)}>{workspace.projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.mode === 'demo' ? t(" · 演示项目") : ''}</option>)}</select></div><div className="project-save-meta"><span className={'project-state ' + (workspace.meta?.status === 'saved' ? 'saved' : 'draft')}>{workspace.meta?.status === 'saved' ? t("已保存") : t("暂存草稿")}</span><span role="status" className="project-save-status">{t(workspace.status)}</span></div><div className="project-save-actions"><button className="outline" disabled={!workspace.id || workspace.loading || workspace.saving || locked} onClick={() => workspace.mark('draft')}><Archive size={15} />{t("暂存项目")}</button><button className="primary" disabled={!workspace.id || workspace.loading || workspace.saving || locked} onClick={() => workspace.mark('save')}><Save size={15} />{t("保存项目")}</button><button className="outline" disabled={workspace.loading || workspace.saving || locked} onClick={onHistory}><History size={15} />{t("历史项目")}</button></div><button className="primary" disabled={workspace.loading || workspace.saving || locked} onClick={() => {
        setOpen(true);
        setError('');
      }}><FolderPlus size={16} />{t("新建工程项目")}</button></div>{workspace.notice && <p className="project-action-notice" role="status">{workspace.notice}</p>}{workspace.error && <div className="error" role="alert">{t(workspace.error)}{!workspace.id && <button className="outline" disabled={workspace.loading} onClick={workspace.reload}>{t("重新连接项目服务")}</button>}</div>}{open && <div className="modal-overlay"><section className="modal project-create-modal" role="dialog" aria-modal="true" aria-label={t("新建工程项目")}><button className="close" aria-label={t("关闭新建项目")} disabled={busy} onClick={() => setOpen(false)}><X /></button><h2>{t("新建工程项目")}</h2><p>{t("填写工程问题与目标，按十个步骤逐步完成。项目从空数据开始，后续上传你的 CSV。")}</p><form onSubmit={submit}><label htmlFor="new-project-name">{t("项目名称")}</label><input id="new-project-name" required maxLength={200} value={form.name} onChange={e => setForm(f => ({
            ...f,
            name: e.target.value
          }))} placeholder={t("例如：注塑尺寸波动改善")} /><label htmlFor="new-project-question">{t("工程问题与要求")}</label><textarea id="new-project-question" required value={form.question} onChange={e => setForm(f => ({
            ...f,
            question: e.target.value
          }))} placeholder={t("描述现状、影响、希望分析的关系及要求")} /><label htmlFor="new-project-target">{t("目标与成功标准")}</label><textarea id="new-project-target" required value={form.target} onChange={e => setForm(f => ({
            ...f,
            target: e.target.value
          }))} placeholder={t("填写可测量的改善目标")} />{error && <div className="error" role="alert">{error}</div>}<div className="modal-actions"><button type="button" className="outline" disabled={busy} onClick={() => setOpen(false)}>{t("取消")}</button><button className="primary" disabled={busy}>{busy ? t("正在创建…") : t("创建并开始")}</button></div></form></section></div>}</>;
}
export function VariableMapping({
  data,
  xs,
  y,
  onY,
  onX
}) {
  return <><label htmlFor="response-variable">{t("结果变量 Y")}</label><select id="response-variable" value={y ?? ''} onChange={e => onY(+e.target.value)}><option value="" disabled>{t("选择结果列")}</option>{data.columns.map((c, i) => <option key={i} value={i}>{c}</option>)}</select><label>{t("候选影响因素 X")}<small>{t("最多选择 6 个数值因素")}</small></label><div className="factor-list">{data.columns.map((c, i) => i !== y && <label key={i}><input type="checkbox" checked={xs.includes(i)} onChange={() => onX(i)} /><span>{c}</span><span className="pill">{t("数值型")}</span></label>)}</div></>;
}
