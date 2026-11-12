"""Offline regression checks for cross-book capability evidence grading."""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from skill_capabilities import classify, classify_catalog


def capability(result, key):
    return next(item for item in result["capabilities"] if item["id"] == key)


NORMAL = {"id": "n", "book_id": "book-n", "name": "教材甲 · 技能", "description": "解释线性回归和最小二乘的含义。"}
HIGH = {"id": "h", "book_id": "book-h", "name": "教材乙 · 技能", "description": "用线性回归分析工程变量。",
        "inputs": ["需要样本数据和变量单位。"],
        "steps": ["定义结果变量与输入变量，明确线性回归的适用条件。",
                  "选择最小二乘拟合方法并估计参数。",
                  "检查残差图和 RMSE，验证独立留出集。禁止超范围外推。"],
        "outputs": ["参数表与验证报告。"]}
ULTRA_TEXT = """# A misleading title cannot upgrade anything

## Linear regression workflow
Inputs: provided sample data and variable units.
1. Define a response variable and select a least-squares linear regression.
2. Fit parameters and calculate RMSE from residuals.
3. Validate on a holdout test set and compare bootstrap confidence intervals.
Assumption: independent measurements; do not extrapolate beyond the observed range.
A worked example: fit 5 samples; the result has RMSE = 0.12.
Use a fixed random seed for a reproducible expected output.

```python
import numpy as np
def fit(x, y):
    slope, intercept = np.polyfit(x, y, 1)
    return slope, intercept
```
"""


