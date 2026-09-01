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

import { defineTool } from '@deepseek-ai/dsh-tools'
import { BioHttpClient } from './biohttp.ts'
import type { NcbiSearchConfig } from './evidence.ts'

/** Minimal chat seam (same shape as the debate engine's). */
export type ChatFn = (system: string, user: string) => Promise<string>

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'

export type SemanticVerdict = 'consistent' | 'partially_consistent' | 'inconsistent' | 'unrelated'
export type CredibilityImpact = 'none' | 'low' | 'medium' | 'high'

export interface SemanticCheckResult {
  /** Which registry supplied the ground truth ('' when fetch failed). */
  readonly sourceKind: string
  readonly sourceId: string
  /** true when the ground-truth text was retrieved; entailment only runs then. */
  readonly sourceFetched: boolean
  /** First part of the fetched ground truth (truncated) for human inspection. */
  readonly sourceTextPreview: string
  readonly verdict: SemanticVerdict
  readonly credibilityImpact: CredibilityImpact
  /** Concrete points of divergence (or support), each quoting the source. */
  readonly discrepancies: string[]
  readonly suggestion: string
  /** Raw model output tail (kept for audit trail). */
  readonly raw?: string
  readonly error: string
}

// ---------------------------------------------------------------------------
// Ground-truth fetchers (deterministic, one per source kind)
// ---------------------------------------------------------------------------

export type SourceKind = 'pmid' | 'doi' | 'geo' | 'uniprot' | 'patent'

export interface SourceText {
  readonly kind: SourceKind
  readonly id: string
  readonly text: string
  /** e.g. 'PubMed abstract', 'GEO DataSets description' — shown in the report. */
  readonly provenance: string
}

export async function fetchSourceText(client: BioHttpClient, ncbi: NcbiSearchConfig, kind: SourceKind, id: string, patentsApiKey: string): Promise<SourceText> {
  if (kind === 'pmid') {
    const common = client.ncbiParams(ncbi.apiKey)
    const url = new URL(`${EUTILS_BASE}/efetch.fcgi`)
    for (const [key, value] of Object.entries({ ...common, db: 'pubmed', id, rettype: 'abstract', retmode: 'text' })) url.searchParams.set(key, value)
    const response = await client.fetch(url.toString(), { cacheTtlMs: 600_000 })
    return { kind, id, text: response.text.trim(), provenance: 'PubMed abstract (efetch, verbatim)' }
  }

  if (kind === 'doi') {
    // Europe PMC core record carries the full abstractText for most DOIs.
    const url = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search')
    url.searchParams.set('query', `DOI:"${id}"`)
    url.searchParams.set('format', 'json')
    url.searchParams.set('resultType', 'core')
    url.searchParams.set('pageSize', '1')
    const payload = await client.getJson<{ resultList?: { result?: readonly Record<string, unknown>[] } }>(url.toString(), { cacheTtlMs: 600_000 })
    const doc = payload.resultList?.result?.[0]
    const abstract = typeof doc?.abstractText === 'string' ? doc.abstractText : ''
    if (abstract.trim() === '') throw new Error(`no abstract available via Europe PMC for DOI ${id}`)
    const title = typeof doc?.title === 'string' ? `${doc.title}\n` : ''
    return { kind, id, text: `${title}${abstract}`.trim(), provenance: 'Europe PMC abstract (verbatim)' }
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
      const accession = String(doc?.accession ?? '').toLowerCase()
      if (doc === undefined || accession !== wanted) continue
      const summary = String(doc.summary ?? '').trim()
      const title = String(doc.title ?? '').trim()
      if (summary === '' && title === '') throw new Error(`GEO record for ${id} carries no description`)
      return { kind, id, text: `${title}\n${summary}`.trim(), provenance: 'GEO DataSets description (verbatim)' }
    }
    throw new Error(`GEO hit list did not contain ${id}`)
  }

  if (kind === 'uniprot') {
    const entry = await client.getJson<Record<string, unknown>>(
      `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(id)}.json?fields=accession,id,gene_primary,protein_name,organism_name,ft_function`,
      { cacheTtlMs: 600_000 },
    )
    const genes = Array.isArray(entry.genes) ? entry.genes : []
    const geneNames = genes.flatMap(gene => {
      const geneName = (gene as Record<string, unknown>)?.geneName as Record<string, unknown> | undefined
      return typeof geneName?.value === 'string' ? [geneName.value] : []
    })
    const description = entry.proteinDescription as Record<string, unknown> | undefined
    const recommended = (description?.recommendedName as Record<string, unknown> | undefined)?.fullName as Record<string, unknown> | undefined
    const proteinName = typeof recommended?.value === 'string' ? recommended.value : ''
    const features = Array.isArray(entry.features) ? entry.features : []
    const functionText = features.flatMap(feature => {
      const rec = feature as Record<string, unknown>
      return rec.type === 'Function' && typeof rec.description === 'string' ? [rec.description] : []
    }).join(' ')
    const organism = entry.organism as Record<string, unknown> | undefined
    const organismName = typeof organism?.scientificName === 'string' ? organism.scientificName : ''
    const text = [
      `Protein: ${proteinName} (${String(entry.uniProtkbId ?? id)})`,
      `Gene(s): ${geneNames.join(', ') || '(none)'}`,
      `Organism: ${organismName}`,
      functionText !== '' ? `Annotated function: ${functionText}` : '(no function annotation)',
    ].join('\n')
    return { kind, id, text, provenance: 'UniProtKB entry (verbatim fields)' }
  }

  // patent
  if (patentsApiKey === '') {
    throw new Error('patent abstract lookup needs PATENTSVIEW_API_KEY (free: https://patentsview.org/apis/keyrequest)')
  }
  const number = id.replace(/^US/i, '').trim()
  const payload = await client.postJson<{ patents?: readonly Record<string, unknown>[]; error_message?: unknown }>(
    'https://search.patentsview.org/api/v1/patent/',
    {
      q: { patent_number: number },
      f: ['patent_number', 'patent_title', 'patent_abstract'],
    },
    { headers: { 'x-api-key': patentsApiKey } },
  )
  if (payload.error_message !== undefined && payload.error_message !== null) throw new Error(`patentsview: ${String(payload.error_message)}`)
  const patent = payload.patents?.[0]
  const abstract = typeof patent?.patent_abstract === 'string' ? patent.patent_abstract : ''
  if (abstract.trim() === '') throw new Error(`no abstract found for patent US${number}`)
  const title = typeof patent?.patent_title === 'string' ? `${patent.patent_title}\n` : ''
  return { kind, id, text: `${title}${abstract}`.trim(), provenance: 'PatentsView abstract (verbatim)' }
}

// ---------------------------------------------------------------------------
// Entailment judgment (LLM over the two verbatim texts, temperature 0)
// ---------------------------------------------------------------------------

export const SEMANTIC_SYSTEM = `You are a strict citation-consistency auditor for biomedical reports. You will receive a CLAIM made about a source in some report, and the SOURCE TEXT fetched verbatim from the authoritative registry. Judge ONLY these two texts against each other. Never use outside knowledge to rescue or condemn the claim; if the source text does not say it, it is not supported.

Classify the relationship:
- consistent: the source text supports the claim as stated (topic matches, strength matches).
- partially_consistent: right topic, but the claim overstates, over-generalizes, shifts scope/population/species, or drops conditions/limitations present in the source.
- inconsistent: the source text contradicts the claim (different direction of effect, different conclusion).
- unrelated: the source text does not address the claim's topic at all.

Also grade credibilityImpact for the REPORT if it keeps this claim as written: none | low | medium | high.
(unrelated/inconsistent => high; overstated quantitative or causal claims => medium; minor wording => low)

Reply in EXACTLY this format (quote short fragments of the SOURCE TEXT as evidence):
VERDICT: consistent|partially_consistent|inconsistent|unrelated
CREDIBILITY_IMPACT: none|low|medium|high
DISCREPANCIES:
- <specific point; quote the source fragment; write "(none)" if consistent>
SUGGESTION: <one sentence: keep / how to reword / replace citation>`

export function semanticUserPrompt(claim: string, source: SourceText): string {
  return `CLAIM (from the report): ${claim.slice(0, 1200)}

SOURCE TEXT (${source.provenance}):
${source.text.slice(0, 6000)}`
}

