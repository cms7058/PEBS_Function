import {accountFetch as fetch} from './account-fetch';
import { t } from "./i18n";
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChevronLeft, ChevronRight, Download, ZoomIn, ZoomOut } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import './reader.css';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const params = new URLSearchParams(location.search);
const bookId = params.get('book') || '';
const initialPage = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1);
function Reader() {
  const [doc, setDoc] = useState(null),
    [book, setBook] = useState(null),
    [page, setPage] = useState(initialPage),
    [scale, setScale] = useState(1),
    [status, setStatus] = useState('正在加载 PDF…'),
    [error, setError] = useState(''),
    [links, setLinks] = useState([]);
  const canvas = useRef(null),
    task = useRef(null),
    stage = useRef(null),
    pendingScroll = useRef(null),
    wheelDistance = useRef(0),
    wheelDirection = useRef(0);
  const url = `/api/books/${encodeURIComponent(bookId)}/pdf`;
  useEffect(() => {
    if (!/^(nist|b\d{10,})$/.test(bookId)) {
      setError('书籍地址无效。请从知识资料库重新打开。');
      return;
    }
    let active = true;
    fetch('/api/books').then(r => r.json()).then(list => {
      if (active) setBook(list.find(b => b.id === bookId) || null);
    }).catch(() => {});
    const loading = pdfjs.getDocument({
      url,
      disableRange: true
    });
    loading.promise.then(pdf => {
      if (active) {
        setDoc(pdf);
        setPage(p => Math.min(p, pdf.numPages));
        setStatus('');
      } else pdf.destroy();
    }).catch(e => {
      if (active) {
        setError('PDF 加载失败，请确认后端服务正在运行。');
        setStatus('');
        console.error(e);
      }
    });
    return () => {
      active = false;
      loading.destroy();
    };
  }, []);
  useEffect(() => {
    if (!doc || !canvas.current) return;
    let active = true;
    setLinks([]);
    setStatus(`正在渲染第 ${page} 页…`);
    (async () => {
      try {
        if (task.current) {
          task.current.cancel();
          try {
            await task.current.promise;
          } catch {}
        }
        const pdfPage = await doc.getPage(page);
        if (!active) return;
        const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
        const viewport = pdfPage.getViewport({
          scale: pixelRatio * scale
        });
        const linkViewport = pdfPage.getViewport({
          scale
        });
        const el = canvas.current;
        el.width = Math.ceil(viewport.width);
        el.height = Math.ceil(viewport.height);
        el.style.width = `${linkViewport.width}px`;
        el.style.height = `${linkViewport.height}px`;
        const ctx = el.getContext('2d', {
          alpha: false
        });
        task.current = pdfPage.render({
          canvasContext: ctx,
          canvas: el,
          viewport
        });
        await task.current.promise;
        if (!active) return;
        const annotations = await pdfPage.getAnnotations();
        const mapped = await Promise.all(annotations.filter(a => a.subtype === 'Link' && a.rect).map(async a => {
          try {
            const [x1, y1] = linkViewport.convertToViewportPoint(a.rect[0], a.rect[1]);
            const [x2, y2] = linkViewport.convertToViewportPoint(a.rect[2], a.rect[3]);
            const box = {
              left: Math.min(x1, x2),
              top: Math.min(y1, y2),
              width: Math.abs(x2 - x1),
              height: Math.abs(y2 - y1)
            };
            if (box.width < 2 || box.height < 2) return null;
            const label = a.overlaidText || a.contentsObj?.str || 'PDF 链接';
            if (a.url) {
              const target = new URL(a.url);
              if (!['https:', 'http:'].includes(target.protocol)) return null;
              return {
                id: a.id,
                box,
                label,
                url: target.href
              };
            }
            const dest = typeof a.dest === 'string' ? await doc.getDestination(a.dest) : a.dest;
            if (!Array.isArray(dest)) return null;
            const first = dest[0];
            const targetPage = typeof first === 'number' ? first + 1 : (await doc.getPageIndex(first)) + 1;
            if (targetPage < 1 || targetPage > doc.numPages) return null;
            return {
              id: a.id,
              box,
              label,
              targetPage
            };
          } catch {
            return null;
          }
        }));
        if (active) {
          setLinks(mapped.filter(Boolean));
          setStatus('');
          if (pendingScroll.current) {
            const destination = pendingScroll.current;
            requestAnimationFrame(() => {
              if (stage.current) stage.current.scrollTop = destination === 'bottom' ? stage.current.scrollHeight - stage.current.clientHeight : 0;
              pendingScroll.current = null;
            });
          }
        }
      } catch (e) {
        if (active && e?.name !== 'RenderingCancelledException') {
          setError('页面渲染失败。请尝试刷新或下载 PDF 查看。');
          setStatus('');
          console.error(e);
        }
      }
    })();
    return () => {
      active = false;
      task.current?.cancel();
    };
  }, [doc, page, scale]);
  useEffect(() => {
    const el = stage.current;
    if (!el || !doc) return;
    const onWheel = e => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const direction = Math.sign(e.deltaY);
      if (!direction) return;
      const atEdge = direction > 0 ? el.scrollTop + el.clientHeight >= el.scrollHeight - 2 : el.scrollTop <= 2;
      if (!atEdge) {
        wheelDistance.current = 0;
        wheelDirection.current = 0;
        return;
      }
      e.preventDefault();
      if (pendingScroll.current) return;
      if (wheelDirection.current !== direction) wheelDistance.current = 0;
      wheelDirection.current = direction;
      wheelDistance.current = Math.max(0, wheelDistance.current + (e.deltaMode === 1 ? Math.abs(e.deltaY) * 16 : Math.abs(e.deltaY)));
      if (wheelDistance.current < 35) return;
      wheelDistance.current = 0;
      const next = page + direction;
      if (next < 1 || next > doc.numPages) return;
      pendingScroll.current = direction > 0 ? 'top' : 'bottom';
      go(next);
    };
    el.addEventListener('wheel', onWheel, {
      passive: false
    });
    return () => el.removeEventListener('wheel', onWheel);
  }, [doc, page]);
  function go(n) {
    if (!doc) return;
    const next = Math.max(1, Math.min(doc.numPages, n));
    if (!pendingScroll.current && stage.current) stage.current.scrollTop = 0;
    wheelDistance.current = 0;
    setPage(next);
    history.replaceState(null, '', `?book=${encodeURIComponent(bookId)}&page=${next}`);
  }
  return <div className="reader-app"><header className="reader-bar"><a className="reader-brand" href="/?view=library">PEBS <span>{t("· 知识资料库")}</span></a><strong title={book?.title}>{book?.title || t("PDF 阅读器")}</strong><a className="reader-download" href={url} download={(book?.title || 'book') + '.pdf'}><Download size={16} />{t("下载原文件")}</a></header><div className="reader-controls"><button disabled={!doc || page <= 1} onClick={() => go(page - 1)} aria-label={t("上一页")}><ChevronLeft size={18} /></button><label>{t("第")}<input aria-label={t("页码")} type="number" min="1" max={doc?.numPages || 1} value={page} onChange={e => go(Number(e.target.value) || 1)} /> / {doc?.numPages || '…'}{t("页")}</label><button disabled={!doc || page >= doc.numPages} onClick={() => go(page + 1)} aria-label={t("下一页")}><ChevronRight size={18} /></button><span className="reader-separator" /><button onClick={() => setScale(s => Math.max(.5, Math.round((s - .1) * 10) / 10))} aria-label={t("缩小")}><ZoomOut size={18} /></button><span>{Math.round(scale * 100)}%</span><button onClick={() => setScale(s => Math.min(2, Math.round((s + .1) * 10) / 10))} aria-label={t("放大")}><ZoomIn size={18} /></button></div>{error ? <main className="reader-message" role="alert">{error}<p><a href={url} download>{t("下载 PDF")}</a> · <a href="/?view=library">{t("返回知识资料库")}</a></p></main> : <main className="reader-stage" ref={stage}>{status && <div className="reader-status" role="status">{status}</div>}<div className="reader-page"><canvas ref={canvas} aria-label={`PDF 第 ${page} 页`} /><div className="reader-links" aria-label={`第 ${page} 页中的超链接`}>{links.map(link => <a key={link.id} className="reader-link" style={link.box} title={link.label} aria-label={link.label} href={link.url || `?book=${encodeURIComponent(bookId)}&page=${link.targetPage}`} target={link.url ? '_blank' : undefined} rel={link.url ? 'noopener noreferrer' : undefined} onClick={link.targetPage ? e => {
            e.preventDefault();
            go(link.targetPage);
          } : undefined} />)}</div></div></main>}</div>;
}
createRoot(document.getElementById('root')).render(<Reader />);
