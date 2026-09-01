/**
 * Strict evidence-verification tooling ("证据核验组").
 *
 * Biomedical answers must stand on verifiable primary records — GeneAgent's
 * self-verification lesson applied at the citation level, with deterministic
 * API checks rather than model self-assessment (the ChemCrow caveat). Every
 * check talks to an authoritative registry:
 *
 * - DOI      -> Crossref `/works` metadata + title agreement
 * - PMID     -> PubMed E-Summary + a retraction/"expression of concern" scan
 * - Trials   -> ClinicalTrials.gov v2 record, live status, results posted?
 * - Protein  -> UniProtKB accession, gene names, organism
 * - GEO/SRA  -> NCBI accessions via `esearch db=gds/sra`
 *
 * `claim_audit` is the closing gate: it batches every citation of a draft
 * answer into one pass/fail matrix so weak links are impossible to miss.
 *
 * @module dsh-bioinf-routed/evidence
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { BioHttpClient } from './biohttp.ts';
/** NCBI E-utilities credential set shared by every registry check. */
export interface NcbiSearchConfig {
    readonly apiKey: string;
}
/** Canonicalize a DOI string: strip resolvers/prefixes, keep `10.xxxx/yyyy` lowercase. */
export declare function normalizeDoi(raw: string): string;
/** Pull the first DOI-looking identifier out of free text ('' if none). */
export declare function findDoi(text: string): string;
/** Explicit PMID mention (`PMID: 12345`, `pmid=12345`) out of free text. */
export declare function findPmid(text: string): string;
export declare function findNctId(text: string): string;
/** A plausible UniProtKB primary accession (e.g. P04637, Q9NXW2-2): letter(O/P/Q) + digit + 3×alnum + digit, optional isoform suffix. */
export declare function findUniprotAccession(text: string): string;
export declare function findGeoAccession(text: string): string;
export declare function findSraAccession(text: string): string;
export interface TitleSimilarity {
    /** Token-Jaccard over stopword-filtered tokens (0..1). */
    readonly jaccard: number;
    /** One title (normalized) contains the other — subtitles, translations. */
    readonly contained: boolean;
}
/** Similarity primitives shared by compareTitles and the title_verify component. */
export declare function titleSimilarity(expectedTitle: string | undefined, actualTitle: string | undefined): TitleSimilarity;
/**
 * Title-agreement verdict. Token-Jaccard with stopwords dropped, plus a
 * containment fallback for subtitles; `unknown` when no expectation given.
 */
export declare function compareTitles(expectedTitle: string | undefined, actualTitle: string | undefined, threshold?: number): 'match' | 'mismatch' | 'unknown';
export type CheckStatus = 'verified' | 'not_found' | 'mismatch' | 'error' | 'skipped';
export interface CheckResult {
    readonly check: string;
    readonly identifier: string;
    readonly status: CheckStatus;
    readonly detail: string;
    /** Registry-record fields backing the verdict (trimmed). */
    readonly record?: Record<string, string | number | boolean>;
}
interface DoiVerifyOptions {
    doi: string;
    expectedTitle?: string | undefined;
}
export declare function verifyDoi(client: BioHttpClient, opts: DoiVerifyOptions): Promise<CheckResult>;
export interface PmidVerifyOptions {
    pmid: string;
    expectedTitle?: string | undefined;
}
export declare function verifyPmid(client: BioHttpClient, ncbi: NcbiSearchConfig, opts: PmidVerifyOptions): Promise<CheckResult>;
export declare function verifyTrial(client: BioHttpClient, opts: {
    nctId: string;
}): Promise<CheckResult>;
export interface UniprotVerifyOptions {
    accession: string;
    expectedGene?: string | undefined;
}
export declare function verifyUniprot(client: BioHttpClient, opts: UniprotVerifyOptions): Promise<CheckResult>;
export interface AccessionVerifyOptions {
    accession: string;
    expectedTitle?: string | undefined;
}
export declare function verifyGds(client: BioHttpClient, ncbi: NcbiSearchConfig, opts: AccessionVerifyOptions): Promise<CheckResult>;
export declare function verifySra(client: BioHttpClient, ncbi: NcbiSearchConfig, opts: {
    accession: string;
}): Promise<CheckResult>;
/** Registry-existence check for a US patent number (needs PatentsView key). */
export declare function verifyPatent(client: BioHttpClient, opts: {
    patent: string;
    apiKey: string;
}): Promise<CheckResult>;
export interface ClaimInput {
    /** What the draft claims (free text); identifiers may be embedded and will be auto-extracted. */
    claim?: string;
    doi?: string;
    pmid?: string;
    nctId?: string;
    uniprot?: string;
    geo?: string;
    sra?: string;
    /** Optional expected title/gene to enable agreement checking. */
    expectedTitle?: string;
    expectedGene?: string;
}
export interface AuditRow extends CheckResult {
    readonly claim: string;
}
export interface AuditReport {
    readonly totalChecks: number;
    readonly verified: number;
    readonly notFound: number;
    readonly mismatch: number;
    readonly errors: number;
    readonly verdict: 'PASS' | 'REVIEW_REQUIRED' | 'FAIL';
    readonly rows: AuditRow[];
    readonly markdownTable: string;
}
export declare function auditClaims(client: BioHttpClient, ncbi: NcbiSearchConfig, claims: readonly ClaimInput[]): Promise<AuditReport>;
export declare function buildEvidenceTools(client: BioHttpClient, ncbi: NcbiSearchConfig): ReturnType<typeof defineTool>[];
export {};
//# sourceMappingURL=evidence.d.ts.map