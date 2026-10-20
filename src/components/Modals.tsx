import { useEffect, useMemo, useRef, useState } from 'react';
import { PLAN_FEATURES } from '../types.ts';
import type { Workflow } from '../types.ts';
import { useRelayCtx } from '../ctx.ts';
import { channelLabel, timeLabel } from '../format.tsx';
import { searchAnswer, WORKFLOW_TEMPLATES } from '../premium.ts';

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function SearchPalette({ onClose, onPick }: { onClose: () => void; onPick: (channelId: string, threadId?: string) => void }) {
  const { snap } = useRelayCtx();
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const channels = Object.values(snap.channels)
      .map((c) => ({ c, label: channelLabel(c, snap.users, snap.me) }))
      .filter((x) => !needle || x.label.toLowerCase().includes(needle))
      .slice(0, 6);
    const messages = needle
      ? snap.messages
          .filter((m) => !m.system && m.text.toLowerCase().includes(needle))
          .slice(-8)
          .reverse()
      : [];
    const answer = /\?\s*$/.test(q) ? searchAnswer(q, snap.messages) : null;
    return { channels, messages, answer };
  }, [q, snap]);

  return (
    <div className="scrim top" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          placeholder="Search, or ask a question ending in ?"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
        />
        <div className="palette-results">
          {results.answer && (
            <button className="answer" onClick={() => onPick(results.answer!.channelId, results.answer!.threadId ?? results.answer!.id)}>
              <span>✨</span>
              <div>
                <strong>Best answer</strong> from {snap.users[results.answer.userId]?.name} in {channelLabel(snap.channels[results.answer.channelId], snap.users, snap.me)}
                <small>{results.answer.text.slice(0, 200)}</small>
              </div>
            </button>
          )}
          {results.channels.map(({ c, label }) => (
            <button key={c.id} onClick={() => onPick(c.id)}>
              <span>{c.kind === 'dm' ? '●' : c.kind === 'private' ? '🔒' : '#'}</span> {label}
            </button>
          ))}
          {results.messages.map((m) => (
            <button key={m.id} onClick={() => onPick(m.channelId, m.threadId ?? m.id)}>
              <span>💬</span>
              <div>
                <strong>{snap.users[m.userId]?.name}</strong> in {channelLabel(snap.channels[m.channelId], snap.users, snap.me)}
                <small>{m.text.slice(0, 100)}</small>
              </div>
            </button>
          ))}
          {q && results.channels.length + results.messages.length === 0 && <p className="muted pad">No matches.</p>}
        </div>
      </div>
    </div>
  );
}

export function NewChannelModal({ onClose }: { onClose: () => void }) {
  const { send } = useRelayCtx();
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [priv, setPriv] = useState(false);
  return (
    <Modal title="Create a channel" onClose={onClose}>
      <label>Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. launch-plan" /></label>
      <label>Topic<input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What is this channel about?" /></label>
      <label className="check"><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} /> Make private</label>
      <button className="send-btn" disabled={!name.trim()} onClick={() => { send({ t: 'createChannel', name, topic, kind: priv ? 'private' : 'public' }); onClose(); }}>Create</button>
    </Modal>
  );
}

export function ProfileModal({ onClose, theme, setTheme }: { onClose: () => void; theme: string; setTheme: (t: string) => void }) {
  const { snap, send } = useRelayCtx();
  const me = snap.users[snap.me];
  const [name, setName] = useState(me.name);
  const [title, setTitle] = useState(me.title);
  const [emoji, setEmoji] = useState(me.status.emoji);
  const [text, setText] = useState(me.status.text);
  return (
    <Modal title="Profile & preferences" onClose={onClose}>
      <label>Display name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What do you do?" /></label>
      <div className="row">
        <label style={{ width: 80 }}>Status<input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🌴" /></label>
        <label className="grow">&nbsp;<input value={text} onChange={(e) => setText(e.target.value)} placeholder="On vacation" /></label>
      </div>
      <label>Theme
        <select value={theme} onChange={(e) => setTheme(e.target.value)}>
          <option value="midnight">Midnight</option>
          <option value="daylight">Daylight</option>
          <option value="aurora">Aurora</option>
          <option value="sunset">Sunset</option>
        </select>
      </label>
      <button className="send-btn" onClick={() => { send({ t: 'profile', name, title, status: { emoji, text } }); onClose(); }}>Save</button>
    </Modal>
  );
}

export function PlanModal({ onClose }: { onClose: () => void }) {
  const { snap } = useRelayCtx();
  return (
    <Modal title="Plan & billing" onClose={onClose}>
      <div className="plan-card">
        <span className="badge">★ ACTIVE</span>
        <h3>{snap.workspace.plan}</h3>
        <p className="muted">Relay is self-hosted, so nothing is gated. Every premium capability is switched on for every member, with no seat limits and no billing.</p>
      </div>
      <ul className="feature-list">
        {PLAN_FEATURES.map((f) => (
          <li key={f}>✓ {f}</li>
        ))}
      </ul>
    </Modal>
  );
}

export function ScheduledModal({ onClose }: { onClose: () => void }) {
  const { snap, send } = useRelayCtx();
  return (
    <Modal title="Scheduled messages" onClose={onClose}>
      {snap.scheduled.length === 0 && <p className="muted">Nothing scheduled. Use ⏱ Schedule in the composer.</p>}
      {snap.scheduled.map((s) => (
        <div key={s.id} className="sched-item">
          <div>
            <strong>{new Date(s.at).toLocaleString()}</strong>
            <small>{channelLabel(snap.channels[s.channelId], snap.users, snap.me)}</small>
            <p>{s.text}</p>
          </div>
          <button className="ghost-btn danger" onClick={() => send({ t: 'unschedule', id: s.id })}>Cancel</button>
        </div>
      ))}
    </Modal>
  );
}

