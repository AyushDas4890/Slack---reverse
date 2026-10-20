import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  AdminData,
  AuditEntry,
  Channel,
  ClientEvent,
  Flag,
  HuddleState,
  ListItem,
  Message,
  Scheduled,
  Section,
  ServerEvent,
  Settings,
  Snapshot,
  User,
  UserGroup,
  Workflow,
} from '../src/types.ts';
import {
  barred,
  canPost,
  computeAnalytics,
  dailyRecap,
  explainTerm,
  huddleNote,
  isAdmin,
  pruneRetention,
  summarizeText,
  workflowReply,
} from '../src/premium.ts';
import { parseSlash } from './slash.ts';

const PORT = Number(process.env.PORT ?? 8787);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data');
const dataFile = path.join(dataDir, 'db.json');
const distDir = path.join(root, 'dist');

const BOT_ID = 'relaybot';
const COLORS = ['#7c5cff', '#ff6b8b', '#18b6a0', '#f5a524', '#3b9cff', '#e0577d', '#5fb760', '#c06cf0'];
const MAX_TEXT = 8000;

interface DB {
  users: Record<string, User>;
  channels: Record<string, Channel>;
  messages: Message[];
  canvases: Record<string, string>;
  workflows: Workflow[];
  scheduled: Scheduled[];
  saved: Record<string, string[]>;
  lists: Record<string, ListItem[]>;
  sections: Record<string, Section[]>;
  groups: UserGroup[];
  settings: Settings;
  termsAccepted: Record<string, number>;
  flags: Flag[];
  audit: AuditEntry[];
  legalHolds: string[];
  preserved: Message[];
}

const DEFAULT_SETTINGS: Settings = { retentionDays: 0, terms: '', termsVersion: 0, barriers: [] };
const MAX_AUDIT = 1000;

function seed(): DB {
  const now = Date.now();
  const mk = (id: string, name: string, topic: string): Channel => ({
    id,
    name,
    topic,
    kind: 'public',
    members: [BOT_ID],
    createdAt: now,
  });
  const channels = [
    mk('general', 'general', 'Company-wide announcements and chatter'),
    mk('random', 'random', 'Memes, music, and everything off-topic'),
    mk('announcements', 'announcements', 'Read-only vibes: big news goes here'),
    mk('engineering', 'engineering', 'Ship it. Break it. Fix it.'),
    mk('design', 'design', 'Pixels, prototypes, and polish'),
  ];
  const db: DB = {
    users: {
      [BOT_ID]: {
        id: BOT_ID,
        name: 'Relay Bot',
        color: '#7c5cff',
        title: 'Workflow automation',
        status: { emoji: '🤖', text: 'Always on' },
        bot: true,
      },
    },
    channels: Object.fromEntries(channels.map((c) => [c.id, c])),
    messages: [],
    canvases: {
      general: '# Team handbook\n\nWelcome to Relay. Edit this canvas — it is shared with everyone in the channel.\n\n- Be kind\n- Ship small\n- Write things down',
    },
    workflows: [
      {
        id: 'wf-welcome',
        name: 'Welcome new members',
        enabled: true,
        trigger: { type: 'join', channelId: 'general' },
        reply: 'Welcome aboard! 👋 Try `/remind me stretch in 10m`, open a canvas, or press ⌘K to search.',
      },
      {
        id: 'wf-help',
        name: 'Answer "help"',
        enabled: true,
        trigger: { type: 'keyword', keyword: '!help', channelId: 'any' },
        reply: 'Slash commands: /remind, /topic, /me, /shrug, /huddle, /summarize. Press ⌘K to search anything.',
      },
    ],
    scheduled: [],
    saved: {},
    lists: {},
    sections: {},
    groups: [],
    settings: { ...DEFAULT_SETTINGS },
    termsAccepted: {},
    flags: [],
    audit: [],
    legalHolds: [],
    preserved: [],
  };
  db.messages.push({
    id: randomUUID(),
    channelId: 'general',
    userId: BOT_ID,
    text: 'Welcome to **Relay** — every premium feature is unlocked. Say `!help` to see what I can do.',
    ts: now,
    reactions: {},
  });
  return db;
}

function load(): DB {
  if (!fs.existsSync(dataFile)) return seed();
  const raw = fs.readFileSync(dataFile, 'utf8');
  const stored = JSON.parse(raw) as Partial<DB> & Pick<DB, 'users' | 'channels' | 'messages'>;
  // Databases written before the premium features lack these fields.
  return {
    canvases: {},
    workflows: [],
    scheduled: [],
    saved: {},
    lists: {},
    sections: {},
    groups: [],
    termsAccepted: {},
    flags: [],
    audit: [],
    legalHolds: [],
    preserved: [],
    ...stored,
    settings: { ...DEFAULT_SETTINGS, ...stored.settings },
  };
}

const db = load();
let saveTimer: NodeJS.Timeout | undefined;
function persist(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFile(dataFile, JSON.stringify(db), (err) => {
      if (err) console.error('persist failed:', err.message);
    });
  }, 250);
}

const clients = new Map<WebSocket, string>();
const huddles = new Map<string, Set<string>>();

function send(ws: WebSocket, ev: ServerEvent): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(ev));
}

function broadcast(ev: ServerEvent, filter?: (userId: string) => boolean): void {
  const payload = JSON.stringify(ev);
  for (const [ws, uid] of clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (filter && !filter(uid)) continue;
    ws.send(payload);
  }
}

function canSee(ch: Channel, userId: string): boolean {
  if (db.users[userId]?.role === 'guest') return ch.members.includes(userId);
  return ch.kind === 'public' || ch.members.includes(userId);
}

function adminData(): AdminData {
  return { flags: db.flags, audit: db.audit.slice(-200), legalHolds: db.legalHolds, preservedCount: db.preserved.length };
}

function broadcastAdmin(): void {
  broadcast({ t: 'admin', admin: adminData() }, (uid) => isAdmin(db.users[uid]));
}

function audit(actor: string, action: string, detail: string): void {
  db.audit.push({ ts: Date.now(), actor, action, detail });
  if (db.audit.length > MAX_AUDIT) db.audit = db.audit.slice(-MAX_AUDIT);
  broadcastAdmin();
}

function preserve(m: Message): void {
  if (!db.legalHolds.includes(m.userId)) return;
  db.preserved.push({ ...m, reactions: { ...m.reactions } });
  broadcastAdmin();
}

function resendInit(userId: string): void {
  for (const [ws, uid] of clients) if (uid === userId) send(ws, { t: 'init', snapshot: snapshotFor(userId) });
}

function broadcastChannel(ch: Channel, ev: ServerEvent): void {
  broadcast(ev, (uid) => canSee(ch, uid));
}

function onlineIds(): string[] {
  return [...new Set(clients.values())];
}

function huddleList(): HuddleState[] {
  return [...huddles.entries()]
    .filter(([, set]) => set.size > 0)
    .map(([channelId, set]) => ({ channelId, participants: [...set] }));
}

function snapshotFor(userId: string): Snapshot {
  const visibleChannels = Object.fromEntries(
    Object.entries(db.channels).filter(([, ch]) => canSee(ch, userId)),
  );
  return {
    me: userId,
    workspace: { name: 'Relay HQ', plan: 'Enterprise Grid · all premium unlocked' },
    users: db.users,
    online: onlineIds(),
    channels: visibleChannels,
    messages: db.messages.filter((m) => visibleChannels[m.channelId]),
    canvases: db.canvases,
    workflows: db.workflows,
    scheduled: db.scheduled.filter((s) => s.userId === userId),
    huddles: huddleList(),
    saved: db.saved[userId] ?? [],
    lists: Object.fromEntries(Object.entries(db.lists).filter(([cid]) => visibleChannels[cid])),
    sections: db.sections[userId] ?? [],
    groups: db.groups,
    settings: db.settings,
    termsAccepted: db.termsAccepted[userId] ?? 0,
    admin: isAdmin(db.users[userId]) ? adminData() : undefined,
  };
}

function postMessage(
  channelId: string,
  userId: string,
  text: string,
  extra: Partial<Message> = {},
): Message | null {
  const ch = db.channels[channelId];
  if (!ch) return null;
  const message: Message = {
    id: randomUUID(),
    channelId,
    userId,
    text: text.slice(0, MAX_TEXT),
    ts: Date.now(),
    reactions: {},
    ...extra,
  };
  db.messages.push(message);
  broadcastChannel(ch, { t: 'message', message });
  persist();
  runWorkflows(message);
  return message;
}

