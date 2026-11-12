"""Account/commerce service invoked by Rust over stdin, never via a public command API.
SQLite for local development; set DATABASE_URL for PostgreSQL in deployment.
"""
import base64, calendar, hashlib, hmac, json, math, os, re, secrets, shutil, smtplib, sqlite3, ssl, sys, time, uuid
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from payments import checkout, readiness, verified_event
ROOT=Path(os.environ.get('DATA_DIR','data')).resolve();HOME=ROOT/'accounts'
class Fail(Exception):
    def __init__(self,message,status=400):self.message=message;self.status=status

def now():return int(time.time())
def uid(prefix):return prefix+uuid.uuid4().hex
class DB:
    def __init__(self):
        url=os.environ.get('DATABASE_URL','')
        self.pg=bool(url)
        if self.pg:
            import psycopg
            from psycopg.rows import dict_row
            self.c=psycopg.connect(url,autocommit=True,row_factory=dict_row)
        else:
            self.c=sqlite3.connect(HOME/'accounts.sqlite3',timeout=30,isolation_level=None);self.c.row_factory=sqlite3.Row
            self.c.execute('PRAGMA foreign_keys=ON');self.c.execute('PRAGMA journal_mode=WAL')
    def execute(self,sql,args=()):return self.c.execute(sql.replace('?','%s').replace('MIN(credits+', 'LEAST(credits+') if self.pg else sql,args)
    def one(self,sql,args=()):
        row=self.execute(sql,args).fetchone();return dict(row) if row else None
    def all(self,sql,args=()):return [dict(r) for r in self.execute(sql,args).fetchall()]
    def begin(self):
        self.execute('BEGIN' if self.pg else 'BEGIN IMMEDIATE')
        if self.pg:self.execute('SELECT pg_advisory_xact_lock(917530)')
    def commit(self):self.c.commit()
    def rollback(self):self.c.rollback()
SCHEMA=[
'''CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,status TEXT NOT NULL,locale TEXT NOT NULL,created_at BIGINT NOT NULL,last_login BIGINT,tier TEXT NOT NULL,expires_at BIGINT NOT NULL,credits INTEGER NOT NULL,credit_limit INTEGER NOT NULL,credit_reset_at BIGINT NOT NULL,trial_expires_at BIGINT NOT NULL)''',
'''CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at BIGINT NOT NULL,created_at BIGINT NOT NULL)''',
'''CREATE TABLE IF NOT EXISTS codes(email TEXT NOT NULL,purpose TEXT NOT NULL,digest TEXT NOT NULL,expires_at BIGINT NOT NULL,attempts INTEGER NOT NULL,sent_at BIGINT NOT NULL,PRIMARY KEY(email,purpose))''',
'''CREATE TABLE IF NOT EXISTS rates(key TEXT PRIMARY KEY,bucket BIGINT NOT NULL,count INTEGER NOT NULL)''',
'''CREATE TABLE IF NOT EXISTS plans(tier TEXT PRIMARY KEY,monthly INTEGER NOT NULL,yearly INTEGER NOT NULL,monthly_usd INTEGER NOT NULL DEFAULT 0,yearly_usd INTEGER NOT NULL DEFAULT 0,credits INTEGER NOT NULL,projects INTEGER NOT NULL,storage_mb INTEGER NOT NULL,concurrency INTEGER NOT NULL,enabled INTEGER NOT NULL,version INTEGER NOT NULL)''',
'''CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),tier TEXT NOT NULL,period TEXT NOT NULL,channel TEXT NOT NULL,amount INTEGER NOT NULL,currency TEXT NOT NULL,status TEXT NOT NULL,created_at BIGINT NOT NULL,expires_at BIGINT NOT NULL,paid_at BIGINT,transaction_id TEXT,provider_id TEXT,checkout TEXT,plan_snapshot TEXT NOT NULL,member_before TEXT,member_after TEXT)''',
'''CREATE TABLE IF NOT EXISTS payment_events(id TEXT PRIMARY KEY,channel TEXT NOT NULL,order_id TEXT NOT NULL,transaction_id TEXT NOT NULL UNIQUE,created_at BIGINT NOT NULL)''',
'''CREATE TABLE IF NOT EXISTS usage(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,units INTEGER NOT NULL,status TEXT NOT NULL,created_at BIGINT NOT NULL,finished_at BIGINT,note TEXT,request_key TEXT UNIQUE)''',
'''CREATE TABLE IF NOT EXISTS refunds(id TEXT PRIMARY KEY,order_id TEXT UNIQUE NOT NULL REFERENCES orders(id),amount INTEGER NOT NULL,receipt TEXT NOT NULL,reason TEXT NOT NULL,actor TEXT NOT NULL,created_at BIGINT NOT NULL,source TEXT NOT NULL)''',
'''CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,details TEXT NOT NULL,created_at BIGINT NOT NULL)'''
]
def init(db):
    HOME.mkdir(parents=True,exist_ok=True);os.chmod(HOME,0o700)
    for s in SCHEMA:db.execute(s)
    # Existing local databases predate the USD columns. Add them in place so a
    # deployment can migrate without deleting its account or order history.
    for column in ('monthly_usd','yearly_usd'):
        try:db.execute(f'ALTER TABLE plans ADD COLUMN {column} INTEGER NOT NULL DEFAULT 0')
        except Exception:pass
    defaults=[
        ('normal',15900,159000,1900,19000,150,10,1024,1,1),
        ('high',59900,599000,9900,99000,600,50,4096,3,1),
        ('ultra',89900,899000,0,0,1200,100,10240,3,0),
    ]
    for tier,month,year,month_usd,year_usd,credits,projects,storage,parallel,enabled in defaults:
        db.execute('INSERT INTO plans(tier,monthly,yearly,monthly_usd,yearly_usd,credits,projects,storage_mb,concurrency,enabled,version) VALUES(?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(tier) DO NOTHING',(tier,month,year,month_usd,year_usd,credits,projects,storage,parallel,enabled))
        existing=db.one('SELECT * FROM plans WHERE tier=?',(tier,))
        # Upgrade the original pilot defaults once; preserve later operator
        # edits made in the admin console.
        if existing and (not existing.get('monthly_usd') or existing['monthly'] in (9900,29900,89900)):
            db.execute('UPDATE plans SET monthly=?,yearly=?,monthly_usd=?,yearly_usd=?,credits=?,projects=?,storage_mb=?,concurrency=?,enabled=? WHERE tier=?',(month,year,month_usd,year_usd,credits,projects,storage,parallel,enabled,tier))
    # Ultra is retained only for historical membership records; it cannot be
    # purchased or exposed as a public pricing tier.
    db.execute("UPDATE plans SET enabled=0 WHERE tier='ultra'")
    if not (HOME/'bootstrap-token').exists():
        try:
            fd=os.open(HOME/'bootstrap-token',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'w') as f:f.write(secrets.token_urlsafe(32))
        except FileExistsError:pass
    os.chmod(HOME/'bootstrap-token',0o600)
    if not db.pg:os.chmod(HOME/'accounts.sqlite3',0o600)

