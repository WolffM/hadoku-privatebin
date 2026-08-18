# Wiring the SPA into the platform

If your backend serves its own single-page UI (no build step), adapt it to the
platform with these two drop-ins — paste into the served document `<head>` before
the main app script:

```html
<script src="/privatebin/native-base.js"></script>
<script src="/privatebin/app-prefs.js"></script>
```

> Serve both files from the backend (static, no server logic).

## 1. Route backend root calls through the prefix

Every call to the backend's **root** API must go through the
`/privatebin/_pb` namespace so the shim can demux it. Wrap them:

| Before                          | After                              |
| ------------------------------- | ---------------------------------- |
| `fetch('/<root-route>', …)`     | `fetch(native('/<root-route>'), …)`|
| `new WebSocket('ws://…/ws?…')`  | `new WebSocket(nativeWs('/ws?'+qs))`|

The backend's **own** `/privatebin/*` routes already carry the prefix — call them
as `/privatebin/<route>` (or `appApi('/<route>')`). They need no wrapper.

Local dev against a bare backend (no prefix): set
`window.PRIVATEBIN_BASE = ''` before `native-base.js` loads and every helper
becomes a passthrough.

## 2. Persist per-user settings

```js
const s = await AppPrefs.load();   // hydrate controls
AppPrefs.save({ lastFoo: value }); // on change (debounced, syncs for authed users)
```

Keep to small JSON (~32KB cap). Bulk artifacts (uploads, outputs) are **files** on
the host, namespaced per-user by the backend from the `X-User-Id` header the edge
injects.
