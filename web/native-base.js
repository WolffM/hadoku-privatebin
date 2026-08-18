/**
 * native-base.js — base-path awareness for the PrivateBin SPA.
 *
 * The SPA is served at hadoku.me/privatebin and ALL its traffic must stay under
 * the /privatebin prefix (that's how the platform scopes auth). The backend's own
 * root endpoints (e.g. /prompt, /ws, /view) must be called through the
 * `/privatebin/_pb` namespace; the tunnel shim strips that back to
 * root before forwarding.
 *
 * Drop in BEFORE the main app script and rewrite direct backend calls:
 *
 *   fetch('/prompt', ...)              ->  fetch(native('/prompt'), ...)
 *   new WebSocket(`ws://host/ws?...`)  ->  new WebSocket(nativeWs('/ws?' + qs))
 *
 * The backend's OWN prefixed routes already carry the prefix and need no change —
 * call them as `/privatebin/<route>` (or use appApi() below).
 *
 * Local dev against a bare backend (no prefix): set window.PRIVATEBIN_BASE = ''.
 */
(function (global) {
	const BASE = global.PRIVATEBIN_BASE != null ? global.PRIVATEBIN_BASE : '/privatebin';
	const NATIVE = BASE + '/_pb';

	/** Build a URL for a native backend endpoint (root API). */
	function native(path) {
		return NATIVE + (path.startsWith('/') ? path : '/' + path);
	}

	/** Build a ws:// or wss:// URL for a backend WebSocket, honoring page scheme. */
	function nativeWs(path) {
		const proto = global.location.protocol === 'https:' ? 'wss:' : 'ws:';
		return proto + '//' + global.location.host + native(path);
	}

	/** Build a URL for one of the backend's own prefixed routes. */
	function appApi(path) {
		return BASE + (path.startsWith('/') ? path : '/' + path);
	}

	global.AppBase = { BASE, NATIVE, native, nativeWs, appApi };
	global.native = native;
	global.nativeWs = nativeWs;
	global.appApi = appApi;
})(window);
