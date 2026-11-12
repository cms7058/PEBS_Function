"""Check project isolation and restart persistence in a disposable data directory.
--serve leaves the verified test server running for isolated browser QA.
"""
import argparse,json,os,shutil,socket,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def free_port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--serve',action='store_true');parser.add_argument('--port',type=int);args=parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='engineering-projects-') as tmp:
        directory=Path(tmp)
        for name in ['pages.json','library.json']:shutil.copy2(ROOT/'data'/name,directory/name)
        (directory/'catalog').mkdir();(directory/'catalog/catalog.json').write_text('{"books":[],"skills":[]}')
        binary=directory/'api';shutil.copy2(ROOT/'backend/target/debug/nist-model-api',binary)
        port=args.port or free_port();base=f'http://127.0.0.1:{port}'
        env={**os.environ,'DATA_DIR':tmp,'PORT':str(port)}
        def request(path,method='GET',body=None):
            req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,method=method,headers={'Content-Type':'application/json'})
            with urllib.request.urlopen(req,timeout=15) as r:return json.load(r)
        def start():
            process=subprocess.Popen([str(binary)],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
            for _ in range(100):
                if process.poll() is not None:raise RuntimeError(process.stderr.read().decode())
                try:request('/api/health');return process
                except OSError:time.sleep(.05)
            raise RuntimeError('Test server failed to start')
        app=start()
        try:
            assert request('/api/projects')==[]
            a=request('/api/projects','POST',{'name':'测试工程 A','question':'分析压力与尺寸的关系','target':'预测尺寸并确认误差'})
            b=request('/api/projects','POST',{'name':'测试工程 B','question':'分析温度与不良率','target':'降低不良率'})
            for p in [a,b]:
                assert p['state']['mode']=='real' and p['state']['data']['rows']==[] and p['state']['model'] is None and p['state']['completed']==[]
            state=a['state'];state['project'].update(scope='尺寸检测工序',constraints='设备与材料固定',plannedY='尺寸 mm',plannedXs='压力 MPa');state.update(stage=4,completed=[1,2,3])
            request('/api/projects/'+a['id'],'PUT',{'state':state})
            assert request('/api/projects/'+b['id'])['state']['data']['rows']==[]
            rows=[[1+i/10,5+2*(1+i/10)] for i in range(40)]
            state.update(data={'columns':['压力 MPa','尺寸 mm'],'rows':rows,'label':'自有数据.csv','issues':[],'synthetic':False},xs=[0],y=1,stage=6,completed=[1,2,3,4,5])
            state['model']=request('/api/analyze','POST',{'columns':state['data']['columns'],'rows':rows,'x':[0],'y':1,'method':'linear'})
            request('/api/projects/'+a['id'],'PUT',{'state':state})
            loaded=request('/api/projects/'+a['id']);assert loaded['state']['model']['rmse']<1e-8 and loaded['state']['project']['question']==a['state']['project']['question']
            assert request('/api/projects/'+b['id'])['state']['model'] is None
            invalid=json.loads(json.dumps(state));invalid['data']['synthetic']=True
            try:request('/api/projects/'+b['id'],'PUT',{'state':invalid})
            except urllib.error.HTTPError as e:assert e.code==400
            else:raise AssertionError('Actual project must reject synthetic data')
            formal=request('/api/projects/'+a['id'],'PUT',{'state':state,'action':'save'})
            assert formal['status']=='saved' and formal['saved_at'] and formal['save_count']==1
            saved_state=json.loads(json.dumps(state));saved_time=formal['saved_at']
            state['project']['question']='修改后的工程要求：继续分析尺寸与压力'
            draft=request('/api/projects/'+a['id'],'PUT',{'state':state,'action':'draft'})
            assert draft['status']=='draft' and draft['has_saved_version'] and draft['saved_at']==saved_time
            record=request('/api/projects/'+a['id']);assert record['saved_state']==saved_state and record['state']==state
            automatic=request('/api/projects/'+a['id'],'PUT',{'state':state})
            assert automatic['status']=='draft' and automatic['save_count']==1
            listed=next(p for p in request('/api/projects') if p['id']==a['id'])
            assert listed['status']=='draft' and listed['has_saved_version'] and listed['completed']==5
            formal=request('/api/projects/'+a['id'],'PUT',{'state':state,'action':'save'})
            assert formal['status']=='saved' and formal['save_count']==2
            automatic=request('/api/projects/'+a['id'],'PUT',{'state':state})
            assert automatic['status']=='saved' and automatic['saved_at']==formal['saved_at']
            try:request('/api/projects/'+a['id'],'PUT',{'state':state,'action':'invalid'})
            except urllib.error.HTTPError as e:assert e.code==400
            else:raise AssertionError('Invalid save action must be rejected')
            app.terminate();app.wait(timeout=5);app=start()
            assert request('/api/projects/'+a['id'])['state']==state
            assert request('/api/projects/'+b['id'])['state']['data']['rows']==[]
            after_restart=request('/api/projects/'+a['id'])
            assert after_restart['status']=='saved' and after_restart['saved_state']==state and after_restart['save_count']==2
            assert len(request('/api/projects'))==2
            print('PASS: empty actual projects, separate requirements/data/models, upload→fit→save, simulation rejection, explicit draft/save, saved snapshot protection, history metadata, restart persistence',flush=True)
            if args.serve:
                print(f'QA server ready: {base}',flush=True)
                while app.poll() is None:time.sleep(1)
        finally:app.terminate();app.wait(timeout=5)
if __name__=='__main__':main()
