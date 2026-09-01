/**
 * URL verification — "链接是否真实存在/可访问".
 *
 * A citation is only as good as its link. This component checks that a URL
 * resolves, follows redirects to the final destination, distinguishes hard
 * failures (404/410/DNS) from soft blocks (401/403 — may exist but denied),
 * and applies a light soft-404 heuristic (HTTP 200 whose page title says
 * "not found").
 *
 * @module dsh-bioinf-verify/urlverify
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
export type UrlVerdict = 'accessible' | 'redirect' | 'blocked' | 'not_found' | 'unreachable' | 'error';
export interface UrlCheckResult {
    readonly url: string;
    /** Final URL after redirect following ('' when unreachable). */
    readonly finalUrl: string;
    readonly redirected: boolean;
    readonly httpStatus: number;
    readonly verdict: UrlVerdict;
    readonly contentType: string;
    /** Page <title> when HTML (soft-404 heuristic input); '' otherwise. */
    readonly pageTitle: string;
    readonly soft404Suspected: boolean;
    readonly latencyMs: number;
    readonly detail: string;
}
/** Normalize lazy URLs ("www.x.com", "example.com/a") to https form. */
export declare function normalizeUrl(raw: string): string;
/**
 * Fetch a page and extract its ARTICLE title: prefers the OpenGraph
 * `og:title` (what news sites set for social cards), falls back to <title>.
 * Used by title_verify for web/news citations.
 */
export declare function fetchPageTitle(rawUrl: string, options?: {
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
}): Promise<{
    title: string;
    finalUrl: string;
    httpStatus: number;
}>;
export interface UrlCheckOptions {
    readonly timeoutMs?: number;
    readonly fetchImpl?: typeof fetch;
    /** Fetch the body for the title probe even on HEAD success (default true). */
    readonly probeTitle?: boolean;
}
export declare function checkUrl(rawUrl: string, options?: UrlCheckOptions): Promise<UrlCheckResult>;
export declare function buildUrlVerifyTool(): ReturnType<typeof defineTool>;
//# sourceMappingURL=urlverify.d.ts.map