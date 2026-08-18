/**
 * PrivateBin — tunnel-proxy shim
 *
 * Thin reverse-proxy in front of a local backend that exposes TWO route
 * namespaces on one server: its OWN root API (e.g. /prompt, /ws, /view) and its
 * prefixed routes (/privatebin/*). The platform forces all browser traffic under
 * one `/privatebin/*` prefix so the edge can scope auth to it; a single
 * prefix-strip can't satisfy both namespaces, so this shim demuxes:
 *
 *   /privatebin/_pb/<x>  ->  strip  ->  backend root /<x>   (incl. WS)
 *   /privatebin  and  /privatebin/<x>  ->  unchanged  ->  backend
 *
 * cloudflared points privatebin.hadoku.me at THIS process; the shim is the only
 * thing that talks to the backend. Edge-router has already gated the tier and
 * injected X-User-Id / X-User-Key — those headers are forwarded untouched so the
 * backend can namespace per-user state by X-User-Id.
 */

import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { CONFIG, NATIVE_PREFIX } from './config.js';

const app = express();
app.set('trust proxy', true);

// ── Health (public; never proxied) ─────────────────────────────────────────
// Probes the backend so monitoring distinguishes "shim up, backend down" from
// "shim down". Mirrors the public /health contract every tunnel app exposes.
app.get('/health', async (_req, res) => {
	let backend: 'up' | 'down' = 'down';
	try {
		const r = await fetch(`${CONFIG.backendUrl}/`, { signal: AbortSignal.timeout(3000) });
		backend = r.ok || r.status === 404 ? 'up' : 'down'; // 404 = reachable but no root route
	} catch {
		backend = 'down';
	}
	res.status(backend === 'up' ? 200 : 503).json({
		status: backend === 'up' ? 'healthy' : 'degraded',
		service: 'privatebin-tunnel',
		backend,
		timestamp: new Date().toISOString(),
	});
});

// ── Backend reverse proxy (HTTP + WebSocket) ────────────────────────────────
const backendProxy = createProxyMiddleware({
	target: CONFIG.backendUrl,
	changeOrigin: true,
	ws: true,
	proxyTimeout: CONFIG.timeoutMs,
	timeout: CONFIG.timeoutMs,
	pathRewrite: (path) => {
		// Native backend calls are namespaced under the sub-prefix by the SPA;
		// strip that back to root. Everything else passes through verbatim.
		if (path === NATIVE_PREFIX || path.startsWith(`${NATIVE_PREFIX}/`)) {
			return path.slice(NATIVE_PREFIX.length) || '/';
		}
		return path;
	},
	on: {
		error: (err, _req, res) => {
			const msg = String((err as Error)?.message || err);
			console.error('[privatebin] proxy error:', msg);
			if ('writeHead' in res && !res.headersSent) {
				res.writeHead(502, { 'Content-Type': 'application/json' });
				res.end(
					JSON.stringify({
						error: 'PrivateBin backend unavailable',
						hint: 'Is the backend running on this host? Check pm2 logs.',
					})
				);
			} else if ('destroy' in res) {
				(res as { destroy: () => void }).destroy();
			}
		},
	},
});

app.use(backendProxy);

const server = app.listen(CONFIG.port, () => {
	console.log(`[privatebin] shim listening on :${CONFIG.port}`);
	console.log(`[privatebin] proxying ${CONFIG.basePrefix}/* -> ${CONFIG.backendUrl}`);
	console.log(`[privatebin] native backend calls demux'd from ${NATIVE_PREFIX}/*`);
});

// WebSocket upgrades (e.g. a progress stream at /privatebin/_pb/ws).
// http-proxy-middleware exposes .upgrade when ws:true.
server.on('upgrade', backendProxy.upgrade!);
