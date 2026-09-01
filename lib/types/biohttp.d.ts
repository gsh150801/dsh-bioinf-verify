/**
 * Shared HTTP layer for the science query/verification tools.
 *
 * Domain APIs vary wildly in their throttling policies (NCBI E-utilities,
 * Europe PMC, ClinicalTrials.gov, Crossref, PatentsView, arXiv, Open Targets),
 * so every call goes through one client that provides:
 *
 * - per-host token-bucket pacing (each host keeps its own minimum interval;
 *   arXiv famously asks for >=3s between requests, NCBI wants <=3 rps
 *   anonymous / <=10 rps with an API key);
 * - retry with exponential backoff + jitter on 429/5xx/network errors,
 *   honoring `Retry-After`;
 * - an in-memory TTL response cache so repeated identical lookups inside one
 *   session never touch the upstream again;
 * - a polite-pool User-Agent carrying the configured contact email
 *   (Crossref + NCBI want `mailto:` contacts, which buy better rate classes).
 *
 * Pure Node fetch; a `fetchImpl` override keeps unit tests offline.
 *
 * @module dsh-bioinf-routed/biohttp
 */
export interface BioHttpOptions {
    /** Contact email for the Crossref/NCBI polite pool (may be empty). */
    readonly contactEmail: string;
    /** Optional injectable fetch for tests. */
    readonly fetchImpl?: typeof fetch;
    /** Max attempts per request including the first (default 3). */
    readonly maxRetries?: number;
    /** Per-attempt timeout (default 20s). */
    readonly timeoutMs?: number;
}
export interface BioHttpResponse {
    readonly status: number;
    /** Parsed JSON payload (`json()` callers only). */
    readonly json?: () => unknown;
    /** Raw body text; always populated so callers can fall back to parsing themselves. */
    readonly text: string;
    readonly fromCache: boolean;
}
export declare class BioHttpError extends Error {
    readonly status: number;
    readonly bodyPreview: string;
    constructor(message: string, status: number, bodyPreview: string);
}
export declare class BioHttpClient {
    private readonly options;
    private readonly fetchImpl;
    private readonly maxRetries;
    private readonly timeoutMs;
    private readonly pacers;
    private readonly cache;
    constructor(options: BioHttpOptions);
    private pacer;
    /**
     * Fetch a URL with pacing, retries, and caching. Throws `BioHttpError` on a
     * non-retryable HTTP failure or when retries are exhausted; network errors
     * and 429/5xx responses transparently back off and retry.
     */
    fetch(url: string, init?: RequestInit & {
        cacheTtlMs?: number;
        signal?: AbortSignal;
    }): Promise<BioHttpResponse>;
    /** Fetch and require a successful JSON document. */
    getJson<T>(url: string, opts?: RequestInit & {
        cacheTtlMs?: number;
        signal?: AbortSignal;
    }): Promise<T>;
    /** POST a JSON body and require a successful JSON reply. */
    postJson<T>(url: string, body: unknown, opts?: RequestInit & {
        cacheTtlMs?: number;
        signal?: AbortSignal;
    }): Promise<T>;
    /** E-utilities parameter triple identifying our tool to NCBI. */
    ncbiParams(apiKey: string): Record<string, string>;
}
//# sourceMappingURL=biohttp.d.ts.map