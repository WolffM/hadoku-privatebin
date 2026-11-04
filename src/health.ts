/**
 * The hadoku health contract (v1) for this shim's `GET /health`.
 *
 *   200 {status:'ok', service, commit, ...}
 *   503 {status:'degraded', service, commit, reason, ...}
 *
 * `service` is this app's id in hadoku_site scripts/child-apps.json. `commit` is
 * the sha of the code this process is running, read ONCE at startup from the
 * service's own checkout. When it cannot be read the body says `commit: null`
 * and why, in `commit_error`, rather than reporting a made-up value.
 */
import { execFileSync } from 'node:child_process';

export const SERVICE_ID = 'privatebin';

export interface CommitInfo {
	commit: string | null;
	commit_error?: string;
}

/** HEAD of the git checkout at `dir`. */
export function readCommit(dir: string): CommitInfo {
	try {
		const sha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			timeout: 10_000,
		}).trim();
		return { commit: sha };
	} catch (err) {
		const e = err as { stderr?: string; message?: string };
		const why = (e.stderr || e.message || String(err)).trim().split('\n')[0];
		return { commit: null, commit_error: `git rev-parse HEAD in ${dir}: ${why}` };
	}
}

export interface BackendState {
	backend: 'up' | 'down';
	/** Why the backend reads as down. Absent when up. */
	reason?: string;
}

/** Is the PrivateBin container answering? Never throws. */
export async function probeBackend(backendUrl: string): Promise<BackendState> {
	try {
		const r = await fetch(`${backendUrl}/`, { signal: AbortSignal.timeout(3000) });
		if (r.ok) return { backend: 'up' };
		return { backend: 'down', reason: `backend ${backendUrl} answered HTTP ${r.status}` };
	} catch (err) {
		// undici reports every transport failure as "fetch failed"; the cause
		// (ECONNREFUSED, a timeout, a DNS miss) is the actionable part.
		const cause = err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : '';
		const why = err instanceof Error ? err.message : String(err);
		return { backend: 'down', reason: `backend ${backendUrl} unreachable: ${why}${cause}` };
	}
}

/** The status code and body `/health` answers with. */
export function healthResponse(
	commit: CommitInfo,
	state: BackendState,
	now: Date = new Date()
): { status: number; body: Record<string, unknown> } {
	const up = state.backend === 'up';
	return {
		status: up ? 200 : 503,
		body: {
			status: up ? 'ok' : 'degraded',
			service: SERVICE_ID,
			...commit,
			...(up ? {} : { reason: state.reason }),
			backend: state.backend,
			timestamp: now.toISOString(),
		},
	};
}
