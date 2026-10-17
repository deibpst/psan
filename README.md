# psan

A shared task, calendar and list app for one household, built as a progressive web app with no runtime dependencies at all.

## Why this exists

Keeping a house in order is a coordination problem, not a productivity problem. Three people need to see the same tasks, know who is responsible for what, and get told when something changes or is about to be due. Every off-the-shelf option solves this by asking the family to adopt an account system, a subscription and a feature surface built for software teams.

psan is the opposite bet: the smallest possible app that actually covers the real workflow. Each person signs in with a PIN, sees everything the household is doing, and receives a push notification the moment a task is assigned, completed, edited or deleted, plus a daily reminder for anything due or overdue. Nothing is lost: every task keeps a full revision history of who changed it and when, and deletions are soft.

The second reason it exists is as an engineering exercise with a deliberate constraint: **zero runtime dependencies**. No framework, no bundler, no build step, no ORM, no push library. Around 3,700 lines of TypeScript, vanilla ES modules and CSS, running on platform primitives only. Web Push, including VAPID request signing, is implemented from the RFCs with WebCrypto. The result is an app that loads instantly, cannot rot from a dependency tree, and can be read end to end in an afternoon.

## What it does

- **Tasks** with title, notes, due date, status (pending, in progress, done), multiple assignees and optional recurrence (daily, weekly, biweekly, monthly).
- **Urgency signalling**: tasks are colour coded by calendar days remaining, computed in the household's timezone rather than the device's.
- **Recurrence that behaves**: completing a recurring task spawns the next occurrence at a strictly future date, so a task finished late never reappears already overdue.
- **Calendar view** of everything with a due date, and **shared checklists** for groceries and similar.
- **Audit trail**: every edit writes the complete previous row to a revisions table as JSONB, and status changes record who made them. Deletes are soft, so nothing is ever truly gone.
- **Push notifications** per event, plus a daily cron reminder for due and overdue work.
- **Installable PWA** with an offline app shell, maskable icons and a self hosted variable font.

## Architecture

```
public/            Static PWA: no build step, imported as ES modules
  app.js           Shell: hash router, session lifecycle, push toggle, date and urgency logic
  views/           One render function per view (tasks, calendar, lists, login)
  sw.js            Service worker: cache-first shell, network-only API, push handler
api/               Vercel functions, one file per route, Web standard Request/Response
  tasks/           CRUD plus revisions, recurrence and notification fan-out
  lists/           Lists and their items
  cron/notify.ts   Daily due-date reminder, cron-secret protected
lib/
  db.ts            Bun.sql connection and idempotent migrations
  auth.ts          Sessions, sliding idle expiration
  push.ts          Web Push and VAPID, written from the RFCs
```

**Runtime**: Bun on Vercel Functions, Neon serverless Postgres, Vercel Cron.

**No server framework.** Every endpoint is a function taking a `Request` and returning a `Response`. Routing is the filesystem.

**No ORM, no query builder.** `Bun.sql` tagged templates, parameterised throughout. Schema lives in one idempotent `migrate()` of `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS` statements, so deploys are safe to repeat and migrations are never destructive: when single assignment became multi assignment, the old column was left in place rather than dropped.

**No frontend framework and no bundler.** The browser loads ES modules directly. Views are functions that render HTML strings into a section element. State is the server.

**No push library.** `lib/push.ts` builds and ES256-signs the VAPID JWT with WebCrypto and posts to the subscription endpoint per RFC 8030 and RFC 8292, in 74 lines. Dead subscriptions clean themselves up on 404 and 410.

## Notable design decisions

**Payload-free push.** Notifications are sent with no body. The server stores the message, the push wakes the device, and the service worker fetches the text from `GET /api/notifications` using the session cookie. Two consequences: notification content never passes through a third party push service, and the delivery endpoint marks messages read in a single `UPDATE ... RETURNING`, so two devices belonging to the same person cannot both claim the same notification.

**Sliding idle sessions.** Sessions carry an `expires_at` refreshed on every authenticated request. The server deletes an expired session on first touch, and the client runs the same timeout locally from a value the API reports, so an idle tab returns to the login screen instead of sitting on stale data.

**Timezone discipline.** The household is in one timezone, so all date arithmetic is explicitly `America/Mexico_City` via `Intl.DateTimeFormat`, on the server, in the client and in the service worker. Day differences are computed from midnight UTC anchors so a calendar-day delta is exact subtraction rather than a daylight saving puzzle.

**Threat model matched to scale.** Login is rate limited per name rather than per IP, which is sufficient and simpler for a fixed set of three known users. PINs are hashed with `Bun.password`. Cookies are `HttpOnly`, `Secure`, `SameSite=Lax`. The cron endpoint requires a bearer secret.

**Shortcuts are written down.** Where a lazier path was taken on purpose, the limit is recorded in a comment next to the code rather than left for a reader to discover. Monthly recurrence uses `setMonth`, so 31 January plus one month lands in March, and that is stated and accepted.

## Testing

Twenty integration tests run against a real Postgres database, not mocks: authentication and session expiry, authorisation on every protected endpoint, validation failures, the full task lifecycle including revisions and status attribution, multi-assignee filtering, notification fan-out rules, recurrence rollover, push subscription handling, cron authorisation, and lists with their items.

```bash
bun install
bun run seed    # create users and demo data
bun test
bun run vercel:dev
```

Requires `DATABASE_URL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `CRON_SECRET`.

## Ownership and copyright

Copyright (c) 2026 David Ponce Santos. All rights reserved.

This project, including its source code, design, assets and documentation, is my original work and my personal property. It is published for portfolio and reference purposes only. No licence is granted: you may not copy, modify, redistribute, host or use this code or design, in whole or in part, for any purpose without my prior written permission.

Contact: poncesantosdavid@gmail.com
