import json,re,pathlib,hashlib,sys,subprocess,shutil
root=pathlib.Path(__file__).resolve().parents[1]
source=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/Users/mingyue/公司标准/EMD /NIST_handbook.pdf')
(root/'data').mkdir(exist_ok=True);(root/'public').mkdir(exist_ok=True)
subprocess.run(['pdftotext','-layout',str(source),str(root/'data/nist.txt')],check=True)
(root/'data/platform-source').mkdir(exist_ok=True)
shutil.copy2(source,root/'data/platform-source/handbook.pdf')
names=['探索性数据分析','测量过程分析','生产过程特性','过程建模','过程改进与 DOE','过程监控与控制','产品与过程比较','产品可靠性']
keys=['eda','mpc','ppc','pmd','pri','pmc','prc','apr'];pages=[]
for num,text in enumerate((root/'data/nist.txt').read_text().split('\f'),1):
 if not text.strip():continue
 urls=re.findall(r'https?://[^\s\[]+',text); url=next((u for u in urls if '/handbook/' in u),'')
 chapter=next((j+1 for j,k in enumerate(keys) if '/'+k+'/' in url),pages[-1]['chapter'] if pages else 0)
 title=next((l.strip() for l in text.splitlines() if l.strip()),'')
 pages.append(dict(page=num,title=title,chapter=chapter,url=url,text=text.strip()))
chapters=[dict(id=j+1,name=name,pages=sum(p['chapter']==j+1 for p in pages),start=next((p['page'] for p in pages if p['chapter']==j+1),1)) for j,name in enumerate(names)]
spec=[('eda','数据探索与质量检查','识别分布、异常与变量关系','EDA Goals',1,[4],['数值数据与变量说明','采样顺序和测量单位'],['确认采样背景与数据口径','检查缺失与分布，标记异常而非自动删除','观察图形并记录待验证假设'],['数据质量报告','待调查异常清单']),('regression','多元线性回归','建立工艺参数与结果的统计关系','How are estimates of the unknown parameters obtained?',4,[5,6],['连续型 Y 与 1–6 个数值 X','至少 15 行完整记录'],['检查恒定列和线性依赖','使用前 80% 数据拟合含截距的线性模型','保存模型系数、输入范围与版本'],['回归方程','模型适用范围']),('validation','模型诊断与验证','判断预测是否优于基线','How can I tell if a model fits my data?',4,[7],['独立于拟合的数据','已拟合模型'],['使用末尾 20% 数据留出验证','对比预测误差与训练均值基线','检查残差，安排现场确认'],['留出集 RMSE','残差图与验证结论']),('doe','实验设计与参数探索','为工艺改善规划下一步实验','Choosing an Experimental Design',5,[3,5,8],['实验目标和安全边界','因素、水平与实验预算'],['明确响应与可控因素','选择设计并考虑随机化和分组','通过确认实验检验候选参数'],['实验方案草稿','确认实验计划']),('spc','过程监控与效果跟踪','跟踪改善后的数据变化','Control Charts',6,[9,10],['现场新数据','采样频率与分组定义'],['记录基线和现场执行条件','确认适用控制图与过程稳定性','调查异常并决定是否重新建模'],['监控计划','异常调查记录'])]
skills=[]
for id,name,desc,needle,ch,stages,inputs,steps,outputs in spec:
 matches=[p for p in pages if p['chapter']==ch and needle.lower() in p['title'].lower()]
 p=matches[0] if matches else next(p for p in pages if p['chapter']==ch)
 skills.append(dict(id=id,name=name,description=desc,stages=stages,inputs=inputs,steps=steps,outputs=outputs,source=dict(page=p['page'],title=p['title'],url=p['url']),status='draft',note='根据 NIST 方法人工整理的演示模板；页面提取为真实内容。计算实现与阈值是本 Demo 的设计，不是原书逐字规则。'))
(root/'data/pages.json').write_text(json.dumps(pages,ensure_ascii=False))
(root/'data/library.json').write_text(json.dumps(dict(title='NIST / SEMATECH Engineering Statistics Handbook',pages=len(pages),sha256=hashlib.sha256(source.read_bytes()).hexdigest(),chapters=chapters,skills=skills,filename=source.name,edition='PDF · June 2012'),ensure_ascii=False,indent=2))
print(json.dumps({'pages':len(pages),'chapters':chapters,'skills':[(s['id'],s['source']['page'])for s in skills]},ensure_ascii=False))
