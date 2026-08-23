/**
 * PrivateBin — tunnel-proxy shim
 *
 * cloudflared points privatebin.hadoku.me at THIS process, and this process is
 * the only thing that talks to the PrivateBin container (which binds loopback).
 *
 *   browser -> edge-router (hadoku.me/privatebin/*) -> tunnel -> shim :9005
 *           -> privatebin/nginx-fpm-alpine :8090
 *
 * Three jobs, in order of how much they matter:
 *
 *  1. GATE. Read is public, create is friend+ — a split the path-only edge tier
 *     manifest cannot express. See gate.ts, and edge-auth.ts for why the tier
 *     header can be believed at all.
 *  2. STRIP. PrivateBin serves from its document root and knows nothing about
 *     `/privatebin`. The edge forwards the prefix unchanged, so we remove it.
 *  3. THEME. One stylesheet link injected into the HTML shell. PrivateBin runs
 *     unforked — no PHP, no template copy — so injecting from out here is what
 *     keeps upstream CVE patching a `docker pull` instead of a merge.
 */

import express from 'express';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CONFIG } from './config.js';
import { sanitizeHeaders, effectiveTier } from './edge-auth.js';
import { mayProceed, refusalBody, tooLargeBody, isJsonApiCall, CREATE_MIN_TIER } from './gate.js';

// dist/index.js -> repo root, so `web/` resolves whatever the working directory.
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const EDGE_AUTH = {
	secret: CONFIG.edgeAuthSecret,
	allowUnverified: CONFIG.allowUnverifiedEdge,
};

/** Our own assets, namespaced away from anything PrivateBin serves. */
const ASSET_PREFIX = `${CONFIG.basePrefix}/_hadoku`;

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

