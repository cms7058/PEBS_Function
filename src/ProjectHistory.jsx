import {accountFetch as fetch} from './account-fetch';
import { t } from "./i18n";
import React, { useEffect, useState } from 'react';
import { Search, FolderOpen, X, History, RefreshCw } from 'lucide-react';
const stages = ['业务问题识别', '约束 / 瓶颈识别', '变量 X / Y 定义', '数据获取与质量检查', '选择建模方法', '生成数学模型', '验证模型', '参数探索与仿真', '形成改善方案', '监控与模型迭代'];
const date = t => t ? new Date(t).toLocaleString('zh-CN', {
  hour12: false,
  timeZone: 'Asia/Shanghai'
}) : '尚未保存';
export default function ProjectHistory({
  workspace,
  onContinue,
  locked = false
}) {
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [detail, setDetail] = useState(null),
    [version, setVersion] = useState('draft'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    workspace.refresh().catch(e => setError(e.message));
  }, []);
  async function inspect(p) {
    setBusy(true);
    setError('');
    try {
      await workspace.flush();
      const r = await fetch('/api/projects/' + p.id);
      const v = await r.json();
      if (!r.ok) throw Error(v.error || '读取项目失败');
      setDetail(v);
      setVersion(v.status === 'saved' && v.saved_state ? 'saved' : 'draft');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setBusy(true);
    try {
      await workspace.flush();
      await workspace.refresh();
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const items = workspace.projects.filter(p => (filter === 'all' || p.status === filter) && [p.name, p.question].some(s => String(s || '').toLowerCase().includes(query.trim().toLowerCase()))).sort((a, b) => b.updated_at - a.updated_at);
  const snapshot = detail && (version === 'saved' && detail.saved_state ? detail.saved_state : detail.state);
  return <><div className="page-heading"><div><div className="eyebrow">PROJECT HISTORY</div><h1>{t("历史项目")}</h1><p>{t("查看暂存与已保存项目，保留工程过程，继续未完成的分析。")}</p></div><button className="outline" disabled={busy || workspace.loading || workspace.saving || locked} onClick={refresh}><RefreshCw size={16} />{t("刷新列表")}</button></div><div className="project-history-tools"><div className="project-history-search"><Search size={17} /><input aria-label={t("搜索历史项目")} placeholder={t("搜索项目名称或工程问题")} value={query} onChange={e => setQuery(e.target.value)} /></div><select aria-label={t("筛选项目状态")} value={filter} onChange={e => setFilter(e.target.value)}><option value="all">{t("全部项目")}</option><option value="draft">{t("暂存项目")}</option><option value="saved">{t("已保存项目")}</option></select><span>{items.length}{t("个项目")}</span></div>{(error || workspace.error) && <div className="error" role="alert">{error || workspace.error}</div>}<div className="project-history-table table-wrap"><table><thead><tr><th>{t("工程项目")}</th><th>{t("状态")}</th><th>{t("当前进度")}</th><th>{t("最近暂存 / 修改")}</th><th>{t("最近保存")}</th><th>{t("操作")}</th></tr></thead><tbody>{items.map(p => <tr key={p.id}><td><strong>{p.name}</strong>{p.mode === 'demo' && <span className="pill">{t("演示")}</span>}<p>{p.question || t("尚未填写工程问题")}</p><small>{p.rows}{t("行数据 · 创建于")}{date(p.created_at)}</small></td><td><span className={'project-state ' + (p.status === 'saved' ? 'saved' : 'draft')}>{p.status === 'saved' ? t("已保存") : t("已暂存")}</span>{p.status !== 'saved' && p.has_saved_version && <small className="project-history-sub">{t("含已保存版本")}</small>}</td><td>{p.completed || 0} / 10<p>{t("第")}{p.stage}{t("步 ·")}{stages[p.stage - 1]}</p></td><td>{date(p.updated_at)}</td><td>{date(p.saved_at)}</td><td><div className="project-history-actions"><button className="outline" disabled={busy || workspace.loading || workspace.saving || locked} onClick={() => inspect(p)}>{t("查看详情")}</button><button className="primary" disabled={busy || workspace.loading || workspace.saving || locked} onClick={() => onContinue(p.id)}><FolderOpen size={14} />{t("继续项目")}</button></div></td></tr>)}</tbody></table>{!items.length && <div className="empty"><History size={25} /><p>{t("没有符合条件的项目")}</p></div>}</div>{detail && <div className="modal-overlay"><section className="modal project-detail-modal" role="dialog" aria-modal="true" aria-label={t("历史项目详情")}><button className="close" aria-label={t("关闭项目详情")} onClick={() => setDetail(null)}><X /></button><div className="eyebrow">PROJECT DETAILS</div><h2>{snapshot.project.name}</h2>{detail.saved_state && <div className="project-detail-version"><label htmlFor="project-version">{t("查看内容")}</label><select id="project-version" value={version} onChange={e => setVersion(e.target.value)}><option value="draft">{t("最新工作内容")}</option><option value="saved">{t("最近保存的版本 ·")}{date(detail.saved_at)}</option></select></div>}<div className="project-detail-summary"><span>{snapshot.completed.length}{t("/ 10 步")}</span><span>{snapshot.data.rows.length}{t("行数据")}</span><span>{snapshot.model ? t("已建立模型") : t("尚未建模")}</span></div><h4>{t("工程问题与要求")}</h4><p>{snapshot.project.question || t("尚未填写")}</p><h4>{t("目标与成功标准")}</h4><p>{snapshot.project.target || t("尚未填写")}</p><h4>{t("分析范围与约束")}</h4><p>{snapshot.project.scope || t("尚未填写范围")}<br />{snapshot.project.constraints || t("尚未填写约束")}</p><h4>{t("数据与模型")}</h4><p>{snapshot.data.label}<br />{snapshot.data.columns.join('、') || t("尚未定义数据列")}<br />{snapshot.model?.method || t("尚未建立模型")}{snapshot.model && <><br />{t("留出 RMSE：")}{snapshot.model.rmse?.toFixed(4)}</>}</p><h4>{t("负责人及实施计划")}</h4><p>{snapshot.project.owner || t("尚未指定")}<br />{snapshot.project.action || t("尚未填写")}</p><p className="project-save-note">{t("创建：")}{date(detail.created_at)}<br />{t("最近修改：")}{date(detail.updated_at)}<br />{t("最近保存：")}{date(detail.saved_at)}</p><div className="modal-actions"><button className="outline" onClick={() => setDetail(null)}>{t("关闭")}</button><button className="primary" disabled={workspace.loading || workspace.saving || locked} onClick={() => onContinue(detail.id)}>{t("继续编辑最新内容")}</button></div></section></div>}</>;
}
