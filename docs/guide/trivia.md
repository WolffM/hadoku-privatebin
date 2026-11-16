# Trivia

- The 2026-09-23 postmortem keeps three separate wrong diagnoses on record
  on purpose, not to assign blame. A service-key probe refused through the
  edge was taken as proof the "auth chain is broken," when that key was
  never an edge key in the first place. A too-narrow grep concluded a tier
  variable was "never set," when it was set in one place the grep missed.
  And a mismatch between two field names was blamed, when the resolver
  that bridges them already did the translation correctly
  (`docs/incident-2026-09-23-cannot-create.md`).
- Fixing that incident caused a second outage of its own: deleting
  `node_modules` in the wrong checkout took the live shim down for about
  four minutes, so reading pastes broke too, not just creating them
  (`docs/incident-2026-09-23-cannot-create.md:64`).
- A plain `ln -sfn` run where a `node_modules` directory already existed
  created a symlink *inside* it rather than replacing it. That
  self-referential link slipped past `.gitignore` because the ignored
  pattern had a trailing slash, which matches a directory but not a
  symlink of the same name (`55e8fdc`).
- The usable attachment size (about 12 MB) is three-quarters of the
  server's 16 MiB limit on purpose: attachments are base64-encoded before
  they're encrypted, which inflates them roughly a third. The error
  message quotes the real ceiling rather than the raw config value
  (`tooLargeBody`, `src/gate.ts`, from `79db68a`).
