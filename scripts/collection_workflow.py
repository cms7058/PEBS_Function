# -*- coding: utf-8 -*-
"""Local CSV import, deterministic collection checks and reviewable format repair."""
import csv,io,json,sys,re,math,datetime,unicodedata
from collections import Counter
MAX_ROWS=20000
PLACEHOLDERS={'','待填写','待填报','待采集','待记录','待确认','NA','N/A','null','NULL','—','-'}
def label(v):
    name=v['name'].strip();unit=v.get('unit','').strip()
    return name+(' '+unit if unit and unit not in name else '')
def norm(s):return re.sub(r'[\s（）()\[\]【】,，:：/·°%_-]','',str(s)).lower()
def guess(v,headers):
    candidates=[h for h in headers if norm(h) in (norm(label(v)),norm(v['name']))]
    return candidates[0] if len(candidates)==1 else ''
def config(m,stage):
    headers=m.get('collection_headers',[]);variables=m.get('variables',[])
    bindings=m.get('collection_bindings') or {label(v):guess(v,headers) for v in variables}
    rules=m.get('collection_rules') or [{'column':h,'required':True,'type':'number' if h in bindings.values() else 'text','min':'','max':''} for h in headers]
    tables=m.get('collection_tables')
    if tables is None:tables=[{'id':'primary','name':'本阶段采集表','kind':'collection','headers':headers,'rows':m.get('collection_rows',[])}]
    return headers,variables,bindings,rules,tables

def fingerprint(m,stage):
    hs,vs,bs,rs,ts=config(m,stage)
    array=[str(stage),hs,[[r['column'],'1' if r.get('required') else '0',r.get('type','text'),str(r.get('min','')),str(r.get('max',''))] for r in rs],[[v['name'],v['role'],v.get('unit','')] for v in vs],[[label(v),bs.get(label(v),'')] for v in vs],[[t['id'],t['name'],t.get('kind','collection'),t['headers'],[[str(x) if x is not None else '' for x in row] for row in t['rows']]] for t in ts],[[i.get('file',''),str(i.get('row','')),str(i.get('column','')),i['message']] for i in m.get('upload_issues',[])]]
    raw=json.dumps(array,ensure_ascii=False,separators=(',',':')).encode('utf-8');h=14695981039346656037
    for b in raw:h=((h^b)*1099511628211)&((1<<64)-1)
    return f'{h:016x}'

def upload(req):
    filename=req.get('filename','上传文件.csv');raw=req.get('csv','')
    if not isinstance(raw,str) or len(raw.encode('utf-8'))>8*1024*1024:raise ValueError('CSV 文件最多8 MB')
    issues=[]
    def issue(row,col,msg):issues.append({'file':filename,'row':row,'column':col,'message':msg})
    try:
        if '\ufffd' in raw:raise ValueError('文件编码无法识别，请在 Excel 中另存为 CSV UTF-8 后重新上传')
        reader=csv.reader(io.StringIO(raw.lstrip('\ufeff')),strict=True);headers=next(reader,[])
        if not headers:issue(1,'','文件为空，须包含模板列名')
        if len(headers)>40:issue(1,'','采集表最多40列')
        for j,h in enumerate(headers):
            if not h.strip():issue(1,j+1,'列名为空')
            elif headers.count(h)>1:issue(1,h,'列名重复')
        rows=[]
        for row in reader:
            if not any(c.strip() for c in row):continue
            if len(row)!=len(headers):issue(reader.line_num,'',f'列数为{len(row)}，模板表头为{len(headers)}列')
            rows.append(row)
            if len(rows)>MAX_ROWS:raise ValueError('每个上传表格最多20,000条记录')
        if not rows:issue(2,'','文件没有填报记录，请填写后上传')
    except (csv.Error,ValueError) as e:issue(getattr(locals().get('reader'), 'line_num',1),'',str(e));rows=[];headers=locals().get('headers',[])
    if issues:return {'accepted':False,'issues':issues[:200]}
    return {'accepted':True,'table':{'id':req.get('table_id','upload'),'name':filename,'kind':req.get('kind','collection'),'headers':headers,'rows':rows},'issues':[]}

