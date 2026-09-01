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

/** Minimum spacing between requests to one upstream host (milliseconds). */
const HOST_MIN_INTERVAL_MS: Record<string, number> = {
  'eutils.ncbi.nlm.nih.gov': 350, // NCBI guideline: <=3 rps anonymous
  'api.crossref.org': 260, // polite pool ~4 rps
  'www.ebi.ac.uk': 120, // Europe PMC is generous; still pace slightly
  'clinicaltrials.gov': 220, // CT.gov etiquette: a few rps
  'rest.uniprot.org': 120,
  'search.patentsview.org': 900, // free tier: roughly 1 rps
  'api.platform.opentargets.org': 150,
  'export.arxiv.org': 3200, // arXiv requires a 3-second pause
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_CACHE_TTL_MS = 5 * 60_000

export interface BioHttpOptions {
  /** Contact email for the Crossref/NCBI polite pool (may be empty). */
  readonly contactEmail: string
  /** Optional injectable fetch for tests. */
  readonly fetchImpl?: typeof fetch
  /** Max attempts per request including the first (default 3). */
  readonly maxRetries?: number
  /** Per-attempt timeout (default 20s). */
  readonly timeoutMs?: number
}

interface CacheEntry {
  readonly expiresAt: number
  readonly value: CacheValue
}

interface CacheValue {
  readonly status: number
  readonly text: string
}

export interface BioHttpResponse {
  readonly status: number
  /** Parsed JSON payload (`json()` callers only). */
  readonly json?: () => unknown
  /** Raw body text; always populated so callers can fall back to parsing themselves. */
  readonly text: string
  readonly fromCache: boolean
}

export class BioHttpError extends Error {
  constructor(message: string, readonly status: number, readonly bodyPreview: string) {
    super(message)
    this.name = 'BioHttpError'
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }, { once: true })
  })
}

/** One token bucket per host, sequenced serially to avoid thundering herds. */
class HostPacer {
  private chain: Promise<void> = Promise.resolve()
  private lastAt = 0
  constructor(private readonly minIntervalMs: number) {}

  slot(signal?: AbortSignal): Promise<void> {
    const job = this.chain.then(async () => {
      const gap = Date.now() - this.lastAt
      if (gap < this.minIntervalMs && this.lastAt !== 0) await sleep(this.minIntervalMs - gap, signal)
      this.lastAt = Date.now()
    })
    // Later callers must queue behind this slot even if it rejects (network aborts).
    this.chain = job.catch(() => {})
    return job
  }
}

export class BioHttpClient {
  private readonly fetchImpl: typeof fetch
  private readonly maxRetries: number
  private readonly timeoutMs: number
  private readonly pacers = new Map<string, HostPacer>()
  private readonly cache = new Map<string, CacheEntry>()

