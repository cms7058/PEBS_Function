import {accountFetch as fetch} from './account-fetch';
import { t } from "./i18n";
import React, { useEffect, useState } from 'react';
import { chapterRanges } from './skill-books.js';
export default function ChapterSelection({
  book,
  scope,
  setScope,
  ranges,
  setRanges,
  disabled
}) {
  const [toc, setToc] = useState(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [ids, setIds] = useState([]),
    [query, setQuery] = useState('');
  useEffect(() => {
    setToc(null);
    setIds([]);
    setQuery('');
    setError('');
  }, [book?.id]);
  useEffect(() => {
    if (scope !== 'selected' || !book?.uploaded_at) return;
    let active = true;
    setLoading(true);
    setError('');
    fetch('/api/books/' + encodeURIComponent(book.id) + '/chapters').then(async r => {
      const v = await r.json();
      if (!r.ok) throw Error(v.error || '目录读取失败');
      return v;
    }).then(v => {
      if (active) setToc(v);
    }).catch(e => {
      if (active) setError(e.message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [book?.id, scope]);
  function toggle(c) {
    const next = ids.includes(c.id) ? ids.filter(id => id !== c.id) : [...ids, c.id];
    const selected = chapterRanges(toc.chapters, next);
    if (selected.length > 50) {
      setError('一次最多选择50段章节，请分批提取');
      return;
    }
    setIds(next);
    setRanges(selected);
    setError('');
  }
  return <section className="chapter-selection"><label htmlFor="generation-scope">{t("生成内容范围")}</label><select id="generation-scope" value={scope} disabled={disabled} onChange={e => {
      setScope(e.target.value);
      setIds([]);
      setRanges([]);
    }}><option value="all">{t("整本书")}</option><option value="selected">{t("选择部分章节")}</option></select>{scope === 'selected' && <><p>{t("勾选原书目录中的章节。选择上级章节将包含其下属内容，重叠页码会自动合并。")}</p>{loading && <p role="status">{t("正在读取原书目录…")}</p>}{error && <div className="error" role="alert">{error}</div>}{toc && <><small>{toc.notice}</small>{toc.chapters.length > 0 && <><input aria-label={t("筛选原书章节")} placeholder={t("搜索章节名称…")} value={query} onChange={e => setQuery(e.target.value)} /><div className="chapter-tree">{toc.chapters.filter(c => c.title.toLowerCase().includes(query.toLowerCase())).map(c => <label key={c.id} style={{
              paddingLeft: 12 + c.level * 18
            }}><input type="checkbox" aria-label={t("选择章节 ") + c.title} checked={ids.includes(c.id)} disabled={disabled || !c.selectable} onChange={() => toggle(c)} /><span>{c.title}<small>{c.selectable ? `PDF ${c.start}–${c.end} 页` : t("页码未能确认，不可选")}</small></span></label>)}</div></>}<p role="status">{t("已选")}{ids.length}{t("个目录条目，覆盖")}{ranges.reduce((n, r) => n + r.end - r.start + 1, 0)}{t("页。本书共")}{toc.pages}{t("页。")}</p></>}</>}</section>;
}
