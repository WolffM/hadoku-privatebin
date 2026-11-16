# Features

What a visitor to `hadoku.me/privatebin` can do, and what it takes to do it.

## Encrypted pastes and attachments

**What it does.** Standard PrivateBin: paste text or attach a file, and it's
encrypted in your browser before anything is sent — the server only ever
stores ciphertext. You get back a link with the decryption key in the
fragment (`#...`), which never leaves the browser or reaches the server.
Options include a burn-after-reading paste (deleted the moment it's first
read) and an expiry.

**How to use it.** Open `hadoku.me/privatebin`, write or attach, and share
the link it gives you. Anyone with that link can open it — PrivateBin's
read path needs no account.

**What it does not do.** There's a practical ceiling below the advertised
limit: attachments are base64-encoded before encryption, which inflates
them about a third, so a 16 MiB server-side limit becomes roughly 12 MB of
real file (`tooLargeBody`, `src/gate.ts`). Past that, or past the proxy's
own 20 MB request cap, you get an explained refusal instead of a silent
connection reset. Comments/discussion on a paste are switched off
(`cfg/conf.php`) and turning them on would need a change to the create gate
below — a stray anonymous comment is a write the same rule would have to
account for.

## Read is public, create is friend+

**What it does.** The exact same URL serves two different rules depending
on the HTTP method: any `GET` (reading a paste, or the server-side delete
a burn-after-reading paste triggers on its own read) is open to anyone who
has the link; any `POST`, `PUT` or `DELETE` (creating a paste, or deleting
one by its own delete token) needs a signed-in **friend** account or
higher.

**How to use it.** Reading needs nothing — open the link. Creating needs to
be signed in to hadoku.me as a friend-tier account or above; without that,
the create button's request is refused with a message naming exactly what's
missing, not a generic error.

**What it does not do.** There is currently no prompt to sign in when a
create is refused — PrivateBin's create happens over an XHR the login flow
can't intercept, and the route is registered `public` at the platform edge
(since the edge's tier rules are path-only and can't see the method), so
the refusal is the end of the road for now rather than a redirect
(hadoku-privatebin#1).

Enforced by `CREATE_MIN_TIER = 'friend'` in `src/gate.ts:59`, checked by
`mayProceed()` (`src/gate.ts:94`) against the tier the edge actually
vouched for — never a header a client could simply assert — in the gate
middleware at `src/index.ts:114`. The split itself was read directly off
upstream's own router rather than guessed: see
[contributing](contributing.md#the-gate) for where that mapping comes from.

## Themed, not forked

**What it does.** Every page carries the same hadoku.me look as the rest of
the platform, even though the HTML comes straight from PrivateBin's own
unmodified template.

**How to use it.** Nothing to do — it's always on. One stylesheet is
injected into the `<head>` of PrivateBin's HTML shell on the way through
the proxy, as the response streams back.

**What it does not do.** Nothing about PrivateBin's own behavior changes;
only the paint does. Everything else that's customized (size limits, PHP
config, the nginx limits) lives in files mounted into the stock container,
never in a modified copy of it.

## Trivia

The theme injection is the only reason this shim buffers a response at
all, and it buffers exactly one path on purpose: PrivateBin's document
root, and nothing else, because every other response can be the full
size limit and holding that in memory to rewrite it would defeat the
point (`servesHtmlShell`, `src/index.ts`).
