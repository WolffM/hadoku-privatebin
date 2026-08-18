;<?php http_response_code(403); /*
;
; PrivateBin configuration — mounted read-only into the upstream container at
; /srv/cfg/conf.php. Nothing in this repo forks PrivateBin; this file and the
; two limit files beside it are the entire customisation surface.
;
; The leading PHP line is upstream's own guard: if this file is ever served over
; HTTP rather than read from disk, it 403s instead of disclosing the config.
;
; Reference: PrivateBin 2.0.6, lib/Configuration.php.

[main]
name = "hadoku paste"

; Only used for the absolute URLs in the template (apple-touch-icon, og:image).
; The shim strips /privatebin before the container sees a request, so PrivateBin
; believes it lives at the document root and cannot work this out for itself.
basepath = "https://hadoku.me/privatebin/"

; ── Discussion: OFF, and the create gate depends on it ──────────────────────
; Posting a comment is a POST, and the shim classifies every POST as a create
; requiring friend+. With discussion enabled an anonymous recipient would have a
; legitimate reason to POST, and gating on the method alone would stop being a
; correct classification. Turning this on means revisiting src/gate.ts.
discussion = false
opendiscussion = false

; Both features the operator asked for by name.
password = true

; Off by default upstream. This is what makes small friend-to-friend file
; sharing work at all. See sizelimit below for what "small" means.
fileupload = true

; Don't pre-tick burn-after-reading: it destroys the paste on first read, and a
; default that silently does that surprises people who were sharing a config.
; It stays one click away in the expiry dropdown.
burnafterreadingselected = false

defaultformatter = "plaintext"

; ── Size ────────────────────────────────────────────────────────────────────
; 16 MiB, and this covers the paste AND its attachment together. Attachments are
; base64'd into the paste body before encryption, so roughly 25-33% of this is
; encoding overhead and the realistic usable payload is ~11-12 MB — less for
; already-compressed input (zip, png, mp4), where zlib cannot win any of it back.
;
; php-limits.ini and nginx-limits.conf MUST stay consistent with this number.
; If they disagree, a large upload fails as an OOM or a bare 413 rather than as
; a clean message: PrivateBin has no pre-upload size check (upstream issues #95,
; #406, #601, #858), so the browser encrypts the whole thing in memory first and
; only then discovers the server won't take it.
sizelimit = 16777216

template = "bootstrap5"

; Set expectations honestly, in the UI, before someone wastes an upload. The
; shim's injected stylesheet (web/theme.css) styles this slot.
notice = "Good for configs, keys, tokens, screenshots and small archives — roughly 12 MB after encryption overhead. Not a video transfer; use hadoku.me/filetransfer for that. Everything is encrypted in your browser: the key lives in the link after the # and never reaches the server."

info = "Encrypted in your browser before it is sent. <a href='https://privatebin.info/'>How it works</a>."

languageselection = false

; Identicons only ever appear next to comments, and discussion is off.
icon = "none"

qrcode = true
email = true

; Left at the upstream default deliberately. It is what confines the decryption
; JS, and 'style-src self' is why web/theme.css is a file rather than an inline
; <style>. Do not widen it to make something render.
cspheader = "default-src 'none'; base-uri 'self'; form-action 'none'; manifest-src 'self'; connect-src * blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; font-src 'self'; frame-ancestors 'none'; frame-src blob:; img-src 'self' data: blob:; media-src blob:; object-src blob:; sandbox allow-same-origin allow-scripts allow-forms allow-modals allow-downloads"

; Served over TLS end to end (browser -> edge -> tunnel), so the insecure-context
; warning would be a false alarm.
httpwarning = false

compression = "zlib"

[expire]
default = "1week"

[expire_options]
5min = 300
10min = 600
1hour = 3600
1day = 86400
1week = 604800
1month = 2592000
1year = 31536000
; No "never". A secrets bin whose default outcome is permanence is the wrong
; default; everything here should eventually stop existing.

[formatter_options]
plaintext = "Plain Text"
syntaxhighlighting = "Source Code"
markdown = "Markdown"

[traffic]
; Seconds between pastes from one client. The `header` key below is what makes
; this per-USER rather than per-IP — and behind this shim that distinction is
; the whole ballgame: every request reaches the container from 127.0.0.1, so
; without it PrivateBin would rate-limit every friend on the platform as a
; single client and one person pasting would lock out everyone else.
;
; X-User-Id is injected by edge-router and re-stamped under the X-Edge-Auth seal
; (the shim pins it to absent on anything that cannot prove edge provenance), so
; it cannot be forged to dodge the limit. PrivateBin reads it as HTTP_X_USER_ID
; and stores only an HMAC of it, never the value.
limit = 10
header = "X_USER_ID"

; Both must stay empty: TrafficLimiter parses them as IP ranges, and the ipKey
; here is a user id, not an address.
exempted = ""
creators = ""

[purge]
limit = 300
batchsize = 10

[model]
class = "Filesystem"

[model_options]
dir = "/srv/data"
