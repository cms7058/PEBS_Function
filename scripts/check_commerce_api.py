"""HTTP multi-user isolation checks using a temporary server/store; no production data."""
import os,sys,json,tempfile,subprocess,time,urllib.request,urllib.error,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def request(base,path,body=None,token='',method=None):
 headers={'Origin':'http://127.0.0.1:5176'}
 if token:headers['Authorization']='Bearer '+token
 data=None
 if body is not None:data=json.dumps(body).encode();headers['Content-Type']='application/json'
 req=urllib.request.Request(base+path,data=data,headers=headers,method=method)
 try:
  with urllib.request.urlopen(req,timeout=20) as r:return r.status,r.read(),r.headers
 except urllib.error.HTTPError as e:return e.code,e.read(),e.headers

def run_suite(temp,base):
 def q(path,b=None,t='',method=None,expected=200):
  s,raw,h=request(base,path,b,t,method);assert s==expected,(path,s,raw[:200]);return json.loads(raw),h
 cfg,_=q('/api/public/config');assert cfg['setup_required'] and not any(v['ready'] for v in cfg['channels'].values())
 token=(Path(temp)/'accounts/bootstrap-token').read_text()
 admin,h=q('/api/auth/setup',{'email':'admin@test.example','password':'Admin-fixture-123','name':'Admin','setup_token':token});cookie=h['Set-Cookie'];assert 'HttpOnly' in cookie and 'SameSite=Lax' in cookie
 # Login yields an HttpOnly cookie; API fixtures obtain token only from that cookie.
 at=cookie.split(';')[0].split('=',1)[1]
 q('/api/books',expected=401);q('/api/projects',expected=401)
 def register(email):
  q('/api/auth/send-code',{'email':email});mail=json.loads(sorted((Path(temp)/'accounts/mail-outbox').glob('*.json'),key=lambda p:p.stat().st_mtime_ns)[-1].read_text());u,h=q('/api/auth/register',{'email':email,'password':'User-fixture-123','code':mail['code'],'accepted_terms':True});return u['user'],h['Set-Cookie'].split(';')[0].split('=',1)[1]
 u,ut=register('user@test.example');v,vt=register('other@test.example')
 for path in ['/api/admin/overview','/api/model-config','/api/library','/api/search?q=regression']:q(path,t=ut,expected=403)
 q('/api/access-profile',{'tier':'ultra','role':'admin'},ut,method='PUT',expected=403)
 profile,_=q('/api/access-profile',t=ut);assert profile['tier']=='normal' and not profile['show_book_names']
 engine,_=q('/api/skill-engine',t=ut)
 if engine.get('provider')=='codex':assert not engine['ready'],'regular accounts must not inherit the administrator Codex session'
 p,_=q('/api/projects',{'name':'User A actual project','question':'Reduce cycle time'},ut)
 projects,_=q('/api/projects',t=vt);assert projects==[]
 q('/api/projects/'+p['id'],t=vt,expected=400)
 assert p['state']['data']['rows']==[] and p['state']['mode']=='real'
 a,_=q('/api/books',{'title':'Admin-only reference'},at);b,_=q('/api/books',{'title':'Private A'},ut);c,_=q('/api/books',{'title':'Private B'},vt)
 av,_=q('/api/books',t=at);bv,_=q('/api/books',t=ut);cv,_=q('/api/books',t=vt)
 assert [x['title'] for x in av]==['Admin-only reference'];assert [x['title'] for x in bv]==['Private A'];assert [x['title'] for x in cv]==['Private B']
 q('/api/books/'+a['id'],{'title':'hacked'},ut,method='PATCH',expected=400);q('/api/books/'+b['id']+'/pdf',t=vt,expected=400)
 q('/api/skills/evaluate',{},ut,expected=403)
 q('/api/billing/orders',{'tier':'normal','period':'month','channel':'wechat'},ut,expected=503)
 account,_=q('/api/billing/account',t=ut);assert account['orders']==[] and account['user']['credits']==20
 # A request with a forged cross-origin header is rejected even with a valid cookie.
 req=urllib.request.Request(base+'/api/projects',data=b'{}',headers={'Origin':'https://attacker.example','Cookie':'pebs_session='+ut,'Content-Type':'application/json'})
 try:urllib.request.urlopen(req);raise AssertionError('Expected origin rejection')
 except urllib.error.HTTPError as e:assert e.code==403
 adminv,_=q('/api/admin/overview',t=at);assert len(adminv['users'])==3
 q('/api/auth/logout',{},ut);q('/api/auth/me',t=ut,expected=401)
 print('PASS: HttpOnly login, unauthorized routes, real membership authority, cross-account project/book/PDF isolation, CSRF, empty actual projects, unconfigured payment rejection, admin list and logout')
 return {'admin_email':'admin@test.example','admin_password':'Admin-fixture-123','user_email':'user@test.example','user_password':'User-fixture-123'}
if __name__=='__main__':
 temp=tempfile.mkdtemp(prefix='pebs-commerce-http-');p=Path(temp);(p/'pages.json').write_text('[]');(p/'library.json').write_text('{}');(p/'catalog').mkdir();(p/'catalog/catalog.json').write_text('{"books":[],"skills":[]}')
 env=dict(os.environ,DATA_DIR=temp,PORT='8899',APP_URL='http://127.0.0.1:5176',PEBS_MAIL_MODE='file',APP_ENV='test',PYTHONDONTWRITEBYTECODE='1')
 server=subprocess.Popen([str(ROOT/'backend/target/debug/nist-model-api')],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 try:
  for i in range(60):
   try:
    if request('http://127.0.0.1:8899','/api/health')[0]==200:break
   except OSError:time.sleep(.1)
  credentials=run_suite(temp,'http://127.0.0.1:8899')
  if '--keep' in sys.argv:
   print(json.dumps({'data_dir':temp,'port':8899,'fixtures':credentials}));sys.stdout.flush()
   while True:time.sleep(30)
 finally:server.terminate();server.wait(timeout=10)
