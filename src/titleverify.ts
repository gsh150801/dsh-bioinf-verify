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

import { defineTool } from '@deepseek-ai/dsh-tools'
import { BioHttpClient } from './biohttp.ts'
import { titleSimilarity, type NcbiSearchConfig } from './evidence.ts'
import { fetchPageTitle } from './urlverify.ts'

export type TitleVerdict = 'match' | 'close' | 'mismatch' | 'unverified'

export interface TitleCheckResult {
  readonly sourceKind: 'doi' | 'pmid' | 'patent' | 'geo' | 'url'
  readonly sourceId: string
  readonly claimedTitle: string
  /** The title verbatim from the authoritative source ('' when unfetchable). */
  readonly actualTitle: string
  readonly verdict: TitleVerdict
  /** Similarity score 0..1 backing the verdict. */
  readonly similarity: number
  readonly provenance: string
  readonly detail: string
  readonly error: string
}

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'

export async function fetchTitle(client: BioHttpClient, ncbi: NcbiSearchConfig, kind: TitleCheckResult['sourceKind'], id: string, patentsApiKey: string): Promise<{ title: string; provenance: string }> {
  if (kind === 'doi') {
    const payload = await client.getJson<{ message?: { title?: unknown } }>(
      `https://api.crossref.org/works/${encodeURIComponent(id)}`,
      { cacheTtlMs: 600_000 },
    )
    const raw = payload.message?.title
    const title = Array.isArray(raw) ? String(raw[0] ?? '') : typeof raw === 'string' ? raw : ''
    if (title.trim() === '') throw new Error('Crossref record carries no title')
    return { title, provenance: 'Crossref title' }
  }
  if (kind === 'pmid') {
    const common = client.ncbiParams(ncbi.apiKey)
    const url = new URL(`${EUTILS_BASE}/esummary.fcgi`)
    for (const [key, value] of Object.entries({ ...common, db: 'pubmed', id, retmode: 'json' })) url.searchParams.set(key, value)
    const payload = await client.getJson<{ result?: Record<string, Record<string, unknown>> }>(url.toString(), { cacheTtlMs: 600_000 })
    const title = String(payload.result?.[id]?.title ?? '')
    if (title.trim() === '') throw new Error(`PubMed has no title for PMID ${id}`)
    return { title, provenance: 'PubMed title' }
  }
  if (kind === 'geo') {
    const common = client.ncbiParams(ncbi.apiKey)
    const searchUrl = new URL(`${EUTILS_BASE}/esearch.fcgi`)
    for (const [key, value] of Object.entries({ ...common, db: 'gds', term: `${id}[ACCN]`, retmax: '10', retmode: 'json' })) searchUrl.searchParams.set(key, value)
    const searched = await client.getJson<{ esearchresult?: { idlist?: unknown } }>(searchUrl.toString())
    const uids = ((searched.esearchresult?.idlist ?? []) as unknown[]).map(String).filter(uid => /^\d+$/.test(uid))
    if (uids.length === 0) throw new Error(`GEO accession ${id} not found`)
    const sumUrl = new URL(`${EUTILS_BASE}/esummary.fcgi`)
    for (const [key, value] of Object.entries({ ...common, db: 'gds', id: uids.join(','), retmode: 'json' })) sumUrl.searchParams.set(key, value)
    const summarized = await client.getJson<{ result?: Record<string, Record<string, unknown>> }>(sumUrl.toString())
    const wanted = id.toLowerCase()
    for (const uid of uids) {
      const doc = summarized.result?.[uid]
      if (doc === undefined || String(doc.accession ?? '').toLowerCase() !== wanted) continue
      const title = String(doc.title ?? '')
      if (title.trim() === '') throw new Error(`GEO record for ${id} carries no title`)
      return { title, provenance: 'GEO DataSets title' }
    }
    throw new Error(`GEO hit list did not contain ${id}`)
  }
  if (kind === 'patent') {
    if (patentsApiKey === '') throw new Error('PATENTSVIEW_API_KEY 未配置，无法核验专利标题（免费申请：patentsview.org/apis/keyrequest）')
    const number = id.replace(/^US/i, '').trim()
    const payload = await client.postJson<{ patents?: readonly Record<string, unknown>[]; error_message?: unknown }>(
      'https://search.patentsview.org/api/v1/patent/',
      { q: { patent_id: number }, f: ['patent_id', 'patent_title'] },
      { headers: { 'x-api-key': patentsApiKey } },
    )
    if (payload.error_message !== undefined && payload.error_message !== null) throw new Error(String(payload.error_message))
    const title = typeof payload.patents?.[0]?.patent_title === 'string' ? payload.patents[0]!.patent_title : ''
    if (title.trim() === '') throw new Error(`no patent title found for US${number}`)
    return { title, provenance: 'PatentsView title' }
  }
  // url — news / web articles: og:title → twitter:title → <title>
  const page = await fetchPageTitle(id)
  if (page.title.trim() === '') throw new Error(`page ${id} exposes no title (HTTP ${page.httpStatus})`)
  return { title: page.title, provenance: 'web page title (og:title/<title>)' }
}

