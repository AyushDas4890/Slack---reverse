# Relay

A Slack-style team chat, rebuilt from public product behavior with every premium capability unlocked and a new UI.

Built from publicly known Slack behavior only. No Slack code, assets, or private APIs were inspected or copied. The sandbox that built this could not reach slack.com, so no site crawl was done.

## Run

```
npm install
npm run dev        # API+WS on :8787, UI on :5173
npm run build && npm start   # single server on :8787
npm run lint       # tsc --noEmit
npm test
```

State persists to `data/db.json`.

## Deploy (UI on Vercel, server elsewhere)

Relay needs a long-running server for WebSockets and a disk for state, so it can't run on Vercel functions. Host the server on a WebSocket-capable host and the UI on Vercel.

1. **Server:** on Render, create a Blueprint from this repo (`render.yaml`). It builds, starts `npm start`, health-checks `/healthz`, and stores state in `DATA_DIR` on a persistent disk. Any Node host works: build with `npm run build`, run `npm start`, set `PORT` and `DATA_DIR`.
2. **UI:** in Vercel, import the repo (framework Vite, `vercel.json` is included) and set `VITE_WS_URL=wss://<your-server-host>/ws`. Redeploy after changing it, since it is baked in at build time.

The server also serves the built UI itself, so you can skip Vercel and use the server URL directly.

## Features (all unlocked)

Channels (public/private), DMs, threads, reactions, edit/delete, pins, saved items, mentions, rich text, file attachments, presence and typing, unread badges, Cmd/Ctrl+K search, huddles with mic meter, canvases, Workflow Builder, scheduled messages, `/remind` `/topic` `/me` `/shrug` `/huddle` `/summarize`, four themes.

## Premium feature coverage

Mapped from the public plan-comparison page (`docs/slack/pricing.md`). Everything runs locally with no seat limits.

| Area | What Relay has |
| --- | --- |
| Productivity | Lists (board by status, assignee, due date), custom sidebar sections, user groups with `@handle` mentions, audio and screen clips, huddle notes posted when a huddle ends |
| AI-style | `/recap` daily recap, `/explain <term>`, thread and channel summaries, file summaries for text files, "best answer" when a search ends in `?`. All are local heuristics, not an LLM |
| Automation | Workflow Builder with conditional branching and starter templates |
| Security and admin | Roles (owner, admin, member, guest), guests see only channels they were added to, admins-only posting, admin console with analytics, audit log, flagged content review |
| Compliance | Retention policy, legal holds that preserve edited and deleted messages, information barriers between user groups, custom terms of service with re-acceptance, full JSON data export |

Not built because they need external services or a multi-org backend: Slack Connect, SSO and SCIM, EKM, DLP scanning, data residency, Salesforce/CRM, the app directory, and multiple workspaces. The first person to sign in becomes the owner.

## Notes

- Identity is a name stored in localStorage. No auth: run behind a trusted network.
- Huddles share presence and use the local mic for a level meter. No audio is relayed between users yet.
- `/summarize` is a local heuristic recap, not an LLM.
