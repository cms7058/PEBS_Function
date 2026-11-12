"""Verify numerical recovery, rejection paths, and source indexing against local API."""
import json,urllib.request,urllib.error,math
BASE='http://127.0.0.1:8787'
def get(path):
 return json.load(urllib.request.urlopen(BASE+path))
def post(payload):
 req=urllib.request.Request(BASE+'/api/analyze',json.dumps(payload).encode(),{'Content-Type':'application/json'})
 try:
  r=urllib.request.urlopen(req);return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
rows=[]
for i in range(60):
 a=(i*7)%19;b=(i*11)%23;rows.append([a,b,5+2*a-3*b])
p={'columns':['a','b','y'],'rows':rows,'x':[0,1],'y':2}
code,result=post(p)
assert code==200
assert abs(result['intercept']-5)<1e-9
assert abs(result['factors'][0]['coefficient']-2)<1e-9
assert abs(result['factors'][1]['coefficient']+3)<1e-9
assert result['rmse']<1e-9
assert result['train']==48 and result['test']==12
assert post({**p,'rows':[[r[0],2*r[0],r[2]]for r in rows]})[0]==400
assert post({**p,'x':[0,0]})[0]==400
assert post({**p,'rows':rows[:5]})[0]==400
assert post({**p,'rows':[[r[0],r[1]]for r in rows]})[0]==400
lib=get('/api/library')
assert lib['pages']==2333 and len(lib['chapters'])==8
assert sum(c['pages']for c in lib['chapters'])==2333
assert get('/api/search?q=regression')['total']>0
assert get('/api/search?q=validation')['results']
print('PASS: known coefficients, holdout error, collinearity, duplicate factors, insufficient data, malformed rows, 2,333-page indexing, source search')