def config():
    p=HOME/'service-config.json';v=json.loads(p.read_text()) if p.exists() else {}
    names=['public_url','mail_mode','smtp_host','smtp_port','smtp_user','smtp_password','smtp_from','smtp_security','wechat_app_id','wechat_mch_id','wechat_serial','wechat_private_key','wechat_api_v3_key','wechat_platform_key','wechat_platform_serial','alipay_app_id','alipay_private_key','alipay_public_key','stripe_secret_key','stripe_webhook_secret','alipay_sandbox']
    for k in names:
        if 'PEBS_'+k.upper() in os.environ:v[k]=os.environ['PEBS_'+k.upper()]
    v.setdefault('public_url',os.environ.get('APP_URL','http://127.0.0.1:5175'));v.setdefault('mail_mode','smtp');v.setdefault('smtp_security','starttls');v.setdefault('smtp_port',587)
    if isinstance(v.get('alipay_sandbox'),str):v['alipay_sandbox']=v['alipay_sandbox'].lower()=='true'
    return v
SECRET_FIELDS={'smtp_password','wechat_private_key','wechat_api_v3_key','wechat_platform_key','alipay_private_key','alipay_public_key','stripe_secret_key','stripe_webhook_secret'}
def mail_ready(c):return bool(c.get('smtp_host') and c.get('smtp_from') and c.get('smtp_user') and c.get('smtp_password'))
def production():return os.environ.get('APP_ENV')=='production'
def email_address(s):
    s=str(s).strip()
    if len(s)>254 or s.count('@')!=1 or any(c.isspace() or ord(c)<32 for c in s):raise Fail('请输入有效邮箱 / Enter a valid email')
    local,domain=s.rsplit('@',1)
    try:domain=domain.encode('idna').decode().lower()
    except UnicodeError:raise Fail('邮箱格式无效 / Invalid email')
    if not local or not domain or '.' not in domain:raise Fail('邮箱格式无效 / Invalid email')
    # Preserve local part; do not apply provider-specific dot/plus normalization.
    return local+'@'+domain

