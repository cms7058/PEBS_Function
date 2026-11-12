"""HTTP regression against disposable check_guide_api.py --serve --collection host."""
import copy,csv,io,json,sys,urllib.error
from pathlib import Path
from check_book_to_skill import request
base=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8789'
seed=request(base,'/api/projects')[0];p=request(base,'/api/projects/'+seed['id']);s=copy.deepcopy(p['state']);s.update(stage=3,completed=[1,2],data={'columns':[],'rows':[],'label':'尚未上传项目数据','issues':[],'synthetic':False},xs=[],y=None,model=None,scenario={});s['project']['name']='采集流程API回归';m=s['materials']['3']
for key in ['collection_tables','collection_rules','collection_bindings','collection_check','checked_dataset','upload_issues','check_history']:m.pop(key,None)
m['collection_rows']=[['']*len(m['collection_headers']) for _ in range(5)]
qa=request(base,'/api/projects','POST',{'name':'采集流程API回归','state':s});path='/api/projects/'+qa['id']
def save(state):return request(base,path,'PUT',{'state':state})
def rejected(state):
    try:save(state)
    except urllib.error.HTTPError as e:
        assert e.code==400,e.code;assert '采集' in e.read().decode();return
    raise AssertionError('invalid progression accepted')
def nextstate(state):
    result=copy.deepcopy(state);result.update(stage=4,completed=[1,2,3]);return result
rejected(nextstate(s))
rows=[[f'B{i:02d}',str(100+i*5),str(30+i*2),'2026-10-02'] for i in range(20)]
def text(rows):
    out=io.StringIO();w=csv.writer(out);w.writerow(m['collection_headers']);w.writerows(rows);return out.getvalue()
bad=copy.deepcopy(rows);bad[0][1]=' １,２００ ';bad[1][2]=''
for name,data in [('collection-bad.csv',bad),('collection-fixed.csv',rows)]:Path('/tmp/'+name).write_text(text(data),encoding='utf-8-sig')
u=request(base,'/api/collection/upload','POST',{'filename':'collection-bad.csv','csv':text(bad),'kind':'collection','table_id':'primary'});assert u['accepted'];m['collection_tables']=[u['table']];save(s)
r=request(base,'/api/collection/check','POST',{'stage':3,'material':m});assert not r['passed'] and any(i['row']==3 and i['column']=='强度 MPa' for i in r['issues']);m['collection_check']=r;save(s);rejected(nextstate(s))
repair=request(base,'/api/collection/repair','POST',{'stage':3,'material':m});assert repair['change_count']==1 and repair['tables'][0]['rows'][0][1]=='1200' and repair['tables'][0]['rows'][1][2]=='';assert request(base,path)['state']['materials']['3']['collection_tables'][0]['rows'][0][1]==' １,２００ '
m['collection_tables']=repair['tables'];r=request(base,'/api/collection/check','POST',{'stage':3,'material':m});assert not r['passed'];m['collection_check']=r;save(s);rejected(nextstate(s))
m['collection_tables'][0]['rows']=copy.deepcopy(rows);r=request(base,'/api/collection/check','POST',{'stage':3,'material':m});assert r['passed'] and len(r['dataset']['rows'])==20;m['collection_check']={k:v for k,v in r.items() if k!='dataset'};m['checked_dataset']=r['dataset'];save(s)
stale=nextstate(s);stale['materials']['3']['collection_tables'][0]['rows'][0][2]='41';rejected(stale)
forged=nextstate(s);forged['materials']['3']['collection_tables'][0]['rows'][0][2]='';rejected(forged)
assert request(base,path)['state']==s
save(nextstate(s));assert request(base,path)['state']['stage']==4
assert not request(base,'/api/collection/upload','POST',{'filename':'bad.csv','csv':'A,A\n1,2\n'})['accepted']
print('PASS: isolated HTTP upload, multiple failed rounds, review-only repair, draft persistence, stale/forged receipt rejected, valid progression accepted')
