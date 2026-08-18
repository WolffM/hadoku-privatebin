/**
 * Edge-auth provenance — the reason the tier gate in gate.ts means anything.
 *
 * edge-router resolves the caller's tier once and stamps every request it
 * proxies with `X-Edge-Auth: <EDGE_AUTH_SECRET>` alongside `X-Hadoku-Tier`,
 * `X-User-Id` and `X-User-Key`. It DELETES any client-supplied copy of those
 * first (workers/edge-router/src/proxy.ts), so downstream of a verified seal
 * they are trustworthy.
 *
 * Downstream of an UNVERIFIED seal they are worthless. privatebin.hadoku.me is
 * a public cloudflared hostname: anyone can reach this process without passing
 * through the edge at all and simply assert `X-Hadoku-Tier: friend`. So we
 * verify the seal and, when it fails, overwrite the identity headers with the
 * most restrictive values rather than merely deleting them — a downstream that
 * treats an absent tier as privileged would otherwise be handed the keys.
 *
 * This mirrors verifyEdgeAuth in hadoku_site's workers/shared/edgeAuth.ts, with
 * one deliberate difference: that one degrades to public on a missing secret
 * only because workers are legitimately reachable at *.workers.dev. Here a
 * missing secret is a misconfiguration, and we still degrade to public (never
 * elevate), which fails the service closed into read-only.
 */

/** Constant-time compare. Length is not secret — the token is fixed-length. */
export function ctEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

export interface EdgeAuthOptions {
	/** The shared secret; '' means none configured. */
	secret: string;
	/** Bare-local opt-out: trust the headers even with no secret configured. */
	allowUnverified: boolean;
}

/** True when this request carries a valid edge seal. */
export function edgeVouched(headers: Record<string, unknown>, opts: EdgeAuthOptions): boolean {
	const got = headers['x-edge-auth'];
	return opts.secret !== '' && typeof got === 'string' && ctEqual(got, opts.secret);
}

/**
 * Pin the request to an anonymous public identity unless edge provenance is
 * proven. Mutates `headers` in place (they are forwarded verbatim upstream).
 *
 * Returns true if the request kept its edge-stamped identity.
 */
export function sanitizeHeaders(headers: Record<string, unknown>, opts: EdgeAuthOptions): boolean {
	if (opts.secret === '') {
		if (opts.allowUnverified) return true; // explicit bare-local opt-out, warned at boot
		// else fall through: nothing can prove provenance, so trust nothing
	} else if (edgeVouched(headers, opts)) {
		return true;
	}
	// Stamp the restrictive identity EXPLICITLY rather than deleting the tier —
	// see the module header for why absent must not be mistakable for trusted.
	headers['x-hadoku-tier'] = 'public';
	delete headers['x-user-id'];
	delete headers['x-user-key'];
	delete headers['x-edge-auth'];
	return false;
}

/** The effective tier of a request, post-sanitize. */
export function effectiveTier(headers: Record<string, unknown>): string {
	const t = headers['x-hadoku-tier'];
	return typeof t === 'string' && t !== '' ? t : 'public';
}
