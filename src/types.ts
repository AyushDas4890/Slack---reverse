export interface UserStatus {
  emoji: string;
  text: string;
}

export type Role = 'owner' | 'admin' | 'member' | 'guest';

export interface User {
  id: string;
  name: string;
  color: string;
  title: string;
  status: UserStatus;
  bot?: boolean;
  role?: Role;
}

export type ChannelKind = 'public' | 'private' | 'dm';

export interface Channel {
  id: string;
  name: string;
  topic: string;
  kind: ChannelKind;
  members: string[];
  createdAt: number;
  postingPolicy?: 'everyone' | 'admins';
}

export interface FileAttachment {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

export interface Message {
  id: string;
  channelId: string;
  userId: string;
  text: string;
  ts: number;
  threadId?: string;
  reactions: Record<string, string[]>;
  edited?: boolean;
  pinned?: boolean;
  files?: FileAttachment[];
  system?: boolean;
}

export interface Workflow {
  id: string;
  name: string;
  enabled: boolean;
  trigger: { type: 'keyword'; keyword: string; channelId: string | 'any' } | { type: 'join'; channelId: string };
  reply: string;
  branch?: { contains: string; reply: string };
}

export interface ListItem {
  id: string;
  title: string;
  done: boolean;
  assignee: string;
  due: string;
  status: 'todo' | 'doing' | 'done';
}

export interface Section {
  id: string;
  name: string;
  channelIds: string[];
}

export interface UserGroup {
  id: string;
  handle: string;
  name: string;
  members: string[];
}

export interface Flag {
  id: string;
  messageId: string;
  channelId: string;
  by: string;
  reason: string;
  ts: number;
  excerpt: string;
}

export interface AuditEntry {
  ts: number;
  actor: string;
  action: string;
  detail: string;
}

export interface Settings {
  retentionDays: number;
  terms: string;
  termsVersion: number;
  barriers: [string, string][];
}

export interface AdminData {
  flags: Flag[];
  audit: AuditEntry[];
  legalHolds: string[];
  preservedCount: number;
}

export interface Scheduled {
  id: string;
  channelId: string;
  userId: string;
  text: string;
  at: number;
}

export interface HuddleState {
  channelId: string;
  participants: string[];
}

export const PLAN_FEATURES = [
  'Unlimited message history',
  'Unlimited huddles with screen share',
  'Canvases in every channel',
  'Workflow Builder',
  'Scheduled messages and reminders',
  'AI recaps and thread summaries',
  'Custom statuses and themes',
  'Unlimited file uploads',
  'Private channels and guest access',
  'Advanced search and saved items',
  'Lists, custom sidebar sections, and user groups',
  'Audio and screen clips, huddle notes',
  'Daily recaps, /explain, file summaries, search answers',
  'Conditional branching and workflow templates',
  'Roles, guests, and channel posting permissions',
  'Admin analytics, audit logs, and full data exports',
  'Retention policies, legal holds, and flagged content review',
  'Information barriers and custom terms of service',
] as const;

export interface Snapshot {
  me: string;
  workspace: { name: string; plan: string };
  users: Record<string, User>;
  online: string[];
  channels: Record<string, Channel>;
  messages: Message[];
  canvases: Record<string, string>;
  workflows: Workflow[];
  scheduled: Scheduled[];
  huddles: HuddleState[];
  saved: string[];
  lists: Record<string, ListItem[]>;
  sections: Section[];
  groups: UserGroup[];
  settings: Settings;
  termsAccepted: number;
  admin?: AdminData;
}

export type ClientEvent =
  | { t: 'hello'; userId: string; name: string }
  | { t: 'send'; channelId: string; text: string; threadId?: string; files?: FileAttachment[] }
  | { t: 'edit'; id: string; text: string }
  | { t: 'delete'; id: string }
  | { t: 'react'; id: string; emoji: string }
  | { t: 'pin'; id: string }
  | { t: 'save'; id: string }
  | { t: 'createChannel'; name: string; kind: 'public' | 'private'; topic: string }
  | { t: 'join'; channelId: string }
  | { t: 'leave'; channelId: string }
  | { t: 'openDM'; userId: string }
  | { t: 'typing'; channelId: string }
  | { t: 'profile'; name?: string; title?: string; status?: UserStatus }
  | { t: 'canvas'; channelId: string; content: string }
  | { t: 'workflows'; list: Workflow[] }
  | { t: 'schedule'; channelId: string; text: string; at: number }
  | { t: 'unschedule'; id: string }
  | { t: 'huddle'; channelId: string; action: 'join' | 'leave' }
  | { t: 'list'; channelId: string; items: ListItem[] }
  | { t: 'sections'; sections: Section[] }
  | { t: 'groups'; groups: UserGroup[] }
  | { t: 'flag'; id: string; reason: string }
  | { t: 'resolveFlag'; id: string; removeMessage: boolean }
  | { t: 'role'; userId: string; role: Role }
  | { t: 'channelPolicy'; channelId: string; postingPolicy: 'everyone' | 'admins' }
  | { t: 'addMember'; channelId: string; userId: string }
  | { t: 'settings'; settings: Omit<Settings, 'termsVersion'> }
  | { t: 'legalHold'; userId: string; on: boolean }
  | { t: 'acceptTerms' }
  | { t: 'fileSummary'; id: string; index: number }
  | { t: 'analytics' }
  | { t: 'export' };

export type ServerEvent =
  | { t: 'init'; snapshot: Snapshot }
  | { t: 'user'; user: User }
  | { t: 'presence'; online: string[] }
  | { t: 'channel'; channel: Channel }
  | { t: 'message'; message: Message }
  | { t: 'messageDeleted'; id: string }
  | { t: 'canvas'; channelId: string; content: string }
  | { t: 'workflows'; list: Workflow[] }
  | { t: 'scheduled'; list: Scheduled[] }
  | { t: 'typing'; channelId: string; userId: string }
  | { t: 'huddles'; huddles: HuddleState[] }
  | { t: 'saved'; saved: string[] }
  | { t: 'lists'; channelId: string; items: ListItem[] }
  | { t: 'sections'; sections: Section[] }
  | { t: 'groups'; groups: UserGroup[] }
  | { t: 'settings'; settings: Settings }
  | { t: 'termsAccepted'; version: number }
  | { t: 'admin'; admin: AdminData }
  | { t: 'analytics'; data: Analytics }
  | { t: 'export'; data: unknown }
  | { t: 'error'; message: string };

export interface Analytics {
  totalMessages: number;
  activeUsers7d: number;
  messagesByDay: { day: string; count: number }[];
  topChannels: { channelId: string; name: string; count: number }[];
  topPosters: { userId: string; name: string; count: number }[];
  filesShared: number;
  reactions: number;
}