function runWorkflows(message: Message): void {
  if (message.userId === BOT_ID) return;
  for (const wf of db.workflows) {
    if (!wf.enabled || wf.trigger.type !== 'keyword') continue;
    const { keyword, channelId } = wf.trigger;
    if (channelId !== 'any' && channelId !== message.channelId) continue;
    if (!message.text.toLowerCase().includes(keyword.toLowerCase())) continue;
    postMessage(message.channelId, BOT_ID, workflowReply(wf, message.text), { threadId: message.threadId ?? message.id });
  }
}

function runJoinWorkflows(channelId: string): void {
  for (const wf of db.workflows) {
    if (wf.enabled && wf.trigger.type === 'join' && wf.trigger.channelId === channelId) {
      postMessage(channelId, BOT_ID, wf.reply);
    }
  }
}

function summarize(channelId: string, threadId?: string): string {
  const msgs = db.messages.filter(
    (m) => m.channelId === channelId && !m.system && m.userId !== BOT_ID && (threadId ? m.threadId === threadId || m.id === threadId : !m.threadId),
  );
  if (msgs.length === 0) return 'Nothing to summarize yet.';
  const people = [...new Set(msgs.map((m) => db.users[m.userId]?.name ?? 'someone'))];
  const last = msgs.slice(-3).map((m) => `• ${db.users[m.userId]?.name ?? 'someone'}: ${m.text.slice(0, 90)}`);
  const links = msgs.filter((m) => /https?:\/\//.test(m.text)).length;
  return `**Recap** — ${msgs.length} messages from ${people.join(', ')}${links ? `, ${links} with links` : ''}.\n${last.join('\n')}`;
}

function ensureMember(ch: Channel, userId: string): void {
  if (!ch.members.includes(userId)) ch.members.push(userId);
}

function dmId(a: string, b: string): string {
  return `dm-${[a, b].sort().join('-')}`;
}

function handle(ws: WebSocket, ev: ClientEvent): void {
  if (ev.t === 'hello') {
    const userId = String(ev.userId).slice(0, 64);
    const name = String(ev.name).trim().slice(0, 40) || 'Guest';
    let user = db.users[userId];
    const isNew = !user;
    if (!user) {
      user = {
        id: userId,
        name,
        color: COLORS[Object.keys(db.users).length % COLORS.length],
        title: '',
        status: { emoji: '', text: '' },
        role: 'member',
      };
      db.users[userId] = user;
      for (const id of ['general', 'random']) ensureMember(db.channels[id], userId);
    }
    // The first person to sign in owns the workspace; older databases get an owner the same way.
    if (!Object.values(db.users).some((u) => u.role === 'owner')) user.role = 'owner';
    user.role ??= 'member';
    clients.set(ws, userId);
    send(ws, { t: 'init', snapshot: snapshotFor(userId) });
    broadcast({ t: 'user', user });
    broadcast({ t: 'presence', online: onlineIds() });
    if (isNew) runJoinWorkflows('general');
    persist();
    return;
  }

  const userId = clients.get(ws);
  if (!userId) {
    send(ws, { t: 'error', message: 'Send hello first' });
    return;
  }

  switch (ev.t) {
    case 'send': {
      const ch = db.channels[ev.channelId];
      if (!ch || !canSee(ch, userId)) return;
      if (!canPost(ch, db.users[userId])) {
        send(ws, { t: 'error', message: `Only admins can post in #${ch.name}` });
        return;
      }
      const other = ch.kind === 'dm' ? ch.members.find((u) => u !== userId) : undefined;
      if (other && barred(userId, other, db.groups, db.settings.barriers)) {
        send(ws, { t: 'error', message: 'An information barrier blocks messages between you two.' });
        return;
      }
      ensureMember(ch, userId);
      const slash = parseSlash(ev.text);
      if (slash) {
        if (slash.kind === 'remind') {
          const sched: Scheduled = {
            id: randomUUID(),
            channelId: dmId(userId, BOT_ID),
            userId,
            text: `⏰ Reminder: ${slash.text}`,
            at: Date.now() + slash.inMs,
          };
          openDM(userId, BOT_ID);
          db.scheduled.push(sched);
          sendScheduled(userId);
          postMessage(ev.channelId, BOT_ID, `Got it — I'll remind <@${userId}> to "${slash.text}" in ${slash.label}.`, { system: true });
        } else if (slash.kind === 'topic') {
          ch.topic = slash.text;
          broadcastChannel(ch, { t: 'channel', channel: ch });
          postMessage(ch.id, BOT_ID, `<@${userId}> set the topic to: ${slash.text}`, { system: true });
        } else if (slash.kind === 'huddle') {
          toggleHuddle(ch.id, userId, 'join');
        } else if (slash.kind === 'summarize') {
          postMessage(ch.id, BOT_ID, summarize(ch.id, ev.threadId), { threadId: ev.threadId });
        } else if (slash.kind === 'recap') {
          const dm = openDM(userId, BOT_ID);
          const visible = db.messages.filter((m) => db.channels[m.channelId] && canSee(db.channels[m.channelId], userId));
          postMessage(dm.id, BOT_ID, dailyRecap(visible, db.channels, db.users, Date.now() - 86_400_000, BOT_ID));
        } else if (slash.kind === 'explain') {
          const visible = db.messages.filter((m) => db.channels[m.channelId] && canSee(db.channels[m.channelId], userId));
          postMessage(ch.id, BOT_ID, explainTerm(slash.term, visible, db.users), { system: true, threadId: ev.threadId });
        } else if (slash.kind === 'usage') {
          postMessage(ev.channelId, BOT_ID, slash.text, { system: true, threadId: ev.threadId });
        } else {
          postMessage(ev.channelId, userId, slash.text, { threadId: ev.threadId });
        }
        return;
      }
      if (!ev.text.trim() && !ev.files?.length) return;
      postMessage(ev.channelId, userId, ev.text, { threadId: ev.threadId, files: ev.files?.slice(0, 5) });
      return;
    }
    case 'edit': {
      const m = db.messages.find((x) => x.id === ev.id);
      if (!m || m.userId !== userId) return;
      preserve(m);
      m.text = ev.text.slice(0, MAX_TEXT);
      m.edited = true;
      const ch = db.channels[m.channelId];
      if (ch) broadcastChannel(ch, { t: 'message', message: m });
      persist();
      return;
    }
    case 'delete': {
      const idx = db.messages.findIndex((x) => x.id === ev.id);
      const m = db.messages[idx];
      if (!m || (m.userId !== userId && !isAdmin(db.users[userId]))) return;
      for (const x of db.messages) if (x.id === ev.id || x.threadId === ev.id) preserve(x);
      db.messages = db.messages.filter((x) => x.id !== ev.id && x.threadId !== ev.id);
      if (m.userId !== userId) audit(userId, 'message.delete', `Removed a message by ${db.users[m.userId]?.name ?? m.userId}`);
      const ch = db.channels[m.channelId];
      if (ch) broadcastChannel(ch, { t: 'messageDeleted', id: m.id });
      persist();
      return;
    }
    case 'react': {
      const m = db.messages.find((x) => x.id === ev.id);
      if (!m) return;
      const list = m.reactions[ev.emoji] ?? [];
      m.reactions[ev.emoji] = list.includes(userId) ? list.filter((u) => u !== userId) : [...list, userId];
      if (m.reactions[ev.emoji].length === 0) delete m.reactions[ev.emoji];
      const ch = db.channels[m.channelId];
      if (ch) broadcastChannel(ch, { t: 'message', message: m });
      persist();
      return;
    }
    case 'pin': {
      const m = db.messages.find((x) => x.id === ev.id);
      if (!m) return;
      m.pinned = !m.pinned;
      const ch = db.channels[m.channelId];
      if (ch) broadcastChannel(ch, { t: 'message', message: m });
      persist();
      return;
    }
    case 'save': {
      const list = db.saved[userId] ?? [];
      db.saved[userId] = list.includes(ev.id) ? list.filter((i) => i !== ev.id) : [...list, ev.id];
      send(ws, { t: 'saved', saved: db.saved[userId] });
      persist();
      return;
    }
    case 'createChannel': {
      const name = ev.name.toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
      if (!name) {
        send(ws, { t: 'error', message: 'Channel name required' });
        return;
      }
      if (Object.values(db.channels).some((c) => c.name === name && c.kind !== 'dm')) {
        send(ws, { t: 'error', message: `#${name} already exists` });
        return;
      }
      const ch: Channel = {
        id: randomUUID(),
        name,
        topic: ev.topic.slice(0, 200),
        kind: ev.kind === 'private' ? 'private' : 'public',
        members: [userId],
        createdAt: Date.now(),
      };
      db.channels[ch.id] = ch;
      broadcastChannel(ch, { t: 'channel', channel: ch });
      audit(userId, 'channel.create', `${ch.kind} #${ch.name}`);
      persist();
      return;
    }
    case 'join': {
      const ch = db.channels[ev.channelId];
      if (!ch || ch.kind !== 'public' || !canSee(ch, userId)) return;
      ensureMember(ch, userId);
      broadcastChannel(ch, { t: 'channel', channel: ch });
      postMessage(ch.id, BOT_ID, `<@${userId}> joined the channel.`, { system: true });
      persist();
      return;
    }
    case 'leave': {
      const ch = db.channels[ev.channelId];
      if (!ch || ch.kind === 'dm') return;
      ch.members = ch.members.filter((u) => u !== userId);
      broadcastChannel(ch, { t: 'channel', channel: ch });
      persist();
      return;
    }
    case 'openDM': {
      if (!db.users[ev.userId]) return;
      if (barred(userId, ev.userId, db.groups, db.settings.barriers)) {
        send(ws, { t: 'error', message: 'An information barrier blocks DMs with this person.' });
        return;
      }
      openDM(userId, ev.userId);
      return;
    }
    case 'typing': {
      const ch = db.channels[ev.channelId];
      if (!ch || !canSee(ch, userId)) return;
      broadcast({ t: 'typing', channelId: ch.id, userId }, (uid) => uid !== userId && canSee(ch, uid));
      return;
    }
    case 'profile': {
      const user = db.users[userId];
      if (ev.name !== undefined) user.name = ev.name.trim().slice(0, 40) || user.name;
      if (ev.title !== undefined) user.title = ev.title.slice(0, 80);
      if (ev.status) user.status = { emoji: ev.status.emoji.slice(0, 8), text: ev.status.text.slice(0, 80) };
      broadcast({ t: 'user', user });
      persist();
      return;
    }
    case 'canvas': {
      const ch = db.channels[ev.channelId];
      if (!ch || !canSee(ch, userId)) return;
      db.canvases[ch.id] = ev.content.slice(0, 100_000);
      broadcastChannel(ch, { t: 'canvas', channelId: ch.id, content: db.canvases[ch.id] });
      persist();
      return;
    }
    case 'workflows': {
      if (db.users[userId]?.role === 'guest') return;
      db.workflows = ev.list.slice(0, 50).map((w) => ({ ...w, id: w.id || randomUUID() }));
      broadcast({ t: 'workflows', list: db.workflows });
      audit(userId, 'workflows.publish', `${db.workflows.length} workflows`);
      persist();
      return;
    }
    case 'schedule': {
      const ch = db.channels[ev.channelId];
      if (!ch || !canSee(ch, userId) || !ev.text.trim() || ev.at < Date.now()) return;
      db.scheduled.push({ id: randomUUID(), channelId: ch.id, userId, text: ev.text, at: ev.at });
      sendScheduled(userId);
      persist();
      return;
    }
    case 'unschedule': {
      db.scheduled = db.scheduled.filter((s) => !(s.id === ev.id && s.userId === userId));
      sendScheduled(userId);
      persist();
      return;
    }
    case 'huddle': {
      const ch = db.channels[ev.channelId];
      if (!ch || !canSee(ch, userId)) return;
      const other = ch.kind === 'dm' ? ch.members.find((u) => u !== userId) : undefined;
      if (ev.action === 'join' && other && barred(userId, other, db.groups, db.settings.barriers)) {
        send(ws, { t: 'error', message: 'An information barrier blocks huddles between you two.' });
        return;
      }
      toggleHuddle(ch.id, userId, ev.action);
      return;
    }
    case 'list': {
      const ch = db.channels[ev.channelId];
      if (!ch || !canSee(ch, userId)) return;
      db.lists[ch.id] = ev.items.slice(0, 500).map((it) => ({
        id: it.id || randomUUID(),
        title: String(it.title).slice(0, 200),
        done: it.status === 'done',
        assignee: db.users[it.assignee] ? it.assignee : '',
        due: String(it.due).slice(0, 10),
        status: it.status === 'doing' || it.status === 'done' ? it.status : 'todo',
      }));
      broadcastChannel(ch, { t: 'lists', channelId: ch.id, items: db.lists[ch.id] });
      persist();
      return;
    }
    case 'sections': {
      db.sections[userId] = ev.sections.slice(0, 30).map((sec) => ({
        id: sec.id || randomUUID(),
        name: String(sec.name).slice(0, 40) || 'Section',
        channelIds: sec.channelIds.filter((cid) => db.channels[cid]),
      }));
      send(ws, { t: 'sections', sections: db.sections[userId] });
      persist();
      return;
    }
    case 'groups': {
      if (!isAdmin(db.users[userId])) return;
      db.groups = ev.groups.slice(0, 100).map((g) => ({
        id: g.id || randomUUID(),
        handle: g.handle.toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 30) || 'group',
        name: String(g.name).slice(0, 60),
        members: g.members.filter((u) => db.users[u]),
      }));
      broadcast({ t: 'groups', groups: db.groups });
      audit(userId, 'groups.update', `${db.groups.length} user groups`);
      persist();
      return;
    }
    case 'flag': {
      const m = db.messages.find((x) => x.id === ev.id);
      if (!m || !db.channels[m.channelId] || !canSee(db.channels[m.channelId], userId)) return;
      db.flags.push({
        id: randomUUID(),
        messageId: m.id,
        channelId: m.channelId,
        by: userId,
        reason: ev.reason.slice(0, 200),
        ts: Date.now(),
        excerpt: m.text.slice(0, 200),
      });
      audit(userId, 'message.flag', ev.reason.slice(0, 80));
      persist();
      return;
    }
    case 'resolveFlag': {
      if (!isAdmin(db.users[userId])) return;
      const flag = db.flags.find((f) => f.id === ev.id);
      if (!flag) return;
      db.flags = db.flags.filter((f) => f.id !== ev.id);
      if (ev.removeMessage) {
        const m = db.messages.find((x) => x.id === flag.messageId);
        if (m) {
          preserve(m);
          db.messages = db.messages.filter((x) => x.id !== m.id && x.threadId !== m.id);
          const ch = db.channels[m.channelId];
          if (ch) broadcastChannel(ch, { t: 'messageDeleted', id: m.id });
        }
      }
      audit(userId, 'flag.resolve', ev.removeMessage ? 'Removed flagged message' : 'Dismissed flag');
      persist();
      return;
    }
    case 'role': {
      const actor = db.users[userId];
      const target = db.users[ev.userId];
      if (!isAdmin(actor) || !target || target.bot) return;
      // Only owners can grant or revoke admin rights, and nobody can demote the last owner.
      if ((ev.role === 'owner' || target.role === 'owner' || target.role === 'admin' || ev.role === 'admin') && actor?.role !== 'owner') {
        send(ws, { t: 'error', message: 'Only an owner can change admin or owner roles.' });
        return;
      }
      const owners = Object.values(db.users).filter((u) => u.role === 'owner');
      if (target.role === 'owner' && ev.role !== 'owner' && owners.length === 1) {
        send(ws, { t: 'error', message: 'The workspace needs at least one owner.' });
        return;
      }
      target.role = ev.role;
      broadcast({ t: 'user', user: target });
      audit(userId, 'user.role', `${target.name} → ${ev.role}`);
      resendInit(target.id);
      persist();
      return;
    }
    case 'channelPolicy': {
      const ch = db.channels[ev.channelId];
      if (!ch || ch.kind === 'dm' || !isAdmin(db.users[userId])) return;
      ch.postingPolicy = ev.postingPolicy === 'admins' ? 'admins' : 'everyone';
      broadcastChannel(ch, { t: 'channel', channel: ch });
      audit(userId, 'channel.policy', `#${ch.name}: ${ch.postingPolicy} can post`);
      persist();
      return;
    }
    case 'addMember': {
      const ch = db.channels[ev.channelId];
      if (!ch || ch.kind === 'dm' || !db.users[ev.userId] || !ch.members.includes(userId)) return;
      if (db.users[ev.userId].role === 'guest' && !isAdmin(db.users[userId])) {
        send(ws, { t: 'error', message: 'Only admins can add guests to channels.' });
        return;
      }
      ensureMember(ch, ev.userId);
      broadcastChannel(ch, { t: 'channel', channel: ch });
      resendInit(ev.userId);
      postMessage(ch.id, BOT_ID, `<@${userId}> added <@${ev.userId}>.`, { system: true });
      audit(userId, 'channel.addMember', `${db.users[ev.userId].name} → #${ch.name}`);
      return;
    }
    case 'settings': {
      if (!isAdmin(db.users[userId])) return;
      const terms = ev.settings.terms.slice(0, 20_000);
      db.settings = {
        retentionDays: Math.max(0, Math.min(3650, Math.floor(ev.settings.retentionDays) || 0)),
        terms,
        termsVersion: terms !== db.settings.terms ? db.settings.termsVersion + 1 : db.settings.termsVersion,
        barriers: ev.settings.barriers.filter(([a, b]) => a !== b && db.groups.some((g) => g.id === a) && db.groups.some((g) => g.id === b)),
      };
      broadcast({ t: 'settings', settings: db.settings });
      audit(userId, 'settings.update', `retention ${db.settings.retentionDays || '∞'}d, ${db.settings.barriers.length} barriers, terms v${db.settings.termsVersion}`);
      applyRetention();
      persist();
      return;
    }
    case 'legalHold': {
      if (!isAdmin(db.users[userId]) || !db.users[ev.userId]) return;
      db.legalHolds = ev.on ? [...new Set([...db.legalHolds, ev.userId])] : db.legalHolds.filter((u) => u !== ev.userId);
      audit(userId, ev.on ? 'legalHold.place' : 'legalHold.release', db.users[ev.userId].name);
      persist();
      return;
    }
    case 'acceptTerms': {
      db.termsAccepted[userId] = db.settings.termsVersion;
      send(ws, { t: 'termsAccepted', version: db.settings.termsVersion });
      persist();
      return;
    }
    case 'fileSummary': {
      const m = db.messages.find((x) => x.id === ev.id);
      const file = m?.files?.[ev.index];
      if (!m || !file || !canSee(db.channels[m.channelId], userId)) return;
      const isText = /^text\/|json|xml|csv|markdown|javascript/.test(file.type) || /\.(md|txt|csv|json|log|ts|js|py)$/i.test(file.name);
      if (!isText) {
        send(ws, { t: 'error', message: `Can't summarize ${file.name}: only text files are supported.` });
        return;
      }
      const base64 = file.dataUrl.slice(file.dataUrl.indexOf(',') + 1);
      const text = Buffer.from(base64, 'base64').toString('utf8');
      postMessage(m.channelId, BOT_ID, `**Summary of ${file.name}**\n${summarizeText(text)}`, { threadId: m.threadId ?? m.id });
      return;
    }
    case 'analytics': {
      if (!isAdmin(db.users[userId])) return;
      send(ws, { t: 'analytics', data: computeAnalytics(db.messages, db.channels, db.users, Date.now()) });
      return;
    }
    case 'export': {
      if (!isAdmin(db.users[userId])) return;
      audit(userId, 'data.export', 'Full workspace export');
      const { users, channels, messages, canvases, lists, groups, preserved } = db;
      send(ws, { t: 'export', data: { exportedAt: new Date().toISOString(), users, channels, messages, canvases, lists, groups, preserved } });
      return;
    }
  }
}

function applyRetention(): void {
  const { kept, removed } = pruneRetention(db.messages, db.settings.retentionDays, db.legalHolds, Date.now());
  if (removed === 0) return;
  const keptIds = new Set(kept.map((m) => m.id));
  const gone = db.messages.filter((m) => !keptIds.has(m.id));
  db.messages = kept;
  for (const m of gone) {
    const ch = db.channels[m.channelId];
    if (ch) broadcastChannel(ch, { t: 'messageDeleted', id: m.id });
  }
  audit('system', 'retention.prune', `Deleted ${removed} messages older than ${db.settings.retentionDays} days`);
  persist();
}

const huddleSessions = new Map<string, { startedAt: number; everyone: Set<string> }>();

function toggleHuddle(channelId: string, userId: string, action: 'join' | 'leave'): void {
  const set = huddles.get(channelId) ?? new Set<string>();
  if (action === 'join') set.add(userId);
  else set.delete(userId);
  huddles.set(channelId, set);
  if (action === 'join') {
    const session = huddleSessions.get(channelId) ?? { startedAt: Date.now(), everyone: new Set<string>() };
    session.everyone.add(userId);
    huddleSessions.set(channelId, session);
  }
  if (set.size === 0) endHuddle(channelId);
  broadcast({ t: 'huddles', huddles: huddleList() });
}

