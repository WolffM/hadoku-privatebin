---
title: PrivateBin
summary: >-
  Encrypted, link-shareable pastes and file attachments at
  hadoku.me/privatebin, running unforked upstream [PrivateBin](https://privatebin.info/)
  behind a thin proxy shim that lets anyone with a link read a paste while
  only signed-in friends can create one.
features:
  - name: Encrypted pastes and attachments
    summary: 'Client-side-encrypted text and file sharing by link, up to a usable ~12 MB attachment.'
    anchor: encrypted-pastes-and-attachments
  - name: Read is public, create is friend+
    summary: 'Anyone holding a link can read or burn a one-time paste; only a signed-in friend account can create one.'
    anchor: read-is-public-create-is-friend
    tier: friend
  - name: Themed, not forked
    summary: 'The platform look is injected into the stock HTML shell at the proxy layer, so upstream can be upgraded with a plain docker pull.'
    anchor: themed-not-forked
trivia:
  - 'The tier split (read public, create friend+) could not be read off any config: it was derived from PrivateBin''s own router, where every POST, PUT and DELETE counts as a write and burn-after-reading deletes server-side inside a GET (`src/gate.ts`).'
  - 'A customer with a valid key once could not create a paste for a reason that had nothing to do with their key: the shim was simply missing its edge secret, so every request — theirs included — was already pinned to public before the gate ever saw it (`docs/incident-2026-09-23-cannot-create.md`).'
  - 'That incident''s postmortem records three different confident, wrong diagnoses offered before anyone read the running process''s actual environment — kept on purpose, because the pattern recurs more than the conclusion does (`2ff82e4`).'
  - 'Diagnosing it caused a second, shorter outage of its own: deleting `node_modules` in the wrong checkout killed the live process for about four minutes (`docs/incident-2026-09-23-cannot-create.md:64`).'
---

# PrivateBin

This repo holds no PrivateBin code at all — it runs the stock, unforked
[`privatebin/nginx-fpm-alpine`](https://github.com/PrivateBin/PrivateBin)
image, pinned by digest, and everything here is a small Node proxy shim in
front of it. The shim's one job that matters is a split the platform's edge
cannot express on its own: the same URL answers reads for anyone with a
link, but only a signed-in friend account may create a new paste.

- [Features](features.md): what a visitor and a friend-tier creator can
  each do.
- [Contributing](contributing.md): running it locally, the shim's layout,
  how a deploy reaches the live container.
- [History](history.md): the bring-up, and the day a working service looked
  broken from every angle but the right one.
- [Trivia](trivia.md)

## Trivia

PrivateBin itself is never patched here: upgrading it is a `docker pull`
and a digest bump in `docker-compose.yml`'s pinned `image:` line
(`docker-compose.yml:22`), nothing more — the entire point of running it
unforked is that an upstream CVE is a routine pull, not a merge someone has
to notice and perform ([contributing](contributing.md#how-it-deploys)).
