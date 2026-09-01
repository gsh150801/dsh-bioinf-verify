/**
 * Report decomposition — split a report into individually verifiable
 * evidence points, each classified by source category.
 *
 * Two passes, merged:
 *   1. DETERMINISTIC SCAN — paragraph/sentence segmentation plus identifier
 *      regexes (DOI/PMID/NCT/GEO/SRA/UniProt/patent/URL). Zero hallucination
 *      risk; anchors every claim to a paragraph index and quote.
 *   2. LLM PASS — catches claims whose identifiers are described but not
 *      spelled out, and splits compound statements. Parsed tolerantly;
 *      identifiers are re-extracted from the quoted text deterministically.
 *
 * Resolver URLs (doi.org, pubmed…) are not独立网页证据 — they fold into the
 * literature claim instead of spawning a webpage claim.
 *
 * @module dsh-bioinf-verify/decompose
 */
import type { ClaimCategory, ClaimIdentifiers, ClaimRecord } from './ledger.ts';
export declare function findPatentNumber(text: string): string;
export declare function findUrls(text: string): string[];
/** Choose the strongest category for a set of identifiers. */
export declare function classifyIdentifiers(ids: ClaimIdentifiers): ClaimCategory;
export interface DecomposedClaim {
    readonly claim: string;
    readonly quote: string;
    readonly paraIndex: number;
    readonly category: ClaimCategory;
    readonly identifiers: ClaimIdentifiers;
    readonly origin: 'scan' | 'llm' | 'merged';
    readonly expectedTitle?: string;
}
/** Extract identifiers from free text, dropping resolver URLs. */
export declare function extractIdentifiers(text: string): ClaimIdentifiers;
/** Split a report into paragraphs, then sentences within each paragraph. */
export declare function segmentReport(report: string): Array<{
    paraIndex: number;
    sentence: string;
}>;
/** Pass 1: deterministic scan over segmented sentences. */
export declare function scanReport(report: string): DecomposedClaim[];
/** Pass 2: LLM decomposition; failures degrade to the deterministic scan only. */
export declare function decomposeWithLlm(report: string, chat: (system: string, user: string) => Promise<string>): Promise<DecomposedClaim[]>;
/** Paragraph index containing the quote (normalized match); -1 when absent. */
export declare function locateParagraph(report: string, quote: string): number;
/** Merge both passes: dedupe by identifier overlap, prefer scan anchors. */
export declare function mergeClaims(scanned: readonly DecomposedClaim[], llm: readonly DecomposedClaim[]): DecomposedClaim[];
/** Full decomposition: scan + optional LLM pass → materialized ClaimRecords. */
export declare function materializeClaims(claims: readonly DecomposedClaim[]): ClaimRecord[];
//# sourceMappingURL=decompose.d.ts.map