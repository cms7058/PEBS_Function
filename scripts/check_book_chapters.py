"""Automatic outline and printed-TOC mapping fixtures, no external model."""
import json,subprocess,tempfile
from pathlib import Path
def pdf(path,bookmark):
    objects=[b'',b'',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    kids=[]
    for title in ['Contents|Chapter 1 ........ 1|Chapter 2 ........ 2','Chapter 1|Evidence and measurement','Chapter 2|Regression and validation']:
        page=len(objects)+1;content=page+1;kids.append(page)
        objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {content} 0 R >>'.encode())
        stream=('BT /F1 12 Tf 50 740 Td '+' 0 -20 Td '.join(f'({line}) Tj' for line in title.split('|'))+' ET').encode()
        objects.append(f'<< /Length {len(stream)} >>\nstream\n'.encode()+stream+b'\nendstream')
    outline=len(objects)+1
    if bookmark:
        objects.extend([f'<< /Type /Outlines /First {outline+1} 0 R /Last {outline+2} 0 R /Count 2 >>'.encode(),f'<< /Title (Chapter 1) /Parent {outline} 0 R /Next {outline+2} 0 R /Dest [{kids[1]} 0 R /Fit] >>'.encode(),f'<< /Title (Chapter 2) /Parent {outline} 0 R /Prev {outline+1} 0 R /Dest [{kids[2]} 0 R /Fit] >>'.encode()])
    objects[0]=f'<< /Type /Catalog /Pages 2 0 R '+(f'/Outlines {outline} 0 R ' if bookmark else '')+'>>';objects[0]=objects[0].encode()
    objects[1]=f'<< /Type /Pages /Kids [ '+ ' '.join(f'{n} 0 R' for n in kids)+' ] /Count 3 >>';objects[1]=objects[1].encode()
    raw=b'%PDF-1.4\n';offsets=[]
    for i,obj in enumerate(objects,1):offsets.append(len(raw));raw+=f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n'
    xref=len(raw);raw+=f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()+b''.join(f'{n:010} 00000 n \n'.encode() for n in offsets)+f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode();path.write_bytes(raw)
with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);index=root/'pages.json';index.write_text(json.dumps([{'page':1,'text':'Contents\nChapter 1 ........ 1\nChapter 2 ........ 2'},{'page':2,'text':'Chapter 1\nEvidence'},{'page':3,'text':'Chapter 2\nRegression'}]))
    for bookmark in [True,False]:
        path=root/'book.pdf';pdf(path,bookmark)
        toc=json.loads(subprocess.check_output(['node','scripts/book_chapters.mjs',str(path),str(index)]))
        assert toc['source']==('bookmark' if bookmark else 'contents'),toc
        assert [(c['start'],c['end']) for c in toc['chapters']]==[(2,2),(3,3)],toc
    index.write_text(json.dumps([{'page':1,'text':'Contents\nChapter 1 ........ 1\nChapter 2 ........ 2'}]))
    toc=json.loads(subprocess.check_output(['node','scripts/book_chapters.mjs',str(path),str(index)]));assert not any(c['selectable'] for c in toc['chapters']),toc
print('PASS: PDF bookmarks, printed contents with verified page offset, ambiguous/unverified pages disabled')
