# "Could not create document: server error or not responding" — 2026-09-23

A customer with a valid friend key could not create a document. The server was
healthy the whole time and had already answered with the exact reason. Three
separate defects stacked so that the reason never reached them, and a fourth
was introduced during the diagnosis.

Issues filed from this: #1 (login redirect), #2 (fail-closed forever), #3
(no success logging).

## What the customer saw, and what was actually happening

| Layer                | State                        | What it reported                                                 |
| -------------------- | ---------------------------- | ---------------------------------------------------------------- |
| PrivateBin container | healthy, created pastes fine | —                                                                |
| Shim gate            | correctly refusing           | `{"status":1,"message":"…requires a hadoku.me friend account…"}` |
| Shim HTTP status     | **403**                      | —                                                                |
| PrivateBin client    | `$.ajax(...).fail(...)`      | **"server error or not responding"**                             |

jQuery routes every non-2xx into `.fail`, whose handler carries a generic error
enum and not the response body. So a precise, well-written explanation was
discarded and replaced with the one string that sends the reader hunting for an
outage. `refusalBody`'s own comment said it built PrivateBin's envelope "so a
refusal renders as a real message in the UI instead of a generic failure" — the
envelope was right and the status code silently undid it.

**Fixed in 82a4860.** A JSON-API refusal answers 200, matching what it is
impersonating: upstream's `Controller::_json_error` sets `status`/`message` and
never touches the HTTP code. A non-JSON caller still gets the honest 4xx,
because curl, scripts and monitors read the code and none of them parse
`status`. The status now travels WITH the body out of `gate.ts` so the two
cannot drift apart again. The 413 too-large path had the identical defect.

## The actual fault

The running shim had **no `EDGE_AUTH_SECRET` in its process environment**. With
an empty secret and `allowUnverifiedEdge` false, `sanitizeHeaders` pins every
request to `tier=public` — so no valid seal can exist and nobody can create, at
any tier. That is why the customer's valid friend key made no difference, and
why a service-key probe failed identically.

A restart picked the secret up and creation worked immediately. **How it went
missing is still unexplained** — see #2. It could recur.

## Three wrong turns, recorded because each was confidently wrong

1. **"The auth chain is broken."** Asserted after a service-key probe through
   the edge was refused. The key used (`HADOKU_SITE_TOKEN`) is not an edge key
   at all — `/session/whoami` returns `{"valid":false,"userType":"public"}` for
   it. A 403 was the correct answer to that request, and it proved nothing.
2. **"`callerTier` is never set."** A too-narrow grep found it read in four
   places and set in none. It is set, in `middleware/authGate.ts:70`.
3. **"The registry stores `tier` but the reader wants `userType`."** The record
   really does use `tier` and the resolver really does return `userType` — but
   `resolveKeyTier` maps one to the other correctly (`userType: rec.tier`).

The common shape: a plausible mechanism, asserted before the cheap check that
would have refuted it. The measurement that actually settled things was reading
the running process's environment.

## Self-inflicted, during the incident

- **A second outage.** Deleting `node_modules` in the repo the shim runs from
  killed the process; `hadoku.me/privatebin` returned 502 for ~4 minutes.
  Reading was down too, not just creating.
- **A self-referential symlink committed to main** (82a4860, removed in
  55e8fdc). `ln -sfn TARGET node_modules` run where a `node_modules` directory
  already exists creates `TARGET/node_modules` INSIDE it rather than replacing
  it. It then got past `.gitignore` because line 1 was `node_modules/` — the
  trailing slash matches a directory, not a symlink of the same name. A fresh
  checkout of that commit resolves to ELOOP. `.gitignore` now lists the bare
  name too.

## What the logs could not say, and can now

The shim logged `refused POST /privatebin/ — tier=public < friend`, which is
consistent with three different causes needing three different fixes: no seal
at all, a seal that did not match, or a genuinely anonymous caller. Both halves
of the chain now say which:

- **shim** (6f1517c): `provenance=verified | seal-rejected | no-seal`
- **edge-router** (hadoku_site 1b48304c): `tier=` (what it resolved to) and
  `auth=cookie|key|none` (what was presented). `auth=cookie tier=public` is a
  session we rejected — ours; `auth=none tier=public` is an anonymous caller —
  theirs.

Historical log search is still unavailable: the Cloudflare tokens on this box
lack Workers Observability read, and wrangler's OAuth session covers live
`wrangler tail` only.

## The thing that is still broken

A friend who holds a key but has no live `hadoku_session` cookie resolves to
public, and PrivateBin's create is an XHR that cannot send `X-User-Key`. They
are refused with no way to sign in, because `/privatebin` is registered
`tier: 'public'` at the edge and `RouteTier` has no method field — so the gate
lives below the layer that knows how to show a login page. **#1.**
