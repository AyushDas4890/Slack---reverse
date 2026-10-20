import { useState } from 'react';
import type { ListItem } from '../types.ts';
import { useRelayCtx } from '../ctx.ts';

const COLUMNS: { status: ListItem['status']; label: string }[] = [
  { status: 'todo', label: 'To do' },
  { status: 'doing', label: 'In progress' },
  { status: 'done', label: 'Done' },
];

export function ListPanel({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const { snap, send } = useRelayCtx();
  const items = snap.lists[channelId] ?? [];
  const [title, setTitle] = useState('');
  const members = snap.channels[channelId]?.members.filter((id) => !snap.users[id]?.bot) ?? [];

  const save = (next: ListItem[]) => send({ t: 'list', channelId, items: next });
  const patch = (id: string, change: Partial<ListItem>) => save(items.map((it) => (it.id === id ? { ...it, ...change } : it)));

  const add = () => {
    if (!title.trim()) return;
    save([...items, { id: crypto.randomUUID(), title: title.trim(), done: false, assignee: '', due: '', status: 'todo' }]);
    setTitle('');
  };

  return (
    <aside className="panel">
      <header>
        <h3>List</h3>
        <button className="icon-btn" aria-label="Close list" onClick={onClose}>×</button>
      </header>
      <div className="panel-scroll pad">
        <form className="row" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input className="grow" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" />
          <button className="send-btn" disabled={!title.trim()}>Add</button>
        </form>
        {COLUMNS.map((col) => {
          const colItems = items.filter((it) => it.status === col.status);
          return (
            <div key={col.status}>
              <h4>{col.label} ({colItems.length})</h4>
              {colItems.length === 0 && <p className="muted small">Nothing here.</p>}
              {colItems.map((it) => (
                <div key={it.id} className={`list-item ${it.status === 'done' ? 'done' : ''}`}>
                  <div className="row">
                    <input
                      type="checkbox"
                      className="fit"
                      checked={it.status === 'done'}
                      onChange={(e) => patch(it.id, { status: e.target.checked ? 'done' : 'todo' })}
                    />
                    <span className="grow">{it.title}</span>
                    <button className="icon-btn" aria-label="Delete task" onClick={() => save(items.filter((x) => x.id !== it.id))}>×</button>
                  </div>
                  <div className="row">
                    <select value={it.status} onChange={(e) => patch(it.id, { status: e.target.value as ListItem['status'] })}>
                      {COLUMNS.map((c) => <option key={c.status} value={c.status}>{c.label}</option>)}
                    </select>
                    <select value={it.assignee} onChange={(e) => patch(it.id, { assignee: e.target.value })}>
                      <option value="">Unassigned</option>
                      {members.map((id) => <option key={id} value={id}>{snap.users[id]?.name}</option>)}
                    </select>
                    <input type="date" value={it.due} onChange={(e) => patch(it.id, { due: e.target.value })} />
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
