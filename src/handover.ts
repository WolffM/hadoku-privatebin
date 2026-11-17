/**
 * Deploy handover: this shim's half of hadoku_site's socket mover.
 *
 * In production the PM2 wrapper runs this process under the handover
 * supervisor (hadoku_site `services/pm2/lib/handover.py`), which binds
 * 127.0.0.1:9005 ONCE and keeps it open across deploys. A deploy starts the
 * next generation on the same socket, waits for it to say it is accepting, and
 * only then sends this one SIGTERM. Nobody is refused at any instant: a
 * connection made while no generation accepts waits in the socket's backlog.
 *
 * The contract, all of it here:
 *
 * - `HADOKU_LISTEN_FD`: serve this inherited listening socket; never bind one.
 * - `HADOKU_READY_FD`: write one byte once accepting, then close it.
 * - SIGTERM: stop accepting, finish what is in flight, exit. The handler must
 *   be installed BEFORE ready is reported: the swap can come the instant
 *   after, and the default action would kill a request just accepted.
 *
 * Without the variables (`pnpm dev`, a bare `node dist/index.js`) the shim
 * binds its port as it always has.
 */
import { closeSync, writeSync } from 'node:fs';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';

/** Every raw connection a server holds, so a drain can cut what outlives its grace. */
const open = new WeakMap<Server, Set<Socket>>();

/** The supervisor's descriptors: the listener and the ready pipe. */
export interface Handover {
	listenFd: number;
	readyFd: number | null;
}

function descriptor(name: string, raw: string): number {
	const fd = Number(raw);
	if (!Number.isInteger(fd) || fd < 0) throw new Error(`${name} is not a descriptor: ${JSON.stringify(raw)}`);
	return fd;
}

/**
 * The handover this process was started with, or null when it binds its own
 * port. Takes the variables OUT of `env`: the descriptors are this process's
 * alone.
 */
export function handoverFromEnv(env: Record<string, string | undefined> = process.env): Handover | null {
	const listen = env.HADOKU_LISTEN_FD;
	const ready = env.HADOKU_READY_FD;
	delete env.HADOKU_LISTEN_FD;
	delete env.HADOKU_READY_FD;
	if (listen === undefined || listen === '') return null;
	return {
		listenFd: descriptor('HADOKU_LISTEN_FD', listen),
		readyFd: ready === undefined || ready === '' ? null : descriptor('HADOKU_READY_FD', ready),
	};
}

/**
 * Accept on `fd` (an inherited socket), or bind `port` on `host` when it is
 * null. Resolves once the server accepts; rejects on a listen error.
 */
export function listen(server: Server, port: number, host: string, fd: number | null): Promise<void> {
	const sockets = new Set<Socket>();
	open.set(server, sockets);
	server.on('connection', (socket: Socket) => {
		sockets.add(socket);
		socket.once('close', () => sockets.delete(socket));
	});
	return new Promise((accepting, failed) => {
		server.once('error', failed);
		const done = (): void => {
			server.off('error', failed);
			accepting();
		};
		if (fd === null) server.listen(port, host, done);
		else server.listen({ fd }, done);
	});
}

/** Tell the supervisor this generation accepts. Only after the SIGTERM handler is installed. */
export function reportReady(handover: Handover | null): void {
	if (handover === null || handover.readyFd === null) return;
	writeSync(handover.readyFd, 'R');
	closeSync(handover.readyFd);
}

/**
 * Stop accepting and let what is in flight finish. Closing the server closes
 * this process's copy of the socket only; the supervisor's stays open for the
 * next generation. Idle keep-alive connections close at once; any connection
 * still open after `graceMs` is cut. Resolves once the server has closed.
 */
export function drain(server: Server, graceMs: number): Promise<void> {
	return new Promise((closed) => {
		server.close(() => closed());
		server.closeIdleConnections();
		setTimeout(() => {
			server.closeAllConnections();
			for (const socket of open.get(server) ?? []) socket.destroy();
		}, graceMs).unref();
	});
}
