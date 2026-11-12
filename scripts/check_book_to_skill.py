"""End-to-end check with a local mock Responses API and disposable catalog."""

import io
import json
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.request
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def fixture_pdf():
    prose = "Engineering methods require measurable inputs, assumptions, validation, and monitored outcomes. " * 8
    stream = ("BT /F1 12 Tf 50 750 Td (" + prose + ") Tj ET").encode()
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
               b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
               b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream"]
    out = b"%PDF-1.4\n"
    offsets = []
    for number, obj in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + obj + b"\nendobj\n"
    position = len(out)
    out += b"xref\n0 6\n0000000000 65535 f \n" + b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets)
    return out + b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + str(position).encode() + b"\n%%EOF"


class ModelMock(BaseHTTPRequestHandler):
    calls = 0

    def do_POST(self):
        assert self.path in ("/v1/responses", "/api/chat", "/v1/chat/completions")
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path == "/v1/chat/completions":
            assert self.headers['Authorization'] == 'Bearer local-test-only'
            assert request['model'] == 'MiniMax-M3' and request['thinking']['type'] == 'disabled'
            fields = json.loads(request['messages'][0]['content'].split('matching this schema: ')[1])['properties']
        elif self.path == "/api/chat":
            assert request["stream"] is False and request["format"]["type"] == "object"
            fields = request["format"]["properties"]
        else:
            assert request["text"]["format"]["type"] == "json_schema"
            assert request["store"] is False
            fields = request["text"]["format"]["schema"]["properties"]
        ModelMock.calls += 1
        if "worked_example" in fields:
            result = {"title": "Measurable engineering decisions", "core_idea": "Define measurable outcomes and validate a model before use.",
                      "frameworks": ["Measurement to validation"], "methods": ["Define the response and factors"],
                      "terms": ["Response variable"], "anti_patterns": ["Using an unvalidated model"],
                      "decision_rules": ["If validation fails, collect more data"], "worked_example": "Compare a prediction with a measured outcome."}
        elif "glossary" in fields:
            result = {"description": "Apply measurement and validation principles from this book.",
                      "core_frameworks": ["Use measurement before modeling"], "glossary": ["Response — measured outcome"],
                      "patterns": ["Validation: compare predicted and actual values"],
                      "cheatsheet": ["If error is large, revisit the model"],
                      "inputs": ["Engineering problem", "Measured data"], "steps": ["Define variables", "Validate results"],
                      "outputs": ["Reviewed model"]}
        elif "answer" in fields:
            result = {"answer": "Define measurable outcomes and validate the model before use.",
                      "steps": ["Define variables", "Compare predicted and measured outcomes"],
                      "limitations": ["Confirm with original PDF and site data"],
                      "sources": ["SKILL.md", "chapters/ch001.md"]}
        else:
            result = {"title": "Engineering decisions", "core_idea": "Validate outcomes.",
                      "frameworks": ["Measurement to validation"], "decision_rules": ["Check errors before use"]}
        result = {k: result[k] for k in fields}
        if self.path == "/v1/chat/completions":
            payload = json.dumps({'choices':[{'finish_reason':'stop','message':{'content':json.dumps(result)}}]}).encode()
        elif self.path == "/api/chat":
            payload = json.dumps({"message": {"content": json.dumps(result)}}).encode()
        else:
            payload = json.dumps({"status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps(result)}]}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_):
        pass


def request(base, path, method="GET", data=None, pdf=False):
    body = data if pdf else json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(base + path, data=body, method=method,
                                 headers={"Content-Type": "application/pdf" if pdf else "application/json"})
    with urllib.request.urlopen(req, timeout=30) as response:
        content = response.read()
        return content if pdf else json.loads(content)


def main():
    with tempfile.TemporaryDirectory(prefix="book-skill-integration-") as temporary:
        for name in ("pages.json", "library.json"):
            shutil.copy2(ROOT / "data" / name, Path(temporary) / name)
        catalog = Path(temporary) / "catalog"
        catalog.mkdir()
        book = {"id": "synthetic", "title": "Synthetic engineering guide", "uploaded_at": 1, "created_at": 1,
                "pages": 1, "processed": True, "indexed": True, "stages": [2], "source_url": None, "access": None}
        static = {"id": "synthetic-template", "book_id": "synthetic", "book_title": book["title"],
                  "mode": "NIST 方法模板", "status": "draft", "stages": [2]}
        (catalog / "catalog.json").write_text(json.dumps({"books": [book], "skills": [static]}))
        (catalog / "synthetic.pdf").write_bytes(fixture_pdf())
        (catalog / "synthetic.json").write_text(json.dumps([{"page": 1, "text": "Engineering validation method"}]))
        model_port, app_port = free_port(), free_port()
        mock = HTTPServer(("127.0.0.1", model_port), ModelMock)
        thread = threading.Thread(target=mock.serve_forever, daemon=True)
        thread.start()
        env = {**os.environ, "DATA_DIR": temporary, "PORT": str(app_port), "OPENAI_API_KEY": "local-test-only",
               "BOOK_TO_SKILL_MODEL": "mock-model", "BOOK_TO_SKILL_API_BASE": f"http://127.0.0.1:{model_port}/v1"}
        env['BOOK_TO_SKILL_PROVIDER'] = os.environ.get('TEST_PROVIDER','openai')
        if env['BOOK_TO_SKILL_PROVIDER'] == 'minimax':
            env.update(MINIMAX_API_KEY='local-test-only', BOOK_TO_SKILL_MODEL='MiniMax-M3')
        ollama_env = {**env, "BOOK_TO_SKILL_PROVIDER": "ollama", "BOOK_TO_SKILL_OLLAMA_BASE": f"http://127.0.0.1:{model_port}"}
        ollama_env.pop("OPENAI_API_KEY")
        check = subprocess.run(["python3", "-c", "from scripts.book_to_skill_bridge import response_json, STRING; print(response_json('Answer in JSON', 'Validate results', {'answer': STRING})['answer'])"],
                               cwd=ROOT, env=ollama_env, capture_output=True, text=True, timeout=10)
        assert check.returncode == 0 and check.stdout.strip(), check.stderr
        app = subprocess.Popen([str(ROOT / "backend" / "target" / "debug" / "nist-model-api")], cwd=ROOT,
                               env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        base = f"http://127.0.0.1:{app_port}"
        try:
            for _ in range(80):
                if app.poll() is not None:
                    raise RuntimeError(app.stderr.read().decode())
                try:
                    request(base, "/api/health")
                    break
                except Exception:
                    time.sleep(.1)
            else:
                raise RuntimeError("Test server did not start")
            config = {'provider':'minimax','model':'MiniMax-M3','base_url':'https://api.minimax.cn/v1','api_key':'synthetic-config-secret'}
            saved = request(base, '/api/model-config', 'PUT', config)
            assert saved['has_api_key'] and 'synthetic-config-secret' not in json.dumps(saved)
            config['api_key'] = ''
            assert request(base, '/api/model-config', 'PUT', config)['has_api_key']
            assert request(base, '/api/model-config')['model'] == 'MiniMax-M3'
            stored = catalog / 'model-config.json'
            assert stored.stat().st_mode & 0o777 == 0o600
            assert json.loads(stored.read_text())['api_key'] == 'synthetic-config-secret'
            config['base_url'] = 'https://api.minimax.io/v1'
            assert not request(base, '/api/model-config', 'PUT', config)['has_api_key']
            stored.unlink()  # Resume environment-only mock integration.
            assert request(base, "/api/model-config/test", "POST")["ok"]
            book_path = "/api/books/" + book["id"]
            preview = request(base, book_path + "/to-skill/preview", "POST", {"mode": "text"})
            assert preview["upstream"] == "virgiliojr94/book-to-skill" and preview["sections"] >= 1
            job_id = request(base, book_path + "/to-skill", "POST")["job_id"]
            for _ in range(100):
                job = request(base, "/api/skill-jobs/" + job_id)
                if job["status"] != "running":
                    break
                time.sleep(.1)
            assert job["status"] == "done", job
            skill = job["skill"]
            assert skill["mode"] == "book-to-skill" and skill["sections"] >= 1
            content = request(base, "/api/skills/" + skill["id"] + "/content", pdf=True)
            assert b"name:" in content and b"description:" in content
            request(base, "/api/skills/" + skill["id"] + "/review", "POST")
            answer = request(base, "/api/skills/" + skill["id"] + "/apply", "POST", {"question": "How should I validate this?", "stage": 7})
            assert answer["skill_id"] == skill["id"] and answer["steps"]
            assert next(s for s in request(base, "/api/skills") if s["id"] == skill["id"])["status"] == "reviewed"
            archive = request(base, "/api/skills/" + skill["id"] + "/archive", pdf=True)
            with zipfile.ZipFile(io.BytesIO(archive)) as package:
                names = package.namelist()
                assert any(name.endswith("SKILL.md") for name in names)
                assert any("chapters/ch001.md" in name for name in names)
                assert any(name.endswith("cheatsheet.md") for name in names)
            second_preview=request(base,book_path+'/to-skill/preview','POST',{'mode':'text','ranges':[{'label':'选定章节','start':1,'end':1}]})
            second_job=request(base,book_path+'/to-skill','POST',{'preview_id':second_preview['preview_id']})['job_id']
            for _ in range(100):
                second=request(base,'/api/skill-jobs/'+second_job)
                if second['status']!='running':break
                time.sleep(.1)
            assert second['status']=='done',second
            second_skill=second['skill'];assert second_skill['id']!=skill['id'] and second_skill['artifact_id']!=skill['artifact_id']
            assert len([s for s in request(base,'/api/skills') if s['mode']=='book-to-skill'])==2
            assert request(base,'/api/skills/'+skill['id']+'/archive',pdf=True)==archive
            request(base, "/api/skills/" + skill["id"], "DELETE")
            assert request(base,'/api/skills/'+second_skill['id']+'/archive',pdf=True)
            assert (catalog/'generated'/second_skill['artifact_id']/'SKILL.md').is_file()
            assert not (catalog/'generated'/skill['artifact_id']).exists()
            print('PASS: multiple packages per book, distinct storage, earlier archive preserved, deletion affects only selected package')

            assert next(b for b in request(base, "/api/books") if b["id"] == book["id"])["processed"]
            assert next(s for s in request(base, "/api/skills") if s["id"] == "synthetic-template")
            assert request(base, book_path + "/pdf", pdf=True).startswith(b"%PDF-")
            app.terminate()
            app.wait(timeout=3)
            app = subprocess.Popen([str(ROOT / "backend" / "target" / "debug" / "nist-model-api")], cwd=ROOT,
                                   env={**ollama_env, "PORT": str(app_port)}, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            for _ in range(80):
                if app.poll() is not None:
                    raise RuntimeError(app.stderr.read().decode())
                try:
                    status = request(base, "/api/skill-engine")
                    break
                except Exception:
                    time.sleep(.1)
            assert status["provider"] == "ollama" and status["ready"] is True
            request(base, book_path + "/to-skill/preview", "POST", {"mode": "text"})
            job_id = request(base, book_path + "/to-skill", "POST")["job_id"]
            for _ in range(100):
                job = request(base, "/api/skill-jobs/" + job_id)
                if job["status"] != "running":
                    break
                time.sleep(.1)
            assert job["status"] == "done", job
            skill = job["skill"]
            request(base, "/api/skills/" + skill["id"] + "/review", "POST")
            answer = request(base, "/api/skills/" + skill["id"] + "/apply", "POST", {"question": "How should I validate this?"})
            assert answer["steps"] and skill["provider"] == "ollama"
            print(f"PASS: model configuration, connection check, extraction, configured provider and Ollama mocks ({ModelMock.calls} calls), skill files, review, apply, archive, persistence, deletion")
        finally:
            app.terminate()
            try:
                app.wait(timeout=3)
            except subprocess.TimeoutExpired:
                app.kill()
                app.wait()
            mock.shutdown()


if __name__ == "__main__":
    main()