def check(m,stage):
    hs,vs,bs,rs,ts=config(m,stage);issues=[];counts={};seen={};numeric_rows=[];limit=0
    def issue(file,row,column,msg):
        nonlocal limit
        limit+=1
        if len(issues)<200:issues.append({'file':file,'row':row,'column':column,'message':msg})
    for i in m.get('upload_issues',[]):issue(i.get('file','上传文件'),i.get('row',''),i.get('column',''),i['message'])
    if not 1<=len(hs)<=40 or len(set(hs))!=len(hs) or any(not isinstance(h,str) or not h.strip() for h in hs):issue('模板',1,'','模板列名为空、重复或数量不合法')
    if not any(t.get('kind','collection')=='collection' for t in ts):issue('采集表',2,'','必须提交本阶段采集表，数值数据表不能替代追溯记录')
    rulemap={r['column']:r for r in rs}
    if len(rulemap)!=len(rs) or set(rulemap)!=set(hs):issue('检查规则',1,'','检查规则必须覆盖每个采集列且不能重复')
    for r in rs:
        if r.get('type') not in ('text','number','integer','date'):issue('检查规则',1,r['column'],'字段类型无效')
        bounds=[]
        for k in ('min','max'):
            value=r.get(k,'')
            try:n=float(value) if str(value).strip() else None
            except (ValueError,TypeError):n=None;issue('检查规则',1,r['column'],k+'边界不是有限数值')
            if n is not None and not math.isfinite(n):issue('检查规则',1,r['column'],'边界不是有限数值')
            bounds.append(n)
        if bounds[0] is not None and bounds[1] is not None and bounds[0]>bounds[1]:issue('检查规则',1,r['column'],'最小值不能大于最大值')
    variable_columns=[]
    for v in vs:
        col=bs.get(label(v),'');variable_columns.append(col)
        if col not in hs:issue('变量映射',1,label(v),'请选择对应的采集列，核对单位后再检查')
        elif rulemap.get(col,{}).get('type') not in ('number','integer'):issue('检查规则',1,col,'X/Y对应采集列必须设置为数值或整数')
    if len(set(variable_columns))!=len(variable_columns):issue('变量映射',1,'','不同变量不能映射到同一列')
    if vs and (sum(v.get('role')=='Y' for v in vs)!=1 or not 1<=sum(v.get('role')=='X' for v in vs)<=6):issue('变量映射',1,'','需要一个Y和1–6个X')
    if len(ts)>20:issue('采集表',1,'','最多20张数据表')
    total=0;data_rows=[]
    for t in ts:
        file=t.get('name','数据表');headers=t.get('headers',[]);rows=t.get('rows',[]);kind=t.get('kind','collection');index={h:i for i,h in enumerate(headers)}
        expected=hs if kind=='collection' else [label(v) for v in vs]
        applicable=rs if kind=='collection' else [{'column':label(v),'required':True,'type':'number','min':'','max':''} for v in vs]
        required=set(variable_columns) if kind=='collection' else set(expected)
        if kind not in ('collection','data'):issue(file,1,'','数据表类型无效')
        if not headers or len(set(headers))!=len(headers) or any(not str(h).strip() for h in headers):issue(file,1,'','表头为空或有重复列名')
        for h in headers:
            if h not in expected:issue(file,1,h,'列名与本阶段模板不一致，请按模板改名或重新上传')
        for r in applicable:
            if (r.get('required') or r['column'] in required) and r['column'] not in index:issue(file,1,r['column'],'缺少必填列，请重新上传完整模板')
        active=[(i,row) for i,row in enumerate(rows) if any(str(c).strip() for c in row)];counts[t.get('id',file)]=len(active);total+=len(active)
        if not active:issue(file,2,'','没有有效填报记录，请填写或替换上传')
        if len(rows)>MAX_ROWS or total>MAX_ROWS:issue(file,1,'','合计最多20,000条记录')
        for i,row in active[:MAX_ROWS]:
            line=i+2
            if len(row)!=len(headers):issue(file,line,'','数据列数与表头不一致，请重新上传');continue
            key=(kind,tuple((h,str(row[index[h]]).strip()) for h in sorted(headers)))
            if key in seen:issue(file,line,'',f'记录与 {seen[key][0]} 第{seen[key][1]}行完全重复，请核对或删除重复记录')
            else:seen[key]=(file,line)
            values={};bad=False
            for r in applicable:
                h=r['column'];j=index.get(h)
                if j is None:
                    if r.get('required') or h in required:bad=True
                    continue
                value=str(row[j]).strip();required_here=r.get('required') or h in required
                if value in PLACEHOLDERS:
                    if required_here:issue(file,line,h,'必填值为空或仍是待填占位文字');bad=True
                    continue
                typ=r.get('type','text')
                if str(row[j])!=value:issue(file,line,h,'含首尾空白，可预览格式修复后重新检查');bad=True
                if typ in ('number','integer'):
                    try:
                        if not re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?',value,flags=re.ASCII):raise ValueError()
                        n=float(value)
                        if not math.isfinite(n):raise ValueError()
                        if typ=='integer' and not n.is_integer():raise ValueError()
                    except ValueError:issue(file,line,h,'须填写有限数值'+('整数' if typ=='integer' else '')+'，不要带单位或千位分隔符');bad=True;continue
                    values[h]=n
                    for bound,op,msg in [('min',lambda a,b:a<b,'小于设定下限'),('max',lambda a,b:a>b,'大于设定上限')]:
                        try:
                            if str(r.get(bound,'')).strip() and op(n,float(r[bound])):issue(file,line,h,msg+'，请核对原始测量或检查规则');bad=True
                        except (ValueError,TypeError):pass
                elif typ=='date':
                    try:
                        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',value,flags=re.ASCII):raise ValueError()
                        datetime.date.fromisoformat(value)
                    except ValueError:issue(file,line,h,'须填写有效日期 YYYY-MM-DD');bad=True
            if not bad and vs:
                order=[v for v in vs if v['role']=='X']+[v for v in vs if v['role']=='Y']
                cols=[bs.get(label(v),'') if kind=='collection' else label(v) for v in order]
                if all(c in values for c in cols):
                    target=numeric_rows if kind=='collection' else data_rows;target.append([values[c] for c in cols])
    if data_rows and numeric_rows and Counter(map(tuple,data_rows))!=Counter(map(tuple,numeric_rows)):issue('数值数据表与采集表',2,'X/Y','两类表的X/Y数值或记录数量不一致，请核对后重新上传')
    dataset=None
    if not limit and vs:
        order=[v for v in vs if v['role']=='X']+[v for v in vs if v['role']=='Y'];dataset={'columns':[label(v) for v in order],'rows':numeric_rows,'label':'通过检查的采集数据','issues':[],'synthetic':False}
    return {'passed':limit==0,'fingerprint':fingerprint(m,stage),'issues':issues,'issue_count':limit,'truncated':limit>200,'table_counts':counts,'rows':total,'dataset':dataset,'limitations':'本次检查覆盖模板、必填、数值、日期、配置范围、重复和表间数值一致性；不证明测量可靠、采样独立或业务结论正确。'}

