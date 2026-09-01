/**
 * `dsh-bioinf-verify`: standalone verification plugin for DeepSeek Harness.
 *
 * Verification is a different concern from resource routing (dsh-bioinf-
 * routed), so it lives in its own package. Two layers:
 *
 * COMPONENT TOOLS (each independently callable, and the pipeline's parts):
 *   - url_verify                — cited link exists/reachable (redirect, soft-404)
 *   - doi/pmid/trial/uniprot/…  — registry existence checks (+retraction scan)
 *   - claim_audit               — batch citation matrix
 *   - claim_semantic_check      — claim-vs-source meaning consistency (temp 0)
 *
 * REPORT WORKFLOW (the headline feature — verify a whole report):
 *   - report_verify_start  — decompose the report into categorized evidence
 *                            points (deterministic scan + LLM pass, merged)
 *   - report_verify_step   — run the NEXT aspect check, persisting the ledger
 *                            after every single check (auditable/resumable)
 *   - report_verify_status — structured per-claim/per-aspect status
 *   - report_verify_finish — original report with inline failure annotations
 *                            + full verification report appended
 *   - report_verify_list   — recent jobs
 *
 * Everything runs through the durable job ledger (`~/.dsh/science-verification/
 * <jobId>.json`): structured, auditable, traceable, recoverable.
 *
 * @module dsh-bioinf-verify
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "dsh-bioinf-verify";
export declare const inject: string[];
export interface Config {
    /** Ledger + annotated outputs root (default ~/.dsh/science-verification). */
    workDir: string;
    contactEmail: string;
    pubmedApiKey: string;
    patentsviewApiKey: string;
    /** Register the report-verification workflow guidance section. */
    guidance: boolean;
    /** Chat endpoint powering decomposition + semantic entailment. */
    llmRouter: {
        enabled: boolean;
        baseURL: string;
        model: string;
        apiKey: string;
    };
}
export declare const Config: z<Config>;
export declare const GUIDANCE: string;
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map