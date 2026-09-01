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

import type { ClaimCategory, ClaimIdentifiers, ClaimRecord } from './ledger.ts'
import {
  findDoi,
  findGeoAccession,
  findNctId,
  findPmid,
  findSraAccession,
  findUniprotAccession,
} from './evidence.ts'

export function findPatentNumber(text: string): string {
  const us = /\bUS\s?\d{7,9}\b/i.exec(text)?.[0]?.replaceAll(/\s+/g, '').toUpperCase()
  if (us !== undefined) return us
  const plain = /\bPatent\s?(?:No\.?\s?)?(\d{7,9})\b/i.exec(text)?.[1]
  return plain !== undefined ? `US${plain}` : ''
}

export function findUrls(text: string): string[] {
  const matches = text.match(/\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi) ?? []
  return matches.map(url => url.replace(/[.,;)\]]+$/, ''))
}

const RESOLVER_HOSTS = /(doi\.org|pubmed\.ncbi\.nlm\.nih\.gov|clinicaltrials\.gov|www\.ncbi\.nlm\.nih\.gov|europepmc\.org|uniprot\.org|patents\.google\.com)/i

/** Choose the strongest category for a set of identifiers. */
export function classifyIdentifiers(ids: ClaimIdentifiers): ClaimCategory {
  if (ids.doi !== undefined || ids.pmid !== undefined) return 'literature'
  if (ids.patent !== undefined) return 'patent'
  if (ids.nctId !== undefined) return 'clinical_trial'
  if (ids.geo !== undefined || ids.sra !== undefined) return 'dataset'
  if (ids.uniprot !== undefined) return 'protein'
  if ((ids.urls ?? []).length > 0) return 'webpage'
  return 'unlinked'
}

export interface DecomposedClaim {
  readonly claim: string
  readonly quote: string
  readonly paraIndex: number
  readonly category: ClaimCategory
  readonly identifiers: ClaimIdentifiers
  readonly origin: 'scan' | 'llm' | 'merged'
  readonly expectedTitle?: string
}

/** Extract identifiers from free text, dropping resolver URLs. */
export function extractIdentifiers(text: string): ClaimIdentifiers {
  const allUrls = findUrls(text)
  const ids: ClaimIdentifiers = {}
  const doi = findDoi(text)
  const urls = allUrls.filter(url => !RESOLVER_HOSTS.test(url) && (doi === '' || !url.toLowerCase().includes(doi)))
  const pmid = findPmid(text)
  const nctId = findNctId(text)
  const uniprot = findUniprotAccession(text)
  const geo = findGeoAccession(text)
  const sra = findSraAccession(text)
  const patent = findPatentNumber(text)
  if (doi !== '') ids.doi = doi
  if (pmid !== '') ids.pmid = pmid
  if (nctId !== '') ids.nctId = nctId
  if (uniprot !== '') ids.uniprot = uniprot
  if (geo !== '') ids.geo = geo
  if (sra !== '') ids.sra = sra
  if (patent !== '') ids.patent = patent
  if (urls.length > 0) ids.urls = urls.slice(0, 5)
  return ids
}

/** Split a report into paragraphs, then sentences within each paragraph. */
export function segmentReport(report: string): Array<{ paraIndex: number; sentence: string }> {
  const paragraphs = report.replace(/\r\n/g, '\n').split(/\n{2,}/)
  const units: Array<{ paraIndex: number; sentence: string }> = []
  for (let paraIndex = 0; paraIndex < paragraphs.length; paraIndex++) {
    const paragraph = paragraphs[paraIndex]!.trim()
    if (paragraph === '') continue
    const sentences = paragraph
      .split(/(?<=[。！？!?；;])\s*|(?<=[.])\s+(?=[A-Z0-9"（(“])/g)
      .map(sentence => sentence.trim())
      .filter(sentence => sentence.length > 8)
    for (const sentence of sentences) units.push({ paraIndex, sentence })
  }
  return units
}

/** Pass 1: deterministic scan over segmented sentences. */
export function scanReport(report: string): DecomposedClaim[] {
  const claims: DecomposedClaim[] = []
  for (const { paraIndex, sentence } of segmentReport(report)) {
    const ids = extractIdentifiers(sentence)
    const category = classifyIdentifiers(ids)
    if (category === 'unlinked') continue
    claims.push({ claim: sentence, quote: sentence, paraIndex, category, identifiers: ids, origin: 'scan' })
  }
  return claims
}

const DECOMPOSE_SYSTEM = `You decompose a research report into individually verifiable evidence points for an automated verification pipeline. Extract every factual claim that cites or depends on an external source (paper, preprint, patent, trial, dataset, protein entry, web page). Ignore pure reasoning/opinion sentences that cite nothing.

For each point output ONE JSON line:
{"claim": "<the factual assertion as the report makes it>", "quote": "<verbatim fragment of the report containing it>", "category": "literature|patent|clinical_trial|dataset|protein|webpage", "expectedTitle": "<the cited source's title IF the report states or clearly paraphrases one (paper, patent, dataset, or web article title), else omit>"}

Rules: keep each claim atomic (split compound statements); quote verbatim Chinese or English as written; never invent identifiers; output NOTHING else besides JSON lines.`

interface LlmClaimLine {
  claim?: unknown
  quote?: unknown
  category?: unknown
  expectedTitle?: unknown
}

/** Pass 2: LLM decomposition; failures degrade to the deterministic scan only. */
export async function decomposeWithLlm(report: string, chat: (system: string, user: string) => Promise<string>): Promise<DecomposedClaim[]> {
  let reply: string
  try {
    reply = await chat(DECOMPOSE_SYSTEM, report.slice(0, 9000))
  } catch {
    return []
  }
  const claims: DecomposedClaim[] = []
  for (const line of reply.split('\n').map(raw => raw.trim().replace(/^[-*]\s*/, ''))) {
    if (line === '' || !line.startsWith('{')) continue
    let parsed: LlmClaimLine
    try {
      parsed = JSON.parse(line) as LlmClaimLine
    } catch {
      continue
    }
    if (typeof parsed.claim !== 'string' || parsed.claim.trim() === '') continue
    const category = typeof parsed.category === 'string' && ['literature', 'patent', 'clinical_trial', 'dataset', 'protein', 'webpage'].includes(parsed.category)
      ? parsed.category as ClaimCategory
      : 'unlinked'
    const quote = typeof parsed.quote === 'string' ? parsed.quote : parsed.claim
    const paraIndex = locateParagraph(report, quote)
    // Re-extract identifiers from the quote deterministically — the LLM must
    // not be trusted to transcribe identifiers.
    const identifiers = extractIdentifiers(quote)
    claims.push({
      claim: parsed.claim.trim().slice(0, 600),
      quote: quote.slice(0, 400),
      paraIndex,
      category,
      identifiers,
      origin: 'llm',
      ...(typeof parsed.expectedTitle === 'string' && parsed.expectedTitle.trim() !== '' ? { expectedTitle: parsed.expectedTitle.trim().slice(0, 300) } : {}),
    })
  }
  return claims
}

/** Paragraph index containing the quote (normalized match); -1 when absent. */
export function locateParagraph(report: string, quote: string): number {
  const norm = (text: string): string => text.replace(/\s+/g, '')
  const paragraphs = report.replace(/\r\n/g, '\n').split(/\n{2,}/)
  const needle = norm(quote).slice(0, 120)
  if (needle === '') return -1
  for (let index = 0; index < paragraphs.length; index++) {
    if (norm(paragraphs[index] ?? '').includes(needle)) return index
  }
  // token-overlap fallback for quotes the LLM paraphrased
  const tokens = needle.slice(0, 40)
  for (let index = 0; index < paragraphs.length; index++) {
    if (norm(paragraphs[index] ?? '').includes(tokens)) return index
  }
  return -1
}

/** Merge both passes: dedupe by identifier overlap, prefer scan anchors. */
export function mergeClaims(scanned: readonly DecomposedClaim[], llm: readonly DecomposedClaim[]): DecomposedClaim[] {
  const merged: DecomposedClaim[] = [...scanned]
  const signature = (ids: ClaimIdentifiers): string =>
    [ids.doi, ids.pmid, ids.nctId, ids.uniprot, ids.geo, ids.sra, ids.patent].filter(Boolean).map(String).map(value => value.toLowerCase()).sort().join('|') || `url:${(ids.urls ?? []).join('|').toLowerCase()}`
  const signatures = new Set(scanned.map(claim => signature(claim.identifiers)))
  for (const claim of llm) {
    const sig = signature(claim.identifiers)
    if (sig === '') continue // LLM claim without any anchor and without quote identifiers: unusable
    if (signatures.has(sig)) {
      // enrich the existing scan claim with the LLM's expectedTitle when absent
      const existing = merged.find(candidate => signature(candidate.identifiers) === sig)
      if (existing !== undefined && existing.expectedTitle === undefined && claim.expectedTitle !== undefined) {
        merged.splice(merged.indexOf(existing), 1, { ...existing, expectedTitle: claim.expectedTitle, origin: 'merged' })
      }
      continue
    }
    signatures.add(sig)
    merged.push(claim)
  }
  return merged
}

/** Full decomposition: scan + optional LLM pass → materialized ClaimRecords. */
export function materializeClaims(claims: readonly DecomposedClaim[]): ClaimRecord[] {
  return claims.map((claim, index) => ({
    claimId: `C${index + 1}`,
    claim: claim.claim,
    quote: claim.quote,
    paraIndex: claim.paraIndex,
    category: claim.category,
    identifiers: claim.identifiers,
    ...(claim.expectedTitle !== undefined ? { expectedTitle: claim.expectedTitle } : {}),
    origin: claim.origin,
    aspects: [],
    status: 'pending',
    failureAspects: [],
  }))
}
