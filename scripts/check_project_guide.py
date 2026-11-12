"""Grounding, stage isolation, caching and web failure tests with no real model calls."""
import tempfile,json,os,copy
from pathlib import Path
import project_guide as guide
os.environ['MODEL_USER_TIER']='normal';os.environ['MODEL_USER_ROLE']='user';os.environ['MODEL_SOURCE_NAMES']='0'
with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);catalog=root/'catalog';catalog.mkdir()
    (catalog/'catalog.json').write_text(json.dumps({'books':[{'id':'b1','title':'Quality book','indexed':True}],'skills':[{'id':'s1','book_id':'b1','name':'Approved regression','description':'regression quality','status':'reviewed','stages':[5],'steps':['Validate'],'source':{'page':1}},{'id':'unreviewed','book_id':'b1','name':'Do not use','status':'draft','stages':[5]}]}))
    (catalog/'b1.json').write_text(json.dumps([{'page':1,'text':'temperature strength regression measurement residual optimization monitoring bottleneck constraint variable experimental improvement'}]))
    os.environ['DATA_DIR']=tmp;calls=[];evidence=[]
    def model(context,sources):
        calls.append(copy.deepcopy(context));evidence.append(copy.deepcopy(sources));r={k:[] for k in guide.PROPERTIES};r.update(answer='建议确认温度与强度的关系',steps=['采集现场证据'],questions=['材料是否相同？'],hypotheses=['温度可能影响强度，须实验验证'],source_ids=[sources[0]['id']] if sources else []);return r
    guide.call_model=model;guide.online_sources=lambda q:[{'id':'W1','title':'Research','kind':'web','url':'https://doi.org/10.test/x','text':'Test abstract','coverage':'abstract'}]
    context={'stage':5,'project':{'name':'Heat treatment','question':'温度对强度的影响','target':'Improve strength'},'data':{'rows':0,'columns':[]},'model':None}
    req={'context':context,'web':True};before=copy.deepcopy(req)
    result=guide.guide(req);assert req==before
    assert any(s['kind']=='book' for s in result['sources']) and any(s['kind']=='skill' for s in result['sources']) and any(s['kind']=='web' for s in result['sources'])
    assert all(s.get('skill_id')!='unreviewed' for s in result['sources'])
    assert result['access']=={'tier':'normal','role':'user','show_book_names':False}
    assert result['recommendations'][0]['tier']=='normal'
    assert all('url' not in s and 'book_title' not in s and 'book_id' not in s for s in result['sources'])
    assert all(s['title']==s['knowledge_point'] and s.get('summary') for s in result['sources'])
    assert 'Quality book' not in json.dumps(evidence[-1]) and 'Approved regression' not in json.dumps(evidence[-1])
    assert 'Research' not in json.dumps(result['sources'])
    assert guide.guide(req)['cached'] and len(calls)==1
    guide.guide({**req,'web_query':'different query'});assert len(calls)==2
    for stage in range(2,11):
        context['stage']=stage;result=guide.guide({'context':context,'web':False});assert result['stage']==stage
    def unavailable(q):raise OSError('offline')
    guide.online_sources=unavailable
    context['stage']=4;result=guide.guide({'context':context,'web':True,'force':True});assert result['warnings'] and all(s['kind']!='web' for s in result['sources'])
    original=model
    def invented(context,sources):r=original(context,sources);r['source_ids']=['invented'];return r
    guide.call_model=invented
    try:guide.guide({'context':context,'force':True})
    except ValueError:pass
    else:raise AssertionError('unverified source accepted')
