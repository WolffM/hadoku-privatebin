# Handoff: hadoku-privatebin

Host an upstream PrivateBin at `hadoku.me/privatebin`, for sharing secrets over a
domain the operator owns and trusts.

## Read first

- `../hadoku_site/CLAUDE.md` — platform rules. Not optional.
- `../hadoku_site/docs/child-apps/TUNNEL_APP_BRINGUP.md` — the host bring-up
  sequence. Follow it top to bottom; the ordering gotchas in it cost several
  iterations on the first proxy app.
- `../hadoku_site/docs/child-apps/CHECKLIST_privatebin.md` — generated.

## Do not fork PrivateBin

Run the upstream image (`privatebin/nginx-fpm-alpine`) in Docker and configure
it. This is a deliberate decision, not laziness: the entire job of this service
is holding other people's secrets, and a fork means every upstream CVE becomes a
merge somebody has to notice and do. Theme it through PrivateBin's own template
and CSS hooks if you theme it at all.

This repo holds the **proxy shim** and the deployment config. It does not hold
PHP.

## Shape

```
browser → edge-router → cloudflared → shim :9005 → privatebin container :8090
```

The shim is already scaffolded (`src/`). The edge route, tier row, atlas rows,
PM2 wrapper, deploy-config entry and monitoring probe are already wired and
merged in hadoku_site.

The edge forwards `/privatebin` and `/privatebin/*` **unchanged — no
stripPrefix.** The shim, not the edge, decides what is UI and what is backend.

## The one thing you must get right

**Reading a paste is public. Creating one is friend+.**

Those are the same path with different methods (`GET /?pasteid=…` reads,
`POST /` creates), and the edge tier manifest is **path-only** —
`RouteTier` in `../hadoku_site/workers/edge-router/src/route-tiers.ts` has no
`method` field. The split therefore *cannot* be expressed at the edge, and
`/privatebin` is registered there as `public` so that a recipient holding a link
can actually open it.

**So the shim is the gate.** It must reject a create from anyone below friend.

Read the tier off the `X-Hadoku-Tier` request header. That header is
trustworthy on a public route: `authGate` resolves the caller's tier whether or
not a tier rule matched, and `proxy.ts` deletes any client-supplied value before
re-stamping the real one under the `X-Edge-Auth` seal. This is the same
arrangement promptsmith uses — "the app does not rely on the edge gate".

Get this wrong and you have published an open paste service on a domain that
carries the operator's name. Test it explicitly, signed out, with curl.

Which methods/paths constitute "create" is for you to determine from the running
PrivateBin — do not guess from this document. PrivateBin's API is
POST-to-root-with-JSON, but verify against the version you deploy, and default
to **deny** for anything you cannot classify.

## Configuration

In `cfg/conf.php` (mounted into the container, not baked):

- `fileupload = true` — off by default upstream. This is what makes small
  friend-to-friend file sharing work.
- `sizelimit` — the default is 10 MB and it covers the paste **and** its
  attachment together. Attachments are base64'd into the paste body, so ~25-33%
  of whatever you set is overhead, and the browser does the encrypt in memory.
  Realistic usable payload is well under the number you configure.
- PHP `memory_limit` wants roughly **2×** the upload size, and nginx
  `client_max_body_size` has to agree. If they disagree, large uploads fail as
  an OOM or a 413 rather than a clean message — there is no pre-upload size
  check upstream (PrivateBin issues #95, #406, #601, #858).
- Keep password protection and burn-after-reading available; they are the
  features the operator asked for by name.

**Set expectations honestly in the UI**: this is good for configs, keys,
screenshots and small archives. It is not a video-file transfer. That job
belongs to `hadoku-filetransfer`.

## Expect the subpath to be the hard part

Neither PrivateBin nor its nginx config documents subdirectory hosting, and
everything here must live under `/privatebin/`. Budget real time for this; it is
the integration risk, not the config. The shim can rewrite where it must — that
is why there's a shim and a `nativeSubpath` (`/_pb`) rather than a bare proxy.

## Preview policy: leave it alone

`/privatebin` is registered `'none'` in `../hadoku_site/spec/preview-policy.ts`
and must stay that way. A link preview is a fetch by a third party the sender
never chose — Discord, Slack and iMessage all scrape a pasted URL before a human
opens it. Any card at all announces to every hop in the chat chain that this
particular link is a secret worth intercepting. Do not "improve" this by adding
a title.

## Hard constraints

- **No `.env` files.** Secrets come from the vault via the PM2 wrapper
  (`../hadoku_site/services/pm2/privatebin-wrapper.mjs`) and `.devvault.json`
  locally.
- **Never run raw `pm2`.** Use the mgmt-api endpoints.
- **CI must not say `runs-on: ubuntu-latest`.** Use
  `${{ fromJSON(vars.CI_RUNNER || '["self-hosted","hadoku-builder"]') }}`.
- **This repo is PUBLIC.** A `pull_request` job on a self-hosted runner needs an
  `author_association` guard (see the pattern in hadoku_site's CLAUDE.md). Never
  skip the job on a guard — a skipped required check never reports and the PR
  can never merge.
- **Name your CI job `check`** — it is seeded as the required status context in
  `../hadoku_site/scripts/admin/repo-policy-manifest.json`.

## Workflow

Work in a worktree, never the main checkout. Commit, don't stash.

## Done means

- `pnpm check` green. That job name is this repo's REQUIRED status context —
  branch protection is already on and requires it, so a rename breaks merging.
- Run it the way CI does before pushing, not the way your shell is warmed up:
  `rm -rf node_modules && pnpm install --frozen-lockfile && pnpm check`.
  Three defects in this repo survived a passing `pnpm check` and died on exactly
  that command: a `lint` script with no eslint installed, an eslint config with
  no `fetch` in its globals (so it failed on the shim's own /health probe), and
  `ERR_PNPM_IGNORED_BUILDS` from pnpm 11 refusing to skip esbuild's build script.
  All three are fixed; the habit is what matters.
- Signed out: opening a paste link works; `POST` to create is refused.
- Signed in as friend: creating works, and the returned link opens signed out.
- Password-protected and burn-after-reading pastes both behave.
- A ~5 MB attachment round-trips; something far larger fails with a message
  rather than a hang.
- The monitoring probe sees the service (`privatebin.hadoku.me/health`).
