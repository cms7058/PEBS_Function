"""Explainable, offline initial grading of generated engineering skill content.

The grade measures evidence in a skill package, not the reputation of its book,
the amount extracted, or demonstrated accuracy. It must be reviewed by a human.
This module reads generated notes only; it neither calls a model nor writes a
catalog. ``classify_catalog`` returns an id -> assessment map for the caller.
"""

import json
import re
import sys
from pathlib import Path

VERSION = "evidence-v1"
MAX_FILES = 160
MAX_BYTES = 4 * 1024 * 1024
TIERS = ("normal", "high", "ultra")

# IDs describe a capability shared by different books, rather than a book title.
CAPABILITIES = (
    ("problem_definition", "问题定义", r"问题定义|问题识别|业务问题|成功标准|项目范围|problem definition|problem statement|project charter", r"问题陈述|SMART|5W[12]H|CTQ|VOC|project charter|success criteria"),
    ("bottleneck_analysis", "瓶颈分析", r"瓶颈|约束理论|限制理论|价值流|bottleneck|theory of constraints|value stream", r"TOC|五步聚焦|five focusing steps|价值流图|value.stream map|节拍|takt|吞吐量|throughput|约束识别"),
    ("variable_definition", "变量定义", r"变量定义|变量字典|结果变量|影响因素|可控因素|variable dictionary|response variable|predictor|independent variable|dependent variable", r"操作性定义|测量口径|因果图|operational definition|causal diagram|DAG|单位|unit|编码|coding"),
    ("data_quality", "数据质量", r"数据质量|缺失值|测量系统|测量可靠性|data quality|missing data|measurement system|gauge r.?r|gage r.?r", r"缺失值|重复记录|Gage|Gauge|量具|校准|calibration|一致性|重复性|再现性|repeatability|reproducibility|异常值|outlier"),
    ("regression_modeling", "回归建模", r"回归|regression|least.squares|最小二乘", r"线性回归|非线性回归|多项式回归|最小二乘|linear regression|nonlinear regression|polynomial regression|least.squares|岭回归|ridge|LASSO|curve_fit"),
    ("experiment_design", "实验设计", r"实验设计|试验设计|实验方案|实验预算|确认实验计划|正交试验|析因|design of experiments|\bDOE\b|factorial design", r"随机化|randomization|区组|blocking|析因|factorial|中心点|center point|响应面|response surface|正交|orthogonal|D.optimal"),
    ("model_validation", "模型验证", r"模型验证|模型检验|独立验证|model validation|cross.validation|交叉验证|留出集|holdout", r"交叉验证|cross.validation|独立验证|holdout|留出集|残差|residual|RMSE|MAE|确认实验|confirmation experiment"),
    ("optimization_simulation", "优化与仿真", r"优化|仿真|optimization|simulation|蒙特卡洛|Monte Carlo", r"目标函数|约束优化|objective function|constraint|线性规划|linear programming|整数规划|integer programming|Monte Carlo|蒙特卡洛|离散事件|discrete.event|敏感性分析|sensitivity analysis"),
    ("improvement_implementation", "改善实施", r"改善实施|改善方案|实施计划|作业指导书|implementation plan|improvement plan|standard operating procedure|\bSOP\b", r"PDCA|DMAIC|责任人|负责人|owner|验收|acceptance|作业指导书|standard operating procedure|试点|pilot"),
    ("process_monitoring", "过程监控", r"过程监控|控制图|统计过程控制|过程控制|process monitoring|control chart|statistical process control|\bSPC\b", r"控制图|control chart|EWMA|CUSUM|Shewhart|控制限|control limit|特殊原因|special cause|西电规则|Western Electric|漂移|drift"),
    ("reliability", "可靠性分析", r"可靠性分析|寿命分析|生存分析|reliability analysis|life.data|survival analysis|Weibull|威布尔", r"Weibull|威布尔|删失|censoring|Kaplan.Meier|加速寿命|accelerated life|失效率|hazard|生存函数|survival function"),
)

ACTION_TERMS = (
    r"定义|界定|define", r"选择|确定|select|choose|specify", r"采集|收集|collect",
    r"拟合|估计|fit|estimate", r"计算|求解|calculate|compute|solve",
    r"检查|检验|check|test|diagnos", r"比较|评估|compare|evaluate",
    r"验证|validate|verify", r"实施|执行|implement|execute",
    r"监控|跟踪|monitor|track", r"修正|修复|修复|correct|repair",
)