with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);catalog=root/'catalog';catalog.mkdir();os.environ['DATA_DIR']=tmp
    book={'id':'private-book','title':'Secret engineering book title','indexed':False}
    def skill(identifier,tier,score=50,capability='regression_modeling',package_tier=None):
        return {'id':identifier,'mode':'book-to-skill','artifact_id':identifier,'book_id':book['id'],'name':book['title']+' '+identifier,'description':'regression model temperature strength','status':'reviewed','stages':[5,6],'capability_tier':package_tier or tier,'capabilities':[{'id':capability,'label':'非线性回归' if capability=='regression_modeling' else '实验设计','tier':tier,'score':score,'reasons':['包含适用条件、诊断与计算步骤']}],'steps':['Validate regression'],'source':{'page':2}}
    skills=[skill('reg-normal','normal',55),skill('reg-high','high',75),skill('reg-high-best','high',85),skill('reg-ultra','ultra',95),skill('doe-normal','normal',52,'experiment_design'),skill('mixed-ultra-package','normal',100,package_tier='ultra'),{**skill('unreviewed-ultra','ultra',100),'status':'draft'}]
    (catalog/'catalog.json').write_text(json.dumps({'books':[book],'skills':skills}))
    for item in skills:
        folder=catalog/'generated'/item['artifact_id'];folder.mkdir(parents=True)
        (folder/'SKILL.md').write_text('# '+item['name']+'\nREGRESSION_ARTIFACT_'+item['id'])
        (folder/'chapters').mkdir();(folder/'chapters/chapter.md').write_text('regression\nCHAPTER_ARTIFACT_'+item['id'])
    calls=[];evidence=[];guide.call_model=model
    guide.online_sources=lambda q:[]
    context={'stage':5,'project':{'name':'Real project','question':'温度强度回归','target':'精确建模'}}
    req={'context':context,'tier':'ultra','access':{'tier':'ultra','show_book_names':True}}
    result=guide.guide(req);selected={s['skill_id'] for s in result['sources'] if s['kind']=='skill'}
    assert selected=={'reg-normal','doe-normal'},selected
    assert 'ARTIFACT_reg-normal' in json.dumps(evidence[-1]),'allowed generated packages must still supply their own content'
    assert 'ARTIFACT_reg-high' not in json.dumps(evidence[-1]) and 'ARTIFACT_reg-ultra' not in json.dumps(evidence[-1])
    assert 'ARTIFACT_mixed-ultra-package' not in json.dumps(evidence[-1]),'normal capability must not expose an Ultra package'
    assert book['title'] not in json.dumps(evidence[-1]) and book['title'] not in json.dumps(result)
    assert guide.guide(req)['cached'] and len(calls)==1
    os.environ['MODEL_USER_TIER']='high'
    result=guide.guide(req);selected={s['skill_id'] for s in result['sources'] if s['kind']=='skill'}
    assert selected=={'reg-high-best','doe-normal'},selected
    assert not result['cached'] and len(calls)==2
    assert 'ARTIFACT_reg-ultra' not in json.dumps(evidence[-1]) and 'ARTIFACT_mixed-ultra-package' not in json.dumps(evidence[-1])
    os.environ['MODEL_USER_TIER']='ultra'
    result=guide.guide(req);selected={s['skill_id'] for s in result['sources'] if s['kind']=='skill'}
    assert selected=={'reg-ultra','doe-normal'},selected
    assert not result['cached'] and len(calls)==3
    assert result['recommendations'][0]['tier']=='ultra'
    os.environ['MODEL_SOURCE_NAMES']='1';os.environ['MODEL_USER_ROLE']='admin'
    result=guide.guide(req);assert not result['cached'] and len(calls)==4
    assert result['access']=={'tier':'ultra','role':'admin','show_book_names':True}
    assert any(s.get('book_title')==book['title'] and '/reader.html' in s.get('url','') for s in result['sources'])
    assert book['title'] in json.dumps(evidence[-1])
    os.environ['MODEL_USER_ROLE']='user';context['user_question']='role cache isolation check'
    assert not guide.guide(req)['cached'] and len(calls)==5,'role must participate in cache key'
    os.environ['MODEL_USER_TIER']='normal';os.environ['MODEL_USER_ROLE']='user';os.environ['MODEL_SOURCE_NAMES']='0';context.pop('user_question',None)
    assert guide.guide(req)['cached'] and len(calls)==5,'returning to normal must use its isolated result'
    # A missing exact artifact must not fall back to another package from the same book.
    high_backup=catalog/'generated'/book['id'];high_backup.mkdir();(high_backup/'SKILL.md').write_text('FORBIDDEN_BACKUP_ARTIFACT')
    (catalog/'generated/reg-normal/SKILL.md').unlink()
    import shutil
    shutil.rmtree(catalog/'generated/reg-normal/chapters')
    result=guide.guide({**req,'force':True})
    assert 'FORBIDDEN_BACKUP_ARTIFACT' not in json.dumps(evidence[-1])
    # Redaction also covers model output if the model recalls the book title.
    def naming_model(context,sources):
        value=model(context,sources);value['answer']='来自 '+book['title']+' /reader.html?book=private-book&page=2';value['steps']=[book['title']];return value
    guide.call_model=naming_model
    result=guide.guide({**req,'force':True})
    assert book['title'] not in json.dumps(result) and '/reader.html' not in json.dumps(result)