def repair(m,stage):
    hs,vs,bs,rs,ts=config(m,stage);rulemap={r['column']:r for r in rs};changes=[];count=0;new_tables=[]
    for t in ts:
        rows=[]
        for i,row in enumerate(t['rows']):
            new=[]
            for j,cell in enumerate(row):
                old=str(cell);value=old.strip();h=t['headers'][j] if j<len(t['headers']) else '';typ=rulemap.get(h,{}).get('type','number' if t.get('kind')=='data' else 'text')
                if typ in ('number','integer'):
                    value=unicodedata.normalize('NFKC',value).replace('−','-')
                    if re.fullmatch(r'[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?',value):value=value.replace(',','')
                elif typ=='date':
                    candidate=value.replace('/','-')
                    try:datetime.date.fromisoformat(candidate);value=candidate
                    except ValueError:pass
                new.append(value)
                if value!=old:
                    count+=1
                    if len(changes)<200:changes.append({'file':t['name'],'row':i+2,'column':h,'old':old,'new':value})
            rows.append(new)
        new_tables.append({**t,'rows':rows})
    return {'tables':new_tables,'changes':changes,'change_count':count,'fingerprint':fingerprint(m,stage),'notice':'仅修复首尾空白、数值全角字符、明确的千位分隔符及合法日期分隔符；不补造缺失值，不修改越界测量，不删除重复记录。确认后须重新检查。'}
def main(req):
    action=req.get('action','check')
    if action=='upload':return upload(req)
    m=req['material'];stage=req['stage']
    return repair(m,stage) if action=='repair' else check(m,stage)
if __name__=='__main__':
    try:print(json.dumps(main(json.load(sys.stdin)),ensure_ascii=False,allow_nan=False))
    except Exception as e:print(str(e),file=sys.stderr);sys.exit(1)