export function SchedulePicker({ text, channelId, onClose }: { text: string; channelId: string; onClose: () => void }) {
  const { send } = useRelayCtx();
  const [minutes, setMinutes] = useState(30);
  return (
    <Modal title="Schedule message" onClose={onClose}>
      <p className="quote-box">{text}</p>
      <label>Send in
        <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
          <option value={1}>1 minute</option>
          <option value={30}>30 minutes</option>
          <option value={60}>1 hour</option>
          <option value={180}>3 hours</option>
          <option value={1440}>Tomorrow</option>
        </select>
      </label>
      <button className="send-btn" onClick={() => { send({ t: 'schedule', channelId, text, at: Date.now() + minutes * 60_000 }); onClose(); }}>
        Schedule for {timeLabel(Date.now() + minutes * 60_000)}
      </button>
    </Modal>
  );
}

export function WorkflowModal({ onClose }: { onClose: () => void }) {
  const { snap, send } = useRelayCtx();
  const [list, setList] = useState<Workflow[]>(snap.workflows);
  const channels = Object.values(snap.channels).filter((c) => c.kind !== 'dm');
  const patch = (id: string, fn: (w: Workflow) => Workflow) => setList(list.map((w) => (w.id === id ? fn(w) : w)));

  const add = () =>
    setList([
      ...list,
      { id: crypto.randomUUID(), name: 'New workflow', enabled: true, trigger: { type: 'keyword', keyword: 'hello', channelId: 'any' }, reply: 'Hi there!' },
    ]);

  return (
    <Modal title="Workflow Builder" onClose={onClose} wide>
      {list.map((w) => (
        <div key={w.id} className="workflow">
          <div className="row">
            <input className="grow" value={w.name} onChange={(e) => patch(w.id, (x) => ({ ...x, name: e.target.value }))} />
            <label className="check"><input type="checkbox" checked={w.enabled} onChange={(e) => patch(w.id, (x) => ({ ...x, enabled: e.target.checked }))} /> On</label>
            <button className="ghost-btn danger" onClick={() => setList(list.filter((x) => x.id !== w.id))}>Delete</button>
          </div>
          <div className="row">
            <select
              value={w.trigger.type}
              onChange={(e) =>
                patch(w.id, (x) => ({
                  ...x,
                  trigger: e.target.value === 'join' ? { type: 'join', channelId: 'general' } : { type: 'keyword', keyword: 'hello', channelId: 'any' },
                }))
              }
            >
              <option value="keyword">When a message contains…</option>
              <option value="join">When someone new joins…</option>
            </select>
            {w.trigger.type === 'keyword' && (
              <input
                value={w.trigger.keyword}
                onChange={(e) => patch(w.id, (x) => ({ ...x, trigger: { ...(x.trigger as { type: 'keyword'; channelId: string }), type: 'keyword', keyword: e.target.value } }))}
              />
            )}
            <select
              value={w.trigger.channelId}
              onChange={(e) => patch(w.id, (x) => ({ ...x, trigger: { ...x.trigger, channelId: e.target.value } as Workflow['trigger'] }))}
            >
              {w.trigger.type === 'keyword' && <option value="any">any channel</option>}
              {channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </div>
          <textarea value={w.reply} onChange={(e) => patch(w.id, (x) => ({ ...x, reply: e.target.value }))} placeholder="Bot reply" />
          {w.trigger.type === 'keyword' && (
            w.branch ? (
              <div className="branch">
                <div className="row">
                  <span>Otherwise, if the message also contains</span>
                  <input className="grow" value={w.branch.contains} onChange={(e) => patch(w.id, (x) => ({ ...x, branch: { ...x.branch!, contains: e.target.value } }))} />
                  <button className="ghost-btn danger" onClick={() => patch(w.id, (x) => ({ ...x, branch: undefined }))}>Remove branch</button>
                </div>
                <textarea value={w.branch.reply} onChange={(e) => patch(w.id, (x) => ({ ...x, branch: { ...x.branch!, reply: e.target.value } }))} placeholder="Reply for this branch" />
              </div>
            ) : (
              <button className="ghost-btn fit" onClick={() => patch(w.id, (x) => ({ ...x, branch: { contains: 'urgent', reply: 'Escalating this now.' } }))}>
                ＋ Add condition
              </button>
            )
          )}
        </div>
      ))}
      <div className="row">
        <button className="ghost-btn" onClick={add}>＋ Add workflow</button>
        <select
          className="fit"
          value=""
          onChange={(e) => {
            const tpl = WORKFLOW_TEMPLATES[Number(e.target.value)];
            if (tpl) setList([...list, { ...tpl, id: crypto.randomUUID() }]);
          }}
        >
          <option value="">Start from a template…</option>
          {WORKFLOW_TEMPLATES.map((tpl, i) => <option key={tpl.name} value={i}>{tpl.name}</option>)}
        </select>
        <span className="spacer" />
        <button className="send-btn" onClick={() => { send({ t: 'workflows', list }); onClose(); }}>Publish</button>
      </div>
    </Modal>
  );
}
