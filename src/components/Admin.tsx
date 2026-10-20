import { useEffect, useState } from 'react';
import type { Role, UserGroup } from '../types.ts';
import { useRelayCtx } from '../ctx.ts';
import { channelLabel, timeLabel } from '../format.tsx';
import { Modal } from './Modals.tsx';

type Tab = 'analytics' | 'members' | 'groups' | 'policies' | 'flags' | 'audit';
const TABS: { id: Tab; label: string }[] = [
  { id: 'analytics', label: 'Analytics' },
  { id: 'members', label: 'Members' },
  { id: 'groups', label: 'User groups' },
  { id: 'policies', label: 'Policies' },
  { id: 'flags', label: 'Flagged' },
  { id: 'audit', label: 'Audit log' },
];

export function AdminModal({ onClose }: { onClose: () => void }) {
  const { snap, send } = useRelayCtx();
  const [tab, setTab] = useState<Tab>('analytics');
  const flagCount = snap.admin?.flags.length ?? 0;
  return (
    <Modal title="Admin console" onClose={onClose} wide>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'flags' && flagCount > 0 && <b className="tab-count">{flagCount}</b>}
          </button>
        ))}
        <span className="spacer" />
        <button className="ghost-btn" onClick={() => send({ t: 'export' })}>⬇ Export all data</button>
      </div>
      {tab === 'analytics' && <AnalyticsTab />}
      {tab === 'members' && <MembersTab />}
      {tab === 'groups' && <GroupsTab />}
      {tab === 'policies' && <PoliciesTab />}
      {tab === 'flags' && <FlagsTab />}
      {tab === 'audit' && <AuditTab />}
    </Modal>
  );
}

