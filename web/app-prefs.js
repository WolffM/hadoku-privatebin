/**
 * app-prefs.js — per-user settings for the PrivateBin SPA.
 *
 * Backed by the platform preferences service (prefs-api worker, D1, keyed by a
 * stable per-user X-User-Id the edge mints from the auth cookie). appId is
 * 'privatebin', so this namespace never collides with other apps' prefs.
 *
 *   - Authed users (admin/friend): settings sync server-side across devices.
 *   - Public/anon users: /prefs requires friend+, so reads/writes 401 — we fall
 *     back to localStorage so the UI still remembers settings locally.
 *
 * Keep blobs small JSON (~32KB server cap). Bulk artifacts are FILES on the host,
 * namespaced per-user by the backend off X-User-Id — not prefs.
 *
 * Usage:
 *   const settings = await AppPrefs.load();      // {} if none yet
 *   AppPrefs.save({ lastFoo: 'bar' });           // shallow-merge, debounced
 */
(function (global) {
	const APP_ID = 'privatebin';
	const PREFS_URL = '/prefs/api/v1/' + APP_ID;
	const LS_KEY = 'privatebin:prefs';
	const DEBOUNCE_MS = 1000;

	let cache = null;
	let anon = false;
	let saveTimer = null;
	let pending = {};

	function readLocal() {
		try {
			return JSON.parse(global.localStorage.getItem(LS_KEY) || '{}');
		} catch {
			return {};
		}
	}
	function writeLocal(obj) {
		try {
			global.localStorage.setItem(LS_KEY, JSON.stringify(obj));
		} catch {
			/* quota / private mode — ignore */
		}
	}

	async function load() {
		if (cache) return cache;
		try {
			const r = await fetch(PREFS_URL, { credentials: 'include' });
			if (r.status === 401 || r.status === 403) {
				anon = true;
				cache = readLocal();
				return cache;
			}
			if (!r.ok) throw new Error('prefs GET ' + r.status);
			const body = await r.json();
			cache = (body && body.merged) || {};
			return cache;
		} catch {
			anon = true;
			cache = readLocal();
			return cache;
		}
	}

	function save(patch) {
		cache = Object.assign({}, cache || {}, patch);
		pending = Object.assign(pending, patch);
		writeLocal(cache);
		if (anon) return;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = global.setTimeout(flush, DEBOUNCE_MS);
	}

	async function flush() {
		saveTimer = null;
		const patch = pending;
		pending = {};
		if (!Object.keys(patch).length) return;
		try {
			const r = await fetch(PREFS_URL, {
				method: 'PUT',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ scope: 'user', patch }),
			});
			if (r.status === 401 || r.status === 403) anon = true;
		} catch {
			/* keep localStorage mirror; retry on next save() */
		}
	}

	global.AppPrefs = { load, save, flush };
})(window);
