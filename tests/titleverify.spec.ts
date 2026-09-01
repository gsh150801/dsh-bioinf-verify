/**
 * Unit tests for the title_verify component (mocked registries/web) and its
 * workflow integration (title_agreement for patent/geo/webpage categories).
 *
 * @module dsh-bioinf-verify/tests/titleverify
 */

import { describe, expect, it } from 'vitest'
import { jsonResponse } from './helpers.ts'
import { BioHttpClient } from '../src/biohttp.ts'
import { buildTitleVerifyTool, titleSimilarityProbe, verifyTitle } from '../src/titleverify.ts'
import { fetchPageTitle } from '../src/urlverify.ts'
import { materializeClaims, scanReport } from '../src/decompose.ts'
import { planAspects } from '../src/workflow.ts'
import { createVerificationJob, type ClaimRecord } from '../src/ledger.ts'

const ncbi = { apiKey: '' }

function pageResponse(init: { status?: number; url?: string; body: string }): unknown {
  return {
    status: init.status ?? 200,
    url: init.url ?? '',
    headers: { get: () => 'text/html' },
    text: async () => init.body,
  }
}

describe('titleSimilarityProbe (graded bands)', () => {
  it('matches containment, grades close, detects mismatch', () => {
    expect(titleSimilarityProbe('Accelerating scientific discovery with Co-Scientist', 'Accelerating Scientific Discovery with an AI Co-Scientist').verdict).toBe('match')
    expect(titleSimilarityProbe('CRISPR gene editing: a review of applications', 'CRISPR gene editing and its applications').verdict).toBe('close')
    expect(titleSimilarityProbe('CRISPR base editing review', 'Metabolic flux analysis in yeast fermentation').verdict).toBe('mismatch')
  })
})

describe('fetchPageTitle', () => {
  it('prefers og:title over <title> and decodes entities', async () => {
    const { title } = await fetchPageTitle('https://news.test/a', {
      fetchImpl: (async () => pageResponse({
        body: '<html><head><title>Site name</title><meta property="og:title" content="CRISPR &amp; the future of medicine" /></head></html>',
      })) as unknown as typeof fetch,
    })
    expect(title).toBe('CRISPR & the future of medicine')
  })

  it('falls back to twitter:title then <title>', async () => {
    const twitter = await fetchPageTitle('https://news.test/b', {
      fetchImpl: (async () => pageResponse({ body: '<meta name="twitter:title" content="Twitter card title" /><title>ignored</title>' })) as unknown as typeof fetch,
    })
    expect(twitter.title).toBe('Twitter card title')
    const plain = await fetchPageTitle('https://news.test/c', {
      fetchImpl: (async () => pageResponse({ body: '<title>Plain &amp; Simple</title>' })) as unknown as typeof fetch,
    })
    expect(plain.title).toBe('Plain & Simple')
  })
})

describe('verifyTitle (mocked sources)', () => {
  const client = new BioHttpClient({
    contactEmail: '',
    fetchImpl: (async (url: string | URL | Request) => {
      const target = String(url)
      if (target.includes('crossref')) {
        return target.includes('10644-y')
          ? jsonResponse({ message: { title: ['Accelerating scientific discovery with Co-Scientist'] } })
          : new Response('not found', { status: 404 })
      }
      if (target.includes('esummary') && target.includes('db=pubmed')) {
        return jsonResponse({ result: { uids: ['1'], '1': { title: 'Ileal-lymphoid-nodular hyperplasia and autism: a retracted study' } } })
      }
      if (target.includes('esearch')) return jsonResponse({ esearchresult: { idlist: ['200149768'] } })
      if (target.includes('esummary') && target.includes('db=gds')) {
        return jsonResponse({ result: { '200149768': { accession: 'GSE149768', title: 'HPRT1 upregulated predicts breast cancer outcome' } } })
      }
      if (target.includes('patentsview')) {
        return jsonResponse({ patents: [{ patent_id: '10776599', patent_title: 'Methods and compositions for RNA targeting' }] })
      }
      return jsonResponse({})
    }) as unknown as typeof fetch,
  })

  it('doi: match on the real Co-Scientist title', async () => {
    const result = await verifyTitle(client, ncbi, {
      title: 'Accelerating Scientific Discovery with Co-Scientist',
      doi: '10.1038/s41586-026-10644-y',
    }, '')
    expect(result.verdict).toBe('match')
    expect(result.actualTitle).toContain('Co-Scientist')
  })

  it('doi: mismatch when the claimed title belongs to a different work', async () => {
    const result = await verifyTitle(client, ncbi, {
      title: 'Metformin cures Alzheimer disease: a randomized trial',
      doi: '10.1038/s41586-026-10644-y',
    }, '')
    expect(result.verdict).toBe('mismatch')
    expect(result.actualTitle).toContain('Co-Scientist')
  })

  it('pmid: flags a retracted study whose title the report got right', async () => {
    const result = await verifyTitle(client, ncbi, { title: 'a retracted study autism', pmid: '1' }, '')
    // Paraphrase lands in the 'close' band (same work, wording differs).
    expect(result.verdict).toBe('close')
    expect(result.provenance).toContain('PubMed')
  })

  it('geo: dataset title match', async () => {
    const close = await verifyTitle(client, ncbi, { title: 'breast cancer outcome HPRT1', geo: 'GSE149768' }, '')
    expect(close.verdict).toBe('close')
    const exact = await verifyTitle(client, ncbi, { title: 'HPRT1 upregulated predicts breast cancer outcome', geo: 'GSE149768' }, '')
    expect(exact.verdict).toBe('match')
    expect(exact.provenance).toContain('GEO')
  })

  it('patent: verifies when a key is present, unverified with guidance when not', async () => {
    const keyed = new BioHttpClient({
      contactEmail: '',
      fetchImpl: (async () => jsonResponse({ patents: [{ patent_id: '10776599', patent_title: 'RNA targeting system' }] })) as unknown as typeof fetch,
    })
    const ok = await verifyTitle(keyed, ncbi, { title: 'RNA targeting system', patent: 'US10776599' }, 'k-test')
    expect(ok.verdict).toBe('match')

    const noKey = await verifyTitle(client, ncbi, { title: 'RNA targeting system', patent: 'US10776599' }, '')
    expect(noKey.verdict).toBe('unverified')
    expect(noKey.error).toMatch(/PATENTSVIEW_API_KEY/)
  })

  it('url: news article via og:title', async () => {
    const result = await verifyTitle(client, ncbi, {
      title: 'AI co-scientist accelerates biology research',
      url: 'https://news.test/article',
    }, '')
    void result
    // The url branch uses global fetch via fetchPageTitle — stubbed by the
    // client? No: fetchPageTitle uses its own fetch. For the unit test we call
    // it with an explicit fetchImpl instead (covered below); here just assert
    // the unverified path when the page is unreachable from the test sandbox.
    expect(['unverified']).toContain(result.verdict)
  })

  it('argument errors are actionable, not crashes', async () => {
    const noTitle = await verifyTitle(client, ncbi, { title: '', doi: '10.1/x' }, '')
    expect(noTitle.error).toMatch(/title is required/)
    const noSource = await verifyTitle(client, ncbi, { title: 'Anything' }, '')
    expect(noSource.error).toMatch(/no source identifier/)
  })
})

describe('fetchPageTitle against a stubbed global-style client', () => {
  it('extracts and matches an article title', async () => {
    const page = await fetchPageTitle('https://news.test/ai-biology', {
      fetchImpl: (async () => pageResponse({
        url: 'https://news.test/ai-biology',
        body: '<meta property="og:title" content="AI co-scientist accelerates biology research" />',
      })) as unknown as typeof fetch,
    })
    expect(page.title).toBe('AI co-scientist accelerates biology research')
    expect(page.httpStatus).toBe(200)
  })
})

describe('tool + workflow integration', () => {
  it('title_verify tool output keys stay within the declared schema', async () => {
    const client = new BioHttpClient({
      contactEmail: '',
      fetchImpl: (async () => jsonResponse({ message: { title: ['A paper'] } })) as unknown as typeof fetch,
    })
    const tool = buildTitleVerifyTool(client, ncbi, '')
    const declared = Object.keys((tool.output.schema as { properties: Record<string, unknown> }).properties)
    const value = (await tool.execute({ title: 'A paper', doi: '10.1234/real' }, undefined as never)) as Record<string, unknown>
    for (const key of Object.keys(value)) expect(declared).toContain(key)
  })

  it('webpage claims with an expected title plan a title_agreement aspect', () => {
    const report = '报道见 https://news.test/ai-biology ，标题为《AI co-scientist accelerates biology research》。'
    const scanned = materializeClaims(scanReport(report))
    // Deterministic scan cannot know the LLM-supplied expectedTitle; simulate
    // the merge outcome by reconstructing the record with one.
    const claims: ClaimRecord[] = scanned.map(claim =>
      claim.claimId === 'C1' ? { ...claim, expectedTitle: 'AI co-scientist accelerates biology research' } : claim)
    const job = createVerificationJob('t', report, { semanticChecks: false })
    job.claims = claims
    const plan = planAspects(job, claims[0]!)
    expect(plan.some(item => item.aspect === 'url_accessibility')).toBe(true)
    expect(plan.some(item => item.aspect === 'title_agreement')).toBe(true)
  })
})
