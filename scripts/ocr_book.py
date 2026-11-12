"""Local, resumable OCR. Checkpoints are committed only after both text and PDF exist."""
import argparse,json,os,re,subprocess,fcntl
from pathlib import Path

def write(path,value):
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False));tmp.replace(path)
def run(*args):
    p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300)
    if p.returncode: raise RuntimeError(p.stderr.decode(errors='replace')[-600:])
    return p.stdout.decode(errors='replace')
def convert(pdf,work,tessdata):
    work.mkdir(parents=True,exist_ok=True)
    worker_lock=(work/'worker.lock').open('w');fcntl.flock(worker_lock,fcntl.LOCK_EX)
    parent_pid=os.getppid()
    total=int(re.search(r'^Pages:\s+(\d+)',run('pdfinfo',str(pdf)),re.M)[1])
    status=work/'status.json';pages=[];pdfs=[]
    try:
        for page in range(1,total+1):
            if os.getppid()!=parent_pid:raise RuntimeError("服务已停止，可继续 OCR")
            base=work/f'page-{page:05}';txt=base.with_suffix('.txt');out=base.with_suffix('.pdf');done=base.with_suffix('.done')
            write(status,dict(status='running',completed=page-1,total=total,page=page,message='正在识别'))
            if not(done.exists() and txt.exists() and out.exists()):
                run('pdftoppm','-f',str(page),'-l',str(page),'-r','200','-singlefile','-png',str(pdf),str(base))
                run('tesseract',str(base.with_suffix('.png')),str(base),'--tessdata-dir',str(tessdata),'-l','chi_sim+chi_tra+eng','--psm','3','txt','pdf')
                if not(txt.exists() and out.exists()):raise RuntimeError('OCR 未生成文字与 PDF，请检查 Tesseract 配置文件')
                done.write_text('ok');base.with_suffix('.png').unlink(missing_ok=True)
            pages.append(dict(page=page,text=txt.read_text().strip()));pdfs.append(str(out))
            write(status,dict(status='running',completed=page,total=total,page=page,message='正在识别'))
        if not any(p['text'] for p in pages):raise RuntimeError('未识别到文字，请检查扫描清晰度')
        # Bound command size and merge intermediates in groups.
        batches=[]
        for i in range(0,len(pdfs),100):
            batch=work/f'batch-{i//100}.pdf';run('pdfunite',*pdfs[i:i+100],str(batch));batches.append(str(batch))
        target=work/'searchable.tmp.pdf';run('pdfunite',*batches,str(target));target.replace(work/'searchable.pdf')
        write(work/'pages.json',pages)
        # Rust publishes the files and marks completion after updating the catalog.
        write(status,dict(status='running',completed=total,total=total,message='正在保存识别结果'))
    except Exception as e:
        value=json.loads(status.read_text()) if status.exists() else dict(completed=0,total=total)
        value.update(status='failed',error=str(e));write(status,value);raise
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--pdf',required=True);p.add_argument('--work',required=True);p.add_argument('--tessdata',required=True);a=p.parse_args();convert(Path(a.pdf),Path(a.work),Path(a.tessdata))