function AnalyticsTab() {
  const { send, analytics } = useRelayCtx();
  useEffect(() => send({ t: 'analytics' }), []);
  if (!analytics) return <p className="muted">Loading analytics…</p>;
  const peak = Math.max(1, ...analytics.messagesByDay.map((d) => d.count));
  return (
    <div className="admin-grid">
      <div className="stats">
        <div className="stat"><b>{analytics.totalMessages}</b><small>messages</small></div>
        <div className="stat"><b>{analytics.activeUsers7d}</b><small>active in 7 days</small></div>
        <div className="stat"><b>{analytics.filesShared}</b><small>files shared</small></div>
        <div className="stat"><b>{analytics.reactions}</b><small>reactions</small></div>
      </div>
      <h4>Messages per day (last 14 days)</h4>
      <div className="bars" role="img" aria-label="Messages per day">
        {analytics.messagesByDay.map((d) => (
          <div key={d.day} className="bar" title={`${d.day}: ${d.count}`}>
            <i style={{ height: `${(d.count / peak) * 100}%` }} />
            <small>{d.day.slice(3)}</small>
          </div>
        ))}
      </div>
      <div className="row top">
        <div className="grow">
          <h4>Most active channels</h4>
          {analytics.topChannels.map((c) => <div key={c.channelId} className="member">#{c.name}<small>{c.count}</small></div>)}
        </div>
        <div className="grow">
          <h4>Top posters</h4>
          {analytics.topPosters.map((u) => <div key={u.userId} className="member">{u.name}<small>{u.count}</small></div>)}
        </div>
      </div>
    </div>
  );
}

function MembersTab() {
  const { snap, send } = useRelayCtx();
  const people = Object.values(snap.users).filter((u) => !u.bot);
  const holds = snap.admin?.legalHolds ?? [];
  const iAmOwner = snap.users[snap.me]?.role === 'owner';
  return (
    <div>
      <p className="muted small">Guests only see channels they're added to. Only owners can grant admin rights.</p>
      {people.map((u) => (
        <div key={u.id} className="member wide">
          <span className={`dot ${snap.online.includes(u.id) ? 'on' : ''}`} />
          <span className="grow">{u.name}{u.id === snap.me && ' (you)'}</span>
          <label className="check small">
            <input type="checkbox" checked={holds.includes(u.id)} onChange={(e) => send({ t: 'legalHold', userId: u.id, on: e.target.checked })} />
            Legal hold
          </label>
          <select
            className="fit"
            value={u.role ?? 'member'}
            onChange={(e) => send({ t: 'role', userId: u.id, role: e.target.value as Role })}
          >
            {iAmOwner && <option value="owner">Owner</option>}
            {(iAmOwner || u.role === 'admin') && <option value="admin">Admin</option>}
            {!iAmOwner && u.role === 'owner' && <option value="owner">Owner</option>}
            <option value="member">Member</option>
            <option value="guest">Guest</option>
          </select>
        </div>
      ))}
      <p className="muted small">{snap.admin?.preservedCount ?? 0} edited or deleted messages preserved under legal hold. They're included in exports.</p>
    </div>
  );
}

function GroupsTab() {
  const { snap, send } = useRelayCtx();
  const [groups, setGroups] = useState<UserGroup[]>(snap.groups);
  const people = Object.values(snap.users).filter((u) => !u.bot);
  const patch = (id: string, change: Partial<UserGroup>) => setGroups(groups.map((g) => (g.id === id ? { ...g, ...change } : g)));
  return (
    <div className="grid-gap">
      <p className="muted small">Mention a whole group with @handle. Groups are also used for information barriers.</p>
      {groups.map((g) => (
        <div key={g.id} className="workflow">
          <div className="row">
            <input value={g.handle} onChange={(e) => patch(g.id, { handle: e.target.value })} placeholder="handle" />
            <input className="grow" value={g.name} onChange={(e) => patch(g.id, { name: e.target.value })} placeholder="Display name" />
            <button className="ghost-btn danger" onClick={() => setGroups(groups.filter((x) => x.id !== g.id))}>Delete</button>
          </div>
          <div className="chips">
            {people.map((u) => (
              <label key={u.id} className={`chip toggle ${g.members.includes(u.id) ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  hidden
                  checked={g.members.includes(u.id)}
                  onChange={(e) => patch(g.id, { members: e.target.checked ? [...g.members, u.id] : g.members.filter((x) => x !== u.id) })}
                />
                {u.name}
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="row">
        <button className="ghost-btn" onClick={() => setGroups([...groups, { id: crypto.randomUUID(), handle: 'team', name: 'New group', members: [] }])}>＋ Add group</button>
        <span className="spacer" />
        <button className="send-btn" onClick={() => send({ t: 'groups', groups })}>Save groups</button>
      </div>
    </div>
  );
}

function PoliciesTab() {
  const { snap, send } = useRelayCtx();
  const [retention, setRetention] = useState(snap.settings.retentionDays);
  const [terms, setTerms] = useState(snap.settings.terms);
  const [barriers, setBarriers] = useState(snap.settings.barriers);
  const groupName = (id: string) => snap.groups.find((g) => g.id === id)?.handle ?? '?';
  return (
    <div className="grid-gap">
      <label>Message retention
        <select value={retention} onChange={(e) => setRetention(Number(e.target.value))}>
          <option value={0}>Keep forever</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
          <option value={365}>1 year</option>
          <option value={730}>2 years</option>
        </select>
      </label>
      <p className="muted small">Messages from people on legal hold are never deleted by retention.</p>
      <label>Custom terms of service
        <textarea rows={4} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Leave empty to skip. Changing the text asks everyone to accept again." />
      </label>
      <h4>Information barriers</h4>
      {snap.groups.length < 2 && <p className="muted small">Create at least two user groups first.</p>}
      {barriers.map(([a, b], i) => (
        <div key={i} className="row">
          <span className="grow">@{groupName(a)} ⟷ @{groupName(b)}: no DMs or DM huddles</span>
          <button className="ghost-btn danger" onClick={() => setBarriers(barriers.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      {snap.groups.length >= 2 && <BarrierAdder onAdd={(pair) => setBarriers([...barriers, pair])} />}
      <button className="send-btn" onClick={() => send({ t: 'settings', settings: { retentionDays: retention, terms, barriers } })}>Save policies</button>
    </div>
  );
}

function BarrierAdder({ onAdd }: { onAdd: (pair: [string, string]) => void }) {
  const { snap } = useRelayCtx();
  const [a, setA] = useState(snap.groups[0].id);
  const [b, setB] = useState(snap.groups[1].id);
  return (
    <div className="row">
      <select value={a} onChange={(e) => setA(e.target.value)}>{snap.groups.map((g) => <option key={g.id} value={g.id}>@{g.handle}</option>)}</select>
      <span>⟷</span>
      <select value={b} onChange={(e) => setB(e.target.value)}>{snap.groups.map((g) => <option key={g.id} value={g.id}>@{g.handle}</option>)}</select>
      <button className="ghost-btn" disabled={a === b} onClick={() => onAdd([a, b])}>Add barrier</button>
    </div>
  );
}

function FlagsTab() {
  const { snap, send } = useRelayCtx();
  const flags = snap.admin?.flags ?? [];
  if (flags.length === 0) return <p className="muted">No flagged messages.</p>;
  return (
    <div className="grid-gap">
      {flags.map((f) => (
        <div key={f.id} className="sched-item">
          <div>
            <strong>{snap.users[f.by]?.name} flagged a message</strong>
            <small>{snap.channels[f.channelId] ? channelLabel(snap.channels[f.channelId], snap.users, snap.me) : 'private conversation'} · {new Date(f.ts).toLocaleString()}</small>
            <p className="quote-box">{f.excerpt}</p>
            <p>Reason: {f.reason}</p>
          </div>
          <div className="stack">
            <button className="send-btn danger" onClick={() => send({ t: 'resolveFlag', id: f.id, removeMessage: true })}>Remove message</button>
            <button className="ghost-btn" onClick={() => send({ t: 'resolveFlag', id: f.id, removeMessage: false })}>Dismiss</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AuditTab() {
  const { snap } = useRelayCtx();
  const entries = (snap.admin?.audit ?? []).slice().reverse();
  if (entries.length === 0) return <p className="muted">No admin activity yet.</p>;
  return (
    <table className="audit">
      <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead>
      <tbody>
        {entries.map((e, i) => (
          <tr key={i}>
            <td>{new Date(e.ts).toLocaleDateString()} {timeLabel(e.ts)}</td>
            <td>{snap.users[e.actor]?.name ?? e.actor}</td>
            <td><code>{e.action}</code></td>
            <td>{e.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TermsGate() {
  const { snap, send } = useRelayCtx();
  if (!snap.settings.terms || snap.termsAccepted >= snap.settings.termsVersion) return null;
  return (
    <div className="scrim">
      <div className="modal" role="dialog" aria-label="Terms of service">
        <header><h2>Workspace terms</h2></header>
        <div className="modal-body">
          <p className="muted">Your admins ask everyone to accept these terms before using {snap.workspace.name}.</p>
          <div className="quote-box terms">{snap.settings.terms}</div>
          <button className="send-btn" onClick={() => send({ t: 'acceptTerms' })}>I accept</button>
        </div>
      </div>
    </div>
  );
}
