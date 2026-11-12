# -*- coding: utf-8 -*-
import copy
import project_materials as materials
calls=[]
def mock(system,payload,props):
    calls.append(payload)
    return {'summary':'待确认资料','fields':[{'key':k,'value':'待确认'} for k in payload['allowed_fields']], 'variables':[{'name':'温度','unit':'C','role':'X','definition':'测量','min':1,'max':10},{'name':'强度','unit':'MPa','role':'Y','definition':'测量','min':10,'max':20}], 'collection_headers':['温度 C','强度 MPa','批次'],'analysis_plan':[{'item':'检查测量','method':'现场核对','required':'测量记录','decision':'待填写结果'}],'instructions':['模拟范围仅用于教学']}
materials.structured_model=mock
for stage in range(1,11):
    req={'context':{'stage':stage,'project':{'question':'温度对强度的影响'}},'guide':{'stage':stage,'answer':'先确认变量定义','created_at':1,'source_ids':['L1']}}
    before=copy.deepcopy(req);v=materials.generate(req);assert req==before and v['stage']==stage and v['source_ids']==['L1'];assert all(f['key'] in materials.ALLOWED[stage] for f in v['fields'])
original=copy.deepcopy(v)
for change in ('field','range','duplicate','role'):
    value=copy.deepcopy(original)
    if change=='field':value['fields']=[{'key':'scope','value':'wrong stage'}]
    if change=='range':value['variables'][0]['min']=value['variables'][0]['max']
    if change=='duplicate':value['variables'][0]['name']=value['variables'][1]['name']
    if change=='role':value['variables'][0]['role']='Y'
    # Remove returned provenance before testing strict model schema.
    for k in ('stage','created_at','sources','source_ids'):value.pop(k,None)
    try:materials.validate(value,10)
    except ValueError:pass
    else:raise AssertionError(change)
try:materials.generate({'context':{'stage':3},'guide':{'stage':2,'answer':'old'}})
except ValueError:pass
else:raise AssertionError('wrong stage accepted')
print('PASS: stages 1–10, field whitelist, schema/range validation, no project mutation, stage isolation')
repair_calls=[]
def repair_model(system,payload,props):
    repair_calls.append(payload)
    candidate=mock(system,payload,props)
    if len(repair_calls)==1:candidate['collection_headers']=['column'+str(i) for i in range(41)]
    return candidate
materials.structured_model=repair_model
req={'context':{'stage':3,'project':{'question':'test'}},'guide':{'stage':3,'answer':'confirm variables'}}
assert materials.generate(req)['stage']==3 and len(repair_calls)==2
assert 'validation_error' in repair_calls[1]
def always_invalid(system,payload,props):
    candidate=mock(system,payload,props);candidate['fields']=[{'key':'scope','value':'wrong stage'}];return candidate
materials.structured_model=always_invalid
try:materials.generate(req)
except ValueError:pass
else:raise AssertionError('failed repair was accepted')
print('PASS: one bounded schema repair, still-invalid candidates rejected')
