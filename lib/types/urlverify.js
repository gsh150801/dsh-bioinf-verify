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
/** Normalize lazy URLs ("www.x.com", "example.com/a") to https form. */
export function normalizeUrl(raw) {
    let url = raw.trim().replace(/[.,;)\]]+$/, '');
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url))
        url = `https://${url}`;
    return url;
}
const SOFT404_TITLE = /(404|not found|page cannot be found|页面不存在|找不到|無法顯示)/i;
function extractTitle(html) {
    return /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html)?.[1]?.replaceAll(/\s+/g, ' ').trim() ?? '';
}
/** Decode the handful of entities news sites actually use in titles. */
function decodeEntities(text) {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&nbsp;/g, ' ');
}
/**
 * Fetch a page and extract its ARTICLE title: prefers the OpenGraph
 * `og:title` (what news sites set for social cards), falls back to <title>.
 * Used by title_verify for web/news citations.
 */
export async function fetchPageTitle(rawUrl, options = {}) {
    const url = normalizeUrl(rawUrl);
    const doFetch = options.fetchImpl ?? fetch;
    const response = await doFetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
        headers: { accept: 'text/html,*/*' },
    });
    const body = (await response.text()).slice(0, 60_000);
    const ogTitle = /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(body)?.[1]
        ?? /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i.exec(body)?.[1];
    const twitterTitle = /<meta[^>]+name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i.exec(body)?.[1];
    const titleTag = extractTitle(body);
    const title = decodeEntities(ogTitle ?? twitterTitle ?? titleTag).replaceAll(/\s+/g, ' ').trim();
    return { title, finalUrl: response.url || url, httpStatus: response.status };
}
export async function checkUrl(rawUrl, options = {}) {
    const url = normalizeUrl(rawUrl);
    const doFetch = options.fetchImpl ?? fetch;
    const timeoutMs = options.timeoutMs ?? 12_000;
    const started = Date.now();
    const unreachable = (detail) => ({
        url, finalUrl: '', redirected: false, httpStatus: 0, verdict: 'unreachable',
        contentType: '', pageTitle: '', soft404Suspected: false, latencyMs: Date.now() - started, detail,
    });
    let response;
    try {
        response = await doFetch(url, {
            method: 'HEAD',
            redirect: 'follow',
            signal: AbortSignal.timeout(timeoutMs),
        });
        // Many sites reject HEAD; fall back to GET once.
        if (response.status === 405 || response.status === 501) {
            response = await doFetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
        }
    }
    catch (error) {
        return unreachable(`unreachable (${error instanceof Error ? error.message : String(error)})`);
    }
    const latencyMs = Date.now() - started;
    const finalUrl = response.url || url;
    const redirected = finalUrl !== url;
    const contentType = response.headers.get('content-type') ?? '';
    // Read a small prefix for the title probe on HTML responses (always safe: GET/HEAD of text).
    let pageTitle = '';
    let bodyPrefix = '';
    try {
        bodyPrefix = (await response.text()).slice(0, 4000);
        if (/text\/html/i.test(contentType))
            pageTitle = extractTitle(bodyPrefix);
    }
    catch {
        // body unreadable — status still counts
    }
    let verdict;
    let detail;
    if (response.status >= 200 && response.status < 300) {
        verdict = redirected ? 'redirect' : 'accessible';
        detail = `HTTP ${response.status}${redirected ? ` (redirected to ${finalUrl})` : ''}${contentType !== '' ? ` · ${contentType}` : ''}`;
    }
    else if (response.status === 401 || response.status === 403) {
        verdict = 'blocked';
        detail = `HTTP ${response.status} — exists but access denied (login/paywall/anti-bot)`;
    }
    else if (response.status === 404 || response.status === 410) {
        verdict = 'not_found';
        detail = `HTTP ${response.status} — link target does not exist`;
    }
    else if (response.status >= 500) {
        verdict = 'error';
        detail = `HTTP ${response.status} — server-side failure at final destination`;
    }
    else {
        verdict = 'error';
        detail = `HTTP ${response.status} — unexpected status`;
    }
    const soft404Suspected = (verdict === 'accessible' || verdict === 'redirect') &&
        pageTitle !== '' && SOFT404_TITLE.test(pageTitle) ||
        (verdict === 'accessible' && pageTitle === '' && /<title>[^<]*(404|not found)[^<]*<\/title>/i.test(bodyPrefix));
    if (soft404Suspected)
        detail += ' · ⚠ soft-404 suspected (page title suggests missing content)';
    return { url, finalUrl, redirected, httpStatus: response.status, verdict, contentType, pageTitle, soft404Suspected, latencyMs, detail };
}
const URL_PROPERTIES = {
    url: { type: 'string' },
    finalUrl: { type: 'string' },
    redirected: { type: 'boolean' },
    httpStatus: { type: 'number' },
    verdict: { type: 'string', description: 'accessible | redirect | blocked | not_found | unreachable | error' },
    contentType: { type: 'string' },
    pageTitle: { type: 'string' },
    soft404Suspected: { type: 'boolean' },
    latencyMs: { type: 'number' },
    detail: { type: 'string' },
    error: { type: 'string' },
};
const VERDICT_ICON = {
    accessible: '✅',
    redirect: '↪️',
    blocked: '🔒',
    not_found: '❌',
    unreachable: '❌',
    error: '⚠️',
};
export function buildUrlVerifyTool() {
    return defineTool({
        name: 'url_verify',
        description: 'Verify that a cited URL actually exists and is reachable: normalizes the address, follows redirects, distinguishes not-found (404/410) from access-denied (401/403) from server errors, and flags soft-404 pages (HTTP 200 whose title says "not found"). Use on every web link a report cites.',
        parameters: {
            url: { type: 'string', required: true, description: 'The URL as written in the report (scheme optional).' },
            timeoutMs: { type: 'number', description: 'Per-request timeout (default 12000, max 30000).' },
        },
        output: {
            schema: { type: 'object', additionalProperties: false, properties: URL_PROPERTIES },
            render: (_args, value) => [{
                    type: 'text',
                    text: `${VERDICT_ICON[value.verdict ?? 'error']} ${value.verdict ?? 'error'} — ${value.url ?? ''}${value.detail !== undefined && value.detail !== '' ? `: ${value.detail}` : ''}`,
                }],
        },
        async execute(args) {
            try {
                return await checkUrl(String(args.url ?? ''), typeof args.timeoutMs === 'number' ? { timeoutMs: args.timeoutMs } : {});
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return { url: String(args.url ?? ''), finalUrl: '', redirected: false, httpStatus: 0, verdict: 'error', contentType: '', pageTitle: '', soft404Suspected: false, latencyMs: 0, detail: message, error: message };
            }
        },
        presentCall(args) {
            return { card: 'generic', title: `Verify URL: ${String(args.url ?? '').slice(0, 60)}`, kind: 'read', rawInput: String(args.url ?? '') };
        },
    });
}
//# sourceMappingURL=urlverify.js.map