"""Install project-local OCR language data; system binaries remain unchanged."""
from pathlib import Path
import hashlib,shutil,subprocess,urllib.request
root=Path('data/ocr/tessdata');root.mkdir(parents=True,exist_ok=True)
for name,digest in [('chi_sim','a5fcb6f0db1e1d6d8522f39db4e848f05984669172e584e8d76b6b3141e1f730'),('chi_tra','529c5b5797d64b126065cd55f2bb4c7fd7b15790798091b1ff259941a829330b')]:
    target=root/(name+'.traineddata')
    raw=target.read_bytes() if target.exists() else urllib.request.urlopen('https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/'+target.name,timeout=60).read()
    if hashlib.sha256(raw).hexdigest()!=digest:raise RuntimeError('Language package checksum changed; verify source before updating')
    target.write_bytes(raw)
info=subprocess.run(['tesseract','--list-langs'],capture_output=True,text=True,check=True)
import re
system=Path(re.search(r'"([^\"]+)"',info.stdout+info.stderr)[1])
for name in ('eng.traineddata','pdf.ttf'):shutil.copyfile(system/name,root/name)
(root/'configs').mkdir(exist_ok=True)
(root/'configs/pdf').write_text('tessedit_create_pdf 1\n');(root/'configs/txt').write_text('tessedit_create_txt 1\n')
for tool in ('tesseract','pdftoppm','pdfinfo','pdfunite'):
    if not shutil.which(tool):raise RuntimeError('Missing '+tool)
print('OCR ready: Simplified Chinese, Traditional Chinese, English; local project data')