  constructor(private readonly options: BioHttpOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.maxRetries = Math.max(1, options.maxRetries ?? DEFAULT_MAX_RETRIES)
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  private pacer(host: string): HostPacer {
    let pacer = this.pacers.get(host)
    if (pacer === undefined) {
      pacer = new HostPacer(HOST_MIN_INTERVAL_MS[host] ?? 300)
      this.pacers.set(host, pacer)
    }
    return pacer
  }

  /**
   * Fetch a URL with pacing, retries, and caching. Throws `BioHttpError` on a
   * non-retryable HTTP failure or when retries are exhausted; network errors
   * and 429/5xx responses transparently back off and retry.
   */
  async fetch(url: string, init?: RequestInit & { cacheTtlMs?: number; signal?: AbortSignal }): Promise<BioHttpResponse> {
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? init.body : ''
    const cacheTtlMs = init?.cacheTtlMs ?? (method === 'GET' ? DEFAULT_CACHE_TTL_MS : 0)
    const cacheKey = `${method} ${url}${body === '' ? '' : `\n${body}`}`
    if (cacheTtlMs > 0) {
      const hit = this.cache.get(cacheKey)
      if (hit !== undefined && hit.expiresAt > Date.now()) {
        return { status: hit.value.status, text: hit.value.text, json: safeJson(hit.value.text), fromCache: true }
      }
    }

    const { host } = new URL(url)
    const headers: Record<string, string> = {
      'user-agent': `dsh-bioinf-routed/0.2 (+${this.options.contactEmail !== '' ? `mailto:${this.options.contactEmail}` : 'research-agent'})`,
      'accept': 'application/json, */*',
    }
    if (body !== '') headers['content-type'] = 'application/json'
    Object.assign(headers, headersOnly(init?.headers))

    let lastError: Error | undefined
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      await this.pacer(host).slot(init?.signal)
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), this.timeoutMs)
        if (init?.signal !== undefined) {
          init.signal.addEventListener('abort', () => controller.abort(), { once: true })
        }
        let response: Response
        try {
          response = await this.fetchImpl(url, { ...initWithoutSignal(init), headers, signal: controller.signal })
        } finally {
          clearTimeout(timer)
        }
        const text = await response.text()
        if (!response.ok) {
          if (RETRYABLE_STATUS.has(response.status) && attempt < this.maxRetries - 1) {
            lastError = new BioHttpError(`${host}: HTTP ${response.status}`, response.status, text.slice(0, 400))
            const retryAfter = Number(response.headers.get('retry-after'))
            const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
              ? Math.min(retryAfter * 1000, 20_000)
              : Math.min((response.status === 429 ? 4000 : 700) * 2 ** attempt + Math.random() * 500, 20_000)
            await sleep(waitMs, init?.signal)
            continue
          }
          throw new BioHttpError(`${host}: HTTP ${response.status} ${response.statusText}`, response.status, text.slice(0, 400))
        }
        const cached: CacheValue = { status: response.status, text }
        if (cacheTtlMs > 0) {
          this.cache.set(cacheKey, { expiresAt: Date.now() + cacheTtlMs, value: cached })
          trimCache(this.cache)
        }
        return { status: response.status, text, json: safeJson(text), fromCache: false }
      } catch (error) {
        const wrapped = error instanceof Error ? error : new Error(String(error))
        if (init?.signal?.aborted || attempt >= this.maxRetries - 1) throw wrapped
        // Non-HTTP failures (DNS/socket/timeout): back off and retry.
        lastError = wrapped
        await sleep(Math.min(700 * 2 ** attempt + Math.random() * 400, 15_000), init?.signal)
      }
    }
    throw lastError ?? new Error(`biohttp: request failed (${url})`)
  }

  /** Fetch and require a successful JSON document. */
  async getJson<T>(url: string, opts?: RequestInit & { cacheTtlMs?: number; signal?: AbortSignal }): Promise<T> {
    const response = await this.fetch(url, opts)
    const parsed = safeJson(response.text)()
    if (parsed === undefined) throw new BioHttpError(`expected JSON from ${url}`, response.status, response.text.slice(0, 200))
    return parsed as T
  }

  /** POST a JSON body and require a successful JSON reply. */
  async postJson<T>(url: string, body: unknown, opts?: RequestInit & { cacheTtlMs?: number; signal?: AbortSignal }): Promise<T> {
    const response = await this.fetch(url, {
      ...opts,
      method: 'POST',
      body: JSON.stringify(body),
      cacheTtlMs: 0,
    })
    const parsed = safeJson(response.text)()
    if (parsed === undefined) throw new BioHttpError(`expected JSON from POST ${url}`, response.status, response.text.slice(0, 200))
    return parsed as T
  }

  /** E-utilities parameter triple identifying our tool to NCBI. */
  ncbiParams(apiKey: string): Record<string, string> {
    const params: Record<string, string> = { tool: 'dsh-bioinf-routed' }
    if (this.options.contactEmail !== '') params.email = this.options.contactEmail
    if (apiKey !== '') params.api_key = apiKey
    return params
  }
}

// (No additional helpers: retry bookkeeping lives inline in `fetch` above.)

function headersOnly(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (headers === undefined) return out
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = value
    })
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[String(key)] = String(value)
  } else {
    Object.assign(out, headers)
  }
  return out
}

function initWithoutSignal(init: RequestInit | undefined): RequestInit {
  if (init === undefined) return {}
  const { signal: _signal, cacheTtlMs: _cacheTtlMs, ...rest } = init as RequestInit & { cacheTtlMs?: number }
  return rest
}

function safeJson(text: string): () => unknown {
  return () => {
    try {
      return JSON.parse(text) as unknown
    } catch {
      return undefined
    }
  }
}

function trimCache(cache: Map<string, CacheEntry>, maxEntries = 512): void {
  if (cache.size <= maxEntries) return
  const cutoff = [...cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt).slice(0, cache.size - maxEntries)
  for (const [key] of cutoff) cache.delete(key)
}
