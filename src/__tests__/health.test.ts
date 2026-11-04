/**
 * The hadoku health contract (v1): what `/health` answers, against a real
 * checkout and a real HTTP backend rather than stand-ins.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCommit, probeBackend, healthResponse, SERVICE_ID } from '../health.js';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const HEAD = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], {
	encoding: 'utf8',
}).trim();

let server: Server | null = null;
afterEach(async () => {
	await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
	server = null;
});

/** A backend answering every request with `status`; resolves to its base URL. */
function backend(status: number): Promise<string> {
	server = createServer((_req, res) => res.writeHead(status).end());
	return new Promise((resolve) =>
		server!.listen(0, '127.0.0.1', () => {
			const addr = server!.address() as { port: number };
			resolve(`http://127.0.0.1:${addr.port}`);
		})
	);
}

describe('readCommit', () => {
	it('reads HEAD of the checkout', () => {
		expect(readCommit(REPO_ROOT)).toEqual({ commit: HEAD });
	});

	it('reports null and why outside a checkout, never a made-up sha', () => {
		const dir = mkdtempSync(join(tmpdir(), 'pb-health-'));
		try {
			const info = readCommit(dir);
			expect(info.commit).toBeNull();
			expect(info.commit_error).toContain(dir);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('/health body', () => {
	it('is 200 ok with service and commit when the backend answers', async () => {
		const state = await probeBackend(await backend(200));
		const { status, body } = healthResponse(readCommit(REPO_ROOT), state);
		expect(status).toBe(200);
		expect(body.status).toBe('ok');
		expect(body.service).toBe(SERVICE_ID);
		expect(SERVICE_ID).toBe('privatebin');
		expect(body.commit).toBe(HEAD);
		expect(body.backend).toBe('up');
		expect(body).not.toHaveProperty('reason');
		expect(body).not.toHaveProperty('commit_error');
	});

	it('is 503 degraded with a reason when the backend errors', async () => {
		const state = await probeBackend(await backend(502));
		const { status, body } = healthResponse(readCommit(REPO_ROOT), state);
		expect(status).toBe(503);
		expect(body.status).toBe('degraded');
		expect(body.service).toBe('privatebin');
		expect(body.commit).toBe(HEAD);
		expect(body.backend).toBe('down');
		expect(body.reason).toMatch(/answered HTTP 502/);
	});

	it('is 503 degraded with a reason when the backend is not listening', async () => {
		const url = await backend(200);
		await new Promise<void>((resolve) => server!.close(() => resolve()));
		server = null;
		const { status, body } = healthResponse(readCommit(REPO_ROOT), await probeBackend(url));
		expect(status).toBe(503);
		expect(body.status).toBe('degraded');
		expect(body.reason).toMatch(/unreachable/);
	});

	it('carries commit_error through when the sha could not be read', () => {
		const info = { commit: null, commit_error: 'git rev-parse HEAD in /x: not a git repository' };
		const { body } = healthResponse(info, { backend: 'up' });
		expect(body.commit).toBeNull();
		expect(body.commit_error).toBe(info.commit_error);
	});
});
