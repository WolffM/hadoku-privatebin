/**
 * Runtime config for the PrivateBin tunnel-proxy shim.
 *
 * PrivateBin runs UNFORKED (privatebin/nginx-fpm-alpine) and serves everything
 * from its document root — it is not prefix-aware and has no second namespace.
 * The platform forces all browser traffic under `/privatebin/*`, so this shim
 * strips that prefix on the way in. That is the opposite of the `_pb` demux the
 * proxy-tunnel template ships, which assumes a backend serving its own prefixed
 * routes; PrivateBin has none, so a demux here would only route to 404s.
 *
 * All values are env-overridable so the PM2 wrapper (which pulls them from the
 * vault broker) can inject them without code edits. Every `process.env.X` read
 * here must also be declared in `.devvault.json`, or the daily ACL-sync won't
 * grant this repo's service key access to it.
 */

export const CONFIG = {
	/** Port THIS shim listens on. cloudflared points privatebin.hadoku.me here. */
	port: parseInt(process.env.PRIVATEBIN_PORT || '9005', 10),

	/**
	 * The PrivateBin container this shim proxies to. It binds 127.0.0.1 only —
	 * the shim is the only thing cloudflared exposes, and the shim is the gate.
	 */
	backendUrl: process.env.PRIVATEBIN_BACKEND_URL || 'http://127.0.0.1:8090',

	/**
	 * The public prefix every browser request arrives under. Edge-router proxies
	 * hadoku.me/privatebin/* here WITHOUT stripping, so the shim sees the full
	 * `/privatebin/...` path and does the stripping itself.
	 */
	basePrefix: process.env.PRIVATEBIN_BASE_PREFIX || '/privatebin',

	/**
	 * Shared secret edge-router stamps as X-Edge-Auth on everything it proxies
	 * (workers/shared/edgeAuth.ts). The shim believes X-Hadoku-Tier / X-User-Id
	 * ONLY when this matches — privatebin.hadoku.me is reachable directly, so
	 * without this check anyone could send `X-Hadoku-Tier: friend` straight at
	 * the tunnel and create pastes. Unset = FAIL CLOSED: every request degrades
	 * to public/anon, which makes the whole service read-only.
	 */
	edgeAuthSecret: process.env.EDGE_AUTH_SECRET || '',

	/**
	 * Bare-local dev escape hatch. With EDGE_AUTH_SECRET unset the shim fails
	 * closed and nothing can create a paste, which makes local UI work
	 * impossible. Set this to trust the tier headers unverified instead. NEVER
	 * set it anywhere the tunnel host is reachable.
	 */
	allowUnverifiedEdge: process.env.PRIVATEBIN_INSECURE_NO_EDGE_AUTH === '1',

	/**
	 * PrivateBin's own `sizelimit` (cfg/conf.php), mirrored here ONLY so the
	 * shim can quote an accurate figure when it refuses an upload. Keep the two
	 * in step; if they drift, the worst case is a misleading number in an error
	 * message, never a wrong decision about what to store.
	 */
	sizeLimitBytes: parseInt(process.env.PRIVATEBIN_SIZE_LIMIT_BYTES || String(16 * 1024 * 1024), 10),

	/**
	 * Largest request body the shim will forward, in bytes. Must match
	 * `client_max_body_size` in cfg/nginx-limits.conf, which in turn sits above
	 * `sizelimit` in cfg/conf.php to leave room for the JSON envelope.
	 *
	 * This exists to turn a rude failure into an explained one. Past this size
	 * nginx stops reading and resets the connection, so an oversized upload dies
	 * as a broken pipe with no message — after the browser has already spent the
	 * time encrypting it. Checking Content-Length here lets us answer with
	 * PrivateBin's own error envelope before a single body byte is forwarded.
	 */
	maxBodyBytes: parseInt(process.env.PRIVATEBIN_MAX_BODY_BYTES || String(20 * 1024 * 1024), 10),

	/**
	 * Upstream timeout (ms). Covers the whole upload of a large attachment, not
	 * just the handshake. Default 2 min — PrivateBin does the crypto in the
	 * browser, so the server side is a plain body write.
	 */
	timeoutMs: parseInt(process.env.PRIVATEBIN_TIMEOUT_MS || '120000', 10),
} as const;
