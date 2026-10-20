import { createContext, useContext } from 'react';
import type { Analytics, ClientEvent, Snapshot } from './types.ts';

export interface RelayCtx {
  snap: Snapshot;
  send: (ev: ClientEvent) => void;
  typing: Record<string, Record<string, number>>;
  openThread: (id: string | null) => void;
  openChannel: (id: string) => void;
  analytics: Analytics | null;
}

export const Ctx = createContext<RelayCtx | null>(null);

export function useRelayCtx(): RelayCtx {
  const value = useContext(Ctx);
  if (!value) throw new Error('useRelayCtx outside provider');
  return value;
}