function endHuddle(channelId: string): void {
  const session = huddleSessions.get(channelId);
  huddleSessions.delete(channelId);
  if (!session || !db.channels[channelId]) return;
  const now = Date.now();
  if (now - session.startedAt < 30_000) return;
  postMessage(channelId, BOT_ID, huddleNote(channelId, session.startedAt, now, [...session.everyone], db.messages, db.users), { system: true });
}

function openDM(a: string, b: string): Channel {
  const id = dmId(a, b);
  let ch = db.channels[id];
  if (!ch) {
    ch = { id, name: id, topic: '', kind: 'dm', members: [...new Set([a, b])], createdAt: Date.now() };
    db.channels[id] = ch;
    persist();
  }
  broadcastChannel(ch, { t: 'channel', channel: ch });
  return ch;
}

function sendScheduled(userId: string): void {
  const list = db.scheduled.filter((s) => s.userId === userId);
  for (const [ws, uid] of clients) if (uid === userId) send(ws, { t: 'scheduled', list });
}

setInterval(() => {
  const due = db.scheduled.filter((s) => s.at <= Date.now());
  if (due.length === 0) return;
  db.scheduled = db.scheduled.filter((s) => s.at > Date.now());
  for (const s of due) {
    const asBot = s.channelId === dmId(s.userId, BOT_ID);
    postMessage(s.channelId, asBot ? BOT_ID : s.userId, s.text);
    sendScheduled(s.userId);
  }
  persist();
}, 1000);

