"""Isolated workflow guidance API and optional browser QA host, local mock only."""
import argparse,json,os,shutil,subprocess,tempfile,threading,time,urllib.request
from pathlib import Path
from http.server import HTTPServer,BaseHTTPRequestHandler
from check_book_to_skill import free_port,request
ROOT=Path(__file__).resolve().parents[1]
class Mock(BaseHTTPRequestHandler):
    calls=0
    def log_message(self,*args):pass
    def do_POST(self):
        value=json.loads(self.rfile.read(int(self.headers['Content-Length'])));context=json.loads(value['input'][1]['content']);Mock.calls+=1
        props=value['text']['format']['schema']['properties'];result={k:[] for k in props};result.update(answer='根据本工程问题「'+context['context']['project']['question']+'」，建议先确认现场条件，再依据书籍方法进行第 '+str(context['context']['stage'])+' 步分析。',steps=['确认材料与设备条件是否一致','记录证据后再进行建模'],questions=['采样是否覆盖不同批次？'],inputs=['温度、强度与批次记录'],outputs=['本阶段确认记录'],hypotheses=['温度可能影响强度，需现场验证'],limitations=['此建议不能替代独立验证'],source_ids=[context['evidence'][0]['id']] if context.get('evidence') else [])
        if 'fields' in props:
            result={'summary':'根据温度与强度分析建议生成变量字典、采集表及分析计划，数值范围仅用于教学预览。','fields':[{'key':'plannedY','value':'强度 MPa'},{'key':'plannedXs','value':'温度 °C'}],'variables':[{'name':'温度','unit':'°C','role':'X','definition':'记录测量温度，现场核对仪器','min':100,'max':200},{'name':'强度','unit':'MPa','role':'Y','definition':'统一测量结果口径','min':30,'max':80}],'collection_headers':['批次','温度 °C','强度 MPa','测量时间'],'analysis_plan':[{'item':'检查测量一致性','method':'对照仪器与重复测量','required':'同批次测量记录','decision':'核对缺失与单位后再拟合'}],'instructions':['先核对变量与采样口径','模拟数据不作为现场结论']}
        raw=json.dumps({'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(result)}]}]}).encode();self.send_response(200);self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--serve',action='store_true');parser.add_argument('--port',type=int);parser.add_argument('--collection',action='store_true');args=parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='guide-qa-') as tmp:
        root=Path(tmp)
        for name in ('pages.json','library.json'):shutil.copy2(ROOT/'data'/name,root/name)
        cat=root/'catalog';cat.mkdir();(cat/'catalog.json').write_text(json.dumps({'books':[{'id':'test','title':'工程统计测试资料','indexed':True,'uploaded_at':1,'created_at':1,'pages':1,'processed':False,'stages':[2,3,4,5,6,7,8,9,10]}],'skills':[]}))
        (cat/'test.json').write_text(json.dumps([{'page':1,'text':'Measurement of temperature and strength requires regression validation residual analysis. Bottleneck constraints and monitoring quality data.'}]))
        binary=root/'api';shutil.copy2(ROOT/'backend/target/debug/nist-model-api',binary)
        mock=HTTPServer(('127.0.0.1',free_port()),Mock);threading.Thread(target=mock.serve_forever,daemon=True).start()
        port=args.port or free_port();env={**os.environ,'PORT':str(port),'DATA_DIR':tmp,'BOOK_TO_SKILL_PROVIDER':'openai','BOOK_TO_SKILL_MODEL':'mock-guide','OPENAI_API_KEY':'local-only','BOOK_TO_SKILL_API_BASE':f'http://127.0.0.1:{mock.server_port}/v1'}
        app=subprocess.Popen([str(binary)],cwd=ROOT,env=env,stdout=subprocess.DEVNULL);base=f'http://127.0.0.1:{port}'
        try:
            for _ in range(100):
                try:request(base,'/api/health');break
                except OSError:time.sleep(.05)
            p=request(base,'/api/projects','POST',{'name':'流程助手测试工程','question':'温度对强度的影响','target':'建立可验证的预测模型'})
            state=p['state'];state['guideSettings']={'web':False};request(base,'/api/projects/'+p['id'],'PUT',{'state':state})
            context={'stage':2,'project':state['project'],'data':{'rows':0,'columns':[]},'model':None}
            before=request(base,'/api/projects/'+p['id']);value=request(base,'/api/project-guide','POST',{'context':context,'web':False});assert value['stage']==2 and value['sources']
            assert request(base,'/api/project-guide','POST',{'context':context,'web':False})['cached'] and Mock.calls==1
            assert request(base,'/api/projects/'+p['id'])==before
            print('PASS: configured model API, grounded stage response, cache reuse, no project mutation',flush=True)
            context['stage']=3;stage3=request(base,'/api/project-guide','POST',{'context':context,'web':False})
            material=request(base,'/api/project-materials','POST',{'context':context,'guide':stage3});assert material['stage']==3 and material['fields'][0]['key']=='plannedY' and material['variables'][0]['name']=='温度'
            assert request(base,'/api/projects/'+p['id'])==before
            state['stage']=3;state['completed']=[1,2];state['guidance']={'3':stage3};request(base,'/api/projects/'+p['id'],'PUT',{'state':state})
            print('PASS: materials model HTTP API, editable schema, no automatic project changes',flush=True)
            if args.collection:
                state['materials']={'3':{**material,'collection_rows':[['']*4 for _ in range(5)]}};state['project'].update(plannedY='强度 MPa',plannedXs='温度 °C');request(base,'/api/projects/'+p['id'],'PUT',{'state':state})
            if args.serve:
                print('Guide QA ready: '+base,flush=True)
                while app.poll() is None:time.sleep(.5)
        finally:app.terminate();app.wait();mock.shutdown()
if __name__=='__main__':main()
