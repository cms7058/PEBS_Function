import {accountFetch as fetch} from './account-fetch';
import { t } from "./i18n";
import React, { useEffect, useRef, useState } from 'react';
import { Plus, Upload, Search, BookOpen, Sparkles, X, Download } from 'lucide-react';
import './catalog.css';
import { TierBadge, CapabilityGroups, CapabilityAssessment } from './SkillCapabilities.jsx';
import { allowsSkill, tierLabel } from './skill-tiers.js';
import ChapterSelection from './ChapterSelection.jsx';
import { skillBookOptions, extractionStatus } from './skill-books.js';
import LibraryAssistant from './LibraryAssistant.jsx';
async function api(url, options) {
  const r = await fetch(url, options);
  const out = await r.json().catch(() => ({
    error: `请求失败 (${r.status})`
  }));
  if (!r.ok) throw Error(out.error || '请求失败');
  return out;
}
const json = (method, data) => ({
  method,
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(data)
});
const date = n => n ? new Date(n * 1000).toLocaleString('zh-CN', {
  hour12: false
}) : '—';
const readerUrl = (id, page = 1) => `/reader.html?book=${encodeURIComponent(id)}&page=${Math.max(1, Number(page) || 1)}`;
function Modal({
  title,
  close,
  children
}) {
  return <div className="modal-overlay"><section className="modal catalog-modal" role="dialog" aria-modal="true" aria-label={title}><button className="close" aria-label={t("关闭")} onClick={close}><X /></button><h2>{title}</h2>{children}</section></div>;
}
function SkillUseModal({
  skill,
  close,
  question,
  setQuestion,
  stage,
  setStage,
  answer,
  invoke,
  busy,
  error
}) {
  return <Modal title={`调用 Skill · ${skill.name}`} close={close}><p>{t("根据已审核的技能和来源书籍回答问题。请描述你当前的工程问题与已有数据。")}</p><label htmlFor="skill-question">{t("需要解决的问题")}</label><textarea id="skill-question" autoFocus value={question} onChange={e => setQuestion(e.target.value)} placeholder={t("例如：生产线的交付周期持续超标，如何定位约束并验证改善效果？")} /><label htmlFor="skill-stage">{t("对应流程层级（可选）")}</label><select id="skill-stage" value={stage} onChange={e => setStage(e.target.value)}><option value="">{t("不指定层级")}</option>{Array.from({
        length: 10
      }, (_, i) => <option key={i + 1} value={i + 1}>{t("第")}{i + 1}{t("层")}</option>)}</select>{error && <div className="error" role="alert">{t(error)}</div>}<div className="modal-actions"><button className="primary" disabled={busy || !question.trim()} onClick={invoke}>{busy ? t("正在调用…") : t("运行 Skill")}</button></div>{answer && <section className="skill-answer" role="status"><h3>{t("建议")}</h3><p>{answer.answer}</p>{answer.steps?.length > 0 && <><h4>{t("执行步骤")}</h4><ol>{answer.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></>}{answer.limitations?.length > 0 && <><h4>{t("使用限制")}</h4><ul>{answer.limitations.map((s, i) => <li key={i}>{s}</li>)}</ul></>}{answer.sources?.length > 0 && <><h4>{t("依据")}</h4><ul>{answer.sources.map((s, i) => <li key={i}>{s}</li>)}</ul></>}</section>}</Modal>;
}
function exportSkill(s) {
  const text = `---\nname: ${s.id}\ndescription: ${s.description}\n---\n# ${s.name}\n\n状态：${s.status === 'reviewed' ? '已标记审核' : '待审核草稿'}\n处理方式：${s.mode}\n\n## 输入\n${s.inputs.map(x => '- ' + x).join('\n')}\n\n## 步骤\n${s.steps.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\n## 输出\n${s.outputs.join('\n')}\n\n## 来源\n${s.book_title}，PDF 第 ${s.source.page} 页\n${location.origin + readerUrl(s.book_id, s.source.page)}\n\n${s.note}\n\n## 原文片段\n${s.source.excerpt || ''}`;
  const u = URL.createObjectURL(new Blob([text], {
    type: 'text/markdown;charset=utf-8'
  }));
  const a = document.createElement('a');
  a.href = u;
  a.download = s.id + '-SKILL.md';
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
export default function Catalog({
  view,
  personal = false
}) {
  const [books, setBooks] = useState([]),
    [skills, setSkills] = useState([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [edit, setEdit] = useState(null),
    [title, setTitle] = useState(''),
    [deleting, setDeleting] = useState(null),
    [deletingSkill, setDeletingSkill] = useState(null),
    [query, setQuery] = useState(''),
    [results, setResults] = useState(null),
    [filter, setFilter] = useState(''),
    [choose, setChoose] = useState(false),
    [selected, setSelected] = useState(''),
    [detail, setDetail] = useState(null),
    [notice, setNotice] = useState(''),
    [preview, setPreview] = useState(null),
    [mode, setMode] = useState('text'),
    [job, setJob] = useState(() => {
      try {
        return JSON.parse(sessionStorage.getItem('book-skill-job') || 'null');
      } catch {
        return null;
      }
    }),
    [engine, setEngine] = useState(null),
    [using, setUsing] = useState(null),
    [question, setQuestion] = useState(''),
    [answer, setAnswer] = useState(null),
    [usingStage, setUsingStage] = useState('');
  const [profile, setProfile] = useState(null),
    [tierFilter, setTierFilter] = useState('');
  const [skillPage, setSkillPage] = useState(1),
    [skillPageSize, setSkillPageSize] = useState(10);
  const [scope, setScope] = useState('all'),
    [ranges, setRanges] = useState([]),
    [bookSkills, setBookSkills] = useState(null);
  const [ocrStates, setOcrStates] = useState({}),
    [ocrReview, setOcrReview] = useState(null);
  const fileInput = useRef(null),
    uploadId = useRef(null),
    skillListRef = useRef(null);
  function changeSkillPage(page) {
    setSkillPage(page);
    skillListRef.current?.scrollIntoView({
      behavior: 'auto',
      block: 'start'
    });
  }
  async function refresh() {
    const [b, s, e, p] = await Promise.all([api('/api/books'), api('/api/skills'), api('/api/skill-engine'), api('/api/access-profile')]);
    setBooks(b);
    setSkills(s);
    setEngine(e);
    setProfile(p);
    return {
      books: b,
      skills: s,
      engine: e
    };
  }
  useEffect(() => {
    setError('');
    setNotice('');
    setFilter('');
    setLoading(true);
    refresh().catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [view]);
  useEffect(() => {
    const update = e => {
      if (e.detail) setProfile(e.detail);else api('/api/access-profile').then(setProfile).catch(e => setError(e.message));
    };
    window.addEventListener('access-profile-changed', update);
    return () => window.removeEventListener('access-profile-changed', update);
  }, []);
  const scanIds = books.filter(b => b.uploaded_at && !b.indexed).map(b => b.id).join(',');
  useEffect(() => {
    let active = true;
    async function poll() {
      for (const id of scanIds.split(',').filter(Boolean)) {
        try {
          const value = await api('/api/books/' + id + '/ocr');
          if (!active) return;
          setOcrStates(states => ({
            ...states,
            [id]: value
          }));
          if (value.status === 'done') {
            await refresh();
            setNotice('OCR 识别完成。请检查识别结果，再手动生成 Skill。');
          }
        } catch (e) {
          if (active) setError(e.message);
        }
      }
    }
    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [scanIds]);
  async function startOcr(book) {
    await act(async () => {
      const state = await api('/api/books/' + book.id + '/ocr', {
        method: 'POST'
      });
      setOcrStates(states => ({
        ...states,
        [book.id]: state
      }));
      setNotice('OCR 已在后台开始，完成后可检查文字并手动生成 Skill。');
    });
  }
  function ocrControls(book) {
    const state = ocrStates[book.id] || book.ocr;
    return book.uploaded_at && <>{state?.status === 'running' ? <span role="status">{t("OCR 识别中：")}{state.completed} / {state.total || '?'}{t("页")}</span> : !book.indexed ? <><button disabled={busy} onClick={() => startOcr(book)}>{state?.status === 'failed' ? t("重试 OCR") : state?.status === 'interrupted' ? t("继续 OCR") : t("进行 OCR")}</button>{state?.error && <small className="cell-sub">{state.error}</small>}</> : book.ocr?.status === 'done' ? <><span className="pill">{t("OCR 已完成")}</span><button disabled={busy} onClick={() => loadOcrText(book, 1)}>{t("检查识别文字")}</button><a href={'/api/books/' + book.id + '/original'} download>{t("下载原始 PDF")}</a></> : null}</>;
  }
  async function loadOcrText(book, page) {
    setBusy(true);
    setError('');
    try {
      const result = await api('/api/books/' + book.id + '/ocr/text?page=' + page);
      setOcrReview({
        book,
        ...result
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const activeJobId = job?.job_id || job?.id;
  useEffect(() => {
    if (!activeJobId) return;
    let active = true;
    const poll = async () => {
      try {
        const current = await api('/api/skill-jobs/' + activeJobId);
        if (!active) return;
        setJob(current);
        if (current.status === 'done') {
          sessionStorage.removeItem('book-skill-job');
          setJob(null);
          // A completed background job must also close the chooser.  Otherwise
          // the selected book is refreshed to “全部提取” while the old
          // in-progress error remains visible in the modal.
          setChoose(false);
          setPreview(null);
          setError('');
          await refresh();
          setNotice('book-to-skill 生成完成，技能包可在列表中下载。');
        } else if (current.status === 'failed') {
          sessionStorage.removeItem('book-skill-job');
          setJob(null);
          setError(current.error || 'Skill 生成失败');
        } else {
          sessionStorage.setItem('book-skill-job', JSON.stringify(current));
        }
      } catch (e) {
        if (active) {
          sessionStorage.removeItem('book-skill-job');
          setJob(null);
          setError(e.message);
        }
      }
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [activeJobId]);
  async function act(fn) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function invokeSkill() {
    setBusy(true);
    setError('');
    setAnswer(null);
    try {
      setAnswer(await api('/api/skills/' + encodeURIComponent(using.id) + '/apply', json('POST', {
        question,
        stage: usingStage ? Number(usingStage) : null
      })));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const bookOptions = skillBookOptions(books, skills);
  const selectedBook = bookOptions.find(b => b.id === selected);
  async function openSkillChooser(bookId) {
    setBusy(true);
    setError('');
    setNotice('');
    setPreview(null);
    setScope('all');
    setRanges([]);
    setChoose(true);
    try {
      const fresh = await refresh();
      const options = skillBookOptions(fresh.books, fresh.skills);
      const preferred = bookId || options.find(b => b.skillState.ready && extractionStatus(b, fresh.skills) === '未提取')?.id || options.find(b => b.skillState.ready)?.id || '';
      setSelected(preferred);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const shown = books.filter(b => b.title.toLowerCase().includes(filter.toLowerCase()));
  const matchingSkills = skills.filter(s => (s.name + ' ' + s.book_title).toLowerCase().includes(filter.trim().toLowerCase()));
  const tierCounts = matchingSkills.reduce((counts, s) => {
    counts[s.capability_tier || 'normal']++;
    return counts;
  }, {
    normal: 0,
    high: 0,
    ultra: 0
  });
  const shownSkills = matchingSkills.filter(s => !tierFilter || (s.capability_tier || 'normal') === tierFilter);
  const skillPageCount = Math.max(1, Math.ceil(shownSkills.length / skillPageSize));
  const currentSkillPage = Math.min(skillPage, skillPageCount);
  const skillPageStart = (currentSkillPage - 1) * skillPageSize;
  const pageSkills = shownSkills.slice(skillPageStart, skillPageStart + skillPageSize);
  const firstPageNumber = Math.min(Math.max(currentSkillPage - 2, 1), Math.max(skillPageCount - 4, 1));
  const skillPageNumbers = [...new Set([1, ...Array.from({
    length: Math.min(5, skillPageCount)
  }, (_, i) => firstPageNumber + i), skillPageCount])].sort((a, b) => a - b);
  useEffect(() => {
    setSkillPage(p => Math.min(p, skillPageCount));
  }, [skillPageCount]);
  useEffect(() => {
    setSkillPage(1);
  }, [view]);
  return <div className="catalog-page"><div className="page-heading"><div><div className="eyebrow">{view === 'library' ? 'KNOWLEDGE LIBRARY' : 'SKILL LIBRARY'}</div><h1>{view === 'library' ? personal ? t("我的书籍") : t("知识资料库") : personal ? t("我的技能") : t("Skill技能")}</h1><p>{view === 'library' ? t("管理书籍、上传 PDF，检索原文并随时查看来源。") : t("使用开源 book-to-skill 从书籍生成可下载的技能包，并核对来源。")}</p></div><button className="primary" disabled={busy || loading} onClick={() => {
        setError('');
        if (view === 'library') {
          setEdit({
            id: null
          });
          setTitle('');
        } else {
          openSkillChooser();
        }
      }}>{view === 'library' ? <Plus size={17} /> : <Sparkles size={17} />} {view === 'library' ? t("新增书籍") : 'TO-SKILL'}</button></div>
 {view === 'skills' && <div className="catalog-notice">{t("当前会员：")}<strong>{tierLabel(profile?.tier)}</strong>{t("。工作台按同一能力推荐可用的最高等级，技能须先审核。")}<a href={personal?"/?view=account":"/?view=settings"}>{t("配置会员与角色")}</a></div>}
 {view === 'skills' && engine && !engine.ready && <div className="catalog-notice" role="status">{t("Skill 生成与调用需要 Agent 宿主或模型服务。请前往")}<a href={personal?"/?view=account":"/?view=settings"}>{t("模型配置")}</a>{t("选择服务并保存配置。已有技能会继续保存在知识库中。")}</div>}{error && <div className="error" role="alert">{t(error)}</div>}{notice && <div className="catalog-notice" role="status">{notice}</div>}{busy && <p role="status">{t("正在处理，请稍候…")}</p>}
 <section className="catalog-table-card" ref={skillListRef}><div className="catalog-toolbar"><strong>{view === 'library' ? `书籍列表 · ${books.length}` : `Skill 列表 · ${shownSkills.length}`}</strong>{view === 'skills' && <div className="tier-tools"><select aria-label={t("筛选技能等级")} value={tierFilter} onChange={e => {
            setTierFilter(e.target.value);
            setSkillPage(1);
          }}><option value="">{t("全部等级（")}{matchingSkills.length}）</option><option value="normal">normal（{tierCounts.normal}）</option><option value="high">high（{tierCounts.high}）</option><option value="ultra">Ultra（{tierCounts.ultra}）</option></select><button className="outline" disabled={busy || loading || personal} onClick={() => act(async () => {
            const result = await api('/api/skills/evaluate', {
              method: 'POST'
            });
            setNotice(`已评估 ${result.updated} 个技能，人工确认的等级保留。此操作不调用模型。`);
          })}>{t("评估技能等级")}</button></div>}<input aria-label={view === 'library' ? t("筛选书名") : t("筛选技能")} placeholder={view === 'library' ? t("输入书名筛选…") : t("搜索技能或来源书名…")} value={filter} onChange={e => {
          setFilter(e.target.value);
          setSkillPage(1);
        }} /></div><div className="table-wrap"><table className={view === 'skills' ? 'skill-tier-table' : 'book-table'}><thead>{view === 'library' ? <tr><th>{t("书名")}</th><th>{t("上传状态")}</th><th>{t("上传时间")}</th><th>{t("Skill 状态")}</th><th>{t("操作")}</th></tr> : <tr><th>{t("Skill 名称")}</th><th>{t("来源书籍")}</th><th>{t("能力等级")}</th><th>{t("状态 / 处理方式")}</th><th>{t("生成时间")}</th><th>{t("操作")}</th></tr>}</thead><tbody>{view === 'library' ? shown.map(b => <tr key={b.id}><td><strong>{b.title}</strong>{b.stages?.length > 0 && <small className="cell-sub">{t("对应流程：第")}{b.stages.join("、")}{t("层")}</small>}{b.access && <small className="cell-sub">{b.access}</small>}<small className="cell-sub">{b.uploaded_at ? `${b.pages} 页 · ${b.indexed ? t("可搜索原文") : t("无可提取文字，需 OCR")}` : t("PDF 尚未上传")}</small></td><td><span className="pill">{b.uploaded_at ? t("上传完成") : t("待上传")}</span></td><td>{date(b.uploaded_at)}</td><td><button className="skill-status-link" onClick={() => setBookSkills(b)}>{extractionStatus(b, skills)} · {skills.filter(s => s.book_id === b.id).length}{t("个 Skill")}</button></td><td><div className="row-actions"><button disabled={busy || !b.uploaded_at || extractionStatus(b, skills) === "全部提取"} title={extractionStatus(b, skills) === "全部提取" ? t("本书已全部提取，可点击提取状态查看技能") : !b.uploaded_at ? t("请先上传 PDF") : undefined} onClick={() => openSkillChooser(b.id)}>{t("提取 Skill")}</button>{ocrControls(b)}{b.source_url && <a href={b.source_url} target="_blank" rel="noreferrer">{t("资料入口")}</a>}{b.uploaded_at ? <a href={readerUrl(b.id)}>{t("在线查看")}</a> : <button disabled={busy} onClick={() => {
                    uploadId.current = b.id;
                    fileInput.current.click();
                  }}>{t("上传 PDF")}</button>}<button disabled={busy} onClick={() => {
                    setTitle(b.title);
                    setEdit(b);
                  }}>{t("编辑书名")}</button><button disabled={busy} onClick={() => setDeleting(b)}>{t("删除")}</button></div></td></tr>) : pageSkills.map(s => <tr key={s.id}><td><strong>{s.name}</strong><small className="cell-sub">{s.stages.length ? t("适用层级：") + s.stages.join('、') : t("待补充工程适用层级")}</small></td><td>{s.book_title}<small className="cell-sub">{s.source_scope?.length ? s.source_scope.map(r => `${r.label}（PDF ${r.start}–${r.end}）`).join('；') : t("PDF 第 ") + s.source.page + t(" 页")}</small></td><td><TierBadge tier={s.capability_tier} /><small className="cell-sub">{s.capabilities?.length ? s.capabilities.slice(0, 3).map(c => c.label).join(' · ') + (s.capabilities.length > 3 ? ` 等 ${s.capabilities.length} 项` : '') : t("等待评估")}</small><small className="cell-sub">{!s.capability_assessment ? t("待评估") : s.capability_assessment.review_required ? t("内容初评 · 待确认") : t("已确认")}</small></td><td><span className="pill">{s.status === 'reviewed' ? t("已标记审核") : t("待审核草稿")}</span><small className="cell-sub">{s.mode}</small></td><td>{date(s.created_at)}</td><td><div className="row-actions"><button onClick={() => setDetail(s)}>{t("查看详情")}</button>{s.mode === 'book-to-skill' ? <a href={'/api/skills/' + encodeURIComponent(s.id) + '/archive'} download>{t("下载技能包")}</a> : <button onClick={() => exportSkill(s)}>{t("导出")}</button>}<button disabled={busy || s.status !== 'reviewed' || !engine?.ready || !profile || !allowsSkill(profile, s)} title={profile && !allowsSkill(profile, s) ? t("超出当前预览会员等级") : undefined} onClick={() => {
                    setUsing(s);
                    setQuestion('');
                    setAnswer(null);
                    setUsingStage('');
                    setError('');
                  }}>{t("调用")}</button><button className="danger-action" disabled={busy} onClick={() => setDeletingSkill(s)}>{t("删除")}</button></div></td></tr>)}</tbody></table></div>{loading ? <p className="catalog-empty">{t("正在加载…")}</p> : !(view === 'library' ? shown.length : shownSkills.length) && <p className="catalog-empty">{filter || view === 'skills' && tierFilter ? t("没有匹配的记录") : view === 'library' ? t("暂无书籍，点击“新增书籍”建立记录并上传 PDF。") : t("暂无 Skill，点击 TO-SKILL 选择书籍开始处理。")}</p>}
 {view === 'skills' && !loading && <div className="catalog-pagination">
  <span role="status" aria-live="polite">{t("共")}{shownSkills.length}{t("条")}{shownSkills.length > 0 && ` · 显示 ${skillPageStart + 1}–${skillPageStart + pageSkills.length} 条`}</span>
  <div className="skill-page-controls" role="navigation" aria-label={t("技能列表分页")}>
   <label>{t("每页")}<select aria-label={t("每页技能数量")} value={skillPageSize} onChange={e => {
              setSkillPageSize(Number(e.target.value));
              changeSkillPage(1);
            }}>{[10, 20, 50].map(n => <option key={n} value={n}>{n}{t("条")}</option>)}</select></label>
   <button className="outline" disabled={currentSkillPage === 1} onClick={() => changeSkillPage(currentSkillPage - 1)}>{t("上一页")}</button>
   {skillPageNumbers.map((n, i) => <React.Fragment key={n}>{i > 0 && n > skillPageNumbers[i - 1] + 1 && <span aria-hidden="true">…</span>}<button className={'skill-page-button' + (n === currentSkillPage ? ' active' : '')} aria-label={`第 ${n} 页`} aria-current={n === currentSkillPage ? 'page' : undefined} disabled={!shownSkills.length} onClick={() => changeSkillPage(n)}>{n}</button></React.Fragment>)}
   <span className="skill-page-position">{t("第")}{currentSkillPage} / {skillPageCount}{t("页")}</span>
   <button className="outline" disabled={currentSkillPage === skillPageCount} onClick={() => changeSkillPage(currentSkillPage + 1)}>{t("下一页")}</button>
  </div>
 </div>}
 </section>
 {view === 'skills' && <CapabilityGroups skills={shownSkills} open={setDetail} />}
 {activeJobId && <div className="catalog-notice" role="status">{t("book-to-skill 正在处理书籍")}{job.progress ? `：${job.progress.completed} / ${job.progress.total} 个步骤完成` : t("，正在准备章节")}{t("。处理大书可能需要较长时间。")}</div>}
 {view === 'library' && <section className="knowledge-search"><h3><Search size={18} />{t("搜索知识")}</h3><form className="search" onSubmit={e => {
        e.preventDefault();
        if (!query.trim()) return;
        act(async () => setResults(await api('/api/knowledge/search?q=' + encodeURIComponent(query))));
      }}><input aria-label={t("搜索知识")} placeholder={t("搜索所有已索引书籍，例如：回归、residual、测量")} value={query} onChange={e => setQuery(e.target.value)} /><button className="primary" disabled={busy || !query.trim()}>{t("搜索知识")}</button></form><p className="footnote">{t("全文关键词检索，支持常用中英统计术语映射。扫描 PDF 需先进行 OCR。")}</p>{results && <div className="search-results"><div className="catalog-toolbar"><span>{t("找到")}{results.total}{t("个页面 · 最多显示 12 条")}</span><button className="text-button" onClick={() => setResults(null)}>{t("清除结果")}</button></div>{results.results.map(r => <a className="search-result" key={r.book_id + '-' + r.page} href={readerUrl(r.book_id, r.page)}><span>{t("PDF 第")}{r.page}{t("页")}</span><h3>{r.title}</h3><p>{r.excerpt}</p></a>)}</div>}</section>}
 <input ref={fileInput} hidden type="file" accept=".pdf,application/pdf" onChange={e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      if (f.size > 50 * 1024 * 1024) {
        setError(t("PDF 最大支持 50 MB"));
        return;
      }
      act(async () => {
        await api(`/api/books/${uploadId.current}/pdf`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/pdf'
          },
          body: f
        });
        setNotice(t("PDF 上传完成，原文索引已保存。"));
      });
    }} />
 {edit && <Modal title={edit.id ? t("编辑书名") : t("新增书籍")} close={() => !busy && setEdit(null)}><form onSubmit={e => {
        e.preventDefault();
        act(async () => {
          await api(edit.id ? '/api/books/' + edit.id : '/api/books', json(edit.id ? 'PATCH' : 'POST', {
            title
          }));
          setEdit(null);
          setNotice(edit.id ? t("书名已更新") : t("书籍已创建，请在列表中上传 PDF。"));
        });
      }}><label htmlFor="book-title">{t("书名")}</label><input id="book-title" autoFocus required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /><p>{t("新增记录的初始状态为“待上传”。支持上传最大 50 MB 的 PDF 文件。")}</p>{error && <div className="error">{error}</div>}<button className="primary" disabled={busy || !title.trim()}>{busy ? t("保存中…") : t("保存书名")}</button></form></Modal>}
 {deleting && <Modal title={t("删除书籍")} close={() => !busy && setDeleting(null)}><p>{t("确认删除《")}{deleting.title}{t("》？本书的 PDF、知识索引和")}{skills.filter(s => s.book_id === deleting.id).length}{t("个关联 Skill 将一并删除。")}</p>{error && <div className="error">{error}</div>}<div className="modal-actions"><button className="outline" disabled={busy} onClick={() => setDeleting(null)}>{t("取消")}</button><button className="primary" disabled={busy} onClick={() => act(async () => {
          await api('/api/books/' + deleting.id, {
            method: 'DELETE'
          });
          setDeleting(null);
          setResults(null);
          setNotice(t("书籍及关联记录已删除。"));
        })}>{t("确认删除")}</button></div></Modal>}
 {deletingSkill && <Modal title={t("删除 Skill")} close={() => !busy && setDeletingSkill(null)}><p>{t("确认删除「")}{deletingSkill.name}{t("」？仅删除这条 Skill，来源书籍和 PDF 会保留。")}{skills.filter(s => s.book_id === deletingSkill.book_id).length === 1 && t("删除后，这本书可重新进行 TO-SKILL 处理。")}</p>{error && <div className="error">{error}</div>}<div className="modal-actions"><button className="outline" disabled={busy} onClick={() => setDeletingSkill(null)}>{t("取消")}</button><button className="primary" disabled={busy} onClick={() => act(async () => {
          await api('/api/skills/' + encodeURIComponent(deletingSkill.id), {
            method: 'DELETE'
          });
          setDeletingSkill(null);
          setNotice(t("Skill 已删除，来源书籍保留。"));
        })}>{t("确认删除")}</button></div></Modal>}
 {bookSkills && <Modal title={t("书籍 Skill 列表 · ") + bookSkills.title} close={() => setBookSkills(null)}><p>{t("提取状态：")}{extractionStatus(bookSkills, skills)}{t("。仅 book-to-skill 生成的包计入覆盖范围，方法模板不代表整书已提取。")}</p>{skills.filter(s => s.book_id === bookSkills.id).length ? <div className="book-skill-list">{skills.filter(s => s.book_id === bookSkills.id).map(s => <article key={s.id}><strong>{s.name}</strong> <TierBadge tier={s.capability_tier} /><small>{s.mode === 'book-to-skill' ? s.source_scope?.length ? s.source_scope.map(r => `${r.label} · PDF ${r.start}–${r.end} 页`).join('；') : t("整本书提取") : t("预设方法模板")} · {s.status === 'reviewed' ? t("已审核") : t("待审核")}</small><button className="outline" onClick={() => {
            setBookSkills(null);
            setDetail(s);
          }}>{t("查看 Skill")}</button>{s.mode === 'book-to-skill' && <a href={'/api/skills/' + encodeURIComponent(s.id) + '/archive'} download>{t("下载技能包")}</a>}</article>)}</div> : <p>{t("这本书尚无 Skill。")}</p>}<div className="modal-actions"><button className="primary" disabled={busy || !bookSkills.uploaded_at || extractionStatus(bookSkills, skills) === "全部提取"} title={extractionStatus(bookSkills, skills) === "全部提取" ? t("本书已全部提取") : undefined} onClick={() => {
          const id = bookSkills.id;
          setBookSkills(null);
          openSkillChooser(id);
        }}>{t("提取 Skill")}</button></div></Modal>}
 {choose && <Modal title={t("TO-SKILL · 选择书籍")} close={() => !busy && setChoose(false)}><p>{t("这里显示全部书籍，新添加的书籍排在前面。可生成的书籍先提取并估算用量，再确认生成。")}</p>{bookOptions.length ? <select aria-label={t("选择书籍生成 Skill")} disabled={busy} value={selected} onChange={e => {
        setSelected(e.target.value);
        setPreview(null);
        setScope('all');
        setRanges([]);
      }}>{bookOptions.length > 0 && <option value="">{t("请选择可生成 Skill 的书籍")}</option>}{bookOptions.map(b => <option key={b.id} value={b.id}>{b.title} · {b.skillState.label}</option>)}</select> : <p className="catalog-empty">{t("尚无书籍，请先到知识资料库新增并上传 PDF。")}</p>}{selectedBook && !selectedBook.skillState.ready && <div className="catalog-notice" role="status"><strong>{selectedBook.skillState.label}</strong><p>{selectedBook.skillState.reason}</p>{ocrControls(selectedBook)}<a href="/?view=library">{t("前往知识资料库")}</a>{selectedBook.uploaded_at && <> · <a href={readerUrl(selectedBook.id)}>{t("在线查看原书")}</a></>}</div>}<ChapterSelection book={selectedBook} scope={scope} setScope={value => {
        setScope(value);
        setPreview(null);
      }} ranges={ranges} setRanges={value => {
        setRanges(value);
        setPreview(null);
      }} disabled={busy || !selectedBook?.skillState.ready} /><label htmlFor="extract-mode">{t("提取方式")}</label><select id="extract-mode" disabled={busy} value={mode} onChange={e => {
        setMode(e.target.value);
        setPreview(null);
      }}><option value="text">{t("快速文本提取")}</option><option value="technical">{t("技术文档提取（需安装 Docling，长书耗时较长）")}</option></select><div className="info"><p>{engine?.provider === 'codex' ? t("确认后会由本机 Codex 显式调用开源 $book-to-skill 技能。书籍内容会依照 Codex 的服务条款进行模型处理；生成结果需人工审核。") : t("生成阶段会把提取的书籍文字发送到配置的模型 API；请确认你有权处理该书籍。生成结果仍需人工审核。")}</p></div>{engine && !engine.ready && <div className="catalog-notice" role="status">{t("Skill 生成需要模型服务。请前往模型配置页面设置 MiniMax、OpenAI、本机 Codex 或 Ollama，无需重启服务。")}</div>}{preview && <div className="skill-preview"><strong>{t("处理预估")}</strong>{preview.source_scope?.length > 0 && <p>{t("仅生成：")}{preview.source_scope.map(r => `${r.label}（PDF ${r.start}–${r.end} 页）`).join('；')}{t("。原书共")}{preview.total_book_pages}{t("页。")}</p>}<p>{preview.pages}{t("页 · 约")}{preview.words.toLocaleString()}{t("词 ·")}{preview.sections}{t("个段落任务")}</p><p>{t("预计输入约")}{preview.estimated_input_tokens.toLocaleString()}{t("token，输出约")}{preview.estimated_output_tokens.toLocaleString()}{t("token。实际用量与费用取决于模型及文本结构。")}</p><small>{t("提取工具：")}{preview.extraction_method}{preview.images_dropped > 0 ? ` · ${preview.images_dropped} 张图片未读取` : ''}</small></div>}{error && <div className="error">{error}</div>}<div className="modal-actions"><button className="outline" disabled={busy || !selectedBook?.skillState.ready || scope === 'selected' && !ranges.length} onClick={() => act(async () => {
          setPreview(await api(`/api/books/${selected}/to-skill/preview`, json('POST', {
            mode,
            ranges: scope === 'selected' ? ranges.map(r => ({
              ...r,
              start: Number(r.start),
              end: Number(r.end)
            })) : null
          })));
        })}>{busy ? t("提取中…") : t("提取并预估")}</button><button className="primary" disabled={busy || !selectedBook?.skillState.ready || !preview || !engine?.ready} title={!engine?.ready ? t("请先配置模型服务") : undefined} onClick={() => act(async () => {
          const out = await api(`/api/books/${selected}/to-skill`, json('POST', {
            preview_id: preview.preview_id
          }));
          sessionStorage.setItem('book-skill-job', JSON.stringify(out));
          setJob(out);
          setChoose(false);
          setNotice(t("book-to-skill 已开始生成，页面会显示进度。"));
        })}><Sparkles size={17} />{t("确认生成 Skill")}</button></div></Modal>}
 {using && <SkillUseModal skill={using} close={() => !busy && setUsing(null)} question={question} setQuestion={setQuestion} stage={usingStage} setStage={setUsingStage} answer={answer} invoke={invokeSkill} busy={busy} error={error} />}
 {ocrReview && <Modal title={t("检查 OCR · ") + ocrReview.book.title} close={() => setOcrReview(null)}><p>{t("第")}{ocrReview.page} / {ocrReview.total}{t("页。OCR 可能误识别公式、表格和文字，请对照 PDF 检查。")}</p><pre className="source-excerpt">{ocrReview.text || t("本页未识别到文字（可能是空白页或纯图片）。")}</pre><div className="modal-actions"><button className="outline" disabled={busy || ocrReview.page <= 1} onClick={() => loadOcrText(ocrReview.book, ocrReview.page - 1)}>{t("上一页")}</button><button className="outline" disabled={busy || ocrReview.page >= ocrReview.total} onClick={() => loadOcrText(ocrReview.book, ocrReview.page + 1)}>{t("下一页")}</button><a href={readerUrl(ocrReview.book.id, ocrReview.page)}>{t("对照 PDF")}</a></div></Modal>}
 {detail && <Modal title={detail.name} close={() => setDetail(null)}><span className="pill">{detail.status === 'reviewed' ? t("已标记审核") : t("待审核草稿")}</span><p>{detail.description}</p><CapabilityAssessment key={detail.id} skill={detail} busy={busy} save={personal ? undefined : input => act(async () => {
        const updated = await api('/api/skills/' + encodeURIComponent(detail.id) + '/classification', json('PATCH', input));
        setDetail(updated);
        setNotice(t("技能等级已人工确认。新工作台建议将使用更新后的等级。"));
      })} /><h4>{t("所需输入")}</h4><ul>{detail.inputs.map((s, i) => <li key={i}>{s}</li>)}</ul><h4>{t("执行步骤")}</h4><ol>{detail.steps.map((s, i) => <li key={i}>{s}</li>)}</ol><h4>{t("输出成果")}</h4><p>{detail.outputs.join(' · ')}</p><h4>{t("来源与限制")}</h4><p>{detail.note}</p><a href={readerUrl(detail.book_id, detail.source.page)}><BookOpen size={14} /> {detail.book_title}{t("· PDF 第")}{detail.source.page}{t("页")}</a>{detail.source.excerpt && <details><summary>{t("查看提取的原文片段")}</summary><pre className="source-excerpt">{detail.source.excerpt}</pre></details>}{error && <div className="error">{error}</div>}<div className="modal-actions">{detail.mode === 'book-to-skill' ? <><a className="outline" href={'/api/skills/' + encodeURIComponent(detail.id) + '/content'} target="_blank" rel="noreferrer">{t("查看 SKILL.md")}</a><a className="outline" href={'/api/skills/' + encodeURIComponent(detail.id) + '/archive'} download><Download size={16} />{t("下载技能包 ZIP")}</a></> : <button className="outline" onClick={() => exportSkill(detail)}><Download size={16} />{t("导出 SKILL.md")}</button>}<button className="primary" disabled={busy || detail.status === 'reviewed'} onClick={() => act(async () => {
          await api('/api/skills/' + detail.id + '/review', {
            method: 'POST'
          });
          setDetail({
            ...detail,
            status: 'reviewed'
          });
          setNotice(t("审核标记已保存到后端。"));
        })}>{t("标记已审核")}</button></div></Modal>}
 {view === 'library' && <LibraryAssistant />}
 </div>;
}