with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);catalog=root/'catalog';catalog.mkdir();os.environ['DATA_DIR']=tmp
    book={'id':'nist','title':'NIST handbook','indexed':False}
    template={'id':'nist-regression','book_id':'nist','name':'Regression template','description':'regression temperature strength','status':'reviewed','stages':[5],'mode':'template','capability_tier':'normal','capabilities':[{'id':'regression_modeling','label':'回归建模','tier':'normal','score':55}]}
    advanced={**template,'id':'nist-advanced','name':'Advanced generated regression','mode':'book-to-skill','capability_tier':'high','capabilities':[{'id':'regression_modeling','label':'回归建模','tier':'high','score':85}]}
    unknown={**advanced,'id':'unknown-package','artifact_id':'unknown-package','capability_tier':'enterprise','capabilities':[{'id':'regression_modeling','label':'回归建模','tier':'normal','score':100}]}
    unknown_capability={**advanced,'id':'unknown-capability','artifact_id':'unknown-capability','capability_tier':'normal','capabilities':[{'id':'regression_modeling','label':'回归建模','tier':'platinum','score':100}]}
    (catalog/'catalog.json').write_text(json.dumps({'books':[book],'skills':[template,advanced,unknown,unknown_capability]}))
    shared=catalog/'generated/nist';(shared/'chapters').mkdir(parents=True)
    (shared/'SKILL.md').write_text('regression FORBIDDEN_SHARED_HIGH_MASTER')
    (shared/'chapters/high.md').write_text('regression FORBIDDEN_SHARED_HIGH_CHAPTER')
    for item in (unknown,unknown_capability):
        folder=catalog/'generated'/item['artifact_id'];folder.mkdir();(folder/'SKILL.md').write_text('regression FORBIDDEN_UNKNOWN_TIER')
    guide.call_model=model
    for tier in ('normal','high','ultra'):
        os.environ['MODEL_USER_TIER']=tier
        result=guide.guide({'context':context,'force':True})
        source_skills=[s['skill_id'] for s in result['sources'] if s['kind']=='skill']
        assert 'unknown-package' not in source_skills and 'unknown-capability' not in source_skills
        assert 'FORBIDDEN_UNKNOWN_TIER' not in json.dumps(evidence[-1])
        if tier=='normal':
            assert source_skills==['nist-regression']
            assert 'FORBIDDEN_SHARED_HIGH' not in json.dumps(evidence[-1]),'normal template borrowed generated high package from the same book'
        else:
            assert source_skills==['nist-advanced'] and 'FORBIDDEN_SHARED_HIGH_MASTER' in json.dumps(evidence[-1])
    # Legacy template with no mode or tier metadata also never reads generated/nist.
    legacy={k:v for k,v in template.items() if k not in ('mode','capability_tier','capabilities')}
    (catalog/'catalog.json').write_text(json.dumps({'books':[book],'skills':[legacy]}))
    os.environ['MODEL_USER_TIER']='normal'
    result=guide.guide({'context':context,'force':True})
    assert result['recommendations'][0]['tier']=='normal' and 'FORBIDDEN_SHARED_HIGH' not in json.dumps(evidence[-1])
print('PASS: local-first retrieval, reviewed skills, stages 2–10, citation validation, permission-isolated cache, package tier filtering, same-capability best tier, hidden names/URLs, no template borrowing, unknown tiers denied and no backup fallback')
