import { accountFetch as fetch } from './account-fetch';
import { t } from './i18n';
import React, { useMemo, useState } from 'react';
import { BookOpen, Loader2, Send, Sparkles, X } from 'lucide-react';

async function askLibrary(question, history) {
  const context = {
    stage: 1,
    project: {
      name: '知识资料库问答',
      question,
      target: '依据知识资料库书籍内容和已审核 Skill 回答问题',
      scope: '当前账号可访问的知识资料库',
      constraints: '不得编造资料、数据或未提供的结论',
      owner: '',
      action: '',
      followup: ''
    },
    data: {
      columns: [],
      rows: 0,
      issues: [],
      synthetic: false
    },
    variables: {
      xs: [],
      y: ''
    },
    method: 'library-assistant',
    model: null,
    user_question: [...history, question].slice(-6).join('\n')
  };
  const response = await fetch('/api/project-guide', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      context,
      web: false,
      force: false
    })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw Error(result?.error || t('资料库助手暂时不可用，请稍后重试'));
  return result;
}

function SourceList({ sources }) {
  if (!sources?.length) return <p className="library-assistant-empty-source">{t('本次回答没有找到可核对的资料来源。')}</p>;
  return <div className="library-assistant-sources">
    <h4><BookOpen size={14} />{t('资料来源')}</h4>
    {sources.slice(0, 6).map((source, index) => {
      const content = <><strong>{source.knowledge_point || source.title || t('资料库知识点')}</strong>{source.title && source.title !== source.knowledge_point && <span>{source.title}</span>}<small>{source.kind === 'skill' ? t('已审核 Skill') : t('资料库书籍内容')}{source.page ? ` · ${t('PDF 第')}${source.page}${t('页')}` : ''}</small></>;
      return source.url ? <a key={source.id || index} href={source.url} target="_blank" rel="noreferrer" className="library-assistant-source">{content}</a> : <div key={source.id || index} className="library-assistant-source">{content}</div>;
    })}
  </div>;
}

export default function LibraryAssistant() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState(() => [{
    role: 'assistant',
    text: t('你好，我可以根据当前资料库的书籍内容和已审核 Skill 回答问题，并给出可核对的资料来源。')
  }]);
  const history = useMemo(() => messages.filter(message => message.role === 'user').map(message => message.text), [messages]);

  async function submit(event) {
    event?.preventDefault();
    const question = draft.trim();
    if (!question || busy) return;
    setDraft('');
    setMessages(current => [...current, { role: 'user', text: question }]);
    setBusy(true);
    try {
      const result = await askLibrary(question, history);
      setMessages(current => [...current, {
        role: 'assistant',
        text: result.answer || t('资料库中暂时没有形成可核对的回答。'),
        result
      }]);
    } catch (error) {
      setMessages(current => [...current, { role: 'assistant', text: error.message, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    setMessages([{ role: 'assistant', text: t('对话已清空。你可以继续询问资料库中的方法、变量、建模或验证问题。') }]);
  }

  return <>
    {open && <section className="library-assistant-panel" role="dialog" aria-modal="false" aria-label={t('知识库小助手')}>
      <header className="library-assistant-header"><div><Sparkles size={17} /><div><strong>{t('知识库小助手')}</strong><small>{t('书籍内容 · 已审核 Skill')}</small></div></div><button className="library-assistant-close" aria-label={t('关闭小助手')} onClick={() => setOpen(false)}><X size={17} /></button></header>
      <div className="library-assistant-messages" aria-live="polite">
        {messages.map((message, index) => <article key={index} className={'library-assistant-message ' + message.role + (message.error ? ' error' : '')}><p>{message.text}</p>{message.result && <SourceList sources={message.result.sources} />}</article>)}
        {busy && <article className="library-assistant-message assistant pending"><Loader2 size={15} className="spin" /><span>{t('正在检索书籍和 Skill，并生成回答…')}</span></article>}
      </div>
      <form className="library-assistant-form" onSubmit={submit}><textarea aria-label={t('向知识库小助手提问')} value={draft} onChange={event => setDraft(event.target.value)} disabled={busy} maxLength={2000} placeholder={t('例如：哪些资料介绍了非线性回归的模型验证？')} rows={2} /><div><button type="button" className="text-button" disabled={busy || messages.length <= 1} onClick={clear}>{t('清空对话')}</button><button type="submit" className="primary" disabled={busy || !draft.trim()}><Send size={14} />{t('发送')}</button></div></form>
    </section>}
    <button className={'library-assistant-launcher' + (open ? ' active' : '')} aria-label={open ? t('关闭小助手') : t('打开知识库小助手')} onClick={() => setOpen(value => !value)}><Sparkles size={18} /><span>{t('资料库小助手')}</span></button>
  </>;
}
