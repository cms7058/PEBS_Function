"""Payment adapters. No simulated success endpoint exists in the public API."""
import base64, hashlib, hmac, json, secrets, time, urllib.parse, urllib.request
from decimal import Decimal
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

class PaymentError(ValueError): pass

def rsa_sign(key, message):
    private=serialization.load_pem_private_key(key.encode(),password=None)
    return base64.b64encode(private.sign(message.encode(),padding.PKCS1v15(),hashes.SHA256())).decode()
def rsa_verify(key, message, signature):
    public=serialization.load_pem_public_key(key.encode())
    public.verify(base64.b64decode(signature,validate=True),message.encode(),padding.PKCS1v15(),hashes.SHA256())
def http_json(url, data=None, headers=None):
    req=urllib.request.Request(url,data=data,headers=headers or {})
    with urllib.request.urlopen(req,timeout=20) as r:return json.load(r)
def readiness(config):
    fields={'wechat':['wechat_app_id','wechat_mch_id','wechat_serial','wechat_private_key','wechat_api_v3_key','wechat_platform_key','wechat_platform_serial'], 'alipay':['alipay_app_id','alipay_private_key','alipay_public_key'], 'applepay':['stripe_secret_key','stripe_webhook_secret']}
    https=config.get('public_url','').startswith('https://')
    return {k:{'ready':https and all(config.get(f) for f in fs),'missing':[f for f in fs if not config.get(f)]+([] if https else ['public_url_https'])} for k,fs in fields.items()}
def checkout(order,c):
    channel=order['channel'];base=c['public_url'].rstrip('/');name='PEBS '+order['tier']+' / '+order['period']
    if not readiness(c)[channel]['ready']:raise PaymentError('支付渠道尚未配置 / Payment channel is not configured')
    if channel=='applepay':
        # Apple Pay appears in Stripe-hosted Checkout on eligible devices/accounts.
        params={'mode':'payment','client_reference_id':order['id'],'customer_email':order['email'],'payment_method_types[0]':'card','line_items[0][quantity]':1,'line_items[0][price_data][currency]':order.get('currency','CNY').lower(),'line_items[0][price_data][unit_amount]':order['amount'],'line_items[0][price_data][product_data][name]':name,'success_url':base+'/?view=account&order='+order['id'],'cancel_url':base+'/?view=account','expires_at':order['expires_at'],'metadata[order_id]':order['id']}
        headers={'Authorization':'Bearer '+c['stripe_secret_key'],'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':order['id']}
        result=http_json('https://api.stripe.com/v1/checkout/sessions',urllib.parse.urlencode(params).encode(),headers)
        return {'redirect_url':result['url'],'provider_id':result['id'],'message':'Apple Pay 将在支持的设备、银行卡及商户地区显示；也可使用银行卡。 / Apple Pay is shown when eligible.'}
    if channel=='wechat':
        path='/v3/pay/transactions/native';timestamp=str(int(time.time()));nonce=secrets.token_hex(16)
        body=json.dumps({'appid':c['wechat_app_id'],'mchid':c['wechat_mch_id'],'description':name,'out_trade_no':order['id'],'time_expire':time.strftime('%Y-%m-%dT%H:%M:%S+00:00',time.gmtime(order['expires_at'])),'notify_url':base+'/api/payments/webhook/wechat','amount':{'total':order['amount'],'currency':'CNY'}},separators=(',',':'))
        signature=rsa_sign(c['wechat_private_key'],f'POST\n{path}\n{timestamp}\n{nonce}\n{body}\n')
        auth=f'WECHATPAY2-SHA256-RSA2048 mchid="{c["wechat_mch_id"]}",nonce_str="{nonce}",timestamp="{timestamp}",serial_no="{c["wechat_serial"]}",signature="{signature}"'
        result=http_json('https://api.mch.weixin.qq.com'+path,body.encode(),{'Authorization':auth,'Content-Type':'application/json','Accept':'application/json'})
        return {'qr_text':result['code_url'],'message':'请使用微信扫码支付 / Scan with WeChat'}
    if channel=='alipay':
        params={'app_id':c['alipay_app_id'],'method':'alipay.trade.page.pay','format':'JSON','charset':'utf-8','sign_type':'RSA2','timestamp':time.strftime('%Y-%m-%d %H:%M:%S',time.gmtime()),'version':'1.0','notify_url':base+'/api/payments/webhook/alipay','return_url':base+'/?view=account&order='+order['id'],'biz_content':json.dumps({'out_trade_no':order['id'],'product_code':'FAST_INSTANT_TRADE_PAY','total_amount':str(Decimal(order['amount'])/100),'subject':name,'timeout_express':'30m'},ensure_ascii=False,separators=(',',':'))}
        # Alipay timestamps use China time; execution host timezone is irrelevant.
        params['timestamp']=time.strftime('%Y-%m-%d %H:%M:%S',time.gmtime(time.time()+8*3600))
        params['sign']=rsa_sign(c['alipay_private_key'],'&'.join(k+'='+str(params[k]) for k in sorted(params)))
        gateway='https://openapi-sandbox.dl.alipaydev.com/gateway.do' if c.get('alipay_sandbox') else 'https://openapi.alipay.com/gateway.do'
        return {'redirect_url':gateway+'?'+urllib.parse.urlencode(params),'message':'前往支付宝收银台 / Continue to Alipay'}
    raise PaymentError('Unknown payment channel')
