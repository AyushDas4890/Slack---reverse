export type Slash =
  | { kind: 'remind'; text: string; inMs: number; label: string }
  | { kind: 'topic'; text: string }
  | { kind: 'huddle' }
  | { kind: 'summarize' }
  | { kind: 'recap' }
  | { kind: 'explain'; term: string }
  | { kind: 'say'; text: string }
  | { kind: 'usage'; text: string };

const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export function parseSlash(input: string): Slash | null {
  const text = input.trim();
  if (!text.startsWith('/')) return null;
  const [cmd, ...rest] = text.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim();
  switch (cmd) {
    case 'remind': {
      const m = arg.match(/^(?:me\s+)?(.+?)\s+in\s+(\d+)\s*([smhd])$/i);
      if (!m) return { kind: 'usage', text: 'Usage: /remind me <what> in <10m|2h|1d>' };
      const n = Number(m[2]);
      const unit = m[3].toLowerCase();
      return { kind: 'remind', text: m[1], inMs: n * UNITS[unit], label: `${n}${unit}` };
    }
    case 'topic':
      return arg ? { kind: 'topic', text: arg } : { kind: 'usage', text: 'Usage: /topic <new topic>' };
    case 'huddle':
      return { kind: 'huddle' };
    case 'summarize':
      return { kind: 'summarize' };
    case 'recap':
      return { kind: 'recap' };
    case 'explain':
      return arg ? { kind: 'explain', term: arg } : { kind: 'usage', text: 'Usage: /explain <term>' };
    case 'shrug':
      return { kind: 'say', text: `${arg} ¯\\_(ツ)_/¯`.trim() };
    case 'me':
      return { kind: 'say', text: `_${arg}_` };
    default:
      return null;
  }
}
