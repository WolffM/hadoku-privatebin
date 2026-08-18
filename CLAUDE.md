# PrivateBin (hadoku-privatebin) — tunnel-proxy child app

A reverse-proxy shim that exposes a local backend under `hadoku.me/privatebin/*`.
Use this app class when the backend is NOT prefix-aware and exposes BOTH root
routes and prefixed routes on one server (canonical case: ComfyUI + a custom node,
or any GPU service with a stock root API plus a mounted UI).

## Traffic flow

```
browser → edge-router (hadoku.me/privatebin/*) → privatebin.hadoku.me tunnel
        → privatebin shim (this repo, localhost:9005) → backend (http://127.0.0.1:8090)
```

| Piece              | Owned by      | Notes                                                   |
| ------------------ | ------------- | ------------------------------------------------------- |
| Reverse-proxy shim | **this repo** | Thin Express proxy. The only thing cloudflared exposes. |
| Backend + UI       | backend       | Serves root API + its own /privatebin/* routes.         |
| Heavy engine (GPU) | operator      | Managed out-of-band on the host. Not redeployed.        |

## The routing contract (why the shim exists)

The backend serves two namespaces on one server: its **root API** and its **own
`/privatebin/*` routes**. The platform forces all browser traffic under one
`/privatebin/*` prefix, so a single prefix-strip can't serve both. The shim
demuxes:

- `/privatebin/_pb/<x>` → strip → backend root `/<x>` (incl. WS)
- `/privatebin` and `/privatebin/<x>` → unchanged → backend

The SPA must call the backend's root API through `/privatebin/_pb/*`.
See `web/README.md` + `web/native-base.js`.

## Auth & identity

Edge-router gates the tier and injects `X-User-Key` + a stable `X-User-Id` on
every request, including the WS upgrade. The shim forwards both untouched. The
backend should **trust the edge** (don't re-validate keys) and use `X-User-Id` as
the user identity for per-user state.

## Per-user data

- **Settings** → platform prefs (`appId: 'privatebin'`) via `web/app-prefs.js`.
  Authed users sync server-side; anon falls back to localStorage. Blobs < ~32KB.
- **Files** → local disk on the host, keyed per-user off `X-User-Id`. The backend
  owns this.

## Deploy

Push to `main` → `.github/workflows/redeploy.yml` dispatches `redeploy_service`
to hadoku_site → mgmt-api runs `git pull && pnpm install && pnpm build && pm2
restart privatebin`. Only the shim is rebuilt. Needs the `HADOKU_SITE_TOKEN` repo
secret (`administration.py github-secrets child-repos`).

## Vault

Runtime config (`PRIVATEBIN_PORT`, `PRIVATEBIN_BACKEND_URL`) comes from
the vault broker via the PM2 wrapper. Any new `process.env.X` must be declared in
`.devvault.json` so the daily ACL-sync grants this repo's service key access.
