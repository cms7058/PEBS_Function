"""Integration check; creates and removes only its own temporary book."""
import json, os, urllib.request, urllib.error
BASE=os.environ.get('CATALOG_TEST_BASE','http://127.0.0.1:8787')
DATA_DIR=os.environ.get('CATALOG_TEST_DATA_DIR','data')
def request(path,method='GET',data=None,raw=False):
    body=data if raw else json.dumps(data).encode() if data is not None else None
    req=urllib.request.Request(BASE+path,data=body,method=method,headers={'Content-Type':'application/pdf' if raw else 'application/json'})
    with urllib.request.urlopen(req) as r:
        out=r.read()
        return out if raw else json.loads(out)
def reject(path,method,data=None,raw=False):
    try: request(path,method,data,raw)
    except urllib.error.HTTPError as e: assert e.code==400,e.code
    else: raise AssertionError('Expected rejection')
def pdf():
    text=b'BT /F1 16 Tf 50 750 Td (Regression catalog integration fixture. Measurement and residual analysis.) Tj ET'
    objs=[b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', b'<< /Length '+str(len(text)).encode()+b' >>\nstream\n'+text+b'\nendstream']
    out=b'%PDF-1.4\n'; offsets=[]
    for i,obj in enumerate(objs,1):
        offsets.append(len(out));out+=f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n'
    pos=len(out);out+=b'xref\n0 6\n0000000000 65535 f \n'+b''.join(f'{x:010d} 00000 n \n'.encode() for x in offsets)
    return out+b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+str(pos).encode()+b'\n%%EOF'
reject('/api/books','POST',{'title':' '})
b=request('/api/books','POST',{'title':'Integration temporary book'})
path='/api/books/'+b['id']
try:
    assert b['uploaded_at'] is None
    reject(path+'/to-skill','POST')
    request(path,'PATCH',{'title':'Regression fixture'})
    reject(path+'/pdf','PUT',b'not a PDF',True)
    uploaded=json.loads(request(path+'/pdf','PUT',pdf(),True))
    assert uploaded['pages']==1 and uploaded['indexed'] and uploaded['uploaded_at']
    assert request(path+'/pdf',raw=True).startswith(b'%PDF-')
    result=request('/api/knowledge/search?q=integration')
    assert any(r['book_id']==b['id'] for r in result['results'])
    preview=request(path+'/to-skill/preview','POST',{'mode':'text'})
    assert preview['upstream']=='virgiliojr94/book-to-skill' and preview['sections']>=1
    assert not next(x for x in request('/api/books') if x['id']==b['id'])['processed']
finally:
    request(path,'DELETE')
assert not any(s['book_id']==b['id'] for s in request('/api/skills'))
assert not any(x['id']==b['id'] for x in request('/api/books'))
print('PASS: create, rename, upload validation, PDF serving, indexing, search, upstream extraction preview, deletion')
