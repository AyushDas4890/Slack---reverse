import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { mentionsUser } from './premium.ts';
import type { Analytics, ClientEvent, ServerEvent, Snapshot } from './types.ts';

interface State {
  snap: Snapshot | null;
  typing: Record<string, Record<string, number>>;
  error: string | null;
  analytics: Analytics | null;
}

type Action = { ev: ServerEvent } | { clearError: true } | { expireTyping: number };

function reduce(state: State, action: Action): State {
  if ('clearError' in action) return { ...state, error: null };
  if ('expireTyping' in action) {
    const typing: State['typing'] = {};
    for (const [ch, users] of Object.entries(state.typing)) {
      const live = Object.fromEntries(Object.entries(users).filter(([, ts]) => ts > action.expireTyping));
      if (Object.keys(live).length) typing[ch] = live;
    }
    return { ...state, typing };
  }
  const ev = action.ev;
  if (ev.t === 'init') return { ...state, snap: ev.snapshot };
  if (ev.t === 'error') return { ...state, error: ev.message };
  if (ev.t === 'analytics') return { ...state, analytics: ev.data };
  const snap = state.snap;
  if (!snap) return state;
  switch (ev.t) {
    case 'user':
      return { ...state, snap: { ...snap, users: { ...snap.users, [ev.user.id]: ev.user } } };
    case 'presence':
      return { ...state, snap: { ...snap, online: ev.online } };
    case 'channel':
      return { ...state, snap: { ...snap, channels: { ...snap.channels, [ev.channel.id]: ev.channel } } };
    case 'message': {
      const exists = snap.messages.some((m) => m.id === ev.message.id);
      const messages = exists
        ? snap.messages.map((m) => (m.id === ev.message.id ? ev.message : m))
        : [...snap.messages, ev.message];
      return { ...state, snap: { ...snap, messages } };
    }
    case 'messageDeleted':
      return {
        ...state,
        snap: { ...snap, messages: snap.messages.filter((m) => m.id !== ev.id && m.threadId !== ev.id) },
      };
    case 'canvas':
      return { ...state, snap: { ...snap, canvases: { ...snap.canvases, [ev.channelId]: ev.content } } };
    case 'workflows':
      return { ...state, snap: { ...snap, workflows: ev.list } };
    case 'scheduled':
      return { ...state, snap: { ...snap, scheduled: ev.list } };
    case 'huddles':
      return { ...state, snap: { ...snap, huddles: ev.huddles } };
    case 'saved':
      return { ...state, snap: { ...snap, saved: ev.saved } };
    case 'lists':
      return { ...state, snap: { ...snap, lists: { ...snap.lists, [ev.channelId]: ev.items } } };
    case 'sections':
      return { ...state, snap: { ...snap, sections: ev.sections } };
    case 'groups':
      return { ...state, snap: { ...snap, groups: ev.groups } };
    case 'settings':
      return { ...state, snap: { ...snap, settings: ev.settings } };
    case 'termsAccepted':
      return { ...state, snap: { ...snap, termsAccepted: ev.version } };
    case 'admin':
      return { ...state, snap: { ...snap, admin: ev.admin } };
    case 'typing':
      return {
        ...state,
        typing: {
          ...state.typing,
          [ev.channelId]: { ...state.typing[ev.channelId], [ev.userId]: Date.now() + 3500 },
        },
      };
    default:
      return state;
  }
}

function downloadJson(data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `relay-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function getIdentity(): { userId: string; name: string } | null {
  try {
    const raw = localStorage.getItem('relay.identity');
    return raw ? (JSON.parse(raw) as { userId: string; name: string }) : null;
  } catch (err) {
    console.warn('identity unreadable', err);
    return null;
  }
}

export function saveIdentity(name: string): { userId: string; name: string } {
  const existing = getIdentity();
  const identity = { userId: existing?.userId ?? crypto.randomUUID(), name };
  localStorage.setItem('relay.identity', JSON.stringify(identity));
  return identity;
}

export function useRelay(identity: { userId: string; name: string } | null) {
  const [state, dispatch] = useReducer(reduce, { snap: null, typing: {}, error: null, analytics: null });
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!identity) return;
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      // Set VITE_WS_URL when the UI is hosted apart from the server (e.g. UI on Vercel).
      const ws = new WebSocket(import.meta.env.VITE_WS_URL || `${proto}://${location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
        ws.send(JSON.stringify({ t: 'hello', userId: identity.userId, name: identity.name } satisfies ClientEvent));
      };
      ws.onmessage = (e) => {
        const ev = JSON.parse(e.data as string) as ServerEvent;
        if (ev.t === 'export') downloadJson(ev.data);
        else dispatch({ ev });
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        retry += 1;
        timer = setTimeout(connect, Math.min(1000 * 2 ** retry, 10_000));
      };
    };
    connect();
    const sweep = setInterval(() => dispatch({ expireTyping: Date.now() }), 1000);
    return () => {
      closed = true;
      clearTimeout(timer);
      clearInterval(sweep);
      wsRef.current?.close();
    };
  }, [identity?.userId]);

  const send = useCallback((ev: ClientEvent) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(ev));
    else console.warn('socket not open, dropped', ev.t);
  }, []);

  const clearError = useCallback(() => dispatch({ clearError: true }), []);

  return { snap: state.snap, typing: state.typing, error: state.error, analytics: state.analytics, connected, send, clearError };
}

export function useLastRead() {
  const [lastRead, setLastRead] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem('relay.lastRead') ?? '{}') as Record<string, number>;
    } catch (err) {
      console.warn('lastRead unreadable', err);
      return {};
    }
  });
  const markRead = useCallback((channelId: string) => {
    setLastRead((prev) => {
      const next = { ...prev, [channelId]: Date.now() };
      localStorage.setItem('relay.lastRead', JSON.stringify(next));
      return next;
    });
  }, []);
  return { lastRead, markRead };
}

export function useUnread(snap: Snapshot | null, lastRead: Record<string, number>) {
  return useMemo(() => {
    const out: Record<string, { count: number; mentions: number }> = {};
    if (!snap) return out;
    for (const m of snap.messages) {
      if (m.userId === snap.me || m.threadId || m.system) continue;
      const seen = lastRead[m.channelId] ?? 0;
      if (m.ts <= seen) continue;
      const entry = (out[m.channelId] ??= { count: 0, mentions: 0 });
      entry.count += 1;
      if (mentionsUser(m.text, snap.me, snap.groups)) entry.mentions += 1;
    }
    return out;
  }, [snap, lastRead]);
}
