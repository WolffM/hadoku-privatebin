# Handoff: hadoku-privatebin — DONE

Upstream PrivateBin is live at `hadoku.me/privatebin`, brought up 2026-08-18.

This file is the record of that bring-up: the decisions taken, what the original
brief predicted correctly, and what it did not. **Operational detail lives in
`CLAUDE.md`** — read that first if you are changing the service rather than
auditing how it got here.

## Status

| Piece                                          | State                                     |
| ---------------------------------------------- | ----------------------------------------- |
| Shim (gate, edge-auth, prefix strip, theming)  | shipped, CI green, 27 tests               |
| PrivateBin 2.0.6 container                     | running, pinned by digest, stock image    |
| cloudflared ingress + DNS                      | `privatebin.hadoku.me` live               |
| Vault: `EDGE_AUTH_SECRET` grant                | granted to the service key                |
| Monitoring probe                               | sees the service                          |
| Push-to-deploy                                 | verified: rebuilds and restarts the shim  |

## Decisions taken

The brief left four things open. They were settled by the operator:

- **`sizelimit` = 16 MiB.** Usable payload ~12 MB after base64 overhead; less for
  already-compressed input, where zlib wins nothing back.
- **Discussion OFF.** This is load-bearing, not cosmetic — see below.
- **Light hadoku theming plus an honest size notice**, done via injection rather
  than a forked template.
- **Full bring-up to live**, rather than staging behind an unresolvable hostname.

## The brief's one wrong prediction

> "Expect the subpath to be the hard part."

It was not. Under `/privatebin/` it came to two things: strip the prefix (the
scaffolded `_pb` demux is for backends that serve their own prefixed routes, and
PrivateBin serves only from its docroot), and 301 the bare prefix, because its
templates reference assets relatively and `/privatebin` resolves them at the site
root. Half a day of the estimate went unspent.

**The actual risk was in the sentence the brief treated as settled**: read the
tier off `X-Hadoku-Tier`, because `proxy.ts` re-stamps it under the `X-Edge-Auth`
seal. That is true of the header. It was not true of this repo — the scaffold
came from the plain `tunnel.proxy` template, which never *verifies* that seal.
`privatebin.hadoku.me` is a public hostname, so until `src/edge-auth.ts` existed,
anyone could have reached the shim directly with `X-Hadoku-Tier: friend` and
created pastes. The gate the brief correctly insisted on would have been
decorative.

If you are bringing up a sibling from the same template — `hadoku-filetransfer`
is scaffolded identically and has the same public-read/gated-write shape — **that
is the thing to check first.** `templates/tunnel-contained` in hadoku_site has
the pattern; `templates/tunnel-proxy` does not.

## What the gate rests on

Classified from PrivateBin 2.0.6's own `lib/Request.php`, not from documentation:
POST, PUT and DELETE all route to `create`; every read arrives as a GET;
unrecognised methods deny. Burn-after-reading deletes server-side *inside* the
read (`Model/Paste::get`), so an anonymous recipient never needs a mutating
method — which is what makes classifying on method alone correct.

**Enabling discussion breaks that**, because commenting is a POST an anonymous
recipient legitimately makes. If discussion is ever turned on, `src/gate.ts` has
to be revisited in the same change.

## Verified, signed out, against the live URL

Read is public: UI loads, bare prefix redirects, a paste link opens with no key.
Create is friend+: signed-out POST/PUT/DELETE all 403, and a **direct hit on the
tunnel forging `friend` and forging `admin` with a bad seal** both 403.
Authed create returns a link that opens signed out. Burn-after-reading burns on
first read. Password and attachment controls present, discussion absent. A 5 MB
attachment round-trips in 1.8s; 30 MB returns a clean 413 naming the real
ceiling. Preview policy still `none`.

## Two fixes made beyond the brief

- **`traffic.header = X_USER_ID`.** Every request reaches the container from
  127.0.0.1, so PrivateBin's rate limiter would have treated every friend as one
  client and one person pasting would have locked out everyone else.
- **Edge-router said "GPU host may be offline"** for PrivateBin — hydration
  seeded the string from a GPU-app template, and it surfaced on a real failure.
  Fixed in hadoku_site (`workers/edge-router/src/index.ts`).

## Left open

- **`services/pm2/privatebin-wrapper.mjs` is hand-edited** to pass
  `EDGE_AUTH_SECRET`. Re-running hydration drops that line, and the shim silently
  becomes read-only if it does. Noted in the file's own header.
- **Back up `data/`.** It is the only state that matters, it holds the encrypted
  blobs and the ServerSalt, and it is gitignored (it was not — committing it
  would have published both).
- **Checklist cleanup not done**: `templates/privatebin-tunnel/` and
  `docs/child-apps/CHECKLIST_privatebin.md` in hadoku_site are the checklist's own
  post-verification deletions. Skipped because other agents had live worktrees
  there; harmless to leave, safe to delete when that tree is quiet.
- **Upgrades are manual and deliberate**: `docker pull`, bump the digest in
  `docker-compose.yml`, `docker compose up -d`. Push-to-deploy rebuilds only the
  shim and never touches the container.
