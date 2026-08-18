/**
 * The gate is the only thing standing between a signed-out stranger and an open
 * paste service on the operator's domain, so it is tested rather than reasoned
 * about. Each case names the real-world request it stands for.
 */
import { describe, it, expect } from 'vitest';
import {
	mayProceed,
	tierAtLeast,
	isReadMethod,
	isJsonApiCall,
	tooLargeBody,
	CREATE_MIN_TIER,
} from '../gate.js';
import { sanitizeHeaders, effectiveTier, ctEqual } from '../edge-auth.js';

const SECRET = 'edge-secret-value-0123456789abcdef';
const SEALED = { secret: SECRET, allowUnverified: false };

describe('reading is public', () => {
	it.each(['GET', 'HEAD', 'OPTIONS'])('allows anonymous %s', (method) => {
		expect(mayProceed(method, 'public')).toBe(true);
	});

	it('allows an anonymous burn-after-reading open', () => {
		// Verified against PrivateBin 2.0.6: Model/Paste::get() deletes the paste
		// inline while serving the read, so burning is a plain GET and needs no
		// mutating method from the recipient.
		expect(mayProceed('GET', 'public')).toBe(true);
	});
});

describe('creating is friend+', () => {
	it('refuses an anonymous POST — the whole point of this module', () => {
		expect(mayProceed('POST', 'public')).toBe(false);
	});

	it.each(['friend', 'service', 'wife', 'admin'])('allows %s to create', (tier) => {
		expect(mayProceed('POST', tier)).toBe(true);
	});

	it.each(['PUT', 'DELETE'])('gates %s too — PrivateBin routes it as create', (method) => {
		// Request.php sets operation='create' for POST, PUT and DELETE alike,
		// downgrading to 'delete' only on a body carrying pasteid+deletetoken.
		expect(mayProceed(method, 'public')).toBe(false);
		expect(mayProceed(method, 'friend')).toBe(true);
	});

	it('denies by default on a method it does not classify', () => {
		expect(mayProceed('PATCH', 'public')).toBe(false);
		expect(mayProceed('PROPFIND', 'public')).toBe(false);
		expect(isReadMethod('TRACE')).toBe(false);
	});

	it('treats an unknown tier as public rather than ranking it above friend', () => {
		expect(mayProceed('POST', 'superuser')).toBe(false);
		expect(mayProceed('POST', '')).toBe(false);
		expect(tierAtLeast('nonsense', CREATE_MIN_TIER)).toBe(false);
	});

	it('is case-insensitive about the method', () => {
		expect(mayProceed('post', 'public')).toBe(false);
		expect(mayProceed('get', 'public')).toBe(true);
	});
});

describe('a forged tier cannot create', () => {
	it('pins a spoofed tier to public when there is no edge seal', () => {
		// A direct hit on privatebin.hadoku.me claiming to be a friend.
		const headers: Record<string, unknown> = {
			'x-hadoku-tier': 'admin',
			'x-user-id': 'someone-elses-id',
			'x-user-key': 'stolen',
		};
		expect(sanitizeHeaders(headers, SEALED)).toBe(false);
		expect(effectiveTier(headers)).toBe('public');
		expect(headers['x-user-id']).toBeUndefined();
		expect(headers['x-user-key']).toBeUndefined();
		expect(mayProceed('POST', effectiveTier(headers))).toBe(false);
	});

	it('pins a spoofed tier when the seal is present but wrong', () => {
		const headers: Record<string, unknown> = {
			'x-edge-auth': 'not-the-secret-but-same-length-padding',
			'x-hadoku-tier': 'friend',
		};
		expect(sanitizeHeaders(headers, SEALED)).toBe(false);
		expect(mayProceed('POST', effectiveTier(headers))).toBe(false);
	});

	it('keeps the tier when the seal verifies', () => {
		const headers: Record<string, unknown> = {
			'x-edge-auth': SECRET,
			'x-hadoku-tier': 'friend',
			'x-user-id': 'u-123',
		};
		expect(sanitizeHeaders(headers, SEALED)).toBe(true);
		expect(effectiveTier(headers)).toBe('friend');
		expect(headers['x-user-id']).toBe('u-123');
		expect(mayProceed('POST', effectiveTier(headers))).toBe(true);
	});

	it('fails CLOSED with no secret configured — read-only, never open', () => {
		const headers: Record<string, unknown> = { 'x-hadoku-tier': 'admin' };
		expect(sanitizeHeaders(headers, { secret: '', allowUnverified: false })).toBe(false);
		expect(mayProceed('POST', effectiveTier(headers))).toBe(false);
		expect(mayProceed('GET', effectiveTier(headers))).toBe(true);
	});

	it('trusts headers unverified ONLY behind the explicit bare-local opt-out', () => {
		const headers: Record<string, unknown> = { 'x-hadoku-tier': 'friend' };
		expect(sanitizeHeaders(headers, { secret: '', allowUnverified: true })).toBe(true);
		expect(mayProceed('POST', effectiveTier(headers))).toBe(true);
	});

	it('does not let a truncated seal pass', () => {
		expect(ctEqual(SECRET.slice(0, -1), SECRET)).toBe(false);
		expect(ctEqual('', SECRET)).toBe(false);
		expect(ctEqual(SECRET, SECRET)).toBe(true);
	});
});

describe('refusal envelope selection', () => {
	it('detects PrivateBin’s own JSON API marker', () => {
		expect(isJsonApiCall({ 'x-requested-with': 'JSONHttpRequest' })).toBe(true);
	});

	it('treats a browser navigation as HTML', () => {
		expect(isJsonApiCall({ accept: 'text/html,application/xhtml+xml,*/*' })).toBe(false);
	});

	it('treats a bare JSON accept as the API', () => {
		expect(isJsonApiCall({ accept: 'application/json' })).toBe(true);
	});

	it('does not crash on absent headers', () => {
		expect(isJsonApiCall({})).toBe(false);
	});
});

describe('oversize refusal', () => {
	it('quotes the usable file size, not the raw ciphertext cap', () => {
		// 16 MiB of ciphertext is ~12 MB of file once base64 overhead is undone.
		// The number has to match the notice in cfg/conf.php or the UI promises
		// one thing and the error blames another.
		const { body } = tooLargeBody(true, 16 * 1024 * 1024);
		expect(JSON.parse(body).message).toContain('12 MB');
	});

	it('uses PrivateBin’s envelope so the UI renders it as a real message', () => {
		const { body, contentType } = tooLargeBody(true, 16 * 1024 * 1024);
		expect(contentType).toBe('application/json');
		expect(JSON.parse(body).status).toBe(1);
	});

	it('falls back to plain text for a non-API caller', () => {
		const { contentType } = tooLargeBody(false, 16 * 1024 * 1024);
		expect(contentType).toContain('text/plain');
	});
});
