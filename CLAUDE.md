# PrivateBin (hadoku-privatebin) — tunnel-proxy child app

Hosts an **unforked upstream PrivateBin** at `hadoku.me/privatebin`. This repo
holds the proxy shim and the deployment config. It contains no PHP.

## Traffic flow

```
browser → edge-router (hadoku.me/privatebin/*) → privatebin.hadoku.me tunnel
        → privatebin shim (this repo, 127.0.0.1:9005)
        → privatebin container (127.0.0.1:8090, docker-compose.yml)
```

| Piece              | Owned by      | Notes                                                |
| ------------------ | ------------- | ---------------------------------------------------- |
| Reverse-proxy shim | **this repo** | The gate. Loopback-only; cloudflared is the one way in. |
| PrivateBin 2.0.6   | upstream      | `privatebin/nginx-fpm-alpine`, pinned by digest.     |
| Paste storage      | host disk     | `./data`, bind-mounted. Gitignored. Back this up.    |

## The shim binds loopback, like the container

`app.listen` binds `127.0.0.1:9005` (`CONFIG.bindHost`), not `0.0.0.0` — the
same posture as the container's `127.0.0.1:8090`. cloudflared runs on-box and
reaches the shim over loopback, so nothing else needs a route in, and the tunnel
stays the only path to the gate. The shim fails closed to read-only without a
valid edge seal, so a wider bind was never an open hole — but there is no reason
to publish it LAN-wide either. Set `PRIVATEBIN_BIND_HOST` only if cloudflared
runs off-box.

## Do not fork PrivateBin

The entire job of this service is holding other people's secrets, so a fork
would turn every upstream CVE into a merge somebody has to notice and perform.
Upgrading is `docker pull` + bump the digest in `docker-compose.yml`.

Everything customised lives OUTSIDE the image: `cfg/conf.php`,
`cfg/php-limits.ini`, `cfg/nginx-limits.conf` (all mounted read-only), and
`web/theme.css`, which the shim injects into the HTML shell on its way past.
That injection is why there is no forked template.

## The one thing to get right: read is public, create is friend+

`GET /?pasteid` reads, `POST /` creates — same path, different methods. The edge
tier manifest is **path-only** (`RouteTier` has no `method` field), so the split
cannot be expressed there, and `/privatebin` is registered `public` so a
recipient holding a link can open it. **The shim is the gate** (`src/gate.ts`).

The classification was read off PrivateBin 2.0.6's own `lib/Request.php`, not
guessed: POST, PUT and DELETE are all `create`; every read arrives as a GET.
Burn-after-reading deletes server-side inside the read, so an anonymous
recipient never needs a mutating method.

**This only works because `src/edge-auth.ts` verifies the `X-Edge-Auth` seal
first.** `privatebin.hadoku.me` is a public hostname — without that check anyone
could hit the tunnel directly with `X-Hadoku-Tier: friend`. With no
`EDGE_AUTH_SECRET` the shim fails closed (everything degrades to public, so
nothing can be created). `src/__tests__/gate.test.ts` pins all of it.

**Enabling discussion would break the rule**, because commenting is a POST an
anonymous recipient legitimately makes. It is off in `cfg/conf.php`; turning it
on means revisiting `src/gate.ts`.

## Sizes must agree in three places

`sizelimit` (cfg/conf.php, 16 MiB) ≤ `post_max_size` (cfg/php-limits.ini, 20M)
≤ `client_max_body_size` (cfg/nginx-limits.conf, 20m). Attachments are base64'd
into the paste before encryption, so the usable payload is ~12 MB. PrivateBin has
no pre-upload size check, so a disagreement surfaces as an OOM or a bare 413
after the browser has already encrypted everything — the shim's Content-Length
guard exists to turn that into a sentence.

## Per-user identity

Edge-router injects `X-User-Id`; the shim forwards it and PrivateBin uses it as
the traffic-limiter key (`traffic.header = X_USER_ID`). Without that, every
request reaches the container from 127.0.0.1 and one person pasting would
rate-limit every friend on the platform.

## Deploy

Push to `main` → `.github/workflows/redeploy.yml` → mgmt-api runs
`git pull && pnpm install && pnpm build && pm2 restart privatebin`.
**Only the shim is rebuilt.** The container is host state: change `cfg/*` or the
image digest and run `docker compose up -d` on the host yourself.

## Vault

`PRIVATEBIN_PORT`, `PRIVATEBIN_BACKEND_URL` and `EDGE_AUTH_SECRET` come from the
vault broker via the PM2 wrapper. Any new `process.env.X` must be declared in
`.devvault.json` or the daily ACL-sync won't grant this repo's key access to it.
