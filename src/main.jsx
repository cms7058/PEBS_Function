import {accountFetch as fetch} from './account-fetch';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCircle2, ChevronRight, Database, Download, FileText, FlaskConical, FolderOpen, Layers3, Lightbulb, Loader2, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Upload, X, History } from 'lucide-react';
import Papa from 'papaparse';
import Catalog from './Catalog';
import CommercialApp, { AccountPage, AdminPage, LanguageSwitch } from './CommercialApp';
import { t, tx } from './i18n';
import ModelSettings from './ModelSettings';
import ProjectHistory from './ProjectHistory';
import ProjectGuide from './ProjectGuide';
import StageMaterials from './StageMaterials';
import { blockingCollection } from './collection-workflow';
import { MethodPicker, ModelDetails, ScenarioPanel } from './RegressionPanels';
import { methods, nonlinearSample, parameterCount } from './regression';
import { useProjectWorkspace, ProjectToolbar, VariableMapping } from './ProjectWorkspace';
import './style.css';
import './theme-overrides.css';
import './regression.css';
import './project-workspace.css';
const stages = ['业务问题识别', '约束 / 瓶颈识别', '变量 X / Y 定义', '数据获取与质量检查', '选择建模方法', '生成数学模型', '验证模型', '参数探索与仿真', '形成改善方案', '监控与模型迭代'];
const subtitles = ['从一个好问题开始，让分析有明确的方向。', '明确工序和限制，让模型贴近真实现场。', '把业务语言，转化为可以测量的变量。', '先理解数据，再解释结果。', '让问题和数据共同决定方法。', '以可复现的计算，建立变量之间的关系。', '让新数据检验模型，而不只看拟合效果。', '在已知范围内，比较每一种可能。', '把分析结论变成现场可以执行的行动。', '记录实际效果，开始下一轮改进。'];
const defaultProject = {
  name: '热处理工艺 · 产品强度分析',
  question: '分析温度、压力与保温时间对产品强度的影响，建立预测模型，寻找值得现场验证的参数组合。',
  target: '提高产品强度，控制波动；现场确认后再调整工艺。',
  scope: '热处理工序 / 同一材料批次',
  constraints: '保持当前设备和材料不变；参数不超出历史范围。',
  owner: '工艺工程师',
  action: '按候选参数开展小批量确认实验，记录材料批次与设备状态。',
  followup: ''
};
function read(k, f) {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? f;
  } catch {
    return f;
  }
}
const fmt = (n, d = 2) => Number.isFinite(n) ? n.toFixed(d) : '—';
function saveFile(name, text, type = 'text/plain') {
  const u = URL.createObjectURL(new Blob([text], {
    type
  }));
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
function sample() {
  let rows = [];
  for (let i = 0; i < 80; i++) {
    let t = 160 + i * 17 % 61,
      p = 2 + i * 7 % 21 / 10,
      m = 10 + i * 11 % 21;
    let noise = Math.sin(i * 1.71) * 1.5 + Math.cos(i * 0.47) * 0.6;
    rows.push([t, p, m, Number((18 + 0.24 * t + 3.1 * p + 0.65 * m + noise).toFixed(2))]);
  }
  return {
    columns: ['温度 °C', '压力 MPa', '保温时间 min', '强度 MPa'],
    rows,
    label: '模拟工艺数据 · 80 条',
    issues: [],
    synthetic: true
  };
}
function Plot({
  model,
  residual = false
}) {
  if (!model) return null;
  const pts = model.points;
  const ys = pts.map(p => residual ? p.residual : p.predicted);
  const xs = pts.map(p => residual ? p.predicted : p.actual);
  const minx = Math.min(...xs),
    maxx = Math.max(...xs);
  const miny = residual ? Math.min(...ys, -1) : Math.min(...xs, ...ys);
  const maxy = residual ? Math.max(...ys, 1) : Math.max(...xs, ...ys);
  const xx = x => 48 + (x - minx) / (maxx - minx || 1) * 440;
  const yy = y => 210 - (y - miny) / (maxy - miny || 1) * 165;
  return <svg viewBox="0 0 530 260" className="plot" role="img" aria-label={residual ? t("预测值与残差散点图") : t("实际值与预测值散点图")}>{Array.from({
      length: 5
    }, (_, i) => {
      let v = miny + (maxy - miny) * i / 4;
      return <g key={i}><line x1="48" x2="488" y1={yy(v)} y2={yy(v)} stroke="#e6ece9" /><text x="39" y={yy(v) + 4} textAnchor="end">{fmt(v, 1)}</text></g>;
    })}{[0, 1, 2, 3, 4].map(i => <text key={i} x={48 + i * 110} y="234" textAnchor="middle">{fmt(minx + (maxx - minx) * i / 4, 1)}</text>)}{residual ? <line x1="48" x2="488" y1={yy(0)} y2={yy(0)} stroke="#acb9b4" strokeDasharray="5 4" /> : <line x1={xx(minx)} y1={yy(minx)} x2={xx(maxx)} y2={yy(maxx)} stroke="#acb9b4" strokeDasharray="5 4" />}{pts.map((p, i) => <circle key={i} cx={xx(xs[i])} cy={yy(ys[i])} r={p.holdout ? 4 : 3} fill={p.holdout ? '#96bbd4' : '#438fbf'} opacity={p.holdout ? 1 : .55}><title>{`实际 ${fmt(p.actual)} · 预测 ${fmt(p.predicted)}`}</title></circle>)}<text x="260" y="257" textAnchor="middle">{residual ? t("预测值") : t("实际值")} / {model.response}</text></svg>;
}
function App({
  user,
  locale,
  logout,
  refreshUser,
  pendingPlan,
  setPendingPlan
}) {
  const workspaceState = useProjectWorkspace(() => ({
    project: {
      name: tx('我的工程项目', 'My engineering project'),
      question: '',
      target: '',
      scope: '',
      constraints: '',
      owner: '',
      action: '',
      followup: '',
      plannedY: '',
      plannedXs: ''
    },
    stage: 1,
    completed: [],
    data: {
      columns: [],
      rows: [],
      label: tx('尚未上传项目数据', 'No project data uploaded'),
      issues: [],
      synthetic: false
    },
    xs: [],
    y: null,
    model: null,
    method: 'linear',
    scenario: {},
    mode: 'real'
  }), user.id);
  const {
    stage,
    completed,
    project,
    data,
    xs,
    y,
    model,
    method,
    scenario,
    mode
  } = workspaceState.state;
  const setStage = v => workspaceState.setField('stage', v),
    setCompleted = v => workspaceState.setField('completed', v),
    setProject = v => workspaceState.setField('project', v),
    setData = v => workspaceState.setField('data', v),
    setXs = v => workspaceState.setField('xs', v),
    setY = v => workspaceState.setField('y', v),
    setModel = v => workspaceState.setField('model', v),
    setMethod = v => workspaceState.setField('method', v),
    setScenario = v => workspaceState.setField('scenario', v);
  const [view, setView] = useState(() => ['library', 'skills', 'settings', 'reports', 'history', 'account', 'admin'].includes(new URLSearchParams(location.search).get('view')) ? ['settings', 'admin'].includes(new URLSearchParams(location.search).get('view')) && user.role !== 'admin' ? 'project' : new URLSearchParams(location.search).get('view') : pendingPlan ? 'account' : 'project'),
    [library, setLibrary] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(''),
    [results, setResults] = useState(null),
    [skill, setSkill] = useState(null),
    [published, setPublished] = useState(() => read('published', [])),
    [toast, setToast] = useState(''),
    [healthy, setHealthy] = useState(false);
  const hasColumns = data.columns.length >= 2;
  const mapped = hasColumns && Number.isInteger(y) && y >= 0 && y < data.columns.length && xs.length > 0 && xs.every(x => Number.isInteger(x) && x >= 0 && x < data.columns.length && x !== y);
  const dataReady = data.rows.length >= 15 && data.issues.length === 0 && (mode === 'demo' || data.synthetic === false);
  const plannedXs = (project.plannedXs || '').split(/[\n,，;；]+/).map(s => s.trim()).filter(Boolean);
  const planned = !!project.plannedY?.trim() && plannedXs.length > 0 && plannedXs.length <= 6 && !plannedXs.includes(project.plannedY.trim()) && new Set(plannedXs).size === plannedXs.length;
  const firstIncomplete = Array.from({
    length: 10
  }, (_, i) => i + 1).find(n => !completed.includes(n)) || 10;
  const collectionBlock = blockingCollection(workspaceState.state);
  const maxAllowed = collectionBlock === null ? Math.max(stage, firstIncomplete) : Math.min(Math.max(stage, firstIncomplete), collectionBlock);
  const mappingProps = {
    data,
    xs,
    y,
    onY: value => {
      setY(value);
      setXs(a => a.filter(x => x !== value));
      invalidate();
    },
    onX: i => {
      setXs(a => a.includes(i) ? a.filter(x => x !== i) : [...a, i].slice(0, 6));
      invalidate();
    }
  };
  useEffect(() => {
    fetch('/api/health').then(r => r.json()).then(h => {
      setHealthy(h.status === 'ok');
    }).catch(() => setError('无法连接 Rust 后端，请运行启动脚本。'));
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('published', JSON.stringify(published));
    } catch {}
  }, [published]);
  useEffect(() => {
    setError('');
    setToast('');
  }, [workspaceState.id]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 3500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const update = (key, value) => setProject(p => ({
    ...p,
    [key]: value
  }));
  function changeMethod(value) {
    setMethod(value);
    setModel(null);
    setScenario({});
    setCompleted(c => c.filter(n => n < 5));
    setError('');
  }
  function loadExample(kind) {
    if (mode !== 'demo') {
      setError('实际工程项目请上传自己的 CSV；模拟数据只用于演示项目。');
      return;
    }
    setData(kind === 'linear' ? sample() : nonlinearSample(kind));
    setXs([0, 1, 2]);
    setY(3);
    invalidate();
    setMethod(kind);
    setError('');
    setToast('已载入' + (methods.find(m => m.id === kind)?.name || '') + '示例，可前往第 5 步选择方法');
  }
  function invalidate() {
    setModel(null);
    setScenario({});
    setCompleted(c => c.filter(n => n < 3));
  }
  function upload(file) {
    if (!file) return;
    setBusy(true);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: r => {
        setBusy(false);
        const cols = r.meta.fields || [];
        if (cols.length < 2 || r.errors.length) {
          setError('CSV 需有唯一列名和一致列数；请检查文件格式。');
          return;
        }
        if (r.data.length > 20000) {
          setError('每个项目最多支持 20,000 行。');
          return;
        }
        let bad = 0;
        let rows = r.data.map(row => cols.map(c => {
          const value = String(row[c] ?? '').trim();
          if (value === '' || !Number.isFinite(Number(value))) {
            bad++;
            return null;
          }
          return Number(value);
        }));
        setData({
          columns: cols,
          rows,
          label: file.name,
          issues: bad ? [`${bad} 个空白或非数值单元格，请修正 CSV 后重新导入。`] : [],
          synthetic: false
        });
        setXs(cols.slice(0, -1).map((_, i) => i).slice(0, 6));
        setY(cols.length - 1);
        invalidate();
        setError('');
        setProject(p => ({
          ...p,
          plannedY: p.plannedY || cols[cols.length - 1],
          plannedXs: p.plannedXs || cols.slice(0, -1).slice(0, 6).join('\n')
        }));
        setToast('CSV 已导入当前工程项目，请确认下方 X / Y 列映射');
      },
      error: () => {
        setBusy(false);
        setError('无法读取 CSV 文件。');
      }
    });
  }
  async function analyze() {
    if (!dataReady || !mapped) {
      setError('请先上传本项目的数据并确认 X / Y 列映射，再运行建模。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          columns: data.columns,
          rows: data.rows,
          x: xs,
          y,
          method
        })
      });
      const out = await r.json();
      if (!r.ok) throw Error(out.error || '计算失败');
      setModel(out);
      setScenario({});
      setCompleted(c => c.filter(n => n < 6));
      setToast('模型拟合与留出集验证已完成');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function search(e) {
    e?.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    try {
      const r = await fetch('/api/search?q=' + encodeURIComponent(query));
      if (!r.ok) throw Error();
      setResults(await r.json());
    } catch {
      setError('知识检索失败，请确认后端已启动。');
    } finally {
      setBusy(false);
    }
  }
  const related = library?.skills.filter(s => s.stages.includes(stage)) || [];
  const gate = workspaceState.loading || busy || collectionBlock !== null || (stage === 1 ? !project.name.trim() || !project.question.trim() || !project.target.trim() : stage === 2 ? !project.scope.trim() || !project.constraints.trim() : stage === 3 ? hasColumns ? !mapped : !planned : stage === 4 ? !dataReady || !mapped : stage === 5 ? !dataReady || !mapped || Math.floor(data.rows.length * .8) < parameterCount(method, xs.length) * 3 : stage === 6 || stage === 7 || stage === 8 ? !model || !dataReady || !mapped : stage === 9 ? !project.owner.trim() || !project.action.trim() : stage === 10 ? !project.followup.trim() : false);
  function next() {
    if (gate) {
      setError(collectionBlock !== null ? `第${collectionBlock}步采集资料尚未检查通过，请修正并重新检查全部表格。` : '请先完成本阶段的必要输入。');
      return;
    }
    setCompleted(c => [...new Set([...c, ...(stage === 4 ? [3] : []), stage])]);
    setStage(s => Math.min(10, s + 1));
    setError('');
    if (stage === 10) setToast('本轮现场记录已保存，尚未自动验证改善效果。');
  }
  const exportReport = () => {
    saveFile('工程分析报告.md', `# ${project.name}\n\n${data.synthetic ? '> 本报告使用模拟数据，仅供演示。' : ''}\n\n## 问题\n${project.question}\n\n## 目标\n${project.target}\n\n## 分析范围\n${project.scope}\n\n## 数据\n${data.label}，${data.rows.length} 行\n\n## 模型\n${model ? `方法：${model.method}\n响应：${model.response}\n公式：${model.formula || '线性模型'}\n模型项：${JSON.stringify(model.terms || [], null, 2)}\n因素与标准化：${JSON.stringify(model.factors, null, 2)}\n求解信息：${JSON.stringify(model.solver || {})}\n训练 RMSE：${model.train_rmse ?? '未记录'}\n留出 RMSE：${model.rmse}\n基线 RMSE：${model.baseline_rmse}\n验证状态：${model.status}\n${model.notice}` : '尚未建模'}\n\n## 应用计划\n${project.action}\n负责人：${project.owner}\n\n## 现场反馈\n${project.followup || '尚未填写'}\n\n## 来源\nNIST/SEMATECH Engineering Statistics Handbook，2012 PDF；${library?.skills.map(s => `${s.name}：PDF 第 ${s.source.page} 页，${s.source.url}`).join('\n')}\n\n流程模板由 Demo 人工整理，不代表已完成专家审核。`);
    setToast('报告已导出');
  };
  const projectView = <><div className="page-heading"><div><div className="eyebrow">ENGINEERING WORKSPACE <span>/ {mode === 'demo' ? t("示例工程") : t("实际工程")}</span></div><h1>{t("让数据，回答工程问题")}<span className="green-dot" /></h1><p>{t("以 NIST 工程统计手册为依据，从问题定义走向可验证的改善。")}</p></div><button className="outline" onClick={exportReport}><Download size={16} />{t("导出报告")}</button></div><ProjectToolbar workspace={workspaceState} locked={busy} onHistory={() => setView('history')} /><div className="project-banner"><div className="project-icon"><FlaskConical size={23} /></div><div><strong>{project.name}</strong><p><span className="pill amber">{mode === 'demo' ? t("演示项目") : data.rows.length ? t("项目 CSV 数据") : t("实际项目 · 待上传数据")}</span><span>{t("连续响应建模")}</span><span>{t(workspaceState.status)}</span></p></div><div className="banner-progress"><span>{t("流程记录")}<b>{completed.length} / 10</b></span><div className="progress"><i style={{
            width: completed.length * 10 + '%'
          }} /></div></div></div><div className="workspace"><aside className="steps-panel"><div className="section-label">{t("分析路径")}<span>10 STEPS</span></div>{stages.map((s, i) => <button key={s} className={'step ' + (stage === i + 1 ? 'active' : '')} disabled={workspaceState.loading || mode === 'real' && i + 1 > maxAllowed} onClick={() => {
          setStage(i + 1);
          setError('');
        }}><span className={'step-num ' + (completed.includes(i + 1) ? 'done' : '')}>{completed.includes(i + 1) ? <Check size={13} /> : String(i + 1).padStart(2, '0')}</span><span>{t(s)}</span>{stage === i + 1 && <ChevronRight size={14} />}</button>)}<div className="path-note"><ShieldCheck size={18} /><p>{t("每一步都有依据")}<br /><small>{t("支持回退与迭代")}</small></p></div></aside><main className="stage-card"><div className="stage-top"><span className="pill teal">STEP {String(stage).padStart(2, '0')}</span><span className="muted">{stage <= 2 ? t("业务输入") : stage <= 5 ? t("分析准备") : stage <= 8 ? t("模型分析") : t("落地应用")}</span></div><h2>{t(stages[stage - 1])}</h2><p className="intro">{t(subtitles[stage - 1])}</p>{error && <div className="error" role="alert">{t(error)}</div>}{stage === 1 && <><Field label={t("项目名称")} value={project.name} onChange={v => update('name', v)} /><Field label={t("你希望解决什么问题？")} hint={t("描述现象、影响，以及想弄清楚的关系。")} value={project.question} onChange={v => update('question', v)} multiline /><Field label={t("目标与成功标准")} value={project.target} onChange={v => update('target', v)} multiline /><div className="info"><Lightbulb size={18} /><p>{t("好问题包含可测量的结果。例如：在相同材料与设备条件下，哪些工艺参数与强度变化有关？")}</p></div></>}{stage === 2 && <><Field label={t("分析对象与工序范围")} value={project.scope} onChange={v => update('scope', v)} /><Field label={t("资源限制与瓶颈假设")} multiline value={project.constraints} onChange={v => update('constraints', v)} />{mode === 'demo' && <div className="mini-flow"><span>{t("原料")}</span><ArrowRight size={15} /><span className="selected">{t("热处理工序")}</span><ArrowRight size={15} /><span>{t("质量检测")}</span></div>}<div className="info"><Lightbulb size={18} /><p>{t("根据本项目的现场流程确定瓶颈，并填写待验证的证据与假设。")}</p></div></>}{stage === 3 && <>{hasColumns ? <VariableMapping {...mappingProps} /> : <div className="project-variable-plan"><Field label={t("计划测量的结果变量 Y")} value={project.plannedY || ''} onChange={v => update('plannedY', v)} placeholder={t("例如：产品强度 MPa")} /><Field label={t("候选影响因素 X")} hint={t("每行一个变量，保留单位，最多 6 个。")} multiline value={project.plannedXs || ''} onChange={v => update('plannedXs', v)} placeholder={t("例如：温度 °C\\n压力 MPa\\n保温时间 min")} /><div className="info"><p>{t("先定义需要采集的变量，下一步上传数据。CSV 列名建议与这里一致；上传后需确认结果列与因素列。")}</p></div></div>}<div className="info"><Settings2 size={18} /><p>{t("输入列名中保留单位。将编号、时间戳和文本列从用于建模的 CSV 中移除。")}</p></div></>}{stage === 4 && <>{!data.rows.length && <div className="project-need-data"><h3>{t("本项目还没有数据")}</h3><p>{t("工程要求已保存。请按前一步定义的变量采集数据并上传 CSV，才能继续建模。")}</p></div>}<label className="dropzone"><Upload size={24} /><strong>{t("导入你的工艺数据")}</strong><span>{t("CSV · 首行为列名 · 数值型 X / Y · 最多 20,000 行")}</span><input aria-label={t("上传项目 CSV")} disabled={busy} type="file" accept=".csv,text/csv" onChange={e => upload(e.target.files[0])} /></label><div className="data-actions"><span>{data.label}</span>{mode === 'demo' && <select aria-label={t("选择模拟数据")} value="" onChange={e => loadExample(e.target.value)}><option value="" disabled>{t("载入模拟数据")}</option><option value="linear">{t("线性示例")}</option><option value="quadratic">{t("二次响应面示例")}</option><option value="exponential">{t("指数示例")}</option><option value="power">{t("幂函数示例")}</option></select>}<button className="text-button" disabled={!data.rows.length} onClick={() => saveFile(t("项目数据.csv"), '\uFEFF' + Papa.unparse({
              fields: data.columns,
              data: data.rows
            }), 'text/csv')}>{t("下载当前数据")}</button></div><div className="stats-row"><Stat label={t("样本数")} value={data.rows.length} /><Stat label={t("变量数")} value={data.columns.length} /><Stat label={t("数据检查")} value={!data.rows.length ? t("待上传") : data.issues.length ? t("待修正") : t("待确认映射")} /></div>{data.issues.map(s => <div className="error" key={s}>{s}</div>)}<div className="table-wrap"><table><thead><tr>{data.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead><tbody>{data.rows.slice(0, 5).map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v ?? t("缺失")}</td>)}</tr>)}</tbody></table></div><p className="footnote">{t("预览前 5 行。通过格式检查不代表测量可靠；本版不自动删除异常值。")}</p>{hasColumns && <div className="data-mapping"><h3>{t("确认本项目的数据列映射")}</h3><VariableMapping {...mappingProps} /></div>}</>}{stage === 5 && <MethodPicker method={method} onChange={changeMethod} k={xs.length} n={data.rows.length} />}{stage === 6 && <><div className="run-panel"><div className="formula regression-formula">{methods.find(m => m.id === method)?.formula}</div><p>{methods.find(m => m.id === method)?.name} · {data.rows.length}{t("条数据 /")}{xs.length}{t("个因素")}</p><button className="primary" onClick={analyze} disabled={busy || !dataReady || !mapped}>{busy ? <Loader2 className="spin" size={17} /> : <Activity size={17} />} {busy ? t("正在计算…") : model ? t("重新计算模型") : t("运行建模分析")}</button></div>{model && <><div className="stats-row"><Stat label={t("训练样本")} value={model.train} /><Stat label={t("验证样本")} value={model.test} /><Stat label={t("留出 RMSE")} value={fmt(model.rmse)} /></div><ModelDetails model={model} /></>}</>}{stage === 7 && (model ? <><p className="footnote">{model.method}</p><div className="stats-row"><Stat label={t("训练 RMSE")} value={fmt(model.train_rmse)} /><Stat label={t("模型 RMSE")} value={fmt(model.rmse)} /><Stat label={t("均值基线 RMSE")} value={fmt(model.baseline_rmse)} /><Stat label={t("留出 R²*")} value={fmt(model.r2, 3)} /></div><div className="chart-title"><strong>{t("预测是否接近实际？")}</strong><span><i className="legend-dot" />{t("训练")}<i className="legend-dot gold" />{t("留出")}</span></div><Plot model={model} /><details><summary>{t("查看残差诊断图")}</summary><Plot model={model} residual /></details><div className="info"><ShieldCheck size={18} /><p><strong>{model.status}</strong><br />{t("*R² 相对训练均值基线。单次留出误差不足以证明可上线；仍需检查残差、采样独立性与现场适用性。反复用同一留出集比较模型后，请用新的独立数据确认。")}</p></div></> : <Empty onClick={() => setStage(6)} />)}{stage === 8 && (model ? <ScenarioPanel model={model} scenario={scenario} onChange={setScenario} /> : <Empty onClick={() => setStage(6)} />)}{stage === 9 && <><Field label={t("改善／确认实验计划")} multiline value={project.action} onChange={v => update('action', v)} /><Field label={t("负责人")} value={project.owner} onChange={v => update('owner', v)} /><div className="info"><ShieldCheck size={18} /><p>{t("建议记录对照条件、批次、重复次数和验收标准。模型未通过验证时，本阶段用于安排补充实验。")}</p></div></>}{stage === 10 && <><div className="method-card"><Activity size={22} /><div><h3>{t("现场验证记录")}</h3><p>{t("本版使用手动记录，未接入实时设备数据。")}</p></div></div><Field label={t("实际结果与下一步")} multiline value={project.followup} onChange={v => update('followup', v)} placeholder={t("填写实际强度、批次、异常、是否达到目标以及后续采集计划…")} /><button className="outline" onClick={() => {
            setStage(4);
            setToast(t("上传新数据后请重新建模；原结果可先导出留档。"));
          }}><Upload size={16} />{t("返回数据阶段，开始下一轮")}</button></>}<StageMaterials key={workspaceState.id + ":" + stage} workspace={workspaceState} stage={stage} locked={busy} /><footer className="stage-footer">{collectionBlock !== null && <p className="collection-gate-note" role="status">{t("第")}{collectionBlock}{t("步采集资料须检查通过，才能继续。")}</p>}<span>{completed.includes(stage) ? t("✓ 已记录完成") : stage === 4 && !dataReady ? t("请上传至少 15 行完整数据") : workspaceState.status}</span><button className="primary" disabled={gate} onClick={next}>{stage === 10 ? t("保存本轮记录") : t("完成并继续")}<ArrowRight size={16} /></button></footer></main><ProjectGuide key={workspaceState.id + ':' + stage} workspace={workspaceState} stage={stage} /></div></>;
  return <div className="app"><aside className="sidebar"><div className="brand"><div><img className="brand-icon" src="/brand/pebs-icon.png" alt={t("PEBS 图标")} width="42" height="42" /></div><span>PEBS<small>MODEL LAB</small></span></div><div className="workspace-label">{t("工程分析空间")}</div><nav>{[['project', Layers3, t("分析工作台")], ['library', BookOpen, user.role === 'admin' ? t("知识资料库") : t("我的书籍")], ['skills', FlaskConical, user.role === 'admin' ? t("Skill技能") : t("我的技能")], ['reports', FileText, t("项目报告")], ['history', History, t("历史项目")], ['account', ShieldCheck, t("我的账户")], ...(user.role === 'admin' ? [['admin', ShieldCheck, t("用户与收费管理")], ['settings', Settings2, t("模型配置")]] : [])].map(([id, Icon, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => {
          setView(id);
          setError('');
        }}><Icon size={19} />{t(label)}</button>)}</nav><div className="sidebar-note"><div className="tiny-label">YOUR METHOD, TRACEABLE.</div><p>{t("从知识到方法")}<br />{t("从数据到行动")}</p><div className="book-cover"><span>ASQ</span><small>ENGINEERING<br />STATISTICS<br />HANDBOOK</small><i>2012 EDITION</i></div></div><div className="sidebar-bottom"><span className={'status-dot ' + (healthy ? '' : 'offline')} /><span>{healthy ? t("Rust API 已连接") : t("API 连接中")}</span><small>{t("本机工程空间")}</small></div></aside><div className="shell"><header className="topbar"><div><button type="button" className="workspace-home" title={t("返回分析工作台")} onClick={() => {
            setView('project');
            setError('');
          }}><FolderOpen size={16} />{t("我的空间")}</button><ChevronRight size={13} /><span>{view === 'project' ? t("工程建模") : view === 'library' ? user.role === 'admin' ? t("知识资料库") : t("我的书籍") : view === 'skills' ? user.role === 'admin' ? t("Skill技能") : t("我的技能") : view === 'settings' ? t("模型配置") : view === 'history' ? t("历史项目") : view === 'account' ? t("我的账户") : view === 'admin' ? t("用户与收费管理") : t("分析报告")}</span></div><div className="account-actions"><LanguageSwitch authenticated /><button onClick={() => setView('account')} className="account-name">{user.name} · {user.tier === 'ultra' ? 'Ultra' : user.tier} · {user.credits} {tx(t("额度"), 'credits')}</button><button onClick={async () => {
            try {
              await workspaceState.flush();
            } finally {
              await logout();
            }
          }}>{tx(t("退出"), 'Sign out')}</button></div></header><div className="content">{view === 'account' ? <AccountPage user={user} refreshUser={refreshUser} pendingPlan={pendingPlan} setPendingPlan={setPendingPlan} /> : view === 'admin' && user.role === 'admin' ? <AdminPage /> : workspaceState.loading && view === 'project' ? <p role="status">{t("正在加载工程项目…")}</p> : view === 'history' ? <ProjectHistory workspace={workspaceState} locked={busy} onContinue={async id => {
          if (!busy && (await workspaceState.select(id))) setView('project');
        }} /> : view === 'settings' && user.role === 'admin' ? <ModelSettings /> : view === 'project' ? projectView : view === 'library' || view === 'skills' ? <Catalog view={view} personal={user.role !== 'admin'} /> : <><PageHeading eyebrow="PROJECT REPORT" title={t("每个结论，都有来处")} text={t("导出项目输入、计算结果、限制与现场记录，作为讨论和验证的起点。")} /><div className="report-card"><span className="pill teal">PROJECT 001</span><h2>{project.name}</h2><p>{project.question}</p><div className="stats-row"><Stat label={t("流程记录")} value={completed.length + ' / 10'} /><Stat label={t("数据来源")} value={data.synthetic ? t("模拟数据") : t("用户 CSV")} /><Stat label={t("模型状态")} value={model ? model.status : t("未计算")} /></div>{model && <Plot model={model} />}<button className="primary" onClick={exportReport}><Download size={16} />{t("导出 Markdown 报告")}</button></div></>}</div><div className="bottomline">PEBS MODEL LAB <span>{t("基于 NIST 方法 · 工程项目 · 结果需结合工程判断")}</span></div></div>{toast && <div className="toast" role="status"><CheckCircle2 size={18} />{toast}</div>}{skill && <div className="modal-overlay" onClick={() => setSkill(null)}><section className="modal" role="dialog" aria-modal="true" aria-label={skill.name} onClick={e => e.stopPropagation()}><button className="close" aria-label={t("关闭")} onClick={() => setSkill(null)}><X /></button><div className="eyebrow">METHOD CARD / {skill.id.toUpperCase()}</div><h2>{skill.name}</h2><p>{skill.description}</p><h4>{t("所需输入")}</h4><ul>{skill.inputs.map(t => <li key={t}>{t}</li>)}</ul><h4>{t("执行步骤")}</h4><ol>{skill.steps.map(t => <li key={t}>{t}</li>)}</ol><h4>{t("阶段产物")}</h4><p>{skill.outputs.join(' · ')}</p><div className="info"><BookOpen size={18} /><p>{skill.note}<br /><a href={'/reader.html?book=nist&page=' + skill.source.page}>{t("核对 PDF 第")}{skill.source.page}{t("页 ↗")}</a></p></div><div className="modal-actions"><button className="outline" onClick={() => saveFile(skill.id + '-SKILL.md', `---\nname: ${skill.id}\ndescription: ${skill.description}\n---\n# ${skill.name}\n\n## 输入\n${skill.inputs.map(t => '- ' + t).join('\n')}\n\n## 步骤\n${skill.steps.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\n## 输出\n${skill.outputs.join('\n')}\n\n## 来源与限制\n${skill.source.url}\nPDF 第 ${skill.source.page} 页\n${skill.note}\n`)}><Download size={16} />{t("导出 SKILL.md")}</button><button className="primary" onClick={() => {
            setPublished(p => [...new Set([...p, skill.id])]);
            setToast(t("已保存演示审核标记"));
            setSkill(null);
          }}>{t("标记已审核")}<Check size={16} /></button></div></section></div>}</div>;
}
function Field({
  label,
  hint,
  value,
  onChange,
  multiline,
  placeholder
}) {
  return <div className="field"><label>{label}</label>{hint && <p>{hint}</p>}{multiline ? <textarea aria-label={label} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} /> : <input aria-label={label} value={value} onChange={e => onChange(e.target.value)} />}</div>;
}
function Stat({
  label,
  value
}) {
  return <div className="stat"><span>{label}</span><strong>{value}</strong></div>;
}
function Empty({
  onClick
}) {
  return <div className="empty"><Activity size={30} /><h3>{t("先建立一个模型")}</h3><p>{t("完成计算后即可查看验证结果和参数情景。")}</p><button className="primary" onClick={onClick}>{t("前往第 6 层")}<ArrowRight size={16} /></button></div>;
}
function PageHeading({
  eyebrow,
  title,
  text
}) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{text}</p></div></div>;
}
createRoot(document.getElementById('root')).render(<CommercialApp Workbench={App} />);
