import { t } from "./i18n";
import React, { useState } from 'react';
import { tierLabel, capabilityGroups } from './skill-tiers.js';
import './skill-capabilities.css';
export function TierBadge({
  tier
}) {
  return <span className={'tier-badge tier-' + (tier || 'normal')}>{tierLabel(tier)}</span>;
}
export function CapabilityGroups({
  skills,
  open
}) {
  const groups = capabilityGroups(skills);
  return <section className="capability-groups"><h3>{t("按能力比较技能")}</h3><p className="footnote">{t("同一能力可来自不同书籍，按内容证据分级。一个技能包可包含多种能力，包等级取其中最高等级。")}</p>{groups.length ? <div className="capability-group-grid">{groups.map(g => <article key={g.id}><h4>{g.label}<small> · {g.items.length}{t("个技能")}</small></h4>{g.items.map(({
          skill,
          capability
        }) => <button className="capability-item" key={skill.id} onClick={() => open(skill)}><TierBadge tier={capability.tier} /><span>{skill.name}<small>{skill.book_title} · {skill.status === 'reviewed' ? t("已审核") : t("待审核")}</small></span></button>)}</article>)}</div> : <p>{t("尚无能力评级，点击“评估技能等级”进行内容评估。")}</p>}</section>;
}
export function CapabilityAssessment({
  skill,
  busy,
  save
}) {
  const [tiers, setTiers] = useState(() => Object.fromEntries((skill.capabilities || []).map(c => [c.id, c.tier]))),
    [reason, setReason] = useState('');
  return <section className="capability-assessment"><h4>{t("能力评级")}<TierBadge tier={skill.capability_tier} /></h4><p>{skill.capability_assessment?.note || t("等待内容评估。")}{skill.capability_assessment?.review_required && t(" 当前为初评，需人工确认。")}</p>{skill.capabilities?.map(c => <article key={c.id}><strong>{c.label}</strong><TierBadge tier={c.tier} /><ul>{c.reasons?.map((r, i) => <li key={i}>{r}</li>)}</ul></article>)}{save && skill.capabilities?.length > 0 && <details><summary>{t("人工确认或调整等级")}</summary><p className="footnote">{t("normal：基础方法；high：具体方法、可执行流程及验证条件；Ultra：另有可核对计算或代码、多维验证及限制说明。请核对原文和技能包后填写理由。")}</p>{skill.capabilities.map(c => <label key={c.id}>{c.label}<select aria-label={c.label + t("等级")} disabled={busy} value={tiers[c.id]} onChange={e => setTiers(v => ({
          ...v,
          [c.id]: e.target.value
        }))}><option value="normal">normal</option><option value="high">high</option><option value="ultra">Ultra</option></select></label>)}<label>{t("确认理由")}<textarea aria-label={t("等级确认理由")} value={reason} disabled={busy} maxLength={1000} onChange={e => setReason(e.target.value)} placeholder={t("说明哪些步骤、验证或示例支持该等级")} /></label><button className="outline" disabled={busy || !reason.trim()} onClick={() => save({
        capabilities: skill.capabilities.map(c => ({
          id: c.id,
          tier: tiers[c.id]
        })),
        reason
      })}>{t("保存等级确认")}</button></details>}</section>;
}