/** Tolerant parser for the auditor's reply; garbage in -> error out honestly. */
export function parseSemanticReview(text: string): Pick<SemanticCheckResult, 'verdict' | 'credibilityImpact' | 'discrepancies' | 'suggestion'> {
  const verdictMatch = /VERDICT\s*[:：]\s*(consistent|partially[_ -]?consistent|inconsistent|unrelated)/i.exec(text)
  const impactMatch = /CREDIBILITY[_ -]?IMPACT\s*[:：]\s*(none|low|medium|high)/i.exec(text)
  const suggestionMatch = /SUGGESTION\s*[:：]\s*(.+)/i.exec(text)
  const discMatch = /DISCREPANCIES\s*[:：]\s*([\s\S]*?)(?:\nSUGGESTION|$)/i.exec(text)
  if (verdictMatch === null) throw new Error(`auditor reply not parseable: ${text.slice(0, 200)}`)
  const verdictKey = verdictMatch[1]!.toLowerCase().replaceAll(/[_ -]/g, '_')
  const verdict: SemanticVerdict = verdictKey === 'consistent' ? 'consistent'
    : verdictKey === 'partially_consistent' ? 'partially_consistent'
    : verdictKey === 'inconsistent' ? 'inconsistent' : 'unrelated'
  const impact = (impactMatch?.[1] ?? '').toLowerCase() as CredibilityImpact
  const discrepancies = (discMatch?.[1] ?? '').split('\n')
    .map(line => line.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(line => line !== '' && line.toLowerCase() !== '(none)')
  const suggestion = (suggestionMatch?.[1] ?? '').trim().slice(0, 400)
  const validImpacts: CredibilityImpact[] = ['none', 'low', 'medium', 'high']
  const fallbackImpact: Record<SemanticVerdict, CredibilityImpact> = {
    consistent: 'none',
    partially_consistent: 'medium',
    inconsistent: 'high',
    unrelated: 'high',
  }
  return {
    verdict,
    credibilityImpact: validImpacts.includes(impact) ? impact : fallbackImpact[verdict],
    discrepancies,
    suggestion,
  }
}

// ---------------------------------------------------------------------------
// Orchestrator + tool
// ---------------------------------------------------------------------------

export interface SemanticCheckInput {
  readonly claim: string
  pmid?: string
  doi?: string
  geo?: string
  uniprot?: string
  patent?: string
}

export async function runSemanticCheck(
  client: BioHttpClient,
  ncbi: NcbiSearchConfig,
  chat: ChatFn,
  input: SemanticCheckInput,
  patentsApiKey: string,
): Promise<SemanticCheckResult> {
  const claim = input.claim.trim()
  if (claim === '') {
    return emptyResult('', '', false, 'ARGUMENT ERROR (retry with corrected arguments): `claim` is required — it is the statement your report makes about the source.')
  }
  const kindOrder: [SourceKind, string | undefined][] = [
    ['pmid', input.pmid],
    ['doi', input.doi],
    ['geo', input.geo],
    ['uniprot', input.uniprot],
    ['patent', input.patent],
  ]
  const picked = kindOrder.find(([, value]) => value !== undefined && value !== '')
  if (picked === undefined) {
    return emptyResult('', '', false, `ARGUMENT ERROR (retry with corrected arguments): supply one source id via pmid | doi | geo | uniprot | patent (received: ${Object.keys(input).filter(key => key !== 'claim').join(', ') || 'none'}).`)
  }
  const [kind, rawId] = picked
  const id = String(rawId)
  let source: SourceText
  try {
    source = await fetchSourceText(client, ncbi, kind, id, patentsApiKey)
  } catch (error) {
    return emptyResult(kind, id, false, `ground truth unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }

  let review: string
  try {
    review = await chat(SEMANTIC_SYSTEM, semanticUserPrompt(claim, source))
  } catch (error) {
    return emptyResult(kind, id, true, `entailment judgment failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  let parsed
  try {
    parsed = parseSemanticReview(review)
  } catch (error) {
    return {
      ...emptyResult(kind, id, true, error instanceof Error ? error.message : String(error)),
      raw: review.slice(-600),
    }
  }

  return {
    sourceKind: kind,
    sourceId: id,
    sourceFetched: true,
    sourceTextPreview: source.text.slice(0, 400),
    ...parsed,
    raw: review.slice(-600),
    error: '',
  }
}

function emptyResult(kind: string, id: string, fetched: boolean, message: string): SemanticCheckResult {
  return {
    sourceKind: kind,
    sourceId: id,
    sourceFetched: fetched,
    sourceTextPreview: '',
    verdict: 'inconsistent',
    credibilityImpact: 'high',
    discrepancies: [],
    suggestion: message,
    error: message,
  }
}

const SEMANTIC_PROPERTIES = {
  sourceKind: { type: 'string' },
  sourceId: { type: 'string' },
  sourceFetched: { type: 'boolean' },
  sourceTextPreview: { type: 'string', description: 'First ~400 chars of the verbatim ground truth used for the judgment.' },
  verdict: { type: 'string', description: 'consistent | partially_consistent | inconsistent | unrelated' },
  credibilityImpact: { type: 'string', description: 'none | low | medium | high' },
  discrepancies: { type: 'array', items: { type: 'string' } },
  suggestion: { type: 'string' },
  raw: { type: 'string', description: 'Tail of the auditor reply (audit trail; may be absent).' },
  error: { type: 'string' },
} as const

const VERDICT_ICON: Record<SemanticVerdict, string> = {
  consistent: '✅',
  partially_consistent: '🟠',
  inconsistent: '❌',
  unrelated: '❌',
}

const IMPACT_LABEL: Record<CredibilityImpact, string> = {
  none: '不影响可信度',
  low: '对可信度影响：低',
  medium: '对可信度影响：中（需软化措辞）',
  high: '对可信度影响：高（必须修改或换引）',
}

export function buildSemanticCheckTool(
  client: BioHttpClient,
  ncbi: NcbiSearchConfig,
  chat: ChatFn,
  patentsApiKey: string,
): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'claim_semantic_check',
    description: 'Meaning-consistency check between a report CLAIM and its cited SOURCE: fetches the source text verbatim from the authoritative registry (PubMed abstract / Europe PMC by DOI / GEO description / UniProt entry / PatentsView abstract), then judges entailment at temperature 0. Returns verdict (consistent | partially_consistent | inconsistent | unrelated), credibility impact, the exact divergent points, and a fix suggestion. Run this on the key citations of a final report AFTER claim_audit — existence is not consistency.',
    parameters: {
      claim: { type: 'string', required: true, description: 'The statement your report makes about this source (as written in the draft).' },
      pmid: { type: 'string', description: 'PubMed ID of the cited paper (takes precedence).' },
      doi: { type: 'string', description: 'DOI of the cited paper (used when no PMID).' },
      geo: { type: 'string', description: 'GEO accession for dataset claims (GSE/GDS).' },
      uniprot: { type: 'string', description: 'UniProtKB accession for protein claims.' },
      patent: { type: 'string', description: 'US patent number (needs PATENTSVIEW_API_KEY).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: SEMANTIC_PROPERTIES },
      render: (_args, value: Partial<SemanticCheckResult>) => {
        if (value.error !== undefined && value.error !== '') {
          return [{ type: 'text', text: `claim_semantic_check: ${value.error}${value.sourceKind !== undefined && value.sourceKind !== '' ? ` (${value.sourceKind}/${value.sourceId})` : ''}` }]
        }
        return [{
          type: 'text',
          text: [
            `${VERDICT_ICON[value.verdict ?? 'inconsistent']} ${value.verdict} — ${value.sourceKind}/${value.sourceId} — ${IMPACT_LABEL[value.credibilityImpact ?? 'high']}`,
            ...(value.discrepancies ?? []).map(discrepancy => `  • ${discrepancy}`),
            `  建议: ${value.suggestion ?? ''}`,
            `  (ground truth: ${value.sourceTextPreview?.slice(0, 200) ?? ''}...)`,
          ].join('\n'),
        }]
      },
    },
    async execute(args) {
      try {
        return await runSemanticCheck(client, ncbi, chat, {
          claim: String(args.claim ?? ''),
          ...(typeof args.pmid === 'string' && args.pmid !== '' ? { pmid: args.pmid } : {}),
          ...(typeof args.doi === 'string' && args.doi !== '' ? { doi: args.doi } : {}),
          ...(typeof args.geo === 'string' && args.geo !== '' ? { geo: args.geo } : {}),
          ...(typeof args.uniprot === 'string' && args.uniprot !== '' ? { uniprot: args.uniprot } : {}),
          ...(typeof args.patent === 'string' && args.patent !== '' ? { patent: args.patent } : {}),
        }, patentsApiKey) as object
      } catch (error) {
        return emptyResult('', '', false, error instanceof Error ? error.message : String(error))
      }
    },
    presentCall(args) {
      return { card: 'generic', title: `Semantic check: ${String(args.claim ?? '').slice(0, 60)}`, kind: 'read', rawInput: String(args.claim ?? '') }
    },
  })
}
