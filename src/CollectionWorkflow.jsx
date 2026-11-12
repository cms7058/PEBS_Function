import {accountFetch as fetch} from './account-fetch';
import { t } from "./i18n";
import React, { useEffect, useRef, useState } from 'react';
import { Download, Upload, ShieldCheck, Loader2, X } from 'lucide-react';
import { variableLabel } from './stage-materials';
import { collectionConfig, collectionFingerprint, collectionPassed, editCollection } from './collection-workflow';
async function api(path, value) {
  const r = await fetch('/api/collection/' + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(value)
  });
  const v = await r.json().catch(() => null);
  if (!r.ok || !v) throw Error(v?.error || '数据服务暂时不可用，请重试');
  return v;
}
function IssueList({
  issues
}) {
  return <div className="collection-issues"><table><thead><tr><th>{t("表格")}</th><th>{t("行")}</th><th>{t("列")}</th><th>{t("问题与处理方向")}</th></tr></thead><tbody>{issues.map((i, n) => <tr key={n}><td>{i.file}</td><td>{i.row || '—'}</td><td>{i.column || '—'}</td><td>{i.message}</td></tr>)}</tbody></table></div>;
}
export default function CollectionWorkflow({
  workspace,
  stage,
  locked,
  download
}) {
  const material = workspace.state.materials[stage],
    config = collectionConfig(material),
    {
      tables,
      rules,
      bindings,
      variables,
      headers
    } = config;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [selected, setSelected] = useState('primary'),
    [page, setPage] = useState(0),
    [uploadMode, setUploadMode] = useState('replace'),
    [kind, setKind] = useState('collection'),
    [repair, setRepair] = useState(null);
  const alive = useRef(true);
  const latest = useRef();
  latest.current = material;
  useEffect(() => () => {
    alive.current = false;
  }, []);
  const table = tables.find(t => t.id === selected) || tables[0],
    report = material.collection_check,
    passed = collectionPassed(material, stage),
    issues = [...(material.upload_issues || []), ...(report?.issues || [])].filter((v, i, a) => a.findIndex(x => x.file === v.file && x.row === v.row && x.column === v.column && x.message === v.message) === i);
  function edit(change) {
    workspace.patchState(s => editCollection(s, stage, change));
    setError('');
    setRepair(null);
  }
  async function upload(file) {
    if (!file) return;
    setBusy(true);
    setError('');
    const fingerprint = collectionFingerprint(material, stage);
    workspace.patchState(s => editCollection(s, stage, {
      upload_issues: [{
        file: file.name,
        row: '',
        column: '',
        message: '正在读取上传文件，完成后请检查全部表格'
      }]
    }));
    try {
      if (!/\.csv$/i.test(file.name)) throw Error('请上传CSV UTF-8文件，可用Excel另存为该格式。');
      if (file.size > 8 * 1024 * 1024) throw Error('上传文件最多8 MB');
      const result = await api('upload', {
        filename: file.name,
        csv: await file.text(),
        kind,
        table_id: 't' + Date.now()
      });
      if (!alive.current) return;
      if (collectionFingerprint({
        ...latest.current,
        upload_issues: material.upload_issues
      }, stage) !== fingerprint) throw Error('资料已变化，请重新上传。');
      if (!result.accepted) {
        edit({
          upload_issues: result.issues
        });
        return;
      }
      let next;
      if (uploadMode === 'replace') {
        const replace = tables.find(t => t.kind === kind);
        next = replace ? tables.map(t => t.id === replace.id ? {
          ...result.table,
          id: replace.id
        } : t) : [...tables, result.table];
      } else {
        if (tables.length >= 20) throw Error('最多添加20张数据表');
        next = [...tables, result.table];
      }
      edit({
        collection_tables: next,
        upload_issues: []
      });
      setSelected((uploadMode === 'replace' ? tables.find(t => t.kind === kind)?.id : null) || result.table.id);
      setPage(0);
    } catch (e) {
      if (alive.current) {
        setError(e.message);
        edit({
          upload_issues: [{
            file: file.name,
            row: '',
            column: '',
            message: e.message
          }]
        });
        setError(e.message);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function check() {
    setBusy(true);
    setError('');
    workspace.setField('materials', old => ({
      ...old,
      [stage]: {
        ...old[stage],
        collection_check: old[stage].collection_check ? {
          ...old[stage].collection_check,
          passed: false,
          stale: true
        } : null
      }
    }));
    try {
      const snapshot = collectionFingerprint(material, stage);
      const result = await api('check', {
        stage,
        material
      });
      if (!alive.current) return;
      if (snapshot !== collectionFingerprint(latest.current, stage)) throw Error('检查期间数据已变化，请重新检查。');
      workspace.setField('materials', old => ({
        ...old,
        [stage]: {
          ...old[stage],
          collection_check: {
            ...result,
            dataset: undefined,
            checked_at: Date.now()
          },
          checked_dataset: result.passed ? result.dataset : null,
          check_history: [...(old[stage].check_history || []).slice(-19), {
            time: Date.now(),
            passed: result.passed,
            issues: result.issue_count
          }]
        }
      }));
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function previewRepair() {
    setBusy(true);
    setError('');
    try {
      const result = await api('repair', {
        stage,
        material
      });
      if (alive.current) setRepair(result);
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function confirmRepair() {
    if (repair.fingerprint !== collectionFingerprint(material, stage)) {
      setError('数据已变化，请重新预览修复。');
      setRepair(null);
      return;
    }
    edit({
      collection_tables: repair.tables
    });
  }
  function useData() {
    if (!passed || !material.checked_dataset) return;
    const d = material.checked_dataset;
    workspace.patchState(s => ({
      ...s,
      data: d,
      xs: d.columns.slice(0, -1).map((_, i) => i),
      y: d.columns.length - 1,
      model: null,
      scenario: {},
      stage: Math.min(s.stage, 4),
      completed: s.completed.filter(n => n < 4)
    }));
  }
  useEffect(() => {
    setPage(p => Math.min(p, Math.max(0, Math.ceil((table?.rows.length || 0) / 10) - 1)));
  }, [table?.id, table?.rows.length]);
  const tableIssues = issues.filter(i => i.file === table?.name);
  const visibleRows = table?.rows.slice(page * 10, page * 10 + 10) || [];
  return <div className="collection-workflow"><h4>{t("采集模板、上传与质量检查")}</h4><p>{t("下载空模板后用Excel填写并另存为CSV UTF-8，或直接在线填报。所有已添加表格须通过检查，才能继续。完全空白的预留行不计入记录。")}</p><div className="materials-actions"><button className="outline" onClick={() => download(`第${stage}步-采集空模板.csv`, headers, [])}><Download size={14} />{t("下载采集空模板")}</button>{variables.length > 0 && <button className="outline" onClick={() => download(t("数值数据空模板.csv"), [...variables.filter(v => v.role === 'X'), ...variables.filter(v => v.role === 'Y')].map(variableLabel), [])}>{t("下载数值数据模板")}</button>}</div><details><summary>{t("确认必填、类型、范围与变量映射")}</summary><p className="footnote">{t("默认采集列均必填。根据实际采样方案确认可选列；X/Y列始终必填。真实数据范围由你设定，未使用教学模拟范围。此处变化后必须重新检查。")}</p>{variables.map(v => <label className="collection-binding" key={variableLabel(v)}>{v.role}：{variableLabel(v)}<select aria-label={`采集列映射 ${variableLabel(v)}`} disabled={busy || locked} value={bindings[variableLabel(v)] || ''} onChange={e => {
          const column = e.target.value;
          edit({
            collection_bindings: {
              ...bindings,
              [variableLabel(v)]: column
            },
            collection_rules: rules.map(r => r.column === column ? {
              ...r,
              required: true,
              type: 'number'
            } : r)
          });
        }}><option value="">{t("请选择采集列")}</option>{headers.map(h => <option key={h}>{h}</option>)}</select></label>)}<div className="table-wrap"><table><thead><tr><th>{t("采集列")}</th><th>{t("必填")}</th><th>{t("类型")}</th><th>{t("下限（选填）")}</th><th>{t("上限（选填）")}</th></tr></thead><tbody>{rules.map((r, i) => <tr key={r.column}><td>{r.column}</td><td><input aria-label={`${r.column} 必填`} type="checkbox" disabled={busy || locked || Object.values(bindings).includes(r.column)} checked={r.required || Object.values(bindings).includes(r.column)} onChange={e => edit({
                  collection_rules: rules.map((v, j) => j === i ? {
                    ...v,
                    required: e.target.checked
                  } : v)
                })} /></td><td><select aria-label={`${r.column} 类型`} disabled={busy || locked} value={r.type} onChange={e => edit({
                  collection_rules: rules.map((v, j) => j === i ? {
                    ...v,
                    type: e.target.value
                  } : v)
                })}>{[['text', t("文本")], ['number', t("数值")], ['integer', t("整数")], ['date', t("日期")]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td><td><input aria-label={`${r.column} 下限`} type="number" disabled={busy || locked || !['number', 'integer'].includes(r.type)} value={r.min} onChange={e => edit({
                  collection_rules: rules.map((v, j) => j === i ? {
                    ...v,
                    min: e.target.value
                  } : v)
                })} /></td><td><input aria-label={`${r.column} 上限`} type="number" disabled={busy || locked || !['number', 'integer'].includes(r.type)} value={r.max} onChange={e => edit({
                  collection_rules: rules.map((v, j) => j === i ? {
                    ...v,
                    max: e.target.value
                  } : v)
                })} /></td></tr>)}</tbody></table></div></details><div className="collection-upload"><label>{t("上传表格类型")}<select aria-label={t("上传表格类型")} disabled={busy || locked} value={kind} onChange={e => setKind(e.target.value)}><option value="collection">{t("采集表（含追溯信息）")}</option><option value="data" disabled={!variables.length}>{t("数值数据表（仅X/Y，可选）")}</option></select></label><label>{t("上传方式")}<select aria-label={t("采集表上传方式")} disabled={busy || locked} value={uploadMode} onChange={e => setUploadMode(e.target.value)}><option value="replace">{t("替换首张同类表格")}</option><option value="add">{t("增加表格（新批次）")}</option></select></label><label className="outline collection-file"><Upload size={14} />{t("上传CSV表格")}<input aria-label={t("上传采集或数值CSV表格")} type="file" accept=".csv,text/csv" disabled={busy || locked} onChange={e => {
          upload(e.target.files[0]);
          e.target.value = '';
        }} /></label></div><p className="footnote">{t("每个文件最多8 MB，最多20张表、合计20,000条记录。数值数据表不能替代采集表；若两类表同时提交，X/Y数值和记录数量必须一致。")}</p>{material.upload_issues?.length > 0 && <button className="outline" disabled={busy || locked} onClick={() => edit({
      upload_issues: []
    })}>{t("弃用本次失败上传，改用原表填报")}</button>}<label>{t("当前表格")}<select aria-label={t("当前采集数据表")} disabled={busy || locked} value={table?.id || ''} onChange={e => {
        setSelected(e.target.value);
        setPage(0);
      }}>{tables.map(tableOption => <option key={tableOption.id} value={tableOption.id}>{tableOption.name} · {tableOption.kind === 'data' ? t("数值数据") : t("采集记录")} · {tableOption.rows.filter(r => r.some(v => String(v).trim())).length}{t("条")}</option>)}</select></label>{table && <><div className="table-wrap collection-editor"><table><thead><tr><th>{t("数据行")}</th>{table.headers.map((h, i) => <th key={i}>{h}</th>)}<th>{t("操作")}</th></tr></thead><tbody>{visibleRows.map((row, i) => {
              const n = page * 10 + i;
              return <tr key={n}><td>{n + 1}</td>{row.map((v, j) => {
                  const bad = tableIssues.some(issue => issue.row === n + 2 && (issue.column === table.headers[j] || !issue.column));
                  return <td key={j} className={bad ? 'invalid-cell' : ''}><input aria-label={`填报第${n + 1}行 ${table.headers[j]}`} disabled={busy || locked} value={v} onChange={e => edit({
                      collection_tables: tables.map(t => t.id === table.id ? {
                        ...t,
                        rows: t.rows.map((r, k) => k === n ? r.map((c, z) => z === j ? e.target.value : c) : r)
                      } : t)
                    })} /></td>;
                })}<td><button className="text-button" disabled={busy || locked} onClick={() => edit({
                    collection_tables: tables.map(t => t.id === table.id ? {
                      ...t,
                      rows: t.rows.filter((_, k) => k !== n)
                    } : t)
                  })}>{t("删除此行")}</button></td></tr>;
            })}</tbody></table></div><div className="materials-actions"><button className="outline" disabled={busy || page === 0} onClick={() => setPage(p => p - 1)}>{t("上一页")}</button><span>{t("第")}{page + 1}/{Math.max(1, Math.ceil(table.rows.length / 10))}{t("页")}</span><button className="outline" disabled={busy || (page + 1) * 10 >= table.rows.length} onClick={() => setPage(p => p + 1)}>{t("下一页")}</button><button className="outline" disabled={busy || locked || table.rows.length >= 20000} onClick={() => {
          edit({
            collection_tables: tables.map(t => t.id === table.id ? {
              ...t,
              rows: [...t.rows, t.headers.map(() => '')]
            } : t)
          });
          setPage(Math.floor(table.rows.length / 10));
        }}>{t("增加填报行")}</button><button className="outline" onClick={() => download(table.name + '.csv', table.headers, table.rows)}>{t("下载当前填报表")}</button><button className="outline" disabled={busy || locked || table.kind === 'collection' && tables.filter(t => t.kind === 'collection').length <= 1} onClick={() => {
          edit({
            collection_tables: tables.filter(t => t.id !== table.id)
          });
          setSelected('primary');
          setPage(0);
        }}>{t("移除当前表格")}</button></div></>}<div className="materials-actions"><button className="primary" disabled={busy || locked} onClick={check}>{busy ? <Loader2 size={15} className="spin" /> : <ShieldCheck size={15} />}{t("检查全部表格")}</button><button className="outline" disabled={busy || locked} onClick={previewRepair}>{t("预览格式修复")}</button>{report && <button className="outline" onClick={() => download(t("数据检查问题清单.csv"), [t("表格"), t("CSV行号"), t("列名"), t("问题")], report.issues.map(i => [i.file, i.row, i.column, i.message]))}>{t("下载问题清单")}</button>}</div>{error && <div className="error" role="alert">{error}</div>}<p className={'collection-status ' + (passed ? 'checked' : 'pending')} role="status">{passed ? t("✓ 当前全部表格检查通过") : report?.stale || report?.passed ? t("数据或检查规则已变化，下面为上轮问题，须重新检查") : report ? t("检查未通过：") + report.issue_count + t("处问题") : t("当前资料待检查，完成检查前不能继续")}</p>{issues.length > 0 && <><IssueList issues={issues} /><p className="footnote">{t("行号包含表头（第1行），在线第1条记录对应CSV第2行。")}{report?.truncated ? t("仅显示并导出前200个问题，请逐批修正后重查。") : ''}</p></>}{passed && material.checked_dataset && <><button className="outline" disabled={busy || locked || material.checked_dataset.rows.length < 15} onClick={useData}>{t("将通过检查的数值用于建模")}</button><p className="footnote">{t("当前可提取")}{material.checked_dataset.rows.length}{t("条X/Y记录；至少15条才能载入建模。载入后清除旧模型，保留采集记录；后续步骤会返回第4步。")}</p></>}<p className="footnote">{report?.limitations || t("检查不等同于验证测量可靠性或业务正确性。模拟数据只能在独立演示项目中试运行。")}</p>{material.check_history?.length > 0 && <details><summary>{t("检查记录（最近20轮）")}</summary>{material.check_history.map((h, i) => <p key={i}>{t("第")}{i + 1}{t("轮 ·")}{new Date(h.time).toLocaleString('zh-CN')} · {h.passed ? t("通过") : h.issues + t("处问题")}</p>)}</details>}{repair && <div className="modal-overlay"><section className="modal material-modal" role="dialog" aria-modal="true" aria-label={t("格式修复预览")}><button className="close" aria-label={t("关闭格式修复")} onClick={() => setRepair(null)}><X /></button><h2>{t("格式修复预览")}</h2><p>{repair.notice}</p><p>{t("可修复")}{repair.change_count}{t("个单元格，预览前200项。")}</p><div className="table-wrap"><table><thead><tr><th>{t("表格／行／列")}</th><th>{t("原值")}</th><th>{t("修复后")}</th></tr></thead><tbody>{repair.changes.map((c, i) => <tr key={i}><td>{c.file}／{c.row}／{c.column}</td><td>{JSON.stringify(c.old)}</td><td>{JSON.stringify(c.new)}</td></tr>)}</tbody></table></div><div className="modal-actions"><button className="outline" onClick={() => setRepair(null)}>{t("取消修复")}</button><button className="primary" disabled={!repair.change_count} onClick={confirmRepair}>{t("确认格式修复")}</button></div></section></div>}</div>;
}