def password_hash(p):
    if not isinstance(p,str) or not 10<=len(p)<=128:raise Fail('密码需要10–128个字符 / Password must be 10–128 characters')
    salt=secrets.token_bytes(16);digest=Scrypt(salt=salt,length=32,n=16384,r=8,p=1).derive(p.encode())
    return base64.b64encode(salt+digest).decode()
def password_check(p,encoded):
    try:
        raw=base64.b64decode(encoded);d=Scrypt(salt=raw[:16],length=32,n=16384,r=8,p=1).derive(str(p).encode())
        return hmac.compare_digest(d,raw[16:])
    except (ValueError,TypeError):return False

def rate(db,key,maximum,seconds):
    bucket=now()//seconds;r=db.one('SELECT * FROM rates WHERE key=?',(key,));n=r['count']+1 if r and r['bucket']==bucket else 1
    db.execute('INSERT INTO rates VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET bucket=excluded.bucket,count=excluded.count',(key,bucket,n))
    if n>maximum:db.commit();raise Fail('操作太频繁，请稍后重试 / Too many attempts; try later',429)
def code_digest(email,purpose,code):return hmac.new((HOME/'bootstrap-token').read_bytes(),(email+'|'+purpose+'|'+str(code)).encode(),hashlib.sha256).hexdigest()
def send_mail(email,code,purpose,locale,c):
    if c.get('mail_mode')=='file' and not production():
        folder=HOME/'mail-outbox';folder.mkdir(exist_ok=True);os.chmod(folder,0o700)
        path=folder/(uid('mail')+'.json');path.write_text(json.dumps({'email':email,'code':code,'purpose':purpose,'created_at':now()}));os.chmod(path,0o600);return
    if not mail_ready(c):raise Fail('邮件服务尚未配置，请联系管理员 / Email service is not configured',503)
    m=EmailMessage();m['From']=c['smtp_from'];m['To']=email;m['Subject']='PEBS verification code' if locale=='en' else 'PEBS 邮箱验证码'
    m.set_content(f'PEBS verification code: {code}\nValid for 5 minutes. Do not share this code.\n验证码有效期5分钟，请勿向他人透露。')
    context=ssl.create_default_context()
    try:
        if c['smtp_security']=='ssl':server=smtplib.SMTP_SSL(c['smtp_host'],int(c['smtp_port']),timeout=15,context=context)
        else:
            server=smtplib.SMTP(c['smtp_host'],int(c['smtp_port']),timeout=15);server.starttls(context=context)
        with server:
            server.login(c['smtp_user'],c['smtp_password']);server.send_message(m)
    except Exception:raise Fail('验证码发送失败，请稍后重试 / Email delivery failed',503)
def consume_code(db,email,purpose,code):
    r=db.one('SELECT * FROM codes WHERE email=? AND purpose=?',(email,purpose))
    if not r or r['expires_at']<now() or r['attempts']>=5:raise Fail('验证码无效或已过期 / Invalid or expired code')
    if not hmac.compare_digest(r['digest'],code_digest(email,purpose,code)):
        db.execute('UPDATE codes SET attempts=attempts+1 WHERE email=? AND purpose=?',(email,purpose));db.commit();raise Fail('验证码不正确 / Incorrect code')
    db.execute('DELETE FROM codes WHERE email=? AND purpose=?',(email,purpose))
def audit(db,actor,action,target,details):db.execute('INSERT INTO audit VALUES(?,?,?,?,?,?)',(uid('a'),actor,action,target,json.dumps(details,ensure_ascii=False),now()))
def add_months(ts,months):
    d=datetime.fromtimestamp(ts,timezone.utc);m=d.month-1+months;y=d.year+m//12;m=m%12+1
    return int(d.replace(year=y,month=m,day=min(d.day,calendar.monthrange(y,m)[1])).timestamp())
def rollover(db,u):
    if u['expires_at']>now() and u['credit_reset_at']<=now():
        t=u['credit_reset_at']
        while t<=now():t=add_months(t,1)
        db.execute('UPDATE users SET credits=?,credit_reset_at=? WHERE id=?',(u['credit_limit'],t,u['id']));u['credits']=u['credit_limit'];u['credit_reset_at']=t
    return u

def public_user(db,u):
    u=rollover(db,u);subscribed=u['expires_at']>now();trial=u['trial_expires_at']>now() and not subscribed
    tier=u['tier'] if subscribed or u['role']=='admin' else 'normal'
    p=db.one('SELECT * FROM plans WHERE tier=?',(tier,))
    return {k:u[k] for k in ['id','email','name','role','status','locale','created_at','last_login','expires_at','trial_expires_at','credit_reset_at']}|{'tier':tier,'subscription_tier':u['tier'],'membership_status':'active' if subscribed else 'trial' if trial else 'expired','credits':u['credits'] if subscribed or trial else 0,'limits':p,'show_book_names':u['role']=='admin','mode':'authenticated'}