def verified_event(channel,body,headers,c):
    """Return normalized event only after authenticating the exact received bytes."""
    if channel=='applepay':
        sig=headers.get('stripe-signature','');parts={}
        for item in sig.split(','):
            k,_,v=item.partition('=');parts.setdefault(k,[]).append(v)
        timestamp=parts.get('t',[''])[0]
        if abs(int(timestamp)-time.time())>300:raise PaymentError('Expired signature')
        expected=hmac.new(c['stripe_webhook_secret'].encode(),timestamp.encode()+b'.'+body,hashlib.sha256).hexdigest()
        if not any(hmac.compare_digest(expected,x) for x in parts.get('v1',[])):raise PaymentError('Invalid signature')
        event=json.loads(body);o=event['data']['object']
        if bool(event.get('livemode'))!=c['stripe_secret_key'].startswith('sk_live_'):raise PaymentError('Payment environment mismatch')
        if event['type'] not in ('checkout.session.completed','checkout.session.async_payment_succeeded') or o.get('payment_status')!='paid':return {'ignored':True}
        return {'event_id':event['id'],'order_id':o['client_reference_id'],'provider_id':o['id'],'transaction_id':o['payment_intent'],'amount':o['amount_total'],'currency':o['currency'].upper(),'state':'paid'}
    if channel=='wechat':
        ts=headers.get('wechatpay-timestamp','');nonce=headers.get('wechatpay-nonce','')
        if abs(int(ts)-time.time())>300 or headers.get('wechatpay-serial')!=c['wechat_platform_serial']:raise PaymentError('Expired or unknown certificate')
        rsa_verify(c['wechat_platform_key'],ts+'\n'+nonce+'\n'+body.decode()+'\n',headers.get('wechatpay-signature',''))
        event=json.loads(body);r=event['resource']
        decrypted=AESGCM(c['wechat_api_v3_key'].encode()).decrypt(r['nonce'].encode(),base64.b64decode(r['ciphertext']),r.get('associated_data','').encode());o=json.loads(decrypted)
        if o['mchid']!=c['wechat_mch_id'] or o['appid']!=c['wechat_app_id']:raise PaymentError('Merchant mismatch')
        if o.get('trade_state')!='SUCCESS':return {'ignored':True}
        return {'event_id':event['id'],'order_id':o['out_trade_no'],'transaction_id':o['transaction_id'],'amount':o['amount']['total'],'currency':o['amount']['currency'],'state':'paid'}
    if channel=='alipay':
        parsed=urllib.parse.parse_qs(body.decode(),keep_blank_values=True)
        if any(len(v)!=1 for v in parsed.values()):raise PaymentError('Duplicate notification fields')
        o={k:v[0] for k,v in parsed.items()};signature=o.pop('sign');o.pop('sign_type',None)
        rsa_verify(c['alipay_public_key'],'&'.join(k+'='+o[k] for k in sorted(o) if o[k]!=''),signature)
        if o['app_id']!=c['alipay_app_id']:raise PaymentError('Merchant mismatch')
        if o.get('trade_status') not in ('TRADE_SUCCESS','TRADE_FINISHED'):return {'ignored':True}
        amount=Decimal(o['total_amount'])*100
        if amount!=int(amount):raise PaymentError('Invalid amount')
        return {'event_id':o['notify_id'],'order_id':o['out_trade_no'],'transaction_id':o['trade_no'],'amount':int(amount),'currency':'CNY','state':'paid'}
    raise PaymentError('Unknown channel')
