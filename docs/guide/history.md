# History

31 commits over 90 days (first `0f92626` 2026-08-17, latest `ce599ea`
2026-11-15; `node scripts/fact-sheet.mjs` against this worktree). One
author, four eras.

## Bring-up

The whole repo exists inside three days. `0f92626` (2026-08-17) scaffolds
it from a shared template; the same day, `0148cf6` adds the `check` CI job.
The next day, 2026-08-18 — the repo's busiest by commit count (5 of its
31) — `79db68a` lands the thing the repo is actually for: the create-is-
friend+ gate, and running upstream PrivateBin unforked under `/privatebin`.
The same day, `f3aa7c4` fixes an oversized upload so its 413 actually
reaches the client instead of dying as a reset connection, and the
bring-up is recorded done in `511ee3e`. `d5a928e` (2026-08-23) hardens the
shim to bind loopback by default, matching the container's own posture.

## The quiet spell, and the incident the day it ended

An 18-day gap — the longest in the repo's history, from `9d4a946`
(2026-08-31) to `773344a` (2026-09-18, a docs migration) — is broken five
days later. What follows is the busiest stretch outside the bring-up
itself: three commits on 2026-09-23 that trace back to one real incident,
followed by a fourth the next day that writes it up in full.

A customer holding a valid friend key could not create a paste. The
service was healthy throughout and had already answered with the exact
reason; it just never reached them. `82a4860` fixes the proximate cause —
PrivateBin's client routes every non-2xx response into a generic "server
error or not responding" handler that never reads the body, so the shim's
own precise refusal message was being thrown away by a 403 status code.
The fix answers a JSON-API refusal with the same `200` PrivateBin's own
error envelope would use, since the client already reads the body's
`status` field for those. `55e8fdc`, minutes later, removes a
self-referential `node_modules` symlink `82a4860` had accidentally
committed — diagnosing the incident caused a second, roughly four-minute
outage of its own when that symlink was deleted from the wrong checkout.
`6f1517c` closes the loop: the shim's refusal log now says *why* it saw
`tier=public` (no seal at all, a seal that didn't match, or a genuinely
anonymous caller) instead of a single line consistent with all three.

`2ff82e4` (2026-09-24) is the postmortem: the actual root cause was that
the running process simply had no `EDGE_AUTH_SECRET` at all, which pins
every request to public regardless of whose key it carries. A plain
restart fixed it immediately, and how the secret went missing was never
explained. It also records three separate, confidently wrong diagnoses
offered before anyone checked the running process's actual environment.
They are kept deliberately, per the commit: "the pattern is more reusable
than the conclusion."

Three issues came out of the incident, all still open: no sign-in prompt
on a refused create (hadoku-privatebin#1), the possibility of failing
closed forever after one boot-time secret miss (hadoku-privatebin#2), and
no logging at all for a request that *succeeds* (hadoku-privatebin#3).

## Hardening the deploy

Through October, the deploy itself gets safer. CI's install token moves to
one read at job time from the vault rather than a static secret
(`a2eb889`), and the redeploy trigger asks a management service for the
redeploy instead of holding a broad token directly (`5d4908c`). The docs
also become explicit that the live container and its `cfg/` now run from
a separate deploy clone — never `~/repos` — because `docker compose`'s
project name comes from the directory name alone (`bea751a`). `85d79cc`
(2026-10-31) removes `EDGE_AUTH_SECRET` from the service key's own vault
access entirely: the secret that makes the tier gate trustworthy is not
something this repo's own automation should be able to read.

## The tier ladder, and the paste directory's independence

`1f617b4` (2026-11-04) brings `/health` onto the platform's own contract
(status, service id, running commit, a reason when degraded). `2b3aeea`
(2026-11-06) adds `member` to the tier ladder between public and friend —
`CREATE_MIN_TIER` itself stays `friend`, unchanged — and makes a future
typo in that constant fail loudly at import instead of silently ranking as
public. The repo's last commit, `ce599ea` (2026-11-15), moves the paste
directory's location to an explicit `PRIVATEBIN_DATA_DIR` the PM2 wrapper
sets, so it can live outside the deploy clone entirely and survive every
container recreate untouched.

## Trivia

See [trivia.md](trivia.md) — starting with the three wrong diagnoses the
2026-09-23 postmortem keeps on record on purpose.
