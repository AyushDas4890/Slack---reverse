import { useEffect, useRef, useState } from 'react';
import type { Message } from '../types.ts';
import { useRelayCtx } from '../ctx.ts';
import { dayLabel, EMOJI, RichText, timeLabel } from '../format.tsx';
import { isAdmin } from '../premium.ts';
import { Avatar } from './Avatar.tsx';

export function MessageRow({ m, compact, inThread }: { m: Message; compact: boolean; inThread?: boolean }) {
  const { snap, send, openThread } = useRelayCtx();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.text);
  const [picker, setPicker] = useState(false);
  const user = snap.users[m.userId];
  const mine = m.userId === snap.me;
  const canModerate = isAdmin(snap.users[snap.me]);
  const replies = inThread ? [] : snap.messages.filter((x) => x.threadId === m.id);
  const saved = snap.saved.includes(m.id);

  if (m.system) {
    return (
      <div className="msg system">
        <RichText text={m.text} users={snap.users} groups={snap.groups} />
      </div>
    );
  }

  return (
    <div className={`msg ${compact ? 'compact' : ''} ${m.pinned ? 'pinned' : ''}`}>
      <div className="gutter">
        {compact ? <span className="hover-time">{timeLabel(m.ts)}</span> : <Avatar user={user} />}
      </div>
      <div className="body">
        {!compact && (
          <div className="meta">
            <strong>{user?.name ?? 'Unknown'}</strong>
            {user?.status.emoji && <span title={user.status.text}>{user.status.emoji}</span>}
            <time>{timeLabel(m.ts)}</time>
            {m.pinned && <span className="badge">📌 pinned</span>}
            {m.edited && <span className="edited">(edited)</span>}
          </div>
        )}
        {editing ? (
          <div className="edit-box">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div>
              <button className="ghost-btn" onClick={() => setEditing(false)}>Cancel</button>
              <button className="send-btn" onClick={() => { send({ t: 'edit', id: m.id, text: draft }); setEditing(false); }}>Save</button>
            </div>
          </div>
        ) : (
          <div className="text">
            <RichText text={m.text} users={snap.users} groups={snap.groups} />
          </div>
        )}
        {m.files?.map((f, i) =>
          f.type.startsWith('image/') ? (
            <img key={i} className="attach-img" src={f.dataUrl} alt={f.name} />
          ) : f.type.startsWith('video/') ? (
            <video key={i} className="attach-img" src={f.dataUrl} controls />
          ) : f.type.startsWith('audio/') ? (
            <audio key={i} className="attach-audio" src={f.dataUrl} controls />
          ) : (
            <div key={i} className="attach-row">
              <a className="attach-file" href={f.dataUrl} download={f.name}>
                📄 {f.name} <small>{Math.ceil(f.size / 1024)} KB</small>
              </a>
              <button className="ghost-btn" title="Summarize this file" onClick={() => send({ t: 'fileSummary', id: m.id, index: i })}>✨ Summarize</button>
            </div>
          ),
        )}
        {Object.keys(m.reactions).length > 0 && (
          <div className="reactions">
            {Object.entries(m.reactions).map(([emoji, ids]) => (
              <button
                key={emoji}
                className={ids.includes(snap.me) ? 'mine' : ''}
                title={ids.map((id) => snap.users[id]?.name).join(', ')}
                onClick={() => send({ t: 'react', id: m.id, emoji })}
              >
                {emoji} {ids.length}
              </button>
            ))}
          </div>
        )}
        {replies.length > 0 && (
          <button className="thread-link" onClick={() => openThread(m.id)}>
            💬 {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
            <span> · last {timeLabel(replies[replies.length - 1].ts)}</span>
          </button>
        )}
      </div>
      <div className="actions">
        <button title="React" onClick={() => setPicker(!picker)}>☺</button>
        {!inThread && <button title="Reply in thread" onClick={() => openThread(m.id)}>💬</button>}
        <button title={m.pinned ? 'Unpin' : 'Pin'} onClick={() => send({ t: 'pin', id: m.id })}>📌</button>
        <button title={saved ? 'Unsave' : 'Save for later'} onClick={() => send({ t: 'save', id: m.id })}>{saved ? '★' : '☆'}</button>
        {mine && <button title="Edit" onClick={() => { setDraft(m.text); setEditing(true); }}>✎</button>}
        {(mine || canModerate) && <button title="Delete" onClick={() => { if (confirm('Delete this message?')) send({ t: 'delete', id: m.id }); }}>🗑</button>}
        {!mine && (
          <button
            title="Flag for admin review"
            onClick={() => {
              const reason = prompt('Why are you flagging this message?');
              if (reason?.trim()) send({ t: 'flag', id: m.id, reason: reason.trim() });
            }}
          >
            🚩
          </button>
        )}
        {picker && (
          <div className="popover emoji-pop">
            {EMOJI.map((e) => (
              <button key={e} onClick={() => { send({ t: 'react', id: m.id, emoji: e }); setPicker(false); }}>{e}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function MessageList({ messages, inThread }: { messages: Message[]; inThread?: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, messages[messages.length - 1]?.id]);

  return (
    <div className="message-list">
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const newDay = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
        const compact = !newDay && !!prev && !prev.system && prev.userId === m.userId && m.ts - prev.ts < 5 * 60_000;
        return (
          <div key={m.id}>
            {newDay && <div className="day-divider"><span>{dayLabel(m.ts)}</span></div>}
            <MessageRow m={m} compact={compact && !m.system} inThread={inThread} />
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