def run():
    baseline = classify(NORMAL)
    assert capability(baseline, "regression_modeling")["tier"] == "normal"
    assert baseline["capability_assessment"]["review_required"] is True

    stronger = classify(HIGH)
    reg = capability(stronger, "regression_modeling")
    assert reg["tier"] == "high", reg
    assert any("独立数据验证" in reason for reason in reg["reasons"])

    # Different book titles/languages map to the same reusable ability, while
    # workflow evidence, rather than a page count, determines the tier.
    english = {"id": "english", "book_title": "Entirely another book", "description": "Linear regression and least squares concepts."}
    assert capability(classify(english), "regression_modeling")["id"] == reg["id"]
    assert capability(classify(english), "regression_modeling")["tier"] == "normal"
    noise = dict(NORMAL, name="Ultra Advanced Regression Encyclopedia", book_title="Ultra 高级建模", pages=10000, sections=500,
                 source_scope=[{"start": 1, "end": 10000}], capability_tier="ultra")
    assert classify(noise) == baseline
    repeated = dict(NORMAL, description=NORMAL["description"] * 100)
    assert capability(classify(repeated), "regression_modeling")["tier"] == "normal"
    assert classify({"name": "高阶回归实验设计 Ultra", "book_title": "统计学", "pages": 10000})["capabilities"] == []
    assert classify({"description": "回归、DOE、控制图、优化", "steps": ["需人工审核后使用"]})["capability_tier"] == "normal"

    # Multiple capabilities in one package use common IDs; boilerplate human
    # review is not a measurement/model validation criterion.
    multi = classify({"description": "Gage R&R 测量系统分析、缺失值和控制图。", "steps": ["需要人工审核，不代表验证通过。"]})
    assert {"data_quality", "process_monitoring"} <= {x["id"] for x in multi["capabilities"]}
    assert all(x["tier"] == "normal" for x in multi["capabilities"])

    with tempfile.TemporaryDirectory(prefix="skill-grade-") as tmp:
        root = Path(tmp)
        folder = root / "generated" / "artifact-h"
        folder.mkdir(parents=True)
        (folder / "SKILL.md").write_text(ULTRA_TEXT, encoding="utf-8")
        complete = classify(HIGH, folder)
        advanced = capability(complete, "regression_modeling")
        assert advanced["tier"] == "ultra", advanced
        assert any("尚未执行验证" in reason for reason in advanced["reasons"])
        assert "SKILL.md" in advanced["evidence_sources"]

        # Removing reproducibility evidence keeps executable-looking content
        # at high: a code fence is not proof of correctness or production use.
        (folder / "SKILL.md").write_text(ULTRA_TEXT.replace("Use a fixed random seed for a reproducible expected output.", ""), encoding="utf-8")
        assert capability(classify(HIGH, folder), "regression_modeling")["tier"] == "high"
        (folder / "SKILL.md").write_text(ULTRA_TEXT, encoding="utf-8")

        # A high-level title/front matter does not count as content evidence.
        title_only = root / "title-only"
        title_only.mkdir()
        (title_only / "SKILL.md").write_text("---\nname: Ultra Regression\ndescription: linear regression and DOE\n---\n# Ultra 回归百科\n\n普通说明。", encoding="utf-8")
        assert classify({"name": "Book"}, title_only)["capabilities"] == []

        # A regression section must not inherit validation and executable
        # optimization examples from a different heading.
        mixed = root / "mixed"
        mixed.mkdir()
        optimization = ULTRA_TEXT.replace("linear regression", "linear programming").replace("Linear regression", "Optimization").replace("least-squares", "constrained")
        (mixed / "SKILL.md").write_text("# Mixed book\n## Regression\nLinear regression concepts.\n## Optimization\n" + optimization, encoding="utf-8")
        mixed_reg = capability(classify({}, mixed), "regression_modeling")
        assert mixed_reg["tier"] == "normal", mixed_reg

        # External symlinks are not evaluated as the book's own skill content.
        (title_only / "outside.md").symlink_to(folder / "SKILL.md")
        assert classify({}, title_only)["capabilities"] == []

        legacy = root / "generated" / "book-n"
        legacy.mkdir()
        (legacy / "SKILL.md").write_text(ULTRA_TEXT, encoding="utf-8")
        catalog = {"books": [], "skills": [dict(NORMAL, mode="template"),
                   dict(HIGH, artifact_id="artifact-h", mode="book-to-skill"),
                   dict(NORMAL, id="legacy", mode="book-to-skill"),
                   dict(NORMAL, id="template-with-artifact", mode="template", artifact_id="artifact-h"),
                   {"id": "unsafe", "mode": "book-to-skill", "artifact_id": "../artifact-h", "description": "线性回归概念。"}]}
        path = root / "catalog.json"
        saved = json.dumps(catalog, ensure_ascii=False)
        path.write_text(saved, encoding="utf-8")
        graded = classify_catalog(root)
        assert set(graded) == {"n", "h", "unsafe", "legacy", "template-with-artifact"}
        assert graded["h"]["capability_tier"] == "ultra"
        assert graded["legacy"]["capability_tier"] == "ultra"
        # Templates never borrow the full generated book, even when a same-book
        # legacy folder or an explicit artifact_id happens to be present.
        assert graded["n"] == baseline
        assert graded["template-with-artifact"] == baseline
        assert graded["unsafe"]["capability_tier"] == "normal"
        assert path.read_text(encoding="utf-8") == saved
        command = [sys.executable, str(Path(__file__).with_name("skill_capabilities.py"))]
        cli = subprocess.run(command, input=json.dumps({"action": "classify_catalog", "root": str(root)}), text=True, capture_output=True, check=True)
        assert json.loads(cli.stdout) == graded
        direct = subprocess.run(command, input=json.dumps({"action": "classify", "skill": HIGH, "folder": str(folder)}), text=True, capture_output=True, check=True)
        assert json.loads(direct.stdout) == complete
        bad = subprocess.run(command, input=json.dumps({"action": "unexpected"}), text=True, capture_output=True)
        assert bad.returncode and "action" in bad.stderr

    print("PASS: shared cross-book abilities; conservative normal/high/ultra evidence; metadata and length immunity; multiple capabilities; section boundaries; symlink/path containment; read-only catalog and JSON CLI")


if __name__ == "__main__":
    run()
