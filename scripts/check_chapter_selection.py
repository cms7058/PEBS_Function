"""Verify actual PDF/text/model isolation and scope provenance with a local mock."""
import io,json,os,subprocess,tempfile,threading,zipfile
from pathlib import Path
from http.server import HTTPServer
from check_book_to_skill import fixture_pdf,ModelMock,free_port
from book_to_skill_bridge import prepare,select_pdf_pages
class Capture(ModelMock):
    bodies=[]
    def do_POST(self):
        raw=self.rfile.read(int(self.headers['Content-Length']));self.bodies.append(raw.decode());self.rfile=io.BytesIO(raw);super().do_POST()
with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);parts=[]
    for i,marker in enumerate([b'PAGE_ONE___',b'PAGE_TWO___',b'PAGE_THREE_'],1):
        assert len(marker)==len(b'Engineering');path=root/f'{i}.pdf';path.write_bytes(fixture_pdf().replace(b'Engineering',marker));parts.append(str(path))
    pdf=root/'book.pdf';subprocess.run(['pdfunite',*parts,str(pdf)],check=True)
    full=prepare(pdf,root/'full','Test','text')
    ranges=[dict(label='第三章',start=3,end=3),dict(label='第一章',start=1,end=1)]
    preview=prepare(pdf,root/'selected','Test','text',ranges)
    assert preview['pages']==2 and preview['total_book_pages']==3 and preview['source_page_map']==[1,3]
    text=(root/'selected/extraction/full_text.txt').read_text();assert 'PAGE_TWO___' not in text and 'PAGE_ONE___' in text and 'PAGE_THREE_' in text
    assert preview['estimated_input_tokens']<full['estimated_input_tokens']
    metadata=json.loads((root/'selected/extraction/metadata.json').read_text());assert Path(metadata['source_file']).resolve()==(root/'selected/selected.pdf').resolve()
    for bad in [[],[dict(start=0,end=1)],[dict(start=2,end=1)],[dict(start=1,end=4)],[dict(start=1,end=2),dict(start=2,end=3)]]:
        try:select_pdf_pages(pdf,root/'selected',bad)
        except RuntimeError:pass
        else:raise AssertionError(bad)
    mock=HTTPServer(('127.0.0.1',free_port()),Capture);threading.Thread(target=mock.serve_forever,daemon=True).start()
    try:
        env={**os.environ,'BOOK_TO_SKILL_PROVIDER':'openai','OPENAI_API_KEY':'local-test-only','BOOK_TO_SKILL_MODEL':'mock-model','BOOK_TO_SKILL_API_BASE':f'http://127.0.0.1:{mock.server_port}/v1'}
        run=subprocess.run(['python3','scripts/book_to_skill_bridge.py','generate','--workdir',str(root/'selected'),'--outputdir',str(root/'output'),'--slug','selected-skill'],env=env,capture_output=True,text=True)
        assert run.returncode==0,run.stderr
        result=json.loads(run.stdout);assert result['source']['page']==1 and result['source_page_map']==[1,3] and result['source_scope']
        assert all('PAGE_TWO___' not in body for body in Capture.bodies)
        with zipfile.ZipFile(result['archive']) as archive:assert any(n.endswith('source-scope.md') for n in archive.namelist())
    finally:mock.shutdown()
print('PASS: multi-range selection, excluded pages absent from model input, smaller estimates, Codex source subset, validation, scope provenance and archive')
