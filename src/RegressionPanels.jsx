import { t } from "./i18n";
import React from 'react';
import { methods, parameterCount, scenarioPrediction } from './regression';
const fmt = (v, d = 4) => Number.isFinite(v) ? v.toFixed(d) : '—';
export function MethodPicker({
  method,
  onChange,
  k,
  n
}) {
  const params = parameterCount(method, k),
    train = Math.floor(n * .8),
    chosen = methods.find(m => m.id === method) || methods[0];
  return <><div className="regression-methods" role="radiogroup" aria-label={t("建模方法")}>{methods.map(m => <label key={m.id} className={'regression-choice ' + (m.id === method ? 'selected' : '')}><input type="radio" name="regression-method" value={m.id} checked={method === m.id} onChange={() => onChange(m.id)} /><div><strong>{t(m.name)}</strong><p>{t(m.description)}</p><small>{t(m.condition)}</small></div></label>)}</div><div className="formula regression-formula">{chosen.formula}</div><p>{t("当前选择：")}{params}{t("个参数，")}{train}{t("个训练样本。至少需要")}{params * 3}{t("个训练样本。")}</p>{train < params * 3 && <div className="error" role="alert">{t("样本量不足，请减少因素、补充数据或选择更简单的方法。")}</div>}<div className="info"><p>{t("前 80% 数据用于拟合，后 20% 用于一次留出验证。二次与交互模型对参数仍为线性；指数和幂函数采用迭代非线性拟合。请结合工程机理选择方法，反复依据同一留出集挑选模型后，还需新的独立数据验证。")}<br /><a href={method === 'exponential' || method === 'power' ? 'https://www.itl.nist.gov/div898/handbook/pmd/section1/pmd142.htm' : 'https://www.itl.nist.gov/div898/handbook/pmd/section4/pmd431.htm'} target="_blank" rel="noreferrer">{t("查看 NIST 方法说明 ↗")}</a></p></div></>;
}
export function ModelDetails({
  model
}) {
  if (!model) return null;
  const terms = model.terms || [{
    name: '常数项',
    coefficient: model.intercept
  }, ...model.factors.map(f => ({
    name: f.name,
    coefficient: f.coefficient
  }))];
  return <><div className="formula regression-formula">{model.formula || t("线性模型：截距 + 各因素系数 × 因素值")}</div>{model.prediction_spec && <><p>{t("公式使用训练数据的标准化变量：")}</p><ul className="regression-normalization">{model.factors.map((f, j) => <li key={f.name}>z{j + 1} = ({model.prediction_spec.transform === 'log' ? `ln(${f.name})` : f.name} − {fmt(f.center, 6)}) / {fmt(f.scale, 6)}</li>)}</ul></>}<div className="table-wrap"><table><thead><tr><th>{t("模型项")}</th><th>{t("系数")}</th><th>{t("说明")}</th></tr></thead><tbody>{terms.map((t, j) => <tr key={j}><td>{t.name}</td><td>{fmt(t.coefficient, 6)}</td><td>{model.prediction_spec?.link === 'exp' ? t("指数内部的参数") : t.factors?.length === 2 ? t("曲率或交互项") : t("标准化模型参数")}</td></tr>)}</tbody></table></div>{model.solver && <p className="footnote">{model.solver.algorithm} · {model.solver.iterations ? `${model.solver.iterations} 次迭代，已收敛` : t("直接求解完成")} · {model.parameter_count}{t("个参数")}</p>}{model.warnings?.map(w => <div className="info" key={w}><p>{w}</p></div>)}</>;
}
export function ScenarioPanel({
  model,
  scenario,
  onChange
}) {
  const predicted = scenarioPrediction(model, scenario);
  return <><div className="scenario-result"><span>{t("参数组合下的预测")}{model.response}</span><strong>{fmt(predicted, 2)}<small>{t("点预测")}</small></strong><p>{t("未提供预测区间 · 候选参数需现场验证")}</p></div>{predicted === null && <div className="error">{t("当前参数组合超出模型计算范围，请调整参数。")}</div>}{model.factors.map((f, j) => <div className="slider" key={f.name}><label htmlFor={'scenario-' + j}>{f.name}<b>{fmt(scenario[f.name] ?? f.mean, 2)}</b></label><input id={'scenario-' + j} aria-label={f.name + t(" 参数试算")} type="range" min={f.min} max={f.max} step="any" value={scenario[f.name] ?? f.mean} onChange={e => onChange({
        ...scenario,
        [f.name]: +e.target.value
      })} /><div><span>{fmt(f.min, 2)}</span><span>{fmt(f.max, 2)}</span></div></div>)}<div className="info"><p>{t("预测使用当前模型的全部项，包括曲率、交互和非线性变换。滑块限制在训练数据各因素范围内，新组合仍可能缺少联合数据支持，请安排确认实验。")}</p></div></>;
}
