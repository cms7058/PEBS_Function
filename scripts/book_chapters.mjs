import fs from 'node:fs';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
const [pdf,textFile]=process.argv.slice(2);
const task=getDocument({data:new Uint8Array(fs.readFileSync(pdf)),verbosity:0,disableFontFace:true});
try{
 const doc=await task.promise,total=doc.numPages,chapters=[];
 async function walk(items,level=0){for(const item of items||[]){let dest=item.dest,page=null;try{if(typeof dest==='string')dest=await doc.getDestination(dest);if(Array.isArray(dest))page=typeof dest[0]==='number'?dest[0]+1:await doc.getPageIndex(dest[0])+1}catch{}if(page&&page<=total)chapters.push({title:item.title.trim(),start:page,level,source:'bookmark'});await walk(item.items,level+1)}}
 await walk(await doc.getOutline());
 // Some books have bookmarks for only the first half. Supplement only repeated,
 // consistent chapter/part headers; isolated TOC references are not boundaries.
 if(chapters.length&&fs.existsSync(textFile)){
  const indexed=JSON.parse(fs.readFileSync(textFile,'utf8'));
  const numeral=s=>{if(/^\d+$/.test(s))return Number(s);const digits={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};if(s.includes('十')){const [a,b]=s.split('十');return (a?digits[a]:1)*10+(b?digits[b]:0)}return digits[s]};
  const heading=s=>{const m=s.match(/^(?:\d+\s+)?第\s*([\d一二三四五六七八九十]+)\s*([章篇编編遍])\s*(.*)$/);return m?{key:(m[2]==='章'?'chapter':'part')+numeral(m[1]),part:m[2]!=='章',title:s.trim()}:null};
  const groups=new Map();for(const p of indexed){const lines=p.text.split('\n').map(l=>l.trim()).filter(Boolean);for(const line of lines.slice(0,3)){const h=heading(line);if(!h||h.part||line.length>65||/\d\s*$/.test(line))continue;if(!line.replace(/^第\s*[\d一二三四五六七八九十]+\s*章\s*/, '').trim()){const next=lines[lines.indexOf(line)+1];if(next&&next.length<45&&!/^[\d第]/.test(next))h.title+=' '+next}const list=groups.get(h.key)||[];if(!list.some(v=>v.page===p.page))list.push({...h,page:p.page});groups.set(h.key,list)}}
  const supplements=[];for(const [key,items] of groups){const clusters=[];for(const h of items){const last=clusters.at(-1);if(last&&h.page-last.at(-1).page<=8)last.push(h);else clusters.push([h])}const best=clusters.sort((a,b)=>b.length-a.length)[0];if(best?.length>=2&&!chapters.some(c=>heading(c.title)?.key===key)){const titles=new Map();for(const v of best){const title=v.title.replace(/[\s”"，,]/g,'');if(title.replace(/^第[\d一二三四五六七八九十]+章/, '').length>1){const current=titles.get(title)||{title:v.title,count:0};current.count++;titles.set(title,current)}}const title=[...titles.values()].sort((a,b)=>b.count-a.count)[0]?.title||best[0].title;let start=best[0].page;const name=title.replace(/^第\s*[\d一二三四五六七八九十]+\s*章\s*/, '').replace(/[\s”"，,]/g,'');const prior=indexed.find(p=>p.page===start-1);if(name&&prior?.text.split('\n').filter(l=>l.trim()).slice(0,4).some(l=>l.replace(/[\s”"，,]/g,'')===name))start--;supplements.push({...best[0],title,start,source:'heading',level:1})}}
  if(supplements.length){let shift=0;for(const c of chapters){if(c.level===0)shift=heading(c.title)&&!heading(c.title).part?1:0;c.level+=shift}chapters.push(...supplements);chapters.sort((a,b)=>a.start-b.start||a.level-b.level);}
 }

 let source=chapters.some(c=>c.source==='heading')?'bookmark+headings':'bookmark',notice='读取原 PDF 书签；页码为 PDF 页码。'+(chapters.some(c=>c.source==='heading')?'已从重复的正文标题／页眉补充缺失章节，建议核对原书。':'目录完整程度取决于原文件的书签。');
 if(!chapters.length){
  source='contents';notice='从书内目录识别，并与正文标题或 PDF 页码标签核对；无法确认的条目不可选。';
  const pages=fs.existsSync(textFile)?JSON.parse(fs.readFileSync(textFile,'utf8')):[];
  const norm=s=>String(s).normalize('NFKC').replace(/[\s.．·…\-_—:：、（）()]/g,'').toLowerCase();
  const candidates=[];let inToc=false,miss=0;
  for(const p of pages.slice(0,Math.min(total,80))){const lines=p.text.split('\n').map(s=>s.trim()).filter(Boolean);if(lines.some(s=>/^(目\s*录|contents|table of contents)$/i.test(s))){inToc=true;miss=0}if(!inToc)continue;let found=0;
   for(const line of lines){const m=line.match(/^(.{3,160}?)\s*(?:\.{2,}|…+|·{2,}|\s{2,})\s*(\d{1,4})\s*$/)||line.match(/^((?:第[一二三四五六七八九十百\d]+[章节篇部]|chapter\s+\d+|\d+(?:\.\d+)*[、.\s])[^\n]{2,150}?)\s+(\d{1,4})$/i);if(m){const title=m[1].replace(/[.．…·\s]+$/,'').trim();if(!candidates.some(c=>c.title===title)){candidates.push({title,printed:Number(m[2]),level:/^\d+\.\d+/.test(title)?1:0});found++}}}
   miss=found?0:miss+1;if(miss>=3)inToc=false;
  }
  const labels=await doc.getPageLabels();const offsets=[];
  for(const c of candidates){const n=norm(c.title);const matches=pages.filter(p=>p.text.split('\n').filter(l=>l.trim()).slice(0,18).some(l=>norm(l)===n));if(matches.length===1){c.start=matches[0].page;offsets.push(c.start-c.printed)}else if(labels){const hits=labels.map((v,i)=>v===String(c.printed)?i+1:0).filter(Boolean);if(hits.length===1)c.start=hits[0]}}
  const votes=new Map();for(const o of offsets)votes.set(o,(votes.get(o)||0)+1);const best=[...votes].sort((a,b)=>b[1]-a[1])[0];
  for(const c of candidates){if(!c.start&&best?.[1]>=2&&best[1]>=offsets.length*.6)c.start=c.printed+best[0];chapters.push({...c,start:c.start>=1&&c.start<=total?c.start:null,source:'contents'})}
 }
 // End a parent at the next sibling/ancestor; children can also be selected separately.
 for(let i=0;i<chapters.length;i++){const c=chapters[i];c.id='chapter-'+i;c.end=c.start?total:null;for(let j=i+1;j<chapters.length;j++)if(c.start&&chapters[j].start&&chapters[j].start>=c.start&&chapters[j].level<=c.level){c.end=Math.max(c.start,chapters[j].start-1);break}c.selectable=!!c.start&&c.end>=c.start;if(c.end===total&&/^第\s*[\d一二三四五六七八九十]+\s*[篇编編遍]/.test(c.title)&&chapters.some(x=>x.source==='heading'&&x.start>c.start))c.selectable=false}
 if(!chapters.length)notice='未找到可识别的书签或目录。扫描书请先完成 OCR；暂可使用整本书提取。不会自动猜测章节页码。';
 process.stdout.write(JSON.stringify({pages:total,source,notice,chapters}));
}finally{await task.destroy()}
