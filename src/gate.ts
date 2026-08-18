/**
 * The create gate — the one thing this shim exists to get right.
 *
 * READING A PASTE IS PUBLIC. CREATING ONE IS FRIEND+.
 *
 * Those are the same path with different methods, and the edge tier manifest is
 * path-only (RouteTier in hadoku_site has no `method` field), so the split
 * cannot be expressed at the edge. `/privatebin` is registered there as `public`
 * precisely so a recipient holding a link can open it. This module is therefore
 * the only thing standing between a signed-out stranger and an open paste
 * service on the operator's own domain.
 *
 * ── How the classification was derived ──────────────────────────────────────
 * Read off PrivateBin 2.0.6's own router (`/srv/lib/Request.php` in the
 * privatebin/nginx-fpm-alpine image), not guessed from documentation:
 *
 *   POST | PUT | DELETE  ->  operation = 'create', downgraded to 'delete' only
 *                            when the JSON body carries BOTH a non-empty
 *                            `pasteid` and a non-empty `deletetoken`.
 *   anything else (GET)  ->  'read' | 'jsonld' | 'delete' (via ?deletetoken=)
 *                            | 'yourlsproxy' | 'shlinkproxy'
 *
 * So every write enters through POST, PUT or DELETE. We gate on the method
 * alone and never parse the body — which also keeps a 16 MB attachment
 * streaming straight through instead of being buffered here to be re-emitted.
 *
 * Two consequences worth stating out loud, both verified against the image:
 *
 *  - Burn-after-reading is NOT a client-initiated delete. `Model/Paste::get()`
 *    calls `delete()` inline while serving the read, so a one-time paste burns
 *    on a plain GET. An anonymous recipient never needs a mutating method.
 *  - Delete-by-token is a mutation and is gated. It is the creator's own link,
 *    and creators are friend+ by construction, so this costs nothing real. It
 *    is also the safe side of "default to deny for anything you cannot
 *    classify": we do not crack open the body to look for a deletetoken, so we
 *    do not treat any POST as harmless.
 *
 * Discussion/comments are disabled in cfg/conf.php. That is what keeps this
 * rule total: with comments on, an anonymous recipient would have a legitimate
 * reason to POST and the method alone would stop classifying the request.
 */

/** Canonical ordering, mirrored from hadoku_site workers/shared/auth.ts. */
export const TIER_RANK: Record<string, number> = {
	public: 0,
	friend: 1,
	service: 2,
	wife: 3,
	admin: 4,
};

/** Minimum tier permitted to create (or otherwise mutate) a paste. */
export const CREATE_MIN_TIER = 'friend';

/**
 * Methods that can only ever read. Everything else is treated as a mutation,
 * including methods we do not recognise — that is the default-deny.
 */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** True when the method can only read, so an anonymous caller may proceed. */
export function isReadMethod(method: string): boolean {
	return READ_METHODS.has(method.toUpperCase());
}

/** True when `tier` ranks at or above `min`. Unknown tiers rank as public. */
export function tierAtLeast(tier: string, min: string): boolean {
	const have = TIER_RANK[tier] ?? TIER_RANK.public;
	const need = TIER_RANK[min] ?? TIER_RANK.public;
	return have >= need;
}

/**
 * The whole decision. `tier` must be the POST-sanitize tier — see edge-auth.ts,
 * which pins it to 'public' on any request that cannot prove it came via the
 * edge. Passing a raw client header here would defeat the entire module.
 */
export function mayProceed(method: string, tier: string): boolean {
	if (isReadMethod(method)) return true;
	return tierAtLeast(tier, CREATE_MIN_TIER);
}

/**
 * PrivateBin's own error envelope (`Controller::_json_error`), so a refusal
 * renders as a real message in the UI instead of a generic failure.
 */
export function refusalBody(isJsonApi: boolean): { body: string; contentType: string } {
	const message =
		'Creating a document on this PrivateBin requires a hadoku.me friend account. ' +
		'Reading a document you have a link for does not — that stays public.';
	return isJsonApi
		? { body: JSON.stringify({ status: 1, message }), contentType: 'application/json' }
		: { body: message + '\n', contentType: 'text/plain; charset=utf-8' };
}

/**
 * PrivateBin's error envelope again, for a body we refuse to forward at all.
 * Quotes the usable figure rather than the raw cap: the cap is on ciphertext,
 * and what the person actually has is a file, which base64 inflates ~33% before
 * it is ever encrypted.
 */
export function tooLargeBody(isJsonApi: boolean, sizeLimitBytes: number): {
	body: string;
	contentType: string;
} {
	const usableMb = Math.floor((sizeLimitBytes / (1024 * 1024)) * 0.75);
	const message =
		`That is too large to send. The practical ceiling is around ${usableMb} MB of ` +
		'original file, because attachments are base64-encoded before they are encrypted. ' +
		'For anything bigger use hadoku.me/filetransfer.';
	return isJsonApi
		? { body: JSON.stringify({ status: 1, message }), contentType: 'application/json' }
		: { body: message + '\n', contentType: 'text/plain; charset=utf-8' };
}

/**
 * Mirrors PrivateBin's `Request::_detectJsonRequest` closely enough to pick the
 * right error envelope. Only the two simple cases matter here — the full media
 * type negotiation exists upstream for content selection, and guessing wrong
 * only changes whether a refusal is JSON or text, never whether it refuses.
 */
export function isJsonApiCall(headers: Record<string, unknown>): boolean {
	const requestedWith = headers['x-requested-with'];
	if (typeof requestedWith === 'string' && requestedWith === 'JSONHttpRequest') return true;
	const accept = headers['accept'];
	if (typeof accept !== 'string') return false;
	return (
		accept.includes('application/json') &&
		!accept.includes('text/html') &&
		!accept.includes('application/xhtml+xml')
	);
}
