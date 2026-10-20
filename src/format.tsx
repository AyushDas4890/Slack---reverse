import type { ReactNode } from 'react';
import type { Channel, User, UserGroup } from './types.ts';

export const EMOJI = ['👍', '❤️', '😂', '🎉', '🙏', '👀', '🔥', '✅', '🚀', '😮', '😢', '💯'];

export function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function channelLabel(ch: Channel, users: Record<string, User>, me: string): string {
  if (ch.kind !== 'dm') return ch.name;
  const other = ch.members.find((m) => m !== me) ?? me;
  return users[other]?.name ?? 'Unknown';
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(_[^_\n]+_)|(~[^~\n]+~)|(<@[\w-]+>)|(<!g:[\w-]+>)|(https?:\/\/[^\s<]+)|(#[a-z0-9_-]+)/gi;

function inline(text: string, users: Record<string, User>, keyBase: string, groups: UserGroup[] = []): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(INLINE)) {
    const tok = match[0];
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith('`')) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('_')) out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    else if (tok.startsWith('~')) out.push(<s key={key}>{tok.slice(1, -1)}</s>);
    else if (tok.startsWith('<!g:')) {
      const id = tok.slice(4, -1);
      out.push(
        <span key={key} className="mention group">
          @{groups.find((g) => g.id === id)?.handle ?? 'group'}
        </span>,
      );
    } else if (tok.startsWith('<@')) {
      const id = tok.slice(2, -1);
      out.push(
        <span key={key} className="mention">
          @{users[id]?.name ?? 'unknown'}
        </span>,
      );
    } else if (tok.startsWith('http')) {
      out.push(
        <a key={key} href={tok} target="_blank" rel="noreferrer noopener">
          {tok}
        </a>,
      );
    } else out.push(<span key={key} className="chan-ref">{tok}</span>);
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text, users, groups }: { text: string; users: Record<string, User>; groups?: UserGroup[] }) {
  const parts = text.split(/```/);
  return (
    <>
      {parts.map((part, idx) => {
        if (idx % 2 === 1) {
          return (
            <pre key={idx}>
              <code>{part.replace(/^\n/, '')}</code>
            </pre>
          );
        }
        return (
          <span key={idx}>
            {part.split('\n').map((line, li) => (
              <span key={li}>
                {li > 0 && <br />}
                {line.startsWith('> ') ? (
                  <span className="quote">{inline(line.slice(2), users, `${idx}-${li}`, groups)}</span>
                ) : (
                  inline(line, users, `${idx}-${li}`, groups)
                )}
              </span>
            ))}
          </span>
        );
      })}
    </>
  );
}

export function renderCanvas(text: string, users: Record<string, User>): ReactNode {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = (key: string) => {
    if (list.length) {
      blocks.push(
        <ul key={key}>
          {list.map((l, i) => (
            <li key={i}>{inline(l, users, `${key}-${i}`)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  lines.forEach((line, i) => {
    const key = `c${i}`;
    if (/^[-*] /.test(line)) {
      list.push(line.slice(2));
      return;
    }
    flush(`l${i}`);
    if (line.startsWith('# ')) blocks.push(<h1 key={key}>{line.slice(2)}</h1>);
    else if (line.startsWith('## ')) blocks.push(<h2 key={key}>{line.slice(3)}</h2>);
    else if (line.trim()) blocks.push(<p key={key}>{inline(line, users, key)}</p>);
  });
  flush('end');
  return blocks;
}
