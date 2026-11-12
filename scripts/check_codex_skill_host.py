"""Verify the real skill-host wiring with a disposable Codex CLI stand-in."""

import json
import os
import stat
import subprocess
import tempfile
import zipfile
from pathlib import Path

from check_book_to_skill import fixture_pdf

ROOT = Path(__file__).resolve().parents[1]

FAKE_CODEX = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
if args[:2] == ["login", "status"]:
    print("Logged in using ChatGPT")
    sys.exit(0)
assert args[0] == "exec", args
root = Path(args[args.index("--cd") + 1])
skill = root / ".agents" / "skills" / "book-to-skill" / "SKILL.md"
if skill.is_file():
    assert (root / "book.pdf").is_file()
    assert "$book-to-skill" in args[-1]
    target = root / "generated-skills" / "test-book"
    if os.environ.get("EXPECT_RESUME"):
        assert (target / "chapters" / "draft.md").read_text() == "Grounded draft"
        assert "Drafts from an interrupted run are present" in args[-1]
    else:
        assert not (target / "chapters" / "draft.md").exists()
    (target / "chapters").mkdir(parents=True, exist_ok=True)
    (target / "SKILL.md").write_text("---\\nname: test-book\\ndescription: A grounded engineering skill.\\n---\\n\\n# Test book\\n\\nRead [chapter](chapters/ch001.md).\\n")
    (target / "chapters" / "ch001.md").write_text("# Chapter 1\\n\\nMeasure outcomes before choosing a model.\\n")
    for name in ("glossary.md", "patterns.md", "cheatsheet.md"):
        (target / name).write_text("# Notes\\n\\n- Measure and validate.\\n")
    (target / "source-notes.json").write_text('{"pages":1}')
    (target / ".extraction").mkdir(exist_ok=True)
    (target / ".extraction" / "raw.json").write_text('{"source":"private source text"}')
else:
    assert (root / ".agents" / "skills" / "test-book" / "SKILL.md").is_file()
    assert "$test-book" in args[-1]
    result_file = Path(args[args.index("--output-last-message") + 1])
    result_file.write_text(json.dumps({"answer":"Validate before use", "steps":["Measure"], "limitations":[], "sources":["SKILL.md"]}))
print("{}")
'''


def main():
    with tempfile.TemporaryDirectory(prefix="codex-skill-host-") as temporary:
        root = Path(temporary)
        bin_dir = root / "bin"
        bin_dir.mkdir()
        fake = bin_dir / "codex"
        fake.write_text(FAKE_CODEX)
        fake.chmod(fake.stat().st_mode | stat.S_IXUSR)
        pdf = root / "book.pdf"
        pdf.write_bytes(fixture_pdf())
        work = root / "work"
        output = root / "generated" / "test-book"
        env = {**os.environ, "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"],
               "BOOK_TO_SKILL_PROVIDER": "codex"}
        prep = subprocess.run(["python3", "scripts/book_to_skill_bridge.py", "prepare", "--pdf", str(pdf),
                               "--workdir", str(work), "--title", "Test book", "--mode", "text"],
                              cwd=ROOT, env=env, capture_output=True, text=True, timeout=30)
        assert prep.returncode == 0, prep.stderr
        made = subprocess.run(["python3", "scripts/book_to_skill_bridge.py", "generate", "--workdir", str(work),
                               "--outputdir", str(output), "--slug", "test-book"],
                              cwd=ROOT, env=env, capture_output=True, text=True, timeout=30)
        assert made.returncode == 0, made.stderr
        skill = json.loads(made.stdout)
        assert skill["provider"] == "codex" and (output / "SKILL.md").is_file()
        with zipfile.ZipFile(skill["archive"]) as archive:
            assert "test-book/source-notes.json" in archive.namelist()
            assert not any(".extraction" in name for name in archive.namelist())
        use = subprocess.run(["python3", "scripts/use_book_skill.py"], input=json.dumps({"skill": {"id": "test-book", "book_id": "b1",
                              "name": "Test book", "description": "Test", "inputs": [], "steps": [], "note": ""},
                              "question": "How should I validate?", "folder": str(output)}),
                             cwd=ROOT, env=env, capture_output=True, text=True, timeout=30)
        assert use.returncode == 0, use.stderr
        answer = json.loads(use.stdout)
        assert answer["answer"] == "Validate before use" and answer["skill_id"] == "test-book"
        # Interrupted drafts must survive a retry with a new artifact name.
        runtime = work / "codex_runtime"
        draft = runtime / "generated-skills" / "old-job" / "chapters"
        draft.mkdir(parents=True)
        (draft / "draft.md").write_text("Grounded draft")
        (runtime / "book.pdf").write_bytes(pdf.read_bytes())
        retry = subprocess.run(["python3", "scripts/book_to_skill_bridge.py", "generate", "--workdir", str(work),
                                "--outputdir", str(root / "retry"), "--slug", "test-book"],
                               cwd=ROOT, env={**env, "EXPECT_RESUME": "1"}, capture_output=True, text=True, timeout=30)
        assert retry.returncode == 0, retry.stderr
        assert (root / "retry" / "chapters" / "draft.md").is_file()
        # A different source must not inherit stale drafts.
        draft.mkdir(parents=True)
        (draft / "draft.md").write_text("Wrong source draft")
        (runtime / "book.pdf").write_bytes(pdf.read_bytes() + b"\nchanged")
        fresh = subprocess.run(["python3", "scripts/book_to_skill_bridge.py", "generate", "--workdir", str(work),
                                "--outputdir", str(root / "fresh"), "--slug", "test-book"],
                               cwd=ROOT, env=env, capture_output=True, text=True, timeout=30)
        assert fresh.returncode == 0, fresh.stderr
        assert not (root / "fresh" / "chapters" / "draft.md").exists()
        print("PASS: TO-SKILL invokes upstream skill through Codex host; saved skill can be called")
        print("PASS: interrupted drafts resume only for identical source PDF")


if __name__ == "__main__":
    main()