# These are concrete verification dimensions, not generic "human review" text.
VALIDATION_TERMS = (
    ("误差或残差诊断", r"残差|residual|RMSE|MAE|预测误差|prediction error"),
    ("独立数据验证", r"交叉验证|cross.validation|独立(?:数据|样本|测试|验证)|留出集|holdout|test set|out.of.sample"),
    ("不确定性评估", r"置信区间|confidence interval|预测区间|prediction interval|bootstrap|自助法|不确定性(?:量化|评估|区间)|uncertainty quantification"),
    ("稳定性或敏感性检查", r"敏感性分析|sensitivity analysis|稳健性(?:分析|检验)|robustness test|稳定性(?:检验|分析)|stability test"),
    ("测量或数据校验", r"重复性(?:检验|分析)|再现性(?:检验|分析)|measurement validation|校准(?:记录|检验|报告)|calibration (?:record|test)|缺失率|重复率|missing rate|duplicate rate"),
    ("现场或确认验证", r"确认实验|确认试验|现场验证|confirmation experiment|pilot validation|acceptance test|验收测试"),
)

LIMIT_TERMS = r"适用(?:条件|范围)|不适用|前提|约束条件|安全边界|边界条件|外推|超出.{0,8}范围|失效条件|applicability|assumption|precondition|extrapolat|safety bound|boundary condition|failure condition"
INPUT_TERMS = r"(?:输入|采集|需要|所需|provided|required|collect|input).{0,35}(?:数据|样本|变量|单位|记录|data|sample|variable|unit|record)|(?:输入|inputs)\s*[:：\n]|变量字典|variable dictionary"
REPRO_TERMS = r"随机种子|random seed|固定种子|复现|reproducible|版本记录|version record|单元测试|unit test|测试用例|test case|预期(?:结果|输出)|expected (?:result|output)|示例输出|example output"
WORKED_TERMS = r"(?:示例|算例|案例|worked example|numerical example).{0,180}(?:\d+\.?\d*).{0,180}(?:计算|拟合|结果|误差|output|result|fit|error)|(?:\d+\.?\d*).{0,90}(?:=|得到|结果为|yields)\s*-?\d+\.?\d*"


def _matches(pattern, text):
    return bool(re.search(pattern, text, re.I))


def _clean_markdown(text):
    # YAML name/description and the first top-level heading commonly contain a
    # book name. Grade body evidence, not branding or front-matter tier claims.
    text = re.sub(r"\A\s*---\s*\n.*?\n---\s*\n", "", text, count=1, flags=re.S)
    text = re.sub(r"(?m)^# [^\n]+\n", "", text, count=1)
    # Chapter indexes/tables of contents name methods but provide no procedure.
    text = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("|"))
    return text


def _documents(skill, folder):
    parts = []
    description = skill.get("description")
    if isinstance(description, str):
        parts.append(description)
    for field in ("inputs", "steps", "outputs"):
        value = skill.get(field, [])
        if isinstance(value, list):
            title = {"inputs": "Inputs", "steps": "Steps", "outputs": "Outputs"}[field]
            parts.append(title + ":\n" + "\n".join(f"{i + 1}. {item}" for i, item in enumerate(value) if isinstance(item, str)))
    docs = [("技能摘要", "\n\n".join(parts))]
    if not folder:
        return docs, []
    root = Path(folder).resolve()
    if not root.is_dir():
        return docs, ["生成包目录不存在，仅依据保存的技能摘要初评"]
    # Never read external symlink targets or follow instructions in the content.
    files = sorted(root.rglob("*.md"))
    warnings = []
    total = 0
    for file in files[:MAX_FILES]:
        if file.is_symlink() or not file.is_file():
            continue
        try:
            file.resolve().relative_to(root)
        except ValueError:
            continue
        size = file.stat().st_size
        if total + size > MAX_BYTES:
            warnings.append("生成包超过离线初评读取上限，需要人工查看未读内容")
            break
        total += size
        docs.append((file.relative_to(root).as_posix(), _clean_markdown(file.read_text(encoding="utf-8", errors="replace"))))
    if len(files) > MAX_FILES:
        warnings.append("生成包文件数超过离线初评读取上限，需要人工查看未读内容")
    return docs, warnings


def _windows(text, pattern):
    """Keep evidence near this specific capability, not unrelated book chapters."""
    windows = []
    for match in re.finditer(pattern, text, re.I):
        # Bound by a same-or-higher Markdown heading as well as character count.
        lo, hi = max(0, match.start() - 900), min(len(text), match.end() + 1400)
        before = list(re.finditer(r"(?m)^#{1,3} ", text[lo:match.start()]))
        after = re.search(r"(?m)^#{1,3} ", text[match.end():hi])
        if before:
            lo += before[-1].start()
        if after:
            hi = match.end() + after.start()
        windows.append((lo, hi))
    # Repeated mentions do not add score or create quadratically large text.
    # Merge overlapping evidence windows before applying the fixed criteria.
    merged = []
    for lo, hi in sorted(windows):
        if merged and lo <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], hi))
        else:
            merged.append((lo, hi))
    return "\n\n".join(text[lo:hi] for lo, hi in merged)


