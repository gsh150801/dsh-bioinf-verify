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
export type ClaimCategory = 'literature' | 'patent' | 'clinical_trial' | 'dataset' | 'protein' | 'webpage' | 'unlinked';
export type AspectName = 'identifier_scan' | 'existence' | 'retraction' | 'title_agreement' | 'semantic_consistency' | 'url_accessibility';
export type CheckStatus = 'passed' | 'failed' | 'warning' | 'error' | 'skipped';
export interface AspectCheck {
    readonly aspect: AspectName;
    /** Which plugin component produced this result (doi_verify, url_verify, semantic…). */
    readonly component: string;
    readonly startedAt: string;
    readonly finishedAt: string;
    readonly status: CheckStatus;
    /** Human-readable verdict line, quoted into the verification report. */
    readonly detail: string;
    /** Target of this specific check when the claim carries several (e.g. each URL). */
    readonly target?: string;
    /** Full component payload — the audit trail. */
    readonly evidence?: Record<string, unknown>;
}
export interface ClaimIdentifiers {
    doi?: string;
    pmid?: string;
    nctId?: string;
    uniprot?: string;
    geo?: string;
    sra?: string;
    patent?: string;
    urls?: string[];
}
export interface ClaimRecord {
    readonly claimId: string;
    readonly claim: string;
    /** Verbatim fragment of the report this claim anchors to (for annotation). */
    readonly quote: string;
    /** Paragraph index in the original report (annotation fallback anchor). */
    readonly paraIndex: number;
    readonly category: ClaimCategory;
    readonly identifiers: ClaimIdentifiers;
    /** Title the report claims for this source (drives title_agreement). */
    readonly expectedTitle?: string;
    /** Source of the decomposition: deterministic scan or LLM pass. */
    readonly origin: 'scan' | 'llm' | 'merged';
    readonly aspects: AspectCheck[];
    status: 'pending' | 'in_progress' | 'passed' | 'failed' | 'warning';
    /** Names of the aspects that did NOT pass — the report points at these. */
    failureAspects: string[];
}
export type JobStatus = 'decomposing' | 'checking' | 'annotating' | 'done' | 'error';
export interface JobEvent {
    readonly at: string;
    readonly event: string;
    readonly detail: string;
}
export interface VerificationJob {
    readonly jobId: string;
    createdAt: string;
    updatedAt: string;
    status: JobStatus;
    /** The original report exactly as received. */
    reportText: string;
    reportName: string;
    options: {
        semanticChecks: boolean;
    };
    claims: ClaimRecord[];
    /** Append-only event log (audit trail beyond the per-aspect records). */
    log: JobEvent[];
    /** Set by report_verify_finish: where annotated outputs were written. */
    outputs?: {
        annotatedPath: string;
        reportPath: string;
    };
}
export declare function newClaimId(claims: readonly ClaimRecord[]): string;
/** Recompute a claim's roll-up status from its aspect rows. */
export declare function rollUpClaim(claim: ClaimRecord): ClaimRecord['status'];
export declare function refreshFailureAspects(claim: ClaimRecord): void;
export declare class JobStore {
    private readonly dir;
    constructor(dir: string);
    get directory(): string;
    private pathFor;
    static newJobId(now?: Date): string;
    /** Persist immediately — called after EVERY mutation by the workflow. */
    save(job: VerificationJob): Promise<void>;
    get(jobId: string): Promise<VerificationJob | undefined>;
    /** Append a log line AND persist — one call, always durable. */
    log(job: VerificationJob, event: string, detail: string): Promise<void>;
    list(limit: number): Promise<VerificationJob[]>;
}
/** Create a fresh job shell (pre-decomposition). */
export declare function createVerificationJob(jobId: string, report: string, options: {
    reportName?: string;
    semanticChecks: boolean;
}): VerificationJob;
/** Statistics helper used by the annotated appendix and status tools. */
export declare function jobStats(job: VerificationJob): {
    total: number;
    passed: number;
    failed: number;
    warning: number;
    pending: number;
    failedAspects: Record<string, number>;
};
//# sourceMappingURL=ledger.d.ts.map