/**
 * The shim's half of the deploy handover (src/handover.ts, src/index.ts), with
 * real processes. The test plays the supervisor (hadoku_site
 * `services/pm2/lib/handover.py`): it holds the listening socket, starts
 * generations of the built shim on it, and retires the old one with SIGTERM
 * only once the new one says it is accepting, while a poller hits the port.
 * What a caller sees is the assertion: nothing refused, and a request a
 * generation took is answered by that generation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer, request, type Server } from 'node:http';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { handoverFromEnv } from '../handover.js';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const ENTRY = join(REPO_ROOT, 'dist', 'index.js');

/**
 * A miniature supervisor: one listening socket, and generations started
 * (`start <gen>`) or retired (`term <gen>`) on it, told over stdin. It prints
 * `port <n>`, then `ready <gen>` and `exit <gen> <code>`.
 */
const SUPERVISOR = `
import os, select, signal, socket, subprocess, sys, threading
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('127.0.0.1', 0)); s.listen(1024); s.set_inheritable(True)
print('port', s.getsockname()[1], flush=True)
gens = {}
def watch(gen, proc, r):
    if select.select([r], [], [], 60)[0] and os.read(r, 1):
        print('ready', gen, flush=True)
    os.close(r)
    print('exit', gen, proc.wait(), flush=True)
for line in sys.stdin:
    op, gen = line.split()
    if op == 'start':
        r, w = os.pipe()
        env = dict(os.environ, HADOKU_LISTEN_FD=str(s.fileno()), HADOKU_READY_FD=str(w))
        proc = subprocess.Popen([sys.argv[1], sys.argv[2]], pass_fds=(s.fileno(), w),
                                env=env, stdout=subprocess.DEVNULL)
        os.close(w)
        gens[gen] = proc
        threading.Thread(target=watch, args=(gen, proc, r), daemon=True).start()
    elif op == 'term':
        gens[gen].send_signal(signal.SIGTERM)
`;

let backend: Server;
let sup: ChildProcess;
let port: number;
const seen: string[] = [];
const waiters: { re: RegExp; resolve: (m: RegExpMatchArray) => void }[] = [];

function line(re: RegExp): Promise<RegExpMatchArray> {
	for (const l of seen) {
		const m = re.exec(l);
		if (m) return Promise.resolve(m);
	}
	return new Promise((resolve) => waiters.push({ re, resolve }));
}

const send = (cmd: string): void => void sup.stdin!.write(`${cmd}\n`);

function get(path: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const req = request({ host: '127.0.0.1', port, path, agent: false }, (res) => {
			res.resume();
			res.on('end', () => resolve(res.statusCode ?? 0));
		});
		req.on('error', reject);
		req.end();
	});
}

beforeAll(async () => {
	// The real built shim, as PM2 runs it.
	execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { cwd: REPO_ROOT, stdio: 'inherit' });
	backend = createServer((_req, res) => res.writeHead(200).end('ok'));
	await new Promise<void>((r) => backend.listen(0, '127.0.0.1', r));
	const backendPort = (backend.address() as { port: number }).port;
	sup = spawn('python3', ['-c', SUPERVISOR, process.execPath, ENTRY], {
		stdio: ['pipe', 'pipe', 'inherit'],
		env: {
			...process.env,
			PRIVATEBIN_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
			EDGE_AUTH_SECRET: 'handover-test-secret',
		},
	});
	createInterface({ input: sup.stdout! }).on('line', (l) => {
		seen.push(l);
		for (const w of [...waiters]) {
			const m = w.re.exec(l);
			if (m) {
				waiters.splice(waiters.indexOf(w), 1);
				w.resolve(m);
			}
		}
	});
	port = Number((await line(/^port (\d+)$/))[1]);
}, 120_000);

afterAll(async () => {
	sup?.stdin?.end();
	sup?.kill();
	await new Promise<void>((r) => backend.close(() => r()));
});

describe('handoverFromEnv', () => {
	it('is null without the supervisor, and takes the variables out of the env', () => {
		expect(handoverFromEnv({})).toBeNull();
		const env: Record<string, string | undefined> = { HADOKU_LISTEN_FD: '3', HADOKU_READY_FD: '4' };
		expect(handoverFromEnv(env)).toEqual({ listenFd: 3, readyFd: 4 });
		expect(env).toEqual({});
	});

	it('refuses a descriptor that is not one', () => {
		expect(() => handoverFromEnv({ HADOKU_LISTEN_FD: 'x' })).toThrow(/not a descriptor/);
	});
});

describe('a deploy swap', () => {
	it('refuses nothing, and the old generation answers what it took', async () => {
		send('start 1');
		await line(/^ready 1$/);
		expect(await get('/health')).toBe(200);

		// A request gen 1 has accepted and is still reading: the request line
		// is in, the headers are not.
		const half = connect(port, '127.0.0.1');
		await new Promise<void>((r) => half.once('connect', () => r()));
		half.write('GET /health HTTP/1.1\r\nHost: x\r\n');
		let answer = '';
		half.on('data', (d) => (answer += d.toString()));
		const halfClosed = new Promise<void>((r) => half.once('close', () => r()));

		const failures: string[] = [];
		let ok = 0;
		let polling = true;
		const poller = (async () => {
			while (polling) {
				try {
					const status = await get('/health');
					if (status === 200) ok++;
					else failures.push(`HTTP ${status}`);
				} catch (e) {
					failures.push(String(e));
				}
				await new Promise((r) => setTimeout(r, 20));
			}
		})();

		await new Promise((r) => setTimeout(r, 300));
		send('start 2');
		await line(/^ready 2$/);
		send('term 1');
		await new Promise((r) => setTimeout(r, 200));
		half.write('Connection: close\r\n\r\n');
		expect((await line(/^exit 1 (-?\d+)$/))[1]).toBe('0');
		await halfClosed;
		await new Promise((r) => setTimeout(r, 300));
		polling = false;
		await poller;

		expect(answer).toMatch(/^HTTP\/1\.1 200/);
		expect(failures).toEqual([]);
		expect(ok).toBeGreaterThan(10);
		expect(await get('/health')).toBe(200);
		send('term 2');
		expect((await line(/^exit 2 (-?\d+)$/))[1]).toBe('0');
	}, 120_000);
});