def _executable(text):
    blocks = re.findall(r"```(?:python|py|r|rust|julia|javascript|js|sql)?\s*\n(.*?)```", text, re.I | re.S)
    # A fenced method name/pseudocode alone is insufficient. Require runnable
    # statement structure; the assessment still does not execute or verify it.
    return any(_matches(r"(?:import |from .+ import |def \w+\(|function\s*\w*\(|<-|fn \w+\(|SELECT .+ FROM )", code)
               and _matches(r"[=<(]\s*[^\n]+|return |print\(|\.fit\(|lm\(", code) for code in blocks)


def classify(skill, folder=None):
    if not isinstance(skill, dict):
        raise ValueError("skill 必须是对象")
    docs, warnings = _documents(skill, folder)
    found = []
    for capability_id, label, aliases, methods in CAPABILITIES:
        evidence = []
        sources = []
        for source, text in docs:
            nearby = _windows(text, aliases)
            if nearby.strip():
                sources.append(source)
                evidence.append(nearby)
        if not evidence:
            continue
        text = "\n\n".join(evidence)
        named_method = _matches(methods, text)
        actions = sum(_matches(pattern, text) for pattern in ACTION_TERMS)
        procedure = actions >= 3 and _matches(r"(?:^|\n)\s*(?:\d+[.)、]|[-*] ).+|步骤|procedure|workflow", text)
        inputs = _matches(INPUT_TERMS, text)
        validation = [name for name, pattern in VALIDATION_TERMS if _matches(pattern, text)]
        limits = _matches(LIMIT_TERMS, text)
        executable = _executable(text)
        worked = _matches(WORKED_TERMS, text)
        reproducible = _matches(REPRO_TERMS, text)
        score = min(100, 10 + 20 * named_method + 20 * procedure + 10 * inputs
                    + min(20, len(validation) * 10) + 10 * limits
                    + 15 * executable + 10 * worked + 5 * reproducible)
        tier = "normal"
        if named_method and procedure and (validation or limits) and score >= 55:
            tier = "high"
        if (tier == "high" and inputs and len(validation) >= 2 and limits
                and (executable or worked) and reproducible and score >= 85):
            tier = "ultra"
        reasons = ["发现与该能力相关的内容证据"]
        if named_method:
            reasons.append("包含具体方法或工程框架")
        if procedure:
            reasons.append("包含选择、执行、检查等可操作步骤")
        if inputs:
            reasons.append("说明所需数据或输入")
        if validation:
            reasons.append("验证证据：" + "、".join(validation))
        if limits:
            reasons.append("说明适用前提或使用边界")
        if executable:
            reasons.append("包含计算代码；尚未执行验证")
        if worked:
            reasons.append("包含可核对的数值算例；尚未核实计算正确性")
        if reproducible:
            reasons.append("包含复现或预期输出线索")
        if tier == "normal":
            reasons.append("尚不足以确认完整操作流程及验证条件，保守列为 normal")
        elif tier == "high":
            reasons.append("已具备方法、流程和验证或边界证据；尚未满足 Ultra 的复现与多维验证要求")
        else:
            reasons.append("已具备流程、复现线索、多维验证及使用边界，初评为 Ultra")
        found.append({"id": capability_id, "label": label, "tier": tier, "score": score,
                      "reasons": reasons, "evidence_sources": sources[:12]})
    overall = max((item["tier"] for item in found), key=TIERS.index, default="normal")
    return {"capability_tier": overall, "capabilities": found,
            "capability_assessment": {"version": VERSION, "method": "content_evidence",
                "review_required": True,
                "note": "这是生成内容的可解释初评，需人工确认；评分不代表模型性能、计算正确性或现场效果。",
                "warnings": warnings + ([] if found else ["未找到明确工程能力内容，保守列为 normal，请人工补充分类"])}}


def classify_catalog(root):
    root = Path(root).resolve()
    catalog = json.loads((root / "catalog.json").read_text(encoding="utf-8"))
    skills = catalog.get("skills", [])
    if not isinstance(skills, list):
        raise ValueError("catalog.skills 必须是数组")
    result = {}
    for skill in skills:
        if not isinstance(skill, dict) or not isinstance(skill.get("id"), str):
            continue
        artifact = skill.get("artifact_id") or skill.get("book_id")
        folder = None
        # Templates from the same book are separate curated capabilities, not
        # aliases for that book's complete generated artifact. Only a generated
        # package may inherit evidence from generated/<artifact or book id>.
        if skill.get("mode") == "book-to-skill" and isinstance(artifact, str) and re.fullmatch(r"[A-Za-z0-9_-]+", artifact):
            folder = root / "generated" / artifact
        result[skill["id"]] = classify(skill, folder)
    return result


def main():
    payload = json.load(sys.stdin)
    action = payload.get("action", "classify")
    if action == "classify":
        value = classify(payload.get("skill"), payload.get("folder"))
    elif action == "classify_catalog":
        value = classify_catalog(payload["root"])
    else:
        raise ValueError("action 必须是 classify 或 classify_catalog")
    print(json.dumps(value, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
