import { useEffect, useState } from 'react';
import { useRelayCtx } from '../ctx.ts';
import { renderCanvas } from '../format.tsx';
import { isAdmin } from '../premium.ts';
import { Composer } from './Composer.tsx';
import { MessageList, MessageRow } from './MessageList.tsx';

export function ThreadPanel({ parentId, onClose }: { parentId: string; onClose: () => void }) {
  const { snap, send } = useRelayCtx();
  const parent = snap.messages.find((m) => m.id === parentId);
  if (!parent) return null;
  const replies = snap.messages.filter((m) => m.threadId === parentId);
  return (
    <aside className="panel">
      <header>
        <h3>Thread</h3>
        <div>
          <button className="ghost-btn" onClick={() => send({ t: 'send', channelId: parent.channelId, text: '/summarize', threadId: parentId })}>
            ✨ Summarize
          </button>
          <button className="icon-btn" aria-label="Close thread" onClick={onClose}>×</button>
        </div>
      </header>
      <div className="panel-scroll">
        <MessageRow m={parent} compact={false} inThread />
        <div className="day-divider"><span>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span></div>
        <MessageList messages={replies} inThread />
      </div>
      <Composer channelId={parent.channelId} threadId={parentId} placeholder="Reply…" />
    </aside>
  );
}

export function CanvasPanel({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const { snap, send } = useRelayCtx();
  const content = snap.canvases[channelId] ?? '';
  const [draft, setDraft] = useState(content);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(content);
  }, [content, editing, channelId]);

  useEffect(() => {
    if (!editing || draft === content) return;
    const t = setTimeout(() => send({ t: 'canvas', channelId, content: draft }), 500);
    return () => clearTimeout(t);
  }, [draft, editing, channelId]);

  return (
    <aside className="panel canvas">
      <header>
        <h3>Canvas</h3>
        <div>
          <button className="ghost-btn" onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit'}</button>
          <button className="icon-btn" aria-label="Close canvas" onClick={onClose}>×</button>
        </div>
      </header>
      <div className="panel-scroll">
        {editing ? (
          <textarea className="canvas-editor" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="# Title&#10;- bullets&#10;Plain text…" />
        ) : content ? (
          <div className="canvas-doc">{renderCanvas(content, snap.users)}</div>
        ) : (
          <p className="muted">Empty canvas. Press Edit to start a doc everyone in this channel can see.</p>
        )}
      </div>
    </aside>
  );
}

export function DetailsPanel({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const { snap, send, openThread } = useRelayCtx();
  const ch = snap.channels[channelId];
  if (!ch) return null;
  const pins = snap.messages.filter((m) => m.channelId === channelId && m.pinned);
  const amMember = ch.members.includes(snap.me);
  const admin = isAdmin(snap.users[snap.me]);
  const invitable = Object.values(snap.users).filter((u) => !u.bot && !ch.members.includes(u.id) && (admin || u.role !== 'guest'));
  const section = snap.sections.find((sec) => sec.channelIds.includes(channelId));
  const moveToSection = (sectionId: string) =>
    send({
      t: 'sections',
      sections: snap.sections.map((sec) => ({
        ...sec,
        channelIds: sec.id === sectionId ? [...sec.channelIds.filter((id) => id !== channelId), channelId] : sec.channelIds.filter((id) => id !== channelId),
      })),
    });
  return (
    <aside className="panel">
      <header>
        <h3>Details</h3>
        <button className="icon-btn" aria-label="Close details" onClick={onClose}>×</button>
      </header>
      <div className="panel-scroll pad">
        <h4>About</h4>
        <p>{ch.topic || <span className="muted">No topic set. Try /topic</span>}</p>
        <h4>Pinned ({pins.length})</h4>
        {pins.length === 0 && <p className="muted">Nothing pinned yet.</p>}
        {pins.map((p) => (
          <button key={p.id} className="pin-item" onClick={() => openThread(p.id)}>
            <strong>{snap.users[p.userId]?.name}</strong>: {p.text.slice(0, 80)}
          </button>
        ))}
        {ch.kind !== 'dm' && (
          <>
            <h4>Sidebar section</h4>
            <select value={section?.id ?? ''} onChange={(e) => moveToSection(e.target.value)}>
              <option value="">Channels (default)</option>
              {snap.sections.map((sec) => <option key={sec.id} value={sec.id}>{sec.name}</option>)}
            </select>
          </>
        )}
        {ch.kind !== 'dm' && admin && (
          <>
            <h4>Who can post</h4>
            <select value={ch.postingPolicy ?? 'everyone'} onChange={(e) => send({ t: 'channelPolicy', channelId, postingPolicy: e.target.value as 'everyone' | 'admins' })}>
              <option value="everyone">Everyone</option>
              <option value="admins">Admins only (announcement channel)</option>
            </select>
          </>
        )}
        <h4>Members ({ch.members.length})</h4>
        {ch.members.map((id) => (
          <div key={id} className="member">
            <span className={`dot ${snap.online.includes(id) ? 'on' : ''}`} /> {snap.users[id]?.name}
            {snap.users[id]?.role === 'guest' && <span className="badge">guest</span>}
            <small>{snap.users[id]?.title}</small>
          </div>
        ))}
        {ch.kind !== 'dm' && amMember && invitable.length > 0 && (
          <select value="" onChange={(e) => e.target.value && send({ t: 'addMember', channelId, userId: e.target.value })}>
            <option value="">＋ Add someone…</option>
            {invitable.map((u) => <option key={u.id} value={u.id}>{u.name}{u.role === 'guest' ? ' (guest)' : ''}</option>)}
          </select>
        )}
        {ch.kind !== 'dm' && (
          <button className="ghost-btn danger" onClick={() => send({ t: amMember ? 'leave' : 'join', channelId })}>
            {amMember ? 'Leave channel' : 'Join channel'}
          </button>
        )}
      </div>
    </aside>
  );
}
