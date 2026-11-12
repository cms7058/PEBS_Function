import {accountFetch as fetch} from './account-fetch';
import { t } from './i18n';
import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Sparkles, X } from 'lucide-react';
import Papa from 'papaparse';
import { fieldLabels, variableLabel, simulate, applyMaterial, simulationProject, descriptive, validateVariables } from './stage-materials';
import './stage-materials.css';
import CollectionWorkflow from './CollectionWorkflow';
function download(name, columns, rows) {
  const clean = v => typeof v === 'string' && (/^[=+@\t\r]/.test(v) || /^[-]/.test(v) && !Number.isFinite(Number(v))) ? "'" + v : v;
  const url = URL.createObjectURL(new Blob(['\uFEFF' + Papa.unparse({
    fields: columns.map(clean),
    data: rows.map(r => r.map(clean))
  })], {
    type: 'text/csv;charset=utf-8'
  }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Table({
  columns,
  rows,
  onChange
}) {
  return <div className="table-wrap"><table><thead><tr>{columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{onChange ? <input aria-label={`采集表第${i + 1}行 ${columns[j]}`} value={v} onChange={e => onChange(i, j, e.target.value)} /> : typeof v === 'number' ? Number(v.toPrecision(6)) : v}</td>)}</tr>)}</tbody></table></div>;
}
export default function StageMaterials({
  workspace,
  stage,
  locked
}) {
  const guide = workspace.state.guidance?.[stage],
    material = workspace.state.materials?.[stage];
  const [open, setOpen] = useState(false),
    [preview, setPreview] = useState(null),
    [selected, setSelected] = useState([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const signature = () => JSON.stringify([workspace.state.project, workspace.state.data.columns, workspace.state.data.rows.length, workspace.state.xs, workspace.state.y, workspace.state.method, workspace.state.model, guide?.created_at, guide?.access, guide?.access_stale]);
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);
  async function prepare() {
    if (guide?.access_stale) {
      setError('会员等级或角色已变化，请先更新流程助手建议。');
      return;
    }
    const sourceSignature = signature();
    setOpen(true);
    setError('');
    setBusy(true);
    setPreview(null);
    setNotice('');
    const {
      project,
      data,
      xs,
      y,
      method,
      model
    } = workspace.state;
    try {
      const r = await fetch('/api/project-materials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          context: {
            stage,
            project,
            data: {
              columns: data.columns,
              rows: data.rows.length,
              synthetic: data.synthetic
            },
            variables: {
              xs: xs.map(i => data.columns[i]),
              y: data.columns[y] || project.plannedY
            },
            method,
            model: model ? {
              method: model.method,
              rmse: model.rmse,
              status: model.status
            } : null
          },
          guide
        })
      });
      const result = await r.json().catch(() => null);
      if (!r.ok || !result) throw Error(result?.error || '资料生成服务暂时不可用');
      if (!alive.current) return;
      setPreview({
        ...result,
        guide_created_at: guide.created_at,
        context_signature: sourceSignature
      });
      setSelected(result.fields.filter(f => f.value.trim()).map(f => f.key));
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function editVariable(i, key, value) {
    setPreview(p => {
      const old = variableLabel(p.variables[i]),
        next = {
          ...p.variables[i],
          [key]: value
        };
      return {
        ...p,
        variables: p.variables.map((v, j) => j === i ? next : v),
        collection_headers: p.collection_headers.map(h => h === old ? variableLabel(next) : h)
      };
    });
  }
  function commit() {
    try {
      if (preview.context_signature !== signature()) throw Error('工程内容或助手建议已变化，请重新生成导入预览。');
      if (preview.collection_headers.length > 40) throw Error('采集表最多40列。');
      if (preview.variables.length) validateVariables(preview.variables);
      const next = applyMaterial(workspace.state, stage, preview, selected);
      if (!next.project.name.trim() || next.project.name.length > 200) throw Error('项目名称须为1–200个字符。');
      workspace.patchState(() => next);
      setOpen(false);
      setNotice('已导入本阶段资料。更改输入后需重新完成受影响的步骤。');
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }
  function patchMaterial(change) {
    workspace.setField('materials', old => ({
      ...old,
      [stage]: {
        ...old[stage],
        ...change
      }
    }));
  }
  function makeSimulation() {
    try {
      patchMaterial({
        simulation: simulate(material.variables)
      });
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }
  async function tryModel() {
    setBusy(true);
    setError('');
    try {
      const state = simulationProject(workspace.state, material.simulation, workspace.id);
      await workspace.create({
        name: state.project.name,
        state
      });
    } catch (e) {
      setError(e.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return <section className="stage-materials"><div className="materials-heading"><h3>{t("本阶段资料")}</h3><button className="outline" disabled={locked || busy || !guide?.answer || guide?.access_stale} onClick={prepare}><Sparkles size={15} />{busy ? t("正在生成…") : t("导入助手建议")}</button></div><p className="footnote">{t("将本阶段建议整理为可编辑字段和资料表，预览确认后导入。")}{!guide?.answer && t(" 请先在右侧生成助手建议。")}</p>{notice && <p role="status" className="info">{notice}</p>}{error && !open && <div className="error" role="alert">{error}</div>}{material && <><p>{material.summary}</p>{guide?.created_at !== material.guide_created_at && <p className="info">{t("助手建议已更新，当前资料来自此前的建议，可重新导入。")}</p>}<details><summary>{t("填写与分析说明")}</summary><ul>{material.instructions.map((t, i) => <li key={i}>{t}</li>)}</ul>{material.variables.map((v, i) => <p key={i}>{v.role}：{variableLabel(v)} · {v.definition}</p>)}</details><CollectionWorkflow workspace={workspace} stage={stage} locked={locked || busy} download={download} /><h4>{t("数据分析工作表")}</h4><Table columns={[t("分析事项"), t("建议方法"), t("所需资料"), t("判断方式"), t("实际结果"), t("备注")]} rows={material.analysis_rows || material.analysis_plan.map(v => [v.item, v.method, v.required, v.decision, '', ''])} onChange={(i, j, value) => patchMaterial({
        analysis_rows: (material.analysis_rows || material.analysis_plan.map(v => [v.item, v.method, v.required, v.decision, '', ''])).map((row, k) => k === i ? row.map((v, n) => n === j ? value : v) : row)
      })} /><button className="outline" onClick={() => download(`第${stage}步-分析工作表.csv`, [t("分析事项"), t("建议方法"), t("所需资料"), t("判断方式"), t("实际结果"), t("备注")], material.analysis_rows || material.analysis_plan.map(v => [v.item, v.method, v.required, v.decision, '', '']))}><Download size={14} />{t("下载分析表")}</button><div className="simulation-box"><h4>{t("模拟数据预览")}</h4><p>{t("使用人为设定范围和教学关系，仅用于快速查看。不会替换当前工程的真实数据或证明改善有效。")}</p><button className="outline" disabled={busy || !material.variables.length} onClick={makeSimulation}>{t("生成模拟数据")}</button>{!material.variables.length && <p>{t("本阶段未定义连续型 X / Y，请先补充变量后重新导入。")}</p>}{material.simulation && <><p className="pill">{t("模拟数据 · 非现场测量")}</p><p>{material.simulation.simulation_rule}</p><Table columns={material.simulation.columns} rows={material.simulation.rows.slice(0, 5)} /><p className="footnote">{t("共100行，预览前5行。")}</p><h4>{t("模拟数据描述统计")}</h4><Table columns={[t("变量"), t("数量"), t("最小值"), t("最大值"), t("均值"), t("样本标准差")]} rows={descriptive(material.simulation)} /><div className="materials-actions"><button className="outline" onClick={() => download(t("模拟数据-非现场测量.csv"), material.simulation.columns, material.simulation.rows)}>{t("下载模拟数据")}</button><button className="outline" onClick={() => download(t("模拟描述统计.csv"), [t("变量"), t("数量"), t("最小值"), t("最大值"), t("均值"), t("样本标准差")], descriptive(material.simulation))}>{t("下载模拟分析表")}</button><button className="primary" disabled={busy || locked} onClick={tryModel}>{t("新建模拟预览项目")}</button></div><p className="footnote">{t("单独建立演示项目，从第4步开始，可继续选择方法、拟合与查看图表。当前真实工程保留。")}</p></>}</div></>}{open && <div className="modal-overlay"><section className="modal material-modal" role="dialog" aria-modal="true" aria-label={t("导入助手建议预览")}><button className="close" aria-label={t("关闭导入预览")} disabled={busy} onClick={() => setOpen(false)}><X /></button><h2>{t("导入助手建议 · 第")}{stage}{t("步")}</h2>{busy && <p role="status"><Loader2 size={18} className="spin" />{t("正在整理字段与资料表…")}</p>}{error && <div role="alert" className="error">{error}</div>}{preview && <><p>{preview.summary}</p><p className="info">{t("选中的字段会替换当前值；已有表格将被本次资料替换。取消不修改项目。下列模拟范围是教学假设，需核对，不能用于现场设定。")}</p>{preview.fields.filter(f => stage !== 3).map((f, i) => <div className="field" key={f.key}><label><input type="checkbox" checked={selected.includes(f.key)} onChange={e => setSelected(s => e.target.checked ? [...s, f.key] : s.filter(k => k !== f.key))} />{fieldLabels[f.key]}{t("（当前：")}{workspace.state.project[f.key] || t("未填写")}）</label><textarea aria-label={`导入${fieldLabels[f.key]}`} value={f.value} onChange={e => setPreview(p => ({
              ...p,
              fields: p.fields.map(v => v.key === f.key ? {
                ...v,
                value: e.target.value
              } : v)
            }))} /></div>)}<h4>{stage === 3 ? t("确认变量（导入后填写 X / Y 定义）") : t("采集变量与模拟范围")}</h4>{stage === 3 && <p className="footnote">{t("当前 Y：")}{workspace.state.project.plannedY || t("未填写")}{t("；当前 X：")}{workspace.state.project.plannedXs || t("未填写")}{t("。已有 CSV 不会被修改；列名完全一致时同步映射，否则保留原映射。")}</p>}{preview.variables.map((v, i) => <div className="material-variable" key={i}><label>{t("角色")}<select aria-label={`变量${i + 1}角色`} value={v.role} onChange={e => editVariable(i, 'role', e.target.value)}><option>X</option><option>Y</option></select></label><label>{t("变量名称")}<input aria-label={`变量${i + 1}名称`} value={v.name} onChange={e => editVariable(i, 'name', e.target.value)} /></label><label>{t("单位")}<input aria-label={`变量${i + 1}单位`} value={v.unit} onChange={e => editVariable(i, 'unit', e.target.value)} /></label><label>{t("模拟最小值")}<input aria-label={`变量${i + 1}最小值`} type="number" value={v.min} onChange={e => editVariable(i, 'min', e.target.value)} /></label><label>{t("模拟最大值")}<input aria-label={`变量${i + 1}最大值`} type="number" value={v.max} onChange={e => editVariable(i, 'max', e.target.value)} /></label><p>{v.definition}</p></div>)}<h4>{t("采集表列名（用换行分隔）")}</h4><textarea aria-label={t("采集表列名")} value={preview.collection_headers.join('\n')} onChange={e => setPreview(p => ({
            ...p,
            collection_headers: e.target.value.split('\n')
          }))} /><h4>{t("分析工作表预览")}</h4><Table columns={[t("事项"), t("方法"), t("所需资料"), t("判断方式")]} rows={preview.analysis_plan.map(v => [v.item, v.method, v.required, v.decision])} /><div className="modal-actions"><button className="outline" onClick={() => setOpen(false)}>{t("取消")}</button><button className="primary" disabled={!preview.collection_headers.length || preview.collection_headers.some(s => !s.trim()) || new Set(preview.collection_headers).size !== preview.collection_headers.length} onClick={commit}>{t("确认导入本阶段")}</button></div></>}{!busy && !preview && <button className="outline" onClick={prepare}>{t("重试生成资料")}</button>}</section></div>}</section>;
}