/** Graded similarity probe (exported for tests and the workflow's mapping). */
export function titleSimilarityProbe(expected: string, actual: string): { jaccard: number; contained: boolean; verdict: 'match' | 'close' | 'mismatch' } {
  const sim = titleSimilarity(expected, actual)
  const verdict = sim.contained || sim.jaccard >= 0.75 ? 'match' as const : sim.jaccard >= 0.4 ? 'close' as const : 'mismatch' as const
  return { ...sim, verdict }
}

export async function verifyTitle(
  client: BioHttpClient,
  ncbi: NcbiSearchConfig,
  opts: {
    title: string
    doi?: string
    pmid?: string
    patent?: string
    geo?: string
    url?: string
    fetchImpl?: typeof fetch
  },
  patentsApiKey: string,
): Promise<TitleCheckResult> {
  const claimedTitle = opts.title.trim()
  const picked: Array<[TitleCheckResult['sourceKind'], string | undefined]> = [
    ['doi', opts.doi],
    ['pmid', opts.pmid],
    ['patent', opts.patent],
    ['geo', opts.geo],
    ['url', opts.url],
  ]
  const found = picked.find(([, value]) => value !== undefined && value !== '')
  if (claimedTitle === '') {
    return { sourceKind: found?.[0] ?? 'url', sourceId: found?.[1] ?? '', claimedTitle: '', actualTitle: '', verdict: 'unverified', similarity: 0, provenance: '', detail: 'ARGUMENT ERROR (retry with corrected arguments): `title` is required — the title as the report claims it.', error: 'title is required' }
  }
  if (found === undefined) {
    return { sourceKind: 'url', sourceId: '', claimedTitle, actualTitle: '', verdict: 'unverified', similarity: 0, provenance: '', detail: 'ARGUMENT ERROR (retry with corrected arguments): supply one source via doi | pmid | patent | geo | url.', error: 'no source identifier' }
  }
  const [kind, id] = [found[0], String(found[1])]
  try {
    const { title: actualTitle, provenance } = await fetchTitle(client, ncbi, kind, id, patentsApiKey)
    const { jaccard, contained } = titleSimilarity(claimedTitle, actualTitle)
    const verdict: TitleVerdict = contained || jaccard >= 0.75 ? 'match' : jaccard >= 0.4 ? 'close' : 'mismatch'
    const label: Record<TitleVerdict, string> = {
      match: '标题一致',
      close: '标题基本一致（措辞/副标题有出入，同一来源）',
      mismatch: '标题不一致——来源实际标题见 actualTitle',
      unverified: '未能核验',
    }
    return {
      sourceKind: kind,
      sourceId: id,
      claimedTitle,
      actualTitle,
      verdict,
      similarity: Math.round(jaccard * 1000) / 1000,
      provenance,
      detail: `${label[verdict]}（相似度 ${Math.round(jaccard * 100)}%${contained ? '，包含关系' : ''}）· ${provenance}`,
      error: '',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { sourceKind: kind, sourceId: id, claimedTitle, actualTitle: '', verdict: 'unverified', similarity: 0, provenance: '', detail: `标题核验无法执行：${message}`, error: message }
  }
}

const TITLE_PROPERTIES = {
  sourceKind: { type: 'string', description: 'doi | pmid | patent | geo | url' },
  sourceId: { type: 'string' },
  claimedTitle: { type: 'string' },
  actualTitle: { type: 'string', description: 'Title verbatim from the authoritative source.' },
  verdict: { type: 'string', description: 'match | close | mismatch | unverified' },
  similarity: { type: 'number' },
  provenance: { type: 'string' },
  detail: { type: 'string' },
  error: { type: 'string' },
} as const

export function buildTitleVerifyTool(client: BioHttpClient, ncbi: NcbiSearchConfig, patentsApiKey: string): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'title_verify',
    description: 'Title verification across source kinds: compares the title a report CLAIMS against the title carried by the authoritative source — Crossref (doi), PubMed (pmid), PatentsView (patent), GEO DataSets (geo), or the live web page (url: og:title/twitter:title/<title> for news and web articles). Verdict bands: match (≥75% or containment), close (40-75%, same work with wording drift), mismatch (<40%), unverified (source unreachable).',
    parameters: {
      title: { type: 'string', required: true, description: 'The title as the report states it.' },
      doi: { type: 'string', description: 'DOI of the cited paper.' },
      pmid: { type: 'string', description: 'PubMed ID (used when no DOI).' },
      patent: { type: 'string', description: 'US patent number.' },
      geo: { type: 'string', description: 'GEO accession (GSE/GDS).' },
      url: { type: 'string', description: 'Web/news article URL (used when no registry id).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: TITLE_PROPERTIES },
      render: (_args: unknown, value: Partial<TitleCheckResult>) => {
      const icon = value.verdict === 'match' ? '✅' : value.verdict === 'close' ? '🟠' : value.verdict === 'mismatch' ? '❌' : '⏭'
      return [{
        type: 'text',
        text: `${icon} ${value.verdict ?? 'unverified'} — ${value.sourceKind ?? ''}/${value.sourceId ?? ''} (${value.similarity !== undefined ? Math.round(value.similarity * 100) : 0}%)\n  声明: ${value.claimedTitle ?? ''}\n  实际: ${value.actualTitle !== '' ? value.actualTitle : '(未取到)'}\n  ${value.detail ?? value.error ?? ''}`,
      }]
      },
    },
    async execute(args) {
      try {
        return await verifyTitle(client, ncbi, {
          title: String(args.title ?? ''),
          ...(typeof args.doi === 'string' && args.doi !== '' ? { doi: args.doi } : {}),
          ...(typeof args.pmid === 'string' && args.pmid !== '' ? { pmid: args.pmid } : {}),
          ...(typeof args.patent === 'string' && args.patent !== '' ? { patent: args.patent } : {}),
          ...(typeof args.geo === 'string' && args.geo !== '' ? { geo: args.geo } : {}),
          ...(typeof args.url === 'string' && args.url !== '' ? { url: args.url } : {}),
        }, patentsApiKey)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { sourceKind: 'url', sourceId: '', claimedTitle: String(args.title ?? ''), actualTitle: '', verdict: 'unverified', similarity: 0, provenance: '', detail: message, error: message }
      }
    },
    presentCall(args) {
      return { card: 'generic', title: `Verify title: ${String(args.title ?? '').slice(0, 60)}`, kind: 'read', rawInput: String(args.title ?? '') }
    },
  })
}