setInterval(applyRetention, 60 * 60_000);

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, users: Object.keys(db.users).length, messages: db.messages.length }));
    return;
  }
  if (!fs.existsSync(distDir)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Relay API running. Start the UI with `npm run dev:web` or build with `npm run build`.');
    return;
  }
  const requested = path.normalize(path.join(distDir, url.pathname === '/' ? 'index.html' : url.pathname));
  const file = requested.startsWith(distDir) && fs.existsSync(requested) && fs.statSync(requested).isFile()
    ? requested
    : path.join(distDir, 'index.html');
  res.writeHead(200, { 'content-type': mime[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 12 * 1024 * 1024 });
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let ev: ClientEvent;
    try {
      ev = JSON.parse(raw.toString()) as ClientEvent;
    } catch (err) {
      send(ws, { t: 'error', message: `Bad JSON: ${(err as Error).message}` });
      return;
    }
    try {
      handle(ws, ev);
    } catch (err) {
      console.error('handler failed:', err);
      send(ws, { t: 'error', message: 'Server error' });
    }
  });
  ws.on('close', () => {
    const uid = clients.get(ws);
    clients.delete(ws);
    if (uid && !onlineIds().includes(uid)) {
      for (const [cid, set] of huddles) if (set.delete(uid) && set.size === 0) endHuddle(cid);
      broadcast({ t: 'huddles', huddles: huddleList() });
    }
    broadcast({ t: 'presence', online: onlineIds() });
  });
});

server.listen(PORT, () => console.log(`Relay server on http://localhost:${PORT}`));
