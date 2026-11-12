"""Checkpoint failure/retry test without model calls or installed PDF dependencies."""
import importlib.util,tempfile,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('ocr_book','scripts/ocr_book.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as tmp:
    work=Path(tmp)/'work';renders=[];fail=[True]
    def run(*args):
        if args[0]=='pdfinfo':return 'Pages: 2\n'
        if args[0]=='pdftoppm':
            page=int(args[args.index('-f')+1]);renders.append(page)
            if page==2 and fail[0]:fail[0]=False;raise RuntimeError('simulated interruption')
            Path(args[-1]+'.png').write_bytes(b'image')
        if args[0]=='tesseract':
            Path(args[2]+'.txt').write_text('工程质量 test');Path(args[2]+'.pdf').write_bytes(b'%PDF-test')
        if args[0]=='pdfunite':Path(args[-1]).write_bytes(b'%PDF-merged')
        return ''
    m.run=run
    try:m.convert(Path('scan.pdf'),work,Path('tessdata'))
    except RuntimeError:pass
    assert json.loads((work/'status.json').read_text())['status']=='failed'
    assert (work/'page-00001.done').exists()
    m.convert(Path('scan.pdf'),work,Path('tessdata'))
    assert renders==[1,2,2],renders
    assert len(json.loads((work/'pages.json').read_text()))==2
print('PASS: failed jobs preserve checkpoints; retry skips completed pages')
