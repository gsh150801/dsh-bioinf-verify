/**
 * Semantic claim-consistency checking ("含义/意思校验").
 *
 * Registry checks (`evidence.ts`) prove a source EXISTS; this module proves
 * the report actually SAYS what the source says — the check most reports
 * lack. Design (hybrid by necessity, guarded against the ChemCrow trap):
 *
 *   1. GROUND TRUTH  — the source text (abstract/description) is fetched
 *      VERBATIM from the authoritative registry (PubMed efetch, Europe PMC by
 *      DOI, GEO DataSets summary, UniProt entry). No model memory involved.
 *   2. ENTAILMENT    — the configured LLM (local vLLM, temperature 0) judges
 *      ONLY the two verbatim texts against each other and must quote the
 *      exact conflicting/supporting fragments.
 *
 * Verdict scale, with what it means for the report:
 *   consistent           — source supports the claim as stated (no impact)
 *   partially_consistent — right topic, but overstated/over-generalized/
 *                          scope-shifted (medium impact: soften the wording)
 *   inconsistent         — source contradicts the claim (high impact)
 *   unrelated            — source does not address the claim's topic (high)
 *
 * @module dsh-bioinf-routed/semantic
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { BioHttpClient } from './biohttp.ts';
import type { NcbiSearchConfig } from './evidence.ts';
/** Minimal chat seam (same shape as the debate engine's). */
export type ChatFn = (system: string, user: string) => Promise<string>;
export type SemanticVerdict = 'consistent' | 'partially_consistent' | 'inconsistent' | 'unrelated';
export type CredibilityImpact = 'none' | 'low' | 'medium' | 'high';
export interface SemanticCheckResult {
    /** Which registry supplied the ground truth ('' when fetch failed). */
    readonly sourceKind: string;
    readonly sourceId: string;
    /** true when the ground-truth text was retrieved; entailment only runs then. */
    readonly sourceFetched: boolean;
    /** First part of the fetched ground truth (truncated) for human inspection. */
    readonly sourceTextPreview: string;
    readonly verdict: SemanticVerdict;
    readonly credibilityImpact: CredibilityImpact;
    /** Concrete points of divergence (or support), each quoting the source. */
    readonly discrepancies: string[];
    readonly suggestion: string;
    /** Raw model output tail (kept for audit trail). */
    readonly raw?: string;
    readonly error: string;
}
export type SourceKind = 'pmid' | 'doi' | 'geo' | 'uniprot' | 'patent';
export interface SourceText {
    readonly kind: SourceKind;
    readonly id: string;
    readonly text: string;
    /** e.g. 'PubMed abstract', 'GEO DataSets description' — shown in the report. */
    readonly provenance: string;
}
export declare function fetchSourceText(client: BioHttpClient, ncbi: NcbiSearchConfig, kind: SourceKind, id: string, patentsApiKey: string): Promise<SourceText>;
export declare const SEMANTIC_SYSTEM = "You are a strict citation-consistency auditor for biomedical reports. You will receive a CLAIM made about a source in some report, and the SOURCE TEXT fetched verbatim from the authoritative registry. Judge ONLY these two texts against each other. Never use outside knowledge to rescue or condemn the claim; if the source text does not say it, it is not supported.\n\nClassify the relationship:\n- consistent: the source text supports the claim as stated (topic matches, strength matches).\n- partially_consistent: right topic, but the claim overstates, over-generalizes, shifts scope/population/species, or drops conditions/limitations present in the source.\n- inconsistent: the source text contradicts the claim (different direction of effect, different conclusion).\n- unrelated: the source text does not address the claim's topic at all.\n\nAlso grade credibilityImpact for the REPORT if it keeps this claim as written: none | low | medium | high.\n(unrelated/inconsistent => high; overstated quantitative or causal claims => medium; minor wording => low)\n\nReply in EXACTLY this format (quote short fragments of the SOURCE TEXT as evidence):\nVERDICT: consistent|partially_consistent|inconsistent|unrelated\nCREDIBILITY_IMPACT: none|low|medium|high\nDISCREPANCIES:\n- <specific point; quote the source fragment; write \"(none)\" if consistent>\nSUGGESTION: <one sentence: keep / how to reword / replace citation>";
export declare function semanticUserPrompt(claim: string, source: SourceText): string;
/** Tolerant parser for the auditor's reply; garbage in -> error out honestly. */
export declare function parseSemanticReview(text: string): Pick<SemanticCheckResult, 'verdict' | 'credibilityImpact' | 'discrepancies' | 'suggestion'>;
export interface SemanticCheckInput {
    readonly claim: string;
    pmid?: string;
    doi?: string;
    geo?: string;
    uniprot?: string;
    patent?: string;
}
export declare function runSemanticCheck(client: BioHttpClient, ncbi: NcbiSearchConfig, chat: ChatFn, input: SemanticCheckInput, patentsApiKey: string): Promise<SemanticCheckResult>;
export declare function buildSemanticCheckTool(client: BioHttpClient, ncbi: NcbiSearchConfig, chat: ChatFn, patentsApiKey: string): ReturnType<typeof defineTool>;
//# sourceMappingURL=semantic.d.ts.map