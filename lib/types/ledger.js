/**
 * Verification job ledger — the structured backbone of every report check.
 *
 * dsh philosophy applied to verification: the whole process is ONE durable,
 * inspectable data structure. Every decomposition decision, every aspect
 * check (with timestamps, component name, and raw evidence payload) is
 * recorded and **persisted to disk immediately after each unit of work**, so
 * a run is auditable after the fact, resumable after a crash, and every
 * verdict in the final report traces to a ledger row.
 *
 * @module dsh-bioinf-verify/ledger
 */
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
export function newClaimId(claims) {
    return `C${claims.length + 1}`;
}
/** Recompute a claim's roll-up status from its aspect rows. */
export function rollUpClaim(claim) {
    if (claim.aspects.length === 0)
        return 'pending';
    const failing = claim.aspects.some(aspect => aspect.status === 'failed');
    if (failing)
        return 'failed';
    const blocking = claim.aspects.some(aspect => aspect.status === 'error');
    if (blocking)
        return 'warning'; // errors mean "could not verify", not "verified false"
    const warned = claim.aspects.some(aspect => aspect.status === 'warning');
    return warned ? 'warning' : 'passed';
}
export function refreshFailureAspects(claim) {
    claim.failureAspects = claim.aspects
        .filter(aspect => aspect.status === 'failed' || aspect.status === 'error')
        .map(aspect => aspect.aspect);
    claim.status = rollUpClaim(claim);
}
export class JobStore {
    dir;
    constructor(dir) {
        this.dir = dir;
    }
    get directory() {
        return this.dir;
    }
    pathFor(jobId) {
        return join(this.dir, `${encodeURIComponent(jobId)}.json`);
    }
    static newJobId(now = new Date()) {
        const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
        return `verify-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
    }
    /** Persist immediately — called after EVERY mutation by the workflow. */
    async save(job) {
        job.updatedAt = new Date().toISOString();
        await mkdir(this.dir, { recursive: true });
        await writeFile(this.pathFor(job.jobId), JSON.stringify(job, null, 1), 'utf8');
    }
    async get(jobId) {
        try {
            return JSON.parse(await readFile(this.pathFor(jobId), 'utf8'));
        }
        catch {
            return undefined;
        }
    }
    /** Append a log line AND persist — one call, always durable. */
    async log(job, event, detail) {
        job.log.push({ at: new Date().toISOString(), event, detail: detail.slice(0, 300) });
        await this.save(job);
    }
    async list(limit) {
        let names = [];
        try {
            const { readdir } = await import('node:fs/promises');
            names = await readdir(this.dir);
        }
        catch {
            return [];
        }
        const loaded = await Promise.all(names.filter(name => name.endsWith('.json')).map(async (name) => {
            try {
                return JSON.parse(await readFile(join(this.dir, name), 'utf8'));
            }
            catch {
                return undefined;
            }
        }));
        return loaded.filter((job) => job !== undefined)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, limit);
    }
}
/** Create a fresh job shell (pre-decomposition). */
export function createVerificationJob(jobId, report, options) {
    const now = new Date().toISOString();
    return {
        jobId,
        createdAt: now,
        updatedAt: now,
        status: 'decomposing',
        reportText: report,
        reportName: options.reportName ?? '',
        options: { semanticChecks: options.semanticChecks },
        claims: [],
        log: [{ at: now, event: 'created', detail: `${report.length} chars received` }],
    };
}
/** Statistics helper used by the annotated appendix and status tools. */
export function jobStats(job) {
    const failedAspects = {};
    let passed = 0;
    let failed = 0;
    let warning = 0;
    let pending = 0;
    for (const claim of job.claims) {
        if (claim.status === 'passed')
            passed++;
        else if (claim.status === 'failed')
            failed++;
        else if (claim.status === 'warning')
            warning++;
        else
            pending++;
        for (const aspect of claim.aspects) {
            if (aspect.status === 'failed' || aspect.status === 'error') {
                failedAspects[aspect.aspect] = (failedAspects[aspect.aspect] ?? 0) + 1;
            }
        }
    }
    return { total: job.claims.length, passed, failed, warning, pending, failedAspects };
}
//# sourceMappingURL=ledger.js.map