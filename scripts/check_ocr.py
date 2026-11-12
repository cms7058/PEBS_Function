"""Run against a disposable catalog; never invokes a model or creates Skill records."""
import os,json,time,urllib.request,urllib.error,subprocess
from pathlib import Path
BASE=os.environ.get('OCR_TEST_BASE','http://127.0.0.1:8789')
def req(path,method='GET',data=None):
    body=data if isinstance(data,bytes) else json.dumps(data).encode() if data is not None else None
    with urllib.request.urlopen(urllib.request.Request(BASE+path,data=body,method=method,headers={'Content-Type':'application/pdf' if isinstance(data,bytes) else 'application/json'})) as r:
        raw=r.read();return raw if r.headers.get_content_type()=='application/pdf' else json.loads(raw)
def rejected(path,method='POST'):
    try:req(path,method)
    except urllib.error.HTTPError as e:assert e.code==400
    else:raise AssertionError('should reject')
if __name__=='__main__':
    raw=Path(os.environ.get('OCR_TEST_PDF','/tmp/ocr-check/scan.pdf')).read_bytes()
    b=req('/api/books','POST',{'title':'OCR 扫描书籍测试（两页）'});p='/api/books/'+b['id'];print('TEST_BOOK='+b['id'],flush=True)
    rejected(p+'/ocr');req(p+'/pdf','PUT',raw)
    assert not next(x for x in req('/api/books') if x['id']==b['id'])['indexed']
    req(p+'/ocr','POST');rejected(p+'/ocr');rejected(p,'DELETE')
    for _ in range(180):
        state=req(p+'/ocr')
        if state['status'] in ('done','failed'):break
        time.sleep(1)
    assert state['status']=='done',state
    assert state['completed']==2 and state['total']==2
    assert req(p+'/original')==raw
    converted=req(p+'/pdf');assert converted!=raw and converted.startswith(b'%PDF-')
    Path('/tmp/ocr-check/result.pdf').write_bytes(converted)
    texts=[req(p+'/ocr/text?page='+str(i))['text'] for i in (1,2)];assert any(texts)
    assert next(x for x in req('/api/books') if x['id']==b['id'])['indexed']
    preview=req(p+'/to-skill/preview','POST',{'mode':'text'});assert preview['pages']==2 and preview['words']>0,preview
    assert not any(x['book_id']==b['id'] for x in req('/api/skills'))
    rejected(p+'/ocr')
    print('PASS: background OCR, duplicate/delete guards, 2-page result, original preservation, text review, Skill extraction, no automatic generation',flush=True)
