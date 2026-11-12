"""Isolated account, OTP, quota and signed payment regression checks; no real mail/payments."""
import os,sys,tempfile,json,time,hashlib,hmac,base64,sqlite3
from pathlib import Path
with tempfile.TemporaryDirectory(prefix='pebs-account-check-') as temp:
 os.environ.update(DATA_DIR=temp,PEBS_MAIL_MODE='file',APP_ENV='test')
 sys.path.insert(0,str(Path(__file__).parent));import accounts as a
 from payments import verified_event
 a.HOME.mkdir();db=a.DB();a.init(db)
 def run(action,body=None,token='',**kw):
  db.begin()
  try:v=a.handle(db,{'action':action,'body':body or {},'token':token,'ip':kw.pop('ip','test'),**kw});db.commit();return v
  except:db.rollback();raise
 def fails(action,body=None,token='',status=None,**kw):
  try:run(action,body,token,**kw)
  except a.Fail as e:
   if status:assert e.status==status,(e.status,e.message)
   return
  raise AssertionError('Expected rejection: '+action)
 setup=run('bootstrap',{'setup_token':(a.HOME/'bootstrap-token').read_text(),'email':'admin@example.org','password':'Admin-test-1234','name':'Admin'})
 admin=setup['session_token'];assert setup['user']['role']=='admin';fails('bootstrap',{},status=403)
 def register(email):
  run('send_code',{'email':email});code=json.loads(sorted((a.HOME/'mail-outbox').glob('*.json'),key=lambda p:p.stat().st_mtime_ns)[-1].read_text())['code']
  row=db.one('SELECT * FROM codes WHERE email=?',(email,));assert row['digest']!=code
  fails('register',{'email':email,'code':'xxxx','password':'User-test-1234','accepted_terms':True})
  result=run('register',{'email':email,'code':code,'password':'User-test-1234','accepted_terms':True})
  assert result['user']['credits']==20 and result['user']['membership_status']=='trial';fails('register',{'email':email,'code':code,'password':'User-test-1234','accepted_terms':True})
  return result
 one=register('one@example.org');two=register('two@example.org');token=one['session_token'];id=one['user']['id']
 assert not run('me',token=token)['user']['show_book_names'];fails('admin_overview',token=token,status=403);fails('login',{'email':'one@example.org','password':'wrong'},status=401)
 lease=run('reserve',{'action':'guide','units':2,'request_id':'first'},token)['lease_id'];assert run('me',token=token)['user']['credits']==18
 fails('reserve',{'action':'guide','units':2,'request_id':'second'},token,status=429)
 run('settle',{'lease_id':lease,'success':False});assert run('me',token=token)['user']['credits']==20
 fails('reserve',{'action':'guide','units':2,'request_id':'first'},token,status=409)
 lease=run('reserve',{'action':'guide','units':2,'request_id':'third'},token)['lease_id'];run('settle',{'lease_id':lease,'success':True});run('settle',{'lease_id':lease,'success':False});assert run('me',token=token)['user']['credits']==18
 fails('reserve',{'action':'generate','units':1000},token,status=402)
 # Outbound checkout is replaced by a deterministic fixture; webhook authentication is real.
 a.checkout=lambda o,c:{'provider_id':'cs_fixture','redirect_url':'https://checkout.stripe.com/fixture'}
 c={'public_url':'https://example.org','stripe_secret_key':'sk_test_fixture','stripe_webhook_secret':'whsec_fixture'}
 p=a.HOME/'service-config.json';p.write_text(json.dumps(c))
 o=run('order',{'tier':'high','period':'month','channel':'applepay'},token);assert o['amount']==59900 and o['currency']=='CNY'
 run('profile',{'locale':'en','name':'Two'},two['session_token'])
 usd=run('order',{'tier':'normal','period':'month','channel':'applepay','locale':'en'},two['session_token']);assert usd['amount']==1900 and usd['currency']=='USD'
 before=run('me',token=token)['user'];assert before['membership_status']=='trial'
 fails('order_read',{'id':o['id']},two['session_token'],status=404)
 event={'id':'evt_fixture','livemode':False,'type':'checkout.session.completed','data':{'object':{'id':'cs_fixture','client_reference_id':o['id'],'payment_status':'paid','payment_intent':'pi_fixture','amount_total':59900,'currency':'cny'}}}
 raw=json.dumps(event).encode();ts=str(a.now());signature=hmac.new(c['stripe_webhook_secret'].encode(),ts.encode()+b'.'+raw,hashlib.sha256).hexdigest()
 headers={'stripe-signature':'t='+ts+',v1='+signature}
 fails('webhook',channel='applepay',raw=base64.b64encode(raw).decode(),headers={'stripe-signature':'t='+ts+',v1=invalid'})
 run('webhook',channel='applepay',raw=base64.b64encode(raw).decode(),headers=headers);paid=run('me',token=token)['user'];assert paid['tier']=='high' and paid['credits']==600
 run('webhook',channel='applepay',raw=base64.b64encode(raw).decode(),headers=headers);assert run('me',token=token)['user']['expires_at']==paid['expires_at']
 changed=json.loads(raw);changed['data']['object']['amount_total']=1;r=json.dumps(changed).encode();sig=hmac.new(c['stripe_webhook_secret'].encode(),ts.encode()+b'.'+r,hashlib.sha256).hexdigest();fails('webhook',channel='applepay',raw=base64.b64encode(r).decode(),headers={'stripe-signature':'t='+ts+',v1='+sig})
 fails('order',{'tier':'normal','period':'month','channel':'applepay'},token)
 run('admin_user',{'id':id,'status':'suspended','reason':'Test suspension'},admin);fails('me',token=token,status=401)
 # Secret config is masked and never available to regular users.
 masked=run('admin_config',token=admin);assert 'stripe_secret_key' not in masked['config'];assert masked['configured']['stripe_secret_key']
 fails('admin_config',token=two['session_token'],status=403)
 # Monthly quota rollover and expiry are derived server-side.
 db.begin();db.execute('UPDATE users SET credits=0,credit_reset_at=? WHERE id=?',(a.now()-1,id));db.execute('UPDATE users SET status=? WHERE id=?',('active',id));db.commit()
 paid_again=run('me',token=run('login',{'email':'one@example.org','password':'User-test-1234'})['session_token'])['user'];assert paid_again['credits']==600
 # Password reset revokes all existing sessions.
 run('send_code',{'email':'two@example.org','purpose':'reset'});out=json.loads(sorted((a.HOME/'mail-outbox').glob('*.json'),key=lambda p:p.stat().st_mtime_ns)[-1].read_text());run('reset',{'email':'two@example.org','code':out['code'],'password':'New-user-secret-123'});fails('me',token=two['session_token'],status=401)
 db.c.close()
 print('PASS: bootstrap, verified registration, one-use OTP, login/reset, roles, isolated orders, quota reservation/refund/idempotency, signed webhook amount/environment validation, single membership activation, rollover, suspension and secret masking')
