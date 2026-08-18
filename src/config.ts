/**
 * Runtime config for the PrivateBin tunnel-proxy shim.
 *
 * A "proxy tunnel" sits in front of a local backend that ISN'T prefix-aware and
 * exposes BOTH root-level routes and its own prefixed routes on one server
 * (the canonical case: ComfyUI + a custom_node). The platform forces all browser
 * traffic under one `/privatebin/*` prefix, so the edge can't simply strip the
 * prefix — this shim demuxes instead.
 *
 * All values are env-overridable so the PM2 wrapper (which pulls them from the
 * vault broker) can inject them without code edits.
 */

export const CONFIG = {
	/** Port THIS shim listens on. cloudflared points privatebin.hadoku.me here. */
	port: parseInt(process.env.PRIVATEBIN_PORT || '9005', 10),

	/**
	 * The local backend this shim proxies to (binds 127.0.0.1 only — the shim is
	 * the only thing cloudflared exposes).
	 */
	backendUrl: process.env.PRIVATEBIN_BACKEND_URL || 'http://127.0.0.1:8090',

	/**
	 * The public prefix every browser request arrives under. Edge-router proxies
	 * hadoku.me/privatebin/* here WITHOUT stripping, so the shim sees the full
	 * `/privatebin/...` path (required so the WS path survives to the backend).
	 */
	basePrefix: process.env.PRIVATEBIN_BASE_PREFIX || '/privatebin',

	/**
	 * Sub-namespace the SPA uses for the backend's OWN root endpoints. The shim
	 * strips `${basePrefix}${nativeSubpath}` back to root before forwarding; every
	 * other `/privatebin/*` path is forwarded UNCHANGED (the backend serves those
	 * under the prefix itself). This is what lets a backend's root API and its
	 * prefixed routes coexist under one platform prefix. Harmless when unused — if
	 * the SPA never calls the sub-namespace, that branch never fires.
	 */
	nativeSubpath: process.env.PRIVATEBIN_NATIVE_SUBPATH || '/_pb',

	/** Upstream timeout (ms). Long for GPU jobs that can run minutes. */
	timeoutMs: parseInt(process.env.PRIVATEBIN_TIMEOUT_MS || '600000', 10),
} as const;

/** Full prefix the SPA prepends to native backend calls, e.g. `/privatebin/_backend`. */
export const NATIVE_PREFIX = CONFIG.basePrefix + CONFIG.nativeSubpath;
