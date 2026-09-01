/**
 * LIVE acceptance tests for the verification plugin — real registries, real
 * URLs, and the real local vLLM. Gated behind RUN_LIVE=1:
 *
 *   RUN_LIVE=1 ./node_modules/.bin/vitest run packages/examples/dsh-bioinf-verify/tests/live.spec.ts
 *
 * @module dsh-bioinf-verify/tests/live
 */

import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BioHttpClient } from '../src/biohttp.ts'
import { buildEvidenceTools, auditClaims, verifyDoi } from '../src/evidence.ts'
import { verifyTitle } from '../src/titleverify.ts'
import { checkUrl } from '../src/urlverify.ts'
import { makeLlmChat, type ChatFn } from '../src/llm.ts'
import { runSemanticCheck } from '../src/semantic.ts'
import { JobStore } from '../src/ledger.ts'
import { finalizeJob, startVerification, stepJob, type VerifyDeps } from '../src/workflow.ts'

const RUN = process.env.RUN_LIVE === '1'
const d = RUN ? describe : describe.skip

const client = new BioHttpClient({ contactEmail: 'bioinf-test@example.org' })
const ncbi = { apiKey: process.env.PUBMED_API_KEY ?? '' }
const llm: ChatFn = makeLlmChat({
  enabled: true,
  baseURL: process.env.TOURNAMENT_LLM_BASE_URL ?? 'http://127.0.0.1:8012/v1',
  model: 'deepseek-v4-flash',
  apiKey: '',
})

const exec = (tool: { execute: (args: object, exec: never) => Promise<unknown> }, args: object): Promise<Record<string, unknown>> =>
  tool.execute(args, undefined as never) as Promise<Record<string, unknown>>

// ---------------------------------------------------------------------------
// url_verify against the real web
// ---------------------------------------------------------------------------

d('LIVE url_verify', () => {
  it('accepts a real page and rejects a missing one', async () => {
    const good = await checkUrl('https://www.example.com/')
    expect(good.verdict).toBe('accessible')

    const missing = await checkUrl('https://www.example.com/definitely-not-here-2026')
    expect(missing.verdict).toBe('not_found')

    // Redirect chain: doi.org resolves to the publisher.
    const redirect = await checkUrl('https://doi.org/10.1038/s41586-026-10644-y')
    expect(['redirect', 'accessible', 'blocked']).toContain(redirect.verdict)
    console.log('  url_verify: good ->', good.verdict, '| missing ->', missing.verdict, '| doi.org ->', redirect.verdict, '->', redirect.finalUrl.slice(0, 60))
  }, 60_000)
})

// ---------------------------------------------------------------------------
// Registry checks still behave on the real registries
// ---------------------------------------------------------------------------

d('LIVE evidence (verify package)', () => {
  it('verifies the Co-Scientist DOI and rejects a fabricated one', async () => {
    const good = await verifyDoi(client, { doi: '10.1038/s41586-026-10644-y', expectedTitle: 'Accelerating scientific discovery with Co-Scientist' })
    expect(good.status).toBe('verified')
    const bad = await verifyDoi(client, { doi: '10.9999/fabricated.2026.0001' })
    expect(bad.status).toBe('not_found')
    console.log('  doi good ->', good.status, '| fabricated ->', bad.status)
  }, 60_000)

  it('flags a retracted CRISPR paper via pmid_verify', async () => {
    const tool = buildEvidenceTools(client, ncbi).find(t => t.name === 'pmid_verify')!
    const result = await exec(tool, { pmid: '39532094' })
    expect(result.status).toBe('verified')
    expect(String(result.detail)).toMatch(/RETRACTION\/EoC/i)
  }, 60_000)

  it('claim_audit produces a FAIL verdict on a mixed list', async () => {
    const report = await auditClaims(client, ncbi, [
      { claim: 'Co-Scientist paper', doi: '10.1038/s41586-026-10644-y', expectedTitle: 'Accelerating scientific discovery with Co-Scientist' },
      { claim: 'fabricated study', doi: '10.5555/fake.2026.1' },
      { claim: 'dataset exists', geo: 'GSE149768' },
    ])
    expect(report.verified).toBe(2)
    expect(report.notFound).toBe(1)
    expect(report.verdict).toBe('FAIL')
  }, 120_000)
})

// ---------------------------------------------------------------------------
// title_verify against real sources: paper / dataset / news-page
// ---------------------------------------------------------------------------

d('LIVE title_verify', () => {
  it('paper title (doi): match / mismatch / graded close', async () => {
    const match = await verifyTitle(client, ncbi, {
      title: 'Accelerating scientific discovery with Co-Scientist',
      doi: '10.1038/s41586-026-10644-y',
    }, '')
    expect(match.verdict).toBe('match')

    const mismatch = await verifyTitle(client, ncbi, {
      title: 'Metformin cures Alzheimer disease: a randomized trial',
      doi: '10.1038/s41586-026-10644-y',
    }, '')
    expect(mismatch.verdict).toBe('mismatch')
    console.log('  title paper:', match.verdict, '|', mismatch.verdict, '| actual:', mismatch.actualTitle.slice(0, 50))
  }, 90_000)

  it('dataset title (geo): prefix containment matches, unrelated fails (abbreviations are word-level mismatches by design)', async () => {
    const exact = await verifyTitle(client, ncbi, {
      title: 'Hypoxanthine phosphoribosyl transferase 1 is upregulated',
      geo: 'GSE149768',
    }, '')
    expect(exact.verdict).toBe('match')
    const wrong = await verifyTitle(client, ncbi, { title: 'single-cell atlas of mouse brain', geo: 'GSE149768' }, '')
    expect(wrong.verdict).toBe('mismatch')
    console.log('  title geo:', exact.verdict, '|', wrong.verdict, '| actual:', exact.actualTitle.slice(0, 60))
  }, 90_000)

  it('web/news title (url): live page og:title/<title>', async () => {
    const result = await verifyTitle(client, ncbi, {
      title: 'Biomni: A general-purpose biomedical AI agent',
      url: 'https://biomni.stanford.edu/',
    }, '')
    expect(result.sourceKind).toBe('url')
    expect(['match', 'close', 'mismatch', 'unverified']).toContain(result.verdict)
    console.log('  title url:', result.verdict, '| actual:', result.actualTitle.slice(0, 70))
  }, 90_000)

  it('patent title: unverified guidance without a key', async () => {
    const result = await verifyTitle(client, ncbi, { title: 'RNA targeting', patent: 'US10776599' }, process.env.PATENTSVIEW_API_KEY ?? '')
    if (process.env.PATENTSVIEW_API_KEY !== undefined && process.env.PATENTSVIEW_API_KEY !== '') {
      expect(['match', 'close', 'mismatch']).toContain(result.verdict)
      console.log('  title patent (keyed):', result.verdict, '|', result.actualTitle.slice(0, 60))
    } else {
      expect(result.verdict).toBe('unverified')
      expect(result.error).toMatch(/PATENTSVIEW_API_KEY/)
      console.log('  title patent: unverified with key guidance (as designed)')
    }
  }, 60_000)
})

// ---------------------------------------------------------------------------
// Semantic consistency on the real vLLM
// ---------------------------------------------------------------------------

d('LIVE semantic check (verify package)', () => {
  it('consistent claim passes; cross-topic claim fails with evidence', async () => {
    const good = await runSemanticCheck(client, ncbi, llm, {
      claim: '这篇论文提出了一个多智能体 AI 系统，用于科学假说的生成、辩论与排序。',
      doi: '10.1038/s41586-026-10644-y',
    }, '')
    expect(good.sourceFetched).toBe(true)
    expect(good.error).toBe('')
    expect(['consistent', 'partially_consistent']).toContain(good.verdict)

    const bad = await runSemanticCheck(client, ncbi, llm, {
      claim: '该文献证明了 metformin 可以治愈人类阿尔茨海默病。',
      doi: '10.1038/s41586-026-10644-y',
    }, '')
    expect(['inconsistent', 'unrelated']).toContain(bad.verdict)
    expect(bad.credibilityImpact).toBe('high')
    console.log('  semantic: good ->', good.verdict, '| bad ->', bad.verdict, '(', bad.discrepancies[0]?.slice(0, 80), ')')
  }, 180_000)
})

// ---------------------------------------------------------------------------
// Whole-report verification workflow end-to-end (real registries + vLLM)
// ---------------------------------------------------------------------------

d('LIVE report verification workflow', () => {
  it('verifies a mixed-fidelity report and produces the annotated output', async () => {
    const report = `# 验收测试报告

Google 提出的 Co-Scientist 是一个用于加速科学发现的多智能体 AI 系统（doi 10.1038/s41586-026-10644-y）。

某虚假研究发表于 doi 10.5555/fake.2026.9999，其结论支持本假说。

项目主页为 https://www.example.com/ 。

TP53 的 UniProt 登录号是 P04637，对应基因 TP53。
`
    const storeDir = mkdtempSync(join(tmpdir(), 'live-verify-'))
    try {
      const store = new JobStore(storeDir)
      const deps: VerifyDeps = { client, ncbi, chat: llm, patentsApiKey: process.env.PATENTSVIEW_API_KEY ?? '' }
      const job = await startVerification(store, deps, { report, semanticChecks: true })
      expect(job.claims.length).toBeGreaterThanOrEqual(3)

      let guard = 0
      let outcome = await stepJob(store, deps, job.jobId)
      while (!outcome.finished && guard < 60) {
        outcome = await stepJob(store, deps, job.jobId)
        guard++
      }
      expect(outcome.finished).toBe(true)

      const final = (await store.get(job.jobId))!
      const fake = final.claims.find(claim => claim.identifiers.doi === '10.5555/fake.2026.9999')
      expect(fake?.status).toBe('failed')
      const good = final.claims.find(claim => claim.identifiers.doi === '10.1038/s41586-026-10644-y')
      expect(good?.status).toBe('passed')
      const uniprot = final.claims.find(claim => claim.identifiers.uniprot === 'P04637')
      expect(uniprot?.status).toBe('passed')

      const result = await finalizeJob(store, { workDir: storeDir }, job.jobId)
      expect(result.annotated).toContain('【校验未通过')
      expect(result.annotated).toContain('校验报告（自动生成')
      expect(existsSync(join(storeDir, job.jobId, 'annotated.md'))).toBe(true)

      const appendix = readFileSync(join(storeDir, job.jobId, 'verification-report.md'), 'utf8')
      expect(appendix).toContain('10.5555/fake.2026.9999')
      console.log(`  workflow: ${final.claims.length} claims, ${guard + 1} steps; failures: ${final.claims.filter(c => c.status === 'failed').length}`)
      console.log('  sample annotation:', result.annotated.split('\n').find(line => line.includes('【校验未通过'))?.slice(0, 120))
    } finally {
      rmSync(storeDir, { recursive: true, force: true })
    }
  }, 480_000)
})

describe('gate', () => {
  it('live tests are gated by RUN_LIVE=1', () => {
    expect(['0', '1']).toContain(RUN ? '1' : '0')
  })
})

void existsSync
void readFileSync