// ── Health (public; never proxied, never gated) ─────────────────────────────
// Probes the container so monitoring can tell "shim up, backend down" from
// "shim down". The monitoring probe hits this directly, without an edge seal.
app.get('/health', async (_req, res) => {
	let backend: 'up' | 'down' = 'down';
	try {
		const r = await fetch(`${CONFIG.backendUrl}/`, { signal: AbortSignal.timeout(3000) });
		backend = r.ok ? 'up' : 'down';
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

// ── Edge provenance ─────────────────────────────────────────────────────────
// Runs before everything below, so no later handler ever sees a tier header
// that did not come through edge-router. Order is the security property here.
app.use((req, _res, next) => {
	sanitizeHeaders(req.headers as Record<string, unknown>, EDGE_AUTH);
	next();
});

// ── Our assets ──────────────────────────────────────────────────────────────
// Served before the gate and before the proxy: they are public static files,
// and PrivateBin must never see this path.
app.use(
	ASSET_PREFIX,
	express.static(join(REPO_ROOT, 'web'), {
		maxAge: '1h',
		fallthrough: false,
		index: false,
	})
);

// ── Trailing slash ──────────────────────────────────────────────────────────
// PrivateBin's templates reference assets RELATIVELY (`css/…`, `js/…`,
// `img/…`). Relative to `/privatebin` those resolve to `/css/…` at the root of
// hadoku.me — off this app entirely. Relative to `/privatebin/` they resolve
// correctly. So the bare prefix must redirect, carrying the query string with
// it (a paste link is `/privatebin/?pasteid#key`, and the fragment never leaves
// the browser).
app.use((req, res, next) => {
	if (req.path === CONFIG.basePrefix) {
		const qs = req.originalUrl.slice(req.path.length);
		res.redirect(301, `${CONFIG.basePrefix}/${qs}`);
		return;
	}
	next();
});

// ── The gate ────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
	const headers = req.headers as Record<string, unknown>;
	const tier = effectiveTier(headers);
	if (mayProceed(req.method, tier)) {
		next();
		return;
	}
	const { body, contentType } = refusalBody(isJsonApiCall(headers));
	console.warn(
		`[privatebin] refused ${req.method} ${req.path} — tier=${tier} < ${CREATE_MIN_TIER}`
	);
	res.status(403).type(contentType).send(body);
});

// ── Body size ───────────────────────────────────────────────────────────────
// Past client_max_body_size, nginx in the container stops reading and resets the
// connection: the upload dies as a broken pipe with no explanation, after the
// browser has already spent the time encrypting the whole thing. Answering here
// on Content-Length costs nothing and turns that into a sentence someone can act
// on. A chunked request has no Content-Length to check — those still fall
// through to nginx, which is the backstop rather than the front door.
app.use((req, res, next) => {
	const declared = Number(req.headers['content-length']);
	if (!Number.isFinite(declared) || declared <= CONFIG.maxBodyBytes) {
		next();
		return;
	}
	const { body, contentType } = tooLargeBody(
		isJsonApiCall(req.headers as Record<string, unknown>),
		CONFIG.sizeLimitBytes
	);
	console.warn(`[privatebin] refused ${req.method} ${req.path} — body ${declared}B over cap`);

	// Answering before the client has finished sending is what makes this a
	// RESET rather than a reply: the peer is still writing, its write fails, and
	// the message never gets read. Edge-router turned exactly that into a
	// "backend may be offline" 500 for a request the backend was never going to
	// see. So drain first and reply at end-of-body, the same lingering-close
	// dance nginx does — the upload is wasted either way; this only decides
	// whether the person is told why.
	let drained = 0;
	const reply = () => {
		if (!res.headersSent) res.status(413).type(contentType).send(body);
	};
	req.on('data', (chunk: { length: number }) => {
		drained += chunk.length;
		// Past the point where a courteous reply is still worth the bandwidth,
		// stop reading. A client this far over its own Content-Length is not
		// waiting for prose.
		if (drained > CONFIG.maxDrainBytes) {
			console.warn(`[privatebin] drain cap hit at ${drained}B — closing`);
			res.status(413).type(contentType).set('Connection', 'close').send(body);
			req.destroy();
		}
	});
	req.on('end', reply);
	req.on('error', () => res.destroy());
});

/** Inject our stylesheet last in <head> so it wins the cascade. */
function injectTheme(html: string): string {
	const link = `\t\t<link type="text/css" rel="stylesheet" href="_hadoku/theme.css" />\n\t</head>`;
	return html.includes('</head>') ? html.replace('</head>', link) : html;
}

/**
 * Buffering is opt-in per request, because responseInterceptor holds the whole
 * body in memory and a paste read can be the full sizelimit. Only PrivateBin's
 * document root can return the HTML shell (`Controller::_view`); every asset,
 * and every ciphertext read, lives elsewhere or comes back as JSON. So we
 * buffer exactly one path, and still confirm the content type before touching
 * anything.
 */
function servesHtmlShell(method: string, url: string, headers: Record<string, unknown>): boolean {
	if (method !== 'GET' && method !== 'HEAD') return false;
	const path = url.split('?')[0];
	if (path !== '/' && path !== '') return false;
	return !isJsonApiCall(headers);
}

/** Strip the platform prefix; PrivateBin serves everything from its docroot. */
function stripPrefix(url: string): string {
	return url.startsWith(CONFIG.basePrefix) ? url.slice(CONFIG.basePrefix.length) || '/' : url;
}

interface ProxyErrorTarget {
	writeHead?: (status: number, headers: Record<string, string>) => void;
	end?: (body: string) => void;
	headersSent?: boolean;
	destroy?: () => void;
}

function onProxyError(err: Error, _req: unknown, res: unknown): void {
	console.error('[privatebin] proxy error:', String(err?.message || err));
	const target = res as ProxyErrorTarget;
	if (target.writeHead && !target.headersSent) {
		target.writeHead(502, { 'Content-Type': 'application/json' });
		target.end?.(
			JSON.stringify({
				error: 'PrivateBin backend unavailable',
				hint: 'Is the privatebin container running? `docker compose ps` on the host.',
			})
		);
	} else {
		target.destroy?.();
	}
}

const proxyOptions = {
	target: CONFIG.backendUrl,
	changeOrigin: true,
	proxyTimeout: CONFIG.timeoutMs,
	timeout: CONFIG.timeoutMs,
	pathRewrite: stripPrefix,
};

/** Non-buffering: assets, ciphertext reads, uploads. The default path. */
const streamProxy = createProxyMiddleware({
	...proxyOptions,
	on: { error: onProxyError },
});

/** Buffering: the HTML shell only, so the theme link can be injected. */
const htmlProxy = createProxyMiddleware({
	...proxyOptions,
	selfHandleResponse: true,
	on: {
		error: onProxyError,
		proxyRes: responseInterceptor(async (buffer, proxyRes) => {
			const type = String(proxyRes.headers['content-type'] || '');
			if (!type.includes('text/html')) return buffer;
			return injectTheme(buffer.toString('utf8'));
		}),
	},
});

app.use((req, res, next) => {
	const headers = req.headers as Record<string, unknown>;
	const shell = servesHtmlShell(req.method, stripPrefix(req.url), headers);
	(shell ? htmlProxy : streamProxy)(req, res, next);
});

app.listen(CONFIG.port, CONFIG.bindHost, () => {
	console.log(`[privatebin] shim listening on ${CONFIG.bindHost}:${CONFIG.port}`);
	console.log(`[privatebin] ${CONFIG.basePrefix}/* -> ${CONFIG.backendUrl} (prefix stripped)`);
	console.log(`[privatebin] create requires tier >= ${CREATE_MIN_TIER}; read is public`);
	if (CONFIG.edgeAuthSecret === '') {
		if (CONFIG.allowUnverifiedEdge) {
			console.warn(
				'[privatebin] WARNING: PRIVATEBIN_INSECURE_NO_EDGE_AUTH=1 — tier headers trusted ' +
					'UNVERIFIED. Anyone who can reach this port can create pastes. Bare-local only.'
			);
		} else {
			console.warn(
				'[privatebin] WARNING: EDGE_AUTH_SECRET unset — failing closed: every request is ' +
					'degraded to public, so NOTHING can be created. Wire EDGE_AUTH_SECRET via the vault.'
			);
		}
	} else {
		console.log('[privatebin] edge-auth provenance enforced (spoofed tier headers pinned to public)');
	}
});
