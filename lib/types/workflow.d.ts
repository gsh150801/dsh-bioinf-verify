/**
 * Verification workflow — per-claim, per-aspect checking pipeline over the
 * durable job ledger, plus report annotation and the verification appendix.
 *
 * One call to `stepJob` executes exactly ONE aspect check and persists the
 * ledger, so any crash leaves a resumable, auditable trail. `planAspects`
 * derives, per claim category, which components run:
 *
 *   literature      existence (+retraction for PMID) + title_agreement + semantic
 *   patent          existence (PatentsView; skipped without a key)
 *   clinical_trial  existence (ClinicalTrials.gov)
 *   dataset         existence (GEO / SRA)
 *   protein         existence (UniProt)
 *   webpage         url_accessibility (one check per cited URL)
 *   unlinked        identifier_scan (fails with advice — nothing to verify)
 *
 * @module dsh-bioinf-verify/workflow
 */
import type { ChatFn } from './llm.ts';
import type { BioHttpClient } from './biohttp.ts';
import type { NcbiSearchConfig } from './evidence.ts';
import { JobStore, type AspectCheck, type ClaimRecord, type VerificationJob } from './ledger.ts';
export interface VerifyDeps {
    readonly client: BioHttpClient;
    readonly ncbi: NcbiSearchConfig;
    readonly chat: ChatFn;
    readonly patentsApiKey: string;
}
/** Queue of pending checks for one claim, in execution order. */
export declare function planAspects(job: VerificationJob, claim: ClaimRecord): Array<{
    aspect: AspectCheck['aspect'];
    target?: string;
}>;
/**
 * Execute ONE pending aspect check and persist. Returns a progress summary;
 * `finished` when nothing is pending.
 */
export declare function stepJob(store: JobStore, deps: VerifyDeps, jobId: string): Promise<{
    finished: boolean;
    action: string;
    summary: string;
    remainingChecks: number;
    claim?: {
        claimId: string;
        status: string;
        failureAspects: string[];
    };
}>;
export declare function startVerification(store: JobStore, deps: VerifyDeps, options: {
    report: string;
    reportName?: string;
    semanticChecks?: boolean;
}): Promise<VerificationJob>;
export declare const ASPECT_LABEL: Record<string, string>;
/** Build the inline marker for one failing/warning claim. */
export declare function markerFor(claim: ClaimRecord): string | undefined;
/** Insert annotation markers into the original report after each anchored quote. */
export declare function annotateReport(job: VerificationJob): {
    annotated: string;
    unanchored: string[];
};
/** Full verification appendix: summary, per-claim matrix, failure details. */
export declare function verificationAppendix(job: VerificationJob): string;
/** Produce annotated.md + verification-report.md and mark the job done. */
export declare function finalizeJob(store: JobStore, deps: {
    workDir: string;
}, jobId: string): Promise<{
    annotatedPath: string;
    reportPath: string;
    annotated: string;
    appendix: string;
}>;
//# sourceMappingURL=workflow.d.ts.map