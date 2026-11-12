export function extractionStatus(book,skills){
 const generated=skills.filter(s=>s.mode==='book-to-skill'&&s.book_id===book.id);
 if(!generated.length)return '未提取';
 if(generated.some(s=>!s.source_scope?.length))return '全部提取';
 const ranges=generated.flatMap(s=>s.source_scope).sort((a,b)=>a.start-b.start);let end=0;
 for(const r of ranges){if(r.start>end+1)break;end=Math.max(end,r.end)}
 return book.pages>0&&end>=book.pages?'全部提取':'部分提取';
}
export function bookSkillState(book,skills){
 if(!book.uploaded_at)return {ready:false,label:'待上传 PDF',reason:'请先在知识资料库上传这本书的 PDF，然后重新打开 TO-SKILL。'};
 if(!book.indexed)return {ready:false,label:'需 OCR 文字识别',reason:'PDF 已上传，但没有可提取的文字，通常是扫描版。点击“进行 OCR”在本机后台识别，完成后检查文字，再手动生成 Skill。'};
 const status=extractionStatus(book,skills);
 if(status==='全部提取')return {ready:false,label:'全部提取',reason:'本书已全部提取 Skill，无需重复生成。可点击提取状态查看已有技能；删除相关生成包后可重新提取。'};
 return {ready:true,label:status==='未提取'?'可生成 Skill':'部分提取 · 可继续提取',reason:''};
}
export function skillBookOptions(books,skills){return [...books].sort((a,b)=>b.created_at-a.created_at).map(b=>({...b,skillState:bookSkillState(b,skills)}));}
export function chapterRanges(chapters,ids){const chosen=chapters.filter(c=>c.selectable&&ids.includes(c.id)).sort((a,b)=>a.start-b.start||b.end-a.end);const out=[];for(const c of chosen){const last=out.at(-1);if(last&&c.start<=last.end){if(c.end>last.end){last.end=c.end;last.label+=' / '+c.title}}else out.push({label:c.title,start:c.start,end:c.end})}return out}
