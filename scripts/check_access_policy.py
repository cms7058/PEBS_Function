"""Isolated membership/role policy HTTP checks against a local Responses mock.

Uses disposable catalog/profile state and a copy of the built backend. No book
content or model request leaves localhost; no real model service is contacted.
"""
import argparse
import copy
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from check_book_to_skill import free_port, request

ROOT = Path(__file__).resolve().parents[1]


class LocalModel(BaseHTTPRequestHandler):
    calls = []

    def log_message(self, *_):
        pass

    def do_POST(self):
        assert self.path == "/v1/responses", self.path
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        assert body["store"] is False
        props = body["text"]["format"]["schema"]["properties"]
        content = body["input"][1]["content"]
        if "fields" in props:
            kind = "materials"
            payload = json.loads(content)
            stage = payload["context"]["stage"]
            result = {
                "summary": "根据已确认建议建立采集表，模拟范围仅供预览。",
                "fields": [{"key": "plannedY", "value": "强度 MPa"}, {"key": "plannedXs", "value": "温度 °C"}] if stage == 3 else [],
                "variables": [
                    {"name": "温度", "role": "X", "unit": "°C", "definition": "记录测量温度", "min": 100, "max": 200},
                    {"name": "强度", "role": "Y", "unit": "MPa", "definition": "记录测量强度", "min": 30, "max": 80},
                ],
                "collection_headers": ["批次", "温度 °C", "强度 MPa"],
                "analysis_plan": [{"item": "检查测量一致性", "method": "对照仪器", "required": "采集记录", "decision": "核对单位后再拟合"}],
                "instructions": ["先确认测量口径"],
            }
        elif "source_ids" in props:
            kind = "guide"
            payload = json.loads(content)
            result = {key: [] for key in props}
            result.update(answer="建议先核对连续变量与采样条件，再选择回归模型。", steps=["确认温度与强度的测量口径"], questions=["是否覆盖不同批次？"], inputs=["温度与强度数据"], outputs=["验证计划"], hypotheses=["温度可能影响强度，需验证"], limitations=["不能替代现场独立验证"], source_ids=[s["id"] for s in payload["evidence"]])
        else:
            kind = "apply"
            payload = content
            result = {"answer": "先确认变量与测量口径，再验证模型。", "steps": ["采集测量数据", "验证预测误差"], "limitations": ["使用现场数据验证"], "sources": ["SKILL.md", "chapters/ch001.md"]}
        LocalModel.calls.append({"kind": kind, "payload": copy.deepcopy(payload)})
        result = {key: result[key] for key in props}
        raw = json.dumps({"status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps(result)}]}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def expect_error(base, path, method, data, status):
    before = len(LocalModel.calls)
    try:
        request(base, path, method, data)
    except urllib.error.HTTPError as error:
        value = json.loads(error.read())
        assert error.code == status, (path, error.code, value)
        assert value.get("error"), value
    else:
        raise AssertionError("Unexpected success: " + path)
    assert len(LocalModel.calls) == before, "rejected action contacted the model"


def seed(root):
    catalog = root / "catalog"
    catalog.mkdir()
    books, skills = [], []
    for index, tier in enumerate(("normal", "high", "ultra")):
        book = {"id": "book-" + tier, "title": "私有工程书 " + tier, "uploaded_at": 1, "created_at": 1, "pages": 1, "processed": True, "indexed": True, "stages": [3, 5, 6]}
        books.append(book)
        skill = {"id": "reg-" + tier, "artifact_id": "artifact-" + tier, "book_id": book["id"], "book_title": book["title"], "name": book["title"] + " · 已审核回归技能", "description": "regression temperature strength validation", "mode": "book-to-skill", "status": "reviewed", "stages": [3, 5, 6], "inputs": ["测量数据"], "steps": ["定义变量", "拟合与验证"], "outputs": ["验证模型"], "note": "须现场验证", "source": {"page": 1}, "capability_tier": tier, "capabilities": [{"id": "regression_modeling", "label": "回归建模", "tier": tier, "score": 50 + index * 20, "reasons": ["测试用人工等级"]}], "capability_assessment": {"version": 1, "method": "manual", "review_required": False, "note": "测试人工确认"}}
        skills.append(skill)
        (catalog / (book["id"] + ".json")).write_text(json.dumps([{"page": 1, "text": book["title"] + " Measurement temperature strength regression residual validation quality."}], ensure_ascii=False))
        folder = catalog / "generated" / skill["artifact_id"]
        (folder / "chapters").mkdir(parents=True)
        (folder / "SKILL.md").write_text("---\nname: reg-" + tier + "\ndescription: Engineering regression\n---\n# " + skill["name"] + "\nREGRESSION_PAYLOAD_" + tier + "\nDefine measurable factors and validate regression.")
        (folder / "chapters/ch001.md").write_text("Regression measurement and validation. REGRESSION_CHAPTER_" + tier)
    (catalog / "catalog.json").write_text(json.dumps({"books": books, "skills": skills}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--serve", action="store_true", help="Keep disposable QA backend/mock running after checks")
    parser.add_argument("--port", type=int)
    args = parser.parse_args()
    LocalModel.calls = []
    with tempfile.TemporaryDirectory(prefix="access-policy-qa-") as temporary:
        root = Path(temporary)
        for name in ("pages.json", "library.json"):
            shutil.copy2(ROOT / "data" / name, root / name)
        seed(root)
        binary = root / "api"
        shutil.copy2(ROOT / "backend/target/debug/nist-model-api", binary)
        mock = HTTPServer(("127.0.0.1", free_port()), LocalModel)
        thread = threading.Thread(target=mock.serve_forever, daemon=True)
        thread.start()
        port = args.port or free_port()
        base = "http://127.0.0.1:" + str(port)
        env = {**os.environ, "PORT": str(port), "DATA_DIR": temporary, "BOOK_TO_SKILL_PROVIDER": "openai", "BOOK_TO_SKILL_MODEL": "local-access-mock", "OPENAI_API_KEY": "local-only", "BOOK_TO_SKILL_API_BASE": "http://127.0.0.1:" + str(mock.server_port) + "/v1"}
        app = None

        def start():
            process = subprocess.Popen([str(binary)], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            for _ in range(100):
                if process.poll() is not None:
                    raise RuntimeError(process.stderr.read().decode())
                try:
                    request(base, "/api/health")
                    return process
                except OSError:
                    time.sleep(.05)
            process.terminate()
            process.wait(timeout=5)
            raise RuntimeError("Access policy QA backend did not start")

        def profile(tier, role="user"):
            value = request(base, "/api/access-profile", "PUT", {"tier": tier, "role": role})
            assert value["tier"] == tier and value["role"] == role
            assert value["show_book_names"] == (role in ("researcher", "admin"))
            return value

        context = {"stage": 5, "project": {"name": "权限测试工程", "question": "温度对强度的影响，需要回归建模", "target": "建立可验证预测"}, "data": {"rows": 0, "columns": []}, "model": None}
        guides = {}
        try:
            app = start()
            default = request(base, "/api/access-profile")
            assert default["tier"] == "normal" and default["role"] == "user" and not default["show_book_names"]
            for payload in ({"tier": "enterprise", "role": "user"}, {"tier": "normal", "role": "owner"}):
                expect_error(base, "/api/access-profile", "PUT", payload, 400)
                assert request(base, "/api/access-profile") == default

            for tier in ("normal", "high", "ultra"):
                profile(tier)
                value = request(base, "/api/project-guide", "POST", {"context": context, "web": False, "tier": "ultra", "role": "admin", "access": {"tier": "ultra", "role": "admin", "show_book_names": True}})
                guides[tier] = value
                assert value["access"] == {"tier": tier, "role": "user", "show_book_names": False}
                assert [r["skill_id"] for r in value["recommendations"]] == ["reg-" + tier], value["recommendations"]
                assert value["recommendations"][0]["tier"] == tier
                assert all(s["title"] == s["knowledge_point"] and "url" not in s and "book_title" not in s for s in value["sources"])
                assert "私有工程书" not in json.dumps(value, ensure_ascii=False)
                evidence = LocalModel.calls[-1]["payload"]["evidence"]
                text = json.dumps(evidence, ensure_ascii=False)
                assert "REGRESSION_PAYLOAD_" + tier in text
                for other in ("normal", "high", "ultra"):
                    if other != tier:
                        assert "REGRESSION_PAYLOAD_" + other not in text, "retrieved another tier's package"
                calls = len(LocalModel.calls)
                assert request(base, "/api/project-guide", "POST", {"context": context, "web": False})["cached"]
                assert len(LocalModel.calls) == calls
            print("PASS: default/invalid profiles, authoritative backend tiers, capability recommendation, hidden names/URLs, isolated cache", flush=True)

            profile("normal")
            for tier in ("high", "ultra"):
                expect_error(base, "/api/skills/reg-" + tier + "/apply", "POST", {"question": "如何验证回归？", "stage": 7, "tier": "ultra", "access": {"tier": "ultra"}}, 403)
            normal_apply = request(base, "/api/skills/reg-normal/apply", "POST", {"question": "如何验证回归？", "stage": 7})
            assert normal_apply["skill_id"] == "reg-normal" and LocalModel.calls[-1]["kind"] == "apply"
            profile("high")
            high_apply = request(base, "/api/skills/reg-high/apply", "POST", {"question": "如何验证回归？", "stage": 7})
            assert high_apply["skill_id"] == "reg-high"
            expect_error(base, "/api/skills/reg-ultra/apply", "POST", {"question": "如何验证回归？", "stage": 7}, 403)
            print("PASS: direct high/Ultra calls denied without model access; entitled calls succeed", flush=True)

            stale = guides["normal"]
            expect_error(base, "/api/project-materials", "POST", {"context": context, "guide": stale}, 400)
            expect_error(base, "/api/project-materials", "POST", {"context": context, "guide": {key: value for key, value in guides["high"].items() if key != "access"}}, 400)
            expect_error(base, "/api/project-materials", "POST", {"context": context, "guide": {**guides["high"], "access_stale": True}}, 400)
            material = request(base, "/api/project-materials", "POST", {"context": context, "guide": guides["high"]})
            assert material["stage"] == 5 and material["collection_headers"] and LocalModel.calls[-1]["kind"] == "materials"
            print("PASS: stale/legacy access materials denied before model call; matching access works", flush=True)

            profile("high", "researcher")
            named = request(base, "/api/project-guide", "POST", {"context": context, "web": False})
            assert named["access"] == {"tier": "high", "role": "researcher", "show_book_names": True}
            assert any(s.get("book_title") == "私有工程书 high" and s.get("url") for s in named["sources"] if s["kind"] == "skill")
            assert "私有工程书 high" in json.dumps(LocalModel.calls[-1]["payload"]["evidence"], ensure_ascii=False)
            expect_error(base, "/api/project-materials", "POST", {"context": context, "guide": guides["high"]}, 400)

            classification_path = "/api/skills/reg-normal/classification"
            original_skill = next(s for s in request(base, "/api/skills") if s["id"] == "reg-normal")
            for payload in (
                {"capabilities": [{"id": "regression_modeling", "tier": "expert"}], "reason": "无效等级"},
                {"capabilities": [{"id": "missing_capability", "tier": "high"}], "reason": "无效能力"},
                {"capabilities": [{"id": "regression_modeling", "tier": "high"}], "reason": ""},
            ):
                expect_error(base, classification_path, "PATCH", payload, 400)
                assert next(s for s in request(base, "/api/skills") if s["id"] == "reg-normal") == original_skill
            graded = request(base, classification_path, "PATCH", {"capabilities": [{"id": "regression_modeling", "tier": "high"}], "reason": "审核确认包含残差诊断与独立验证流程"})
            assert graded["capability_tier"] == "high" and graded["capability_assessment"]["method"] == "manual"
            assert graded["capabilities"][0]["tier"] == "high" and not graded["capability_assessment"]["review_required"]
            before = len(LocalModel.calls)
            evaluated = request(base, "/api/skills/evaluate", "POST")
            assert evaluated["updated"] == 0 and len(LocalModel.calls) == before
            assert next(s for s in request(base, "/api/skills") if s["id"] == "reg-normal") == graded
            print("PASS: source names by role, grade input validation, manual confirmation preserved by reevaluation", flush=True)

            stored_profile = request(base, "/api/access-profile")
            app.terminate()
            app.wait(timeout=5)
            app = start()
            assert request(base, "/api/access-profile") == stored_profile
            persisted = next(s for s in request(base, "/api/skills") if s["id"] == "reg-normal")
            assert persisted == graded
            profile("normal", "admin")
            expect_error(base, "/api/skills/reg-high/apply", "POST", {"question": "角色是否绕过会员等级？"}, 403)
            assert request(base, "/api/access-profile")["show_book_names"], "role display access is independent from skill tier"
            print("PASS: profile/manual grade survive restart; administrator role does not bypass membership tier", flush=True)
            if args.serve:
                profile("normal", "user")
                request(base, classification_path, "PATCH", {"capabilities": [{"id": "regression_modeling", "tier": "normal"}], "reason": "恢复隔离浏览器测试的 normal 技能"})
                project = request(base, "/api/projects", "POST", {"name": "权限与推荐隔离测试工程", "question": "温度对强度的影响，需要回归建模", "target": "建立可验证预测；所有数据为人工构造的测试数据"})
                state = project["state"]
                state["stage"] = 6
                state["completed"] = [1, 2, 3, 4, 5]
                state["project"].update(plannedY="强度 MPa", plannedXs="温度 °C", scope="仅供隔离页面测试，数据人工构造", constraints="现场结论需要真实数据")
                state["data"] = {"columns": ["温度 °C", "强度 MPa"], "rows": [[100 + i * 4, 40 + i * 1.3 + (i % 3) * .4] for i in range(20)], "label": "隔离测试人工构造数据", "issues": [], "synthetic": False}
                state["xs"], state["y"] = [0], 1
                state["guideSettings"] = {"web": False}
                stage6_context = {"stage": 6, "project": state["project"], "data": {"columns": state["data"]["columns"], "rows": 20, "issues": [], "synthetic": False}, "variables": {"xs": ["温度 °C"], "y": "强度 MPa"}, "method": state["method"], "model": None, "user_question": ""}
                stage6 = request(base, "/api/project-guide", "POST", {"context": stage6_context, "web": False})
                stage6["request"] = {"web": False, "webQuery": "", "question": ""}
                state["guidance"] = {"6": stage6}
                request(base, "/api/projects/" + project["id"], "PUT", {"state": state})
                print("Access QA ready: " + base + " project=" + project["id"] + " data=" + temporary, flush=True)
                while app.poll() is None:
                    time.sleep(.5)
        finally:
            if app is not None and app.poll() is None:
                app.terminate()
                app.wait(timeout=5)
            mock.shutdown()
            mock.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
