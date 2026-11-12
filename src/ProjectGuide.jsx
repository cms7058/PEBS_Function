import {accountFetch as fetch} from './account-fetch';
import { t } from "./i18n";
import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, BookOpen } from 'lucide-react';
import { DEFAULT_ACCESS, accessSignature, matchingAccess, normalizeAccess, sourcePresentation, tierLabel, visibleRecommendations, visibleSources } from './guide-access';
import './project-guide.css';
import { getLocale } from './i18n';
export default function ProjectGuide({
  workspace,
  stage
}) {
  const {
    project,
    data,
    model,
    method,
    xs,
    y
  } = workspace.state;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [web, setWeb] = useState(workspace.state.guidance?.[stage]?.request?.web ?? workspace.state.guideSettings?.web ?? true);
  const [webQuery, setWebQuery] = useState(workspace.state.guidance?.[stage]?.request?.webQuery || workspace.state.guideSettings?.webQuery || '');
  const [question, setQuestion] = useState(workspace.state.guidance?.[stage]?.request?.question || '');
  const [profile, setProfile] = useState(DEFAULT_ACCESS),
    [profileReady, setProfileReady] = useState(false),
    [profileError, setProfileError] = useState('');
  const [accessChanged, setAccessChanged] = useState(false);
  const alive = useRef(''),
    latest = useRef(workspace),
    profileKey = useRef(accessSignature(DEFAULT_ACCESS)),
    profileVersion = useRef(0),
    guideRequest = useRef(null),
    manualRefresh = useRef(false);
  alive.current = workspace.id + ':' + stage;
  latest.current = workspace;
  const context = {
    stage,
    project,
    data: {
      columns: data.columns,
      rows: data.rows.length,
      issues: data.issues,
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
      train_rmse: model.train_rmse,
      baseline_rmse: model.baseline_rmse,
      r2: model.r2,
      status: model.status,
      train: model.train,
      test: model.test
    } : null,
    user_question: question
  };
  const signature = JSON.stringify([context, web, webQuery, accessSignature(profile)]);
  const saved = workspace.state.guidance?.[stage];
  const accessOutdated = !!saved && (saved.access_stale || !matchingAccess(saved, profile));
  const outdated = !!saved && (saved.signature !== signature || accessOutdated);
  const recommendations = profileReady ? visibleRecommendations(saved, profile) : [];
  const sources = visibleSources(saved, profileReady ? profile : DEFAULT_ACCESS);
  async function load(force = false) {
    if (!profileReady || !workspace.id || !project.question?.trim()) return;
    const key = alive.current,
      accessKey = profileKey.current,
      version = profileVersion.current,
      controller = new AbortController();
    guideRequest.current?.abort();
    guideRequest.current = controller;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/project-guide', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          context,
          web,
          web_query: webQuery,
          force,
          locale: getLocale()
        }),
        signal: controller.signal
      });
      const result = await r.json().catch(() => null);
      if (!r.ok || !result) throw Error(result?.error || '流程助手服务暂时不可用，请稍后重试');
      if (alive.current !== key || profileKey.current !== accessKey || profileVersion.current !== version) return;
      if (!result.access || accessSignature(result.access) !== accessKey) throw Error('用户权限已变化，请重新读取权限后更新建议。');
      workspace.setField('guidance', old => ({
        ...old,
        [stage]: {
          ...result,
          access_stale: false,
          signature,
          request: {
            web,
            webQuery,
            question
          }
        }
      }));
      setAccessChanged(false);
    } catch (e) {
      if (e.name !== 'AbortError' && alive.current === key && profileVersion.current === version) setError(e.message);
    } finally {
      if (alive.current === key && profileVersion.current === version) setBusy(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    async function readProfile(changed = false) {
      const version = ++profileVersion.current;
      if (changed) {
        manualRefresh.current = true;
        setAccessChanged(true);
        guideRequest.current?.abort();
        setBusy(false);
      }
      // Hide identifying sources while fetching fresh permissions, including on downgrades.
      setProfileReady(false);
      setProfile(DEFAULT_ACCESS);
      profileKey.current = accessSignature(DEFAULT_ACCESS);
      setProfileError('');
      try {
        const r = await fetch('/api/access-profile');
        const value = await r.json().catch(() => null);
        if (!r.ok || !value) throw Error('无法读取用户权限，请稍后重新读取。');
        if (cancelled || version !== profileVersion.current) return;
        const next = normalizeAccess(value),
          nextKey = accessSignature(next);
        profileKey.current = nextKey;
        setProfile(next);
        setProfileReady(true);
        const current = latest.current.state.guidance?.[stage];
        if (current && (changed || !matchingAccess(current, next))) {
          latest.current.setField('guidance', old => old?.[stage] ? {
            ...old,
            [stage]: {
              ...old[stage],
              access_stale: true
            }
          } : old);
        }
      } catch (e) {
        if (!cancelled && version === profileVersion.current) setProfileError(e.message);
      }
    }
    const changed = () => readProfile(true);
    window.addEventListener('access-profile-changed', changed);
    const retry = () => readProfile(false);
    window.addEventListener('access-profile-retry', retry);
    readProfile();
    return () => {
      cancelled = true;
      alive.current = '';
      guideRequest.current?.abort();
      window.removeEventListener('access-profile-changed', changed);
      window.removeEventListener('access-profile-retry', retry);
    };
  }, [workspace.id, stage]);
  useEffect(() => {
    if (profileReady && !manualRefresh.current && (stage >= 2 || workspace.state.mode === 'real') && !workspace.state.guidance?.[stage]) load();
  }, [profileReady, workspace.id, stage]);
  return <aside className="guidance project-guide">
  <div className="guide-header"><Sparkles size={19} /><strong>{t("流程构建助手")}</strong><span>{t("第")}{stage}{t("步")}</span></div>
  <p className="guide-intro">{t("结合工程要求、资料库与已审核 Skill，逐步建立可验证的模型。")}</p>
  <p className="guide-access-status">{profileReady ? <>{t("当前技能权限")}<span className={'guide-tier ' + profile.tier}>{tierLabel(profile.tier)}</span>{profile.show_book_names ? t(" · 可查看书籍来源") : t(" · 来源显示知识点")}</> : t("正在读取技能权限…")}</p>
  {profileError && <div className="error" role="alert">{profileError}<button className="outline" onClick={() => window.dispatchEvent(new Event('access-profile-retry'))}>{t("重新读取权限")}</button></div>}
  <label className="guide-web"><input type="checkbox" checked={web} disabled={busy} onChange={e => {
        setWeb(e.target.checked);
        workspace.setField('guideSettings', old => ({
          ...old,
          web: e.target.checked
        }));
      }} />{t("补充联网论文检索")}</label>
  {web && <><small>{t("仅发送问题关键词给检索服务，不发送书籍或数据行。检索论文题名与可用摘要，不代表已阅读全文。")}</small><input aria-label={t("联网检索关键词")} value={webQuery} disabled={busy} onChange={e => {
        setWebQuery(e.target.value);
        workspace.setField('guideSettings', old => ({
          ...old,
          webQuery: e.target.value
        }));
      }} placeholder={t("可填写英文工艺关键词，提高相关性")} /></>}
  <textarea aria-label={t("向流程助手补充提问")} disabled={busy} value={question} onChange={e => setQuestion(e.target.value)} placeholder={t("补充提问，例如：需要采集哪些变量？")} maxLength={2000} />
  <button className="primary" disabled={busy || !profileReady || !project.question?.trim()} onClick={() => load(!!saved)}>{busy ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />} {busy ? t("检索与生成建议中…") : saved ? t("更新本阶段建议") : t("生成本阶段建议")}</button>
  {error && <div className="error" role="alert">{error}<a href="/?view=settings">{t("检查模型配置")}</a></div>}
  {(accessChanged || accessOutdated) && <p className="guide-stale" role="status">{t("用户等级或来源权限已变化，旧建议暂不可导入。请点击“更新本阶段建议”重新匹配技能；系统不会自动重新调用模型。")}</p>}
  {outdated && !accessOutdated && !accessChanged && <p className="guide-stale">{t("项目信息或查询条件已变化，请更新建议后再使用。")}</p>}
  {saved && <div className="guide-answer">
   <p>{saved.answer}</p>
   {recommendations.length > 0 && <section className="guide-recommendations"><h4><Sparkles size={14} />{t("推荐技能")}</h4>{recommendations.map((item, i) => <div className="guide-skill-card" key={item.skill_id || item.capability_id || i}><strong>{item.knowledge_point || t("工程分析技能")}</strong><span className={'guide-tier ' + item.tier}>{tierLabel(item.tier)}</span><p>{item.reason}</p></div>)}</section>}
   {profileReady && !accessOutdated && !recommendations.length && <p className="guide-recommendation-empty">{t("当前等级尚无匹配的已审核技能，建议结合资料核对。")}</p>}
   {[[t("建议操作"), 'steps'], [t("待验证假设"), 'hypotheses'], [t("需要补充的信息"), 'questions'], [t("本阶段输入"), 'inputs'], [t("本阶段成果"), 'outputs'], [t("适用范围与限制"), 'limitations']].map(([label, key]) => saved[key]?.length > 0 && <section key={key}><h4>{label}</h4><ul>{saved[key].map((text, i) => <li key={i}>{text}</li>)}</ul></section>)}
   {saved.warnings?.map((text, i) => <p className="guide-stale" key={i}>{text}</p>)}
   <h4><BookOpen size={14} />{t("检索来源")}</h4>
   {sources.length ? sources.map((source, index) => {
        const presentation = sourcePresentation(source, saved, profileReady ? profile : DEFAULT_ACCESS),
          Tag = presentation.url ? 'a' : 'div';
        return <Tag className="source-card" key={source.id || index} {...presentation.url ? {
          href: presentation.url,
          target: '_blank',
          rel: 'noreferrer'
        } : {}}>
     <strong>{presentation.knowledge}</strong>
     {presentation.title && <span className="guide-source-book">{presentation.title}{presentation.page ? t(" · PDF 第 ") + presentation.page + t(" 页") : ''}</span>}
     <p>{source.kind === 'book' ? t("资料库知识点") : source.kind === 'skill' ? t("已审核 Skill") : source.coverage === 'abstract' ? t("联网论文 · 摘要") : t("联网论文 · 仅题名与 DOI")}{source.tier && ['normal', 'high', 'ultra'].includes(source.tier) ? ' · ' + tierLabel(source.tier) : ''}{saved.source_ids?.includes(source.id) ? t(" · 建议引用") : t(" · 待读线索")}</p>
    </Tag>;
      }) : <p>{t("未找到相关资料。当前仅为基于项目信息的建议，请补充资料。")}</p>}
   <small>{saved.cached ? t("复用缓存建议") : t("模型生成建议")}{t("· 不会自动填写字段、计算模型或标记完成。")}</small>
  </div>}
  {!saved && !busy && !error && <p>{t("新建实际项目及第 2–10 步会自动生成首次建议。之后可补充问题并按需更新。")}</p>}
 </aside>;
}
