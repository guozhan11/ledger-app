# Weekly Ledger

A lightweight personal bookkeeping app for tracking account balances, net worth,
period-to-period changes, savings goals, and spending trends.

Try the public demo: [guozhan11.github.io/ledger-app](https://guozhan11.github.io/ledger-app/)

## Features

- Track multiple accounts and periodic balances
- Calculate net worth and trend-adjusted changes automatically
- Exclude one-time income or expenses from spending trends without changing the real account total
- Import CSV or Excel files and export CSV backups
- Set savings goals, target dates, and monthly fixed costs
- Install as a PWA on desktop or mobile
- Keep working from the local browser cache when cloud sync is unavailable; the
  core React runtime is bundled with the app instead of loaded from a CDN
- Synchronize an authenticated user's ledger across devices with Cloudflare

## Public demo and private sync

The GitHub Pages site is the public portfolio/demo version. Visitors can use it,
but their data stays in their own browser and is never shared with the project
owner.

The private deployment runs as the independent `ledger-app-sync` Cloudflare
Worker. Cloudflare Access protects the entire Worker URL, the API validates the
Access JWT signature and application audience, and each authenticated identity
gets a separate ledger row in the independent `ledger-sync` D1 database. It does
not reuse any PSC Docket Helper Worker, database, or storage binding.

## Architecture

- `index.html`: application UI, local cache, import/export, and sync client
- `service-worker.js`: PWA asset caching and offline shell
- `worker/index.ts`: authenticated `/api/ledger` API and static asset delivery
- `migrations/`: D1 schema for versioned per-user ledger snapshots
- `wrangler.jsonc`: Worker, assets, D1, Access, and observability configuration

Cloud writes use optimistic version checks so that edits from two devices do not
silently overwrite one another.

## Local development

```bash
npm install
npm run db:local
npm run dev
```

The local app is available at the URL printed by Wrangler. Local D1 data is kept
separate from the remote database.

## Deploy your own synchronized copy

The identifiers currently present in `wrangler.jsonc` belong to the existing
deployment. Replace them with resources from your own Cloudflare account before
deploying a fork.

1. Create a D1 database and copy its ID into `wrangler.jsonc`:

   ```bash
   npx wrangler d1 create ledger-sync
   ```

2. Set `SYNC_ENABLED` to `false`, then apply the schema and deploy:

   ```bash
   npm run db:remote
   npm run deploy
   ```

3. In the Cloudflare dashboard, open the new Worker, go to **Domains**, and
   change its `workers.dev` URL from **Public** to **Restricted**. Configure an
   Access Allow policy for the intended account or email.

4. Copy the Access team domain and Application Audience (`aud`) into
   `TEAM_DOMAIN` and `POLICY_AUD` in `wrangler.jsonc`.

5. Set `SYNC_ENABLED` to `true`, regenerate binding types, and deploy again:

   ```bash
   npx wrangler types
   npm run deploy
   ```

Do not enable cloud sync until Access is active. The Worker validates signed
Access application tokens before reading or writing any ledger data.

## Checks

```bash
npm run check
```

This runs the TypeScript check and a Wrangler deployment dry run.

## Installed app updates

The PWA checks for a new service worker whenever it opens. The Cloudflare build
inlines the core runtime into its HTML so an authenticated home-screen launch
does not depend on separate script requests. A newly deployed app shell replaces
the old cache and reloads once automatically. If an older iOS
home-screen installation ever remains stuck on a stale version, close it from
the app switcher and reopen it; removing and adding the home-screen icon again
is only a last resort and does not delete the cloud copy of the ledger.