def authenticate(db,token):
    if not token:return None
    s=db.one('SELECT user_id FROM sessions WHERE token=? AND expires_at>?',(hashlib.sha256(token.encode()).hexdigest(),now()))
    if not s:return None
    u=db.one('SELECT * FROM users WHERE id=? AND status=?',(s['user_id'],'active'))
    return public_user(db,u) if u else None

def session(db,u):
    token=secrets.token_urlsafe(32);db.execute('INSERT INTO sessions VALUES(?,?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),u['id'],now()+7*86400,now()))
    return {'user':public_user(db,u),'session_token':token}
def require(db,request,admin=False):
    u=authenticate(db,request.get('token',''))
    if not u:raise Fail('请先登录 / Please sign in',401)
    if admin and u['role']!='admin':raise Fail('仅管理员可操作 / Administrator only',403)
    return u

def new_user(db,email,p,name,role='user',locale='zh'):
    if db.one('SELECT id FROM users WHERE email=?',(email,)):raise Fail('无法注册，请尝试登录或重置密码 / Try signing in or resetting your password')
    name=str(name).strip()[:80] or email.split('@')[0];id=uid('u');ts=now();tier='ultra' if role=='admin' else 'normal';credits=20
    db.execute('INSERT INTO users VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(id,email,name,password_hash(p),role,'active',locale,ts,None,tier,0,credits,credits,ts+30*86400,ts+7*86400))
    audit(db,id,'account_created',id,{'role':role,'trial_credits':credits})
    return db.one('SELECT * FROM users WHERE id=?',(id,))

def migrate_admin(id):
    target=ROOT/'tenants'/id/'projects';target.mkdir(parents=True,exist_ok=True)
    source=ROOT/'projects'
    if source.exists():
        backup=HOME/'legacy-projects-backup'
        if not backup.exists():shutil.copytree(source,backup)
        for f in source.glob('p*.json'):
            if not (target/f.name).exists():shutil.copy2(f,target/f.name)

def order_view(o):
    v={k:o[k] for k in ['id','tier','period','channel','amount','currency','status','created_at','expires_at','paid_at','transaction_id','user_id']}
    if v['status']=='pending' and v['expires_at']<now():v['status']='expired'
    v['checkout']=json.loads(o['checkout']) if o.get('checkout') else None
    return v

def fulfill(db,channel,e):
    if e.get('ignored'):return {'ok':True}
    o=db.one('SELECT * FROM orders WHERE id=?',(e['order_id'],))
    if not o or o['channel']!=channel or o['amount']!=e['amount'] or o['currency']!=e['currency']:raise Fail('支付订单或金额不匹配 / Payment mismatch')
    if e.get('provider_id') and o['provider_id']!=e['provider_id']:raise Fail('Payment session mismatch')
    if o['status']=='paid':
        if o['transaction_id']!=e['transaction_id']:raise Fail('Duplicate payment needs reconciliation')
        return {'ok':True,'duplicate':True}
    if o['status']!='pending':raise Fail('订单不可开通 / Order cannot be fulfilled')
    existing=db.one('SELECT id FROM payment_events WHERE transaction_id=? OR id=?',(e['transaction_id'],channel+':'+e['event_id']))
    if existing:raise Fail('Duplicate payment event')
    u=db.one('SELECT * FROM users WHERE id=?',(o['user_id'],));p=json.loads(o['plan_snapshot']);start=max(now(),u['expires_at']) if u['tier']==o['tier'] else now()
    # Changing tiers while subscribed is disallowed at checkout; paid snapshots are immutable.
    end=add_months(start,12 if o['period']=='year' else 1);before={k:u[k] for k in ['tier','expires_at','credits','credit_limit','credit_reset_at']}
    renewal=u['tier']==o['tier'] and u['expires_at']>now()
    credits=u['credits'] if renewal else p['credits'];reset=u['credit_reset_at'] if renewal else add_months(now(),1)
    db.execute('UPDATE users SET tier=?,expires_at=?,credits=?,credit_limit=?,credit_reset_at=? WHERE id=?',(o['tier'],end,credits,p['credits'],reset,u['id']))
    after={'tier':o['tier'],'expires_at':end,'credits':credits,'credit_limit':p['credits'],'credit_reset_at':reset}
    db.execute('UPDATE orders SET status=?,paid_at=?,transaction_id=?,member_before=?,member_after=? WHERE id=?',('paid',now(),e['transaction_id'],json.dumps(before),json.dumps(after),o['id']))
    db.execute('INSERT INTO payment_events VALUES(?,?,?,?,?)',(channel+':'+e['event_id'],channel,o['id'],e['transaction_id'],now()))
    audit(db,'payment:'+channel,'payment_verified',o['id'],{'amount':o['amount'],'membership_until':end})
    return {'ok':True}

def handle(db,r):
    action=r['action'];b=r.get('body') or {};c=config()
    if action=='reconcile':
        interrupted=db.all('SELECT * FROM usage WHERE status=?',('running',))
        for task in interrupted:
            db.execute('UPDATE usage SET status=?,finished_at=?,note=? WHERE id=?',('failed',now(),'Service restarted; credits released',task['id']))
            user=db.one('SELECT role FROM users WHERE id=?',(task['user_id'],))
            if user and user['role']!='admin':db.execute('UPDATE users SET credits=MIN(credits+?,credit_limit) WHERE id=?',(task['units'],task['user_id']))
        return {'ok':True,'reconciled':len(interrupted)}
    if action=='authenticate':return {'user':authenticate(db,r.get('token',''))}
    if action=='public':return {'setup_required':not bool(db.one('SELECT id FROM users WHERE role=?',('admin',))),'mail_ready':mail_ready(c),'channels':readiness(c),'trial_credits':20,'trial_days':7,'plans':db.all("SELECT * FROM plans WHERE tier IN ('normal','high') AND enabled=1 ORDER BY monthly"),'auto_renew':False}
    if action=='bootstrap':
        rate(db,'bootstrap:'+r.get('ip','local'),5,3600)
        if db.one('SELECT id FROM users WHERE role=?',('admin',)):raise Fail('管理员已经创建 / Administrator already exists',403)
        supplied=str(b.get('setup_token','')).strip();expected=(HOME/'bootstrap-token').read_text().strip()
        if not hmac.compare_digest(supplied,expected):raise Fail('初始化令牌无效 / Invalid setup token',403)
        u=new_user(db,email_address(b.get('email','')),b.get('password'),b.get('name',''),'admin',b.get('locale','zh'));migrate_admin(u['id']);return session(db,u)
    if action=='send_code':
        email=email_address(b.get('email',''));purpose=b.get('purpose','register')
        if purpose not in ('register','reset'):raise Fail('Invalid purpose')
        rate(db,'mail-ip:'+r.get('ip','local'),20,3600);rate(db,'mail-address:'+email,5,3600)
        old=db.one('SELECT sent_at FROM codes WHERE email=? AND purpose=?',(email,purpose))
        if old and now()-old['sent_at']<60:raise Fail('请60秒后重发 / Wait 60 seconds',429)
        known=db.one('SELECT id FROM users WHERE email=?',(email,))
        if (purpose=='reset' and not known) or (purpose=='register' and known):return {'ok':True,'message':'如果邮箱可用，验证码已发送 / If eligible, a code has been sent'}
        code=f'{secrets.randbelow(1000000):06d}'
        send_mail(email,code,purpose,b.get('locale','zh'),c)
        db.execute('INSERT INTO codes VALUES(?,?,?,?,?,?) ON CONFLICT(email,purpose) DO UPDATE SET digest=excluded.digest,expires_at=excluded.expires_at,attempts=0,sent_at=excluded.sent_at',(email,purpose,code_digest(email,purpose,code),now()+300,0,now()))
        return {'ok':True,'message':'如果邮箱可用，验证码已发送 / If eligible, a code has been sent'}
    if action=='register':
        rate(db,'register:'+r.get('ip','local'),20,3600);email=email_address(b.get('email',''))
        if b.get('accepted_terms') is not True:raise Fail('请阅读并同意服务条款和隐私说明 / Accept the terms and privacy notice')
        consume_code(db,email,'register',b.get('code',''));u=new_user(db,email,b.get('password'),b.get('name',''),'user',b.get('locale','zh'));return session(db,u)
    if action=='login':
        rate(db,'login:'+r.get('ip','local'),30,900);email=email_address(b.get('email',''));rate(db,'login-user:'+email,10,900)
        u=db.one('SELECT * FROM users WHERE email=?',(email,));dummy=base64.b64encode(b'0'*48).decode()
        valid=password_check(b.get('password',''),u['password'] if u else dummy)
        if not u or not valid or u['status']!='active':db.commit();raise Fail('邮箱或密码不正确／账号不可用 / Invalid credentials or unavailable account',401)
        db.execute('UPDATE users SET last_login=? WHERE id=?',(now(),u['id']));u['last_login']=now();return session(db,u)
    if action=='reset':
        email=email_address(b.get('email',''));rate(db,'reset:'+r.get('ip','local'),20,3600)
        new=password_hash(b.get('password'));consume_code(db,email,'reset',b.get('code',''));u=db.one('SELECT id FROM users WHERE email=?',(email,))
        if not u:raise Fail('验证码无效 / Invalid code')
        db.execute('UPDATE users SET password=? WHERE id=?',(new,u['id']));db.execute('DELETE FROM sessions WHERE user_id=?',(u['id'],));return {'ok':True}
    if action=='webhook':
        try:e=verified_event(r['channel'],bytes(r['raw_bytes']) if 'raw_bytes' in r else base64.b64decode(r['raw']),r.get('headers',{}),c)
        except Exception:raise Fail('支付签名验证失败 / Invalid payment signature')
        return fulfill(db,r['channel'],e)
    if action in ('reserve','settle'):
        # Internal only: never mapped to a client-accessible action.
        if action=='reserve':
            u=require(db,r);ts=now();units=int(b.get('units',2))
            if not 1<=units<=10000:raise Fail('Invalid units')
            if u['role']!='admin' and (u['membership_status']=='expired' or u['credits']<units):raise Fail('分析额度不足或会员已到期 / Insufficient credits or expired membership',402)
            active=db.one('SELECT count(*) AS n FROM usage WHERE user_id=? AND status=?',(u['id'],'running'))['n']
            if active>=u['limits']['concurrency']:raise Fail('已有分析任务运行，请稍后重试 / Concurrent task limit reached',429)
            request_key=u['id']+'|'+b['action']+'|'+str(b.get('request_id') or uid('req'))[:128]
            if db.one('SELECT id FROM usage WHERE request_key=?',(request_key,)):raise Fail('请求已提交，请等待原任务结果 / Request already submitted',409)
            id=uid('task');db.execute('INSERT INTO usage VALUES(?,?,?,?,?,?,?,?,?)',(id,u['id'],b['action'],units,'running',ts,None,'',request_key))
            if u['role']!='admin':db.execute('UPDATE users SET credits=credits-? WHERE id=?',(units,u['id']))
            return {'lease_id':id}
        task=db.one('SELECT * FROM usage WHERE id=?',(b['lease_id'],))
        if task and task['status']=='running':
            status='done' if b.get('success') else 'failed';db.execute('UPDATE usage SET status=?,finished_at=? WHERE id=?',(status,now(),task['id']))
            user=db.one('SELECT role FROM users WHERE id=?',(task['user_id'],))
            if status=='failed' and user['role']!='admin':db.execute('UPDATE users SET credits=MIN(credits+?,credit_limit) WHERE id=?',(task['units'],task['user_id']))
        return {'ok':True}
    u=require(db,r,action.startswith('admin_'))
    if action=='me':return {'user':u}
    if action=='logout':db.execute('DELETE FROM sessions WHERE token=?',(hashlib.sha256(r['token'].encode()).hexdigest(),));return {'ok':True}
    if action=='account':
        return {'user':u,'orders':[order_view(o) for o in db.all('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 200',(u['id'],))],'refunds':db.all('SELECT r.* FROM refunds r JOIN orders o ON r.order_id=o.id WHERE o.user_id=? ORDER BY r.created_at DESC',(u['id'],)),'usage':db.all('SELECT id,action,units,status,created_at,finished_at FROM usage WHERE user_id=? ORDER BY created_at DESC LIMIT 100',(u['id'],))}
    if action=='profile':
        name=str(b.get('name',u['name'])).strip();locale=b.get('locale',u['locale'])
        if not 1<=len(name)<=80 or locale not in ('zh','en'):raise Fail('Invalid profile')
        db.execute('UPDATE users SET name=?,locale=? WHERE id=?',(name,locale,u['id']));return {'ok':True}
    if action=='order':
        tier=b.get('tier');period=b.get('period');channel=b.get('channel');p=db.one("SELECT * FROM plans WHERE tier=? AND tier IN ('normal','high')",(tier,))
        if not p or not p['enabled'] or period not in ('month','year') or channel not in ('wechat','alipay','applepay'):raise Fail('套餐或支付方式不可用 / Plan or payment channel unavailable')
        locale=b.get('locale',u.get('locale','zh'));currency='USD' if locale=='en' else 'CNY'
        if currency=='USD' and channel in ('wechat','alipay'):raise Fail('美元套餐请使用 Apple Pay / Stripe；微信和支付宝订单使用人民币 / Use Apple Pay / Stripe for USD plans')
        if u['membership_status']=='active' and u['subscription_tier']!=tier:raise Fail('当前会员期内暂仅支持同等级续费；变更等级请联系管理员 / Renew the same tier or contact support to change tiers')
        if not readiness(c)[channel]['ready']:raise Fail('支付渠道尚未配置，请联系管理员 / Payment channel is not configured',503)
        rate(db,'orders:'+u['id'],10,3600)
        recent=db.one('SELECT * FROM orders WHERE user_id=? AND tier=? AND period=? AND channel=? AND status=? AND expires_at>?',(u['id'],tier,period,channel,'pending',now()))
        if recent and recent.get('checkout'):return order_view(recent)
        id=uid('o');ts=now();price_key=('monthly_usd' if period=='month' else 'yearly_usd') if currency=='USD' else ('monthly' if period=='month' else 'yearly');amount=p[price_key];o={'id':id,'email':u['email'],'tier':tier,'period':period,'channel':channel,'amount':amount,'currency':currency,'expires_at':ts+1800}
        try:check=checkout(o,c)
        except Exception:raise Fail('支付订单创建失败，请稍后重试 / Checkout creation failed',502)
        db.execute('INSERT INTO orders(id,user_id,tier,period,channel,amount,currency,status,created_at,expires_at,provider_id,checkout,plan_snapshot) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(id,u['id'],tier,period,channel,amount,currency,'pending',ts,ts+1800,check.get('provider_id'),json.dumps(check),json.dumps(p)))
        return order_view(db.one('SELECT * FROM orders WHERE id=?',(id,)))
    if action=='order_read':
        o=db.one('SELECT * FROM orders WHERE id=? AND user_id=?',(b['id'],u['id']))
        if not o:raise Fail('订单不存在 / Order not found',404)
        return order_view(o)
    if action=='admin_overview':
        users=[public_user(db,v) for v in db.all('SELECT * FROM users ORDER BY created_at DESC LIMIT 500')]
        return {'users':users,'orders':[order_view(o) for o in db.all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500')],'audit':db.all('SELECT * FROM audit ORDER BY created_at DESC LIMIT 200'),'plans':db.all("SELECT * FROM plans WHERE tier IN ('normal','high') ORDER BY monthly"),'refunds':db.all('SELECT r.*,o.currency FROM refunds r JOIN orders o ON o.id=r.order_id ORDER BY r.created_at DESC LIMIT 200'),'usage':db.all('SELECT * FROM usage ORDER BY created_at DESC LIMIT 200')}
    if action=='admin_refund':
        o=db.one('SELECT * FROM orders WHERE id=?',(b.get('id'),))
        receipt=str(b.get('receipt','')).strip();reason=str(b.get('reason','')).strip()
        if not o or o['status']!='paid':raise Fail('仅可登记已付款订单的退款 / Only paid orders can be refunded')
        if not 1<=len(receipt)<=200 or not 1<=len(reason)<=1000:raise Fail('请填写渠道退款凭证编号和原因 / Refund receipt and reason required')
        # This is an explicit operator reconciliation, not a gateway refund call.
        latest=db.one('SELECT id FROM orders WHERE user_id=? AND status=? ORDER BY paid_at DESC,created_at DESC LIMIT 1',(o['user_id'],'paid'))
        if not latest or latest['id']!=o['id']:raise Fail('此订单后已有其他缴费，请先人工核对累计会员权益 / Reconcile subsequent payments before refunding this order')
        before=json.loads(o['member_before']);target=db.one('SELECT * FROM users WHERE id=?',(o['user_id'],));after=json.loads(o['member_after'])
        if target['tier']!=after['tier'] or target['expires_at']!=after['expires_at']:raise Fail('会员权益已经被其他操作修改，请先核对 / Membership changed; reconcile it first')
        db.execute('INSERT INTO refunds VALUES(?,?,?,?,?,?,?,?)',(uid('r'),o['id'],o['amount'],receipt,reason,u['id'],now(),'operator_reconciled'))
        db.execute('UPDATE orders SET status=? WHERE id=?',('refunded',o['id']))
        db.execute('UPDATE users SET tier=?,expires_at=?,credits=?,credit_limit=?,credit_reset_at=? WHERE id=?',(before['tier'],before['expires_at'],before['credits'],before['credit_limit'],before['credit_reset_at'],target['id']))
        audit(db,u['id'],'external_refund_reconciled',o['id'],{'receipt':receipt,'reason':reason,'amount':o['amount'],'membership_restored':before})
        return {'ok':True,'message':'已登记外部退款并恢复相应权益；此操作不发起资金退款 / External refund recorded; funds are not transferred by this action'}
    if action=='admin_user':
        target=db.one('SELECT * FROM users WHERE id=?',(b.get('id'),))
        if not target:raise Fail('User not found',404)
        if not str(b.get('reason','')).strip():raise Fail('请填写修改原因 / A reason is required')
        tier=b.get('tier',target['tier']);status=b.get('status',target['status'])
        if tier not in ('normal','high') or status not in ('active','suspended'):raise Fail('当前仅开放 normal 和 high 两档 / Only normal and high tiers are available')
        if target['role']=='admin':raise Fail('此界面不能修改管理员 / Administrator cannot be changed here')
        days=int(b.get('days',0));credits=int(b.get('credits',target['credits']))
        if not 0<=days<=730 or not 0<=credits<=10000:raise Fail('Invalid membership values')
        expires=max(now(),target['expires_at'])+days*86400 if days else target['expires_at']
        db.execute('UPDATE users SET tier=?,status=?,expires_at=?,credits=?,credit_limit=? WHERE id=?',(tier,status,expires,credits,max(credits,target['credit_limit']),target['id']))
        if status=='suspended':db.execute('DELETE FROM sessions WHERE user_id=?',(target['id'],))
        audit(db,u['id'],'membership_adjusted',target['id'],{'tier':tier,'status':status,'days':days,'credits':credits,'reason':b['reason']});return {'ok':True}
    if action=='admin_plan':
        tier=b.get('tier');old=db.one('SELECT * FROM plans WHERE tier=?',(tier,))
        if not old:raise Fail('Invalid plan')
        if tier not in ('normal','high'):raise Fail('当前仅开放 normal 和 high 两档 / Only normal and high tiers are available')
        fields=['monthly','yearly','monthly_usd','yearly_usd','credits','projects','storage_mb','concurrency','enabled'];values=[]
        limits={'monthly':10000000,'yearly':100000000,'monthly_usd':10000000,'yearly_usd':100000000,'credits':10000,'projects':1000,'storage_mb':100000,'concurrency':10,'enabled':1}
        for f in fields:
            v=int(b.get(f,old[f]));minimum=0 if f=='enabled' else 1
            if not minimum<=v<=limits[f]:raise Fail('套餐参数超出范围 / Invalid plan value')
            values.append(v)
        db.execute('UPDATE plans SET '+','.join(f+'=?' for f in fields)+',version=version+1 WHERE tier=?',(*values,tier));audit(db,u['id'],'plan_updated',tier,dict(zip(fields,values)));return {'ok':True}
    if action=='admin_config':
        return {'config':{k:v for k,v in c.items() if k not in SECRET_FIELDS},'configured':{k:bool(c.get(k)) for k in SECRET_FIELDS},'mail_ready':mail_ready(c),'channels':readiness(c),'database':'postgresql' if db.pg else 'sqlite_local'}
    if action=='admin_config_save':
        old=config();permitted=set(old)|SECRET_FIELDS|{'smtp_host','smtp_port','smtp_user','smtp_from','smtp_security','public_url','mail_mode','wechat_app_id','wechat_mch_id','wechat_serial','wechat_platform_serial','alipay_app_id','alipay_sandbox'}
        for k,v in b.items():
            if k in permitted and (k not in SECRET_FIELDS or v):old[k]=v
        if old.get('smtp_security') not in ('ssl','starttls'):raise Fail('SMTP needs SSL or STARTTLS')
        if old.get('mail_mode') not in ('smtp','file') or (production() and old.get('mail_mode')=='file'):raise Fail('Invalid mail mode')
        url=old.get('public_url','')
        if not re.fullmatch(r'https://[^/?#\s]+(?::\d+)?|http://(?:127\.0\.0\.1|localhost)(?::\d+)?',url):raise Fail('站点地址须为HTTPS或本机地址 / HTTPS website URL required')
        p=HOME/'service-config.json';tmp=p.with_suffix('.tmp');fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
        with os.fdopen(fd,'w') as f:json.dump(old,f)
        tmp.replace(p);audit(db,u['id'],'service_config_updated','services',{'fields':[k for k in b if k not in SECRET_FIELDS]});return {'ok':True}
    raise Fail('Unsupported action',404)
def main():
    HOME.mkdir(parents=True,exist_ok=True);db=DB();init(db);db.begin()
    try:
        value=handle(db,json.load(sys.stdin));db.commit();print(json.dumps({'status':200,'value':value},ensure_ascii=False))
    except Fail as e:db.rollback();print(json.dumps({'status':e.status,'value':{'error':e.message}},ensure_ascii=False))
    except Exception:db.rollback();print(json.dumps({'status':500,'value':{'error':'服务处理失败，请联系管理员 / Service failed; contact the administrator'}}))
    finally:db.c.close()
if __name__=='__main__':main()
