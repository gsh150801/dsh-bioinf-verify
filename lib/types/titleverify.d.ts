/**
 * Title verification ("标题核验") — does the title a report CLAIMS match the
 * title the authoritative source actually carries?
 *
 * One component, five source kinds:
 *   doi / pmid   → Crossref / PubMed article titles        (文献)
 *   patent       → PatentsView granted-patent title        (专利)
 *   geo          → GEO DataSets dataset title              (数据集)
 *   url          → page og:title / twitter:title / <title> (新闻、网页文章)
 *
 * Verdict bands over the shared token-Jaccard similarity:
 *   match    ≥ 0.75 or containment   — the claimed title is the source's
 *   close    ≥ 0.40                  — same work, wording differs (translation, subtitle cut)
 *   mismatch < 0.40                  — the source does not carry this title
 *   unverified                       — source unreachable / key missing
 *
 * @module dsh-bioinf-verify/titleverify
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { BioHttpClient } from './biohttp.ts';
import { type NcbiSearchConfig } from './evidence.ts';
export type TitleVerdict = 'match' | 'close' | 'mismatch' | 'unverified';
export interface TitleCheckResult {
    readonly sourceKind: 'doi' | 'pmid' | 'patent' | 'geo' | 'url';
    readonly sourceId: string;
    readonly claimedTitle: string;
    /** The title verbatim from the authoritative source ('' when unfetchable). */
    readonly actualTitle: string;
    readonly verdict: TitleVerdict;
    /** Similarity score 0..1 backing the verdict. */
    readonly similarity: number;
    readonly provenance: string;
    readonly detail: string;
    readonly error: string;
}
export declare function fetchTitle(client: BioHttpClient, ncbi: NcbiSearchConfig, kind: TitleCheckResult['sourceKind'], id: string, patentsApiKey: string): Promise<{
    title: string;
    provenance: string;
}>;
/** Graded similarity probe (exported for tests and the workflow's mapping). */
export declare function titleSimilarityProbe(expected: string, actual: string): {
    jaccard: number;
    contained: boolean;
    verdict: 'match' | 'close' | 'mismatch';
};
export declare function verifyTitle(client: BioHttpClient, ncbi: NcbiSearchConfig, opts: {
    title: string;
    doi?: string;
    pmid?: string;
    patent?: string;
    geo?: string;
    url?: string;
    fetchImpl?: typeof fetch;
}, patentsApiKey: string): Promise<TitleCheckResult>;
export declare function buildTitleVerifyTool(client: BioHttpClient, ncbi: NcbiSearchConfig, patentsApiKey: string): ReturnType<typeof defineTool>;
//# sourceMappingURL=titleverify.d.ts.map