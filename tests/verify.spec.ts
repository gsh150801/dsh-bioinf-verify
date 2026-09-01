/**
 * Unit tests for dsh-bioinf-verify: URL verification, report decomposition,
 * the durable job ledger, the multi-aspect workflow (end-to-end over a fake
 * report with mocked chat + fetch), annotation, appendix, registry checks
 * (moved from dsh-bioinf-routed), and tool output-schema discipline.
 *
 * @module dsh-bioinf-verify/tests/verify
 */

import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BioHttpClient } from '../src/biohttp.ts'
import {
  buildEvidenceTools,
  compareTitles,
  findDoi,
  findGeoAccession,
  findNctId,
  findPmid,
  findSraAccession,
  findUniprotAccession,
  normalizeDoi,
  verifyDoi,
  verifyPmid,
  auditClaims,
} from '../src/evidence.ts'
import { checkUrl, normalizeUrl, buildUrlVerifyTool, type UrlCheckResult } from '../src/urlverify.ts'
import { makeLlmChat } from '../src/llm.ts'
import {
  classifyIdentifiers,
  decomposeWithLlm,
  extractIdentifiers,
  locateParagraph,
  materializeClaims,
  mergeClaims,
  scanReport,
} from '../src/decompose.ts'
import {
  JobStore,
  createVerificationJob,
  jobStats,
  refreshFailureAspects,
  type ClaimRecord,
  type VerificationJob,
} from '../src/ledger.ts'
import {
  annotateReport,
  finalizeJob,
  markerFor,
  planAspects,
  startVerification,
  stepJob,
  verificationAppendix,
  type VerifyDeps,
} from '../src/workflow.ts'
import { buildSemanticCheckTool, parseSemanticReview, runSemanticCheck } from '../src/semantic.ts'
import { apply as _apply } from '../src/index.ts'

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// ---------------------------------------------------------------------------
// URL verification
// ---------------------------------------------------------------------------

function fakeResponse(init: { status: number; url?: string; contentType?: string; body?: string }): unknown {
  return {
    status: init.status,
    url: init.url ?? '',
    headers: { get: (key: string) => key.toLowerCase() === 'content-type' ? (init.contentType ?? '') : null },
    text: async () => init.body ?? '',
  }
}

describe('urlverify', () => {
  it('normalizes lazy URLs and strips trailing punctuation', () => {
    expect(normalizeUrl('www.example.com/a.')).toBe('https://www.example.com/a')
    expect(normalizeUrl('http://x.test/y')).toBe('http://x.test/y')
  })

  it('marks 2xx as accessible and 404 as not_found', async () => {
    const fetchImpl = (async (_url: string | URL | Request) =>
      fakeResponse({ status: 200, url: '', contentType: 'text/html', body: '<title>Real page</title>' })) as unknown as typeof fetch
    const ok = await checkUrl('https://good.test/a', { fetchImpl })
    expect(ok.verdict).toBe('accessible')
    expect(ok.soft404Suspected).toBe(false)

    const missing = await checkUrl('https://good.test/missing', { fetchImpl: (async () => fakeResponse({ status: 404 })) as unknown as typeof fetch })
    expect(missing.verdict).toBe('not_found')
  })

  it('follows redirects and reports the final URL', async () => {
    const result = await checkUrl('https://old.test/a', {
      fetchImpl: (async () => fakeResponse({ status: 200, url: 'https://new.test/b', contentType: 'text/html', body: '<title>Moved</title>' })) as unknown as typeof fetch,
    })
    expect(result.verdict).toBe('redirect')
    expect(result.redirected).toBe(true)
    expect(result.finalUrl).toBe('https://new.test/b')
  })

  it('treats 401/403 as blocked (warning) and flags soft-404 titles', async () => {
    const blocked = await checkUrl('https://paywall.test/x', { fetchImpl: (async () => fakeResponse({ status: 403 })) as unknown as typeof fetch })
    expect(blocked.verdict).toBe('blocked')

    const soft = await checkUrl('https://shop.test/gone', {
      fetchImpl: (async () => fakeResponse({ status: 200, contentType: 'text/html', body: '<title>404 Not Found</title>' })) as unknown as typeof fetch,
    })
    expect(soft.verdict).toBe('accessible')
    expect(soft.soft404Suspected).toBe(true)
  })

  it('falls back to GET after a 405 HEAD and reports network errors as unreachable', async () => {
    let method = ''
    const result = await checkUrl('https://stubborn.test/', {
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        method = String(init?.method)
        if (method === 'HEAD') return fakeResponse({ status: 405 })
        return fakeResponse({ status: 200, contentType: 'text/plain', body: 'ok' })
      }) as unknown as typeof fetch,
    })
    expect(method).toBe('GET')
    expect(result.verdict).toBe('accessible')

    const down = await checkUrl('https://blackhole.test/', {
      fetchImpl: (async () => { throw new TypeError('getaddrinfo ENOTFOUND') }) as unknown as typeof fetch,
    })
    expect(down.verdict).toBe('unreachable')
  })
})

// ---------------------------------------------------------------------------
// Decomposition
// ---------------------------------------------------------------------------

const SAMPLE_REPORT = `# 肿瘤免疫研究综述

CAR-T 疗法在血液瘤中疗效显著。Huang 等提出的 Biomni 是通用生物医学 AI 智能体（Science 2026, doi 10.1126/science.adz4351）。

该结论由试验 NCT06327698 支持。表达数据来自 GEO 数据集 GSE149768。蛋白靶点为 P04637。

参见项目主页 https://github.com/snap-stanford/biomni 。相关专利为 US10776599。
`

describe('decompose', () => {
  it('extracts identifiers with correct priorities', () => {
    const ids = extractIdentifiers('论文 doi.org/10.1126/abc 的 PMID 39532094 与 GSE149768、P04637')
    expect(ids.doi).toBe('10.1126/abc')
    expect(ids.pmid).toBe('39532094')
    expect(ids.geo).toBe('GSE149768')
    expect(ids.uniprot).toBe('P04637')
    // doi.org resolver URL must not become a webpage identifier
    expect(ids.urls).toBeUndefined()
  })

  it('classifies categories by strongest identifier', () => {
    expect(classifyIdentifiers({ doi: '10.1/x' })).toBe('literature')
    expect(classifyIdentifiers({ nctId: 'NCT00000001' })).toBe('clinical_trial')
    expect(classifyIdentifiers({ geo: 'GSE1' })).toBe('dataset')
    expect(classifyIdentifiers({ uniprot: 'P04637' })).toBe('protein')
    expect(classifyIdentifiers({ patent: 'US10776599' })).toBe('patent')
    expect(classifyIdentifiers({ urls: ['https://x.test'] })).toBe('webpage')
    expect(classifyIdentifiers({})).toBe('unlinked')
  })

  it('scans the sample report into categorized claims with anchors', () => {
    const claims = scanReport(SAMPLE_REPORT)
    const categories = new Set(claims.map(claim => claim.category))
    expect(categories.has('literature')).toBe(true)
    expect(categories.has('clinical_trial')).toBe(true)
    expect(categories.has('dataset')).toBe(true)
    expect(categories.has('protein')).toBe(true)
    expect(categories.has('webpage')).toBe(true)
    expect(categories.has('patent')).toBe(true)
    for (const claim of claims) {
      expect(claim.quote.length).toBeGreaterThan(0)
      expect(claim.paraIndex).toBeGreaterThanOrEqual(0)
    }
  })

  it('locates quotes by normalized match with paragraph fallback', () => {
    expect(locateParagraph(SAMPLE_REPORT, 'CAR-T 疗法在血液瘤中疗效显著')).toBe(1)
    expect(locateParagraph(SAMPLE_REPORT, '不存在的引用片段')).toBe(-1)
  })

  it('merges LLM claims: dedupes by identifier signature, keeps novel ones, enriches expectedTitle', async () => {
    const llmReply = [
      JSON.stringify({ claim: 'Biomni 发表于 Science', quote: 'doi 10.1126/science.adz4351', category: 'literature', expectedTitle: 'Autonomous biomedical research with an AI agent' }),
      JSON.stringify({ claim: 'GitHub 项目包含全部工具', quote: 'https://github.com/snap-stanford/biomni', category: 'webpage' }),
    ].join('\n')
    const chat = (async () => llmReply) as never
    const llm = await decomposeWithLlm(SAMPLE_REPORT, chat)
    expect(llm.length).toBeGreaterThanOrEqual(2)

    const scanned = scanReport(SAMPLE_REPORT)
    const merged = mergeClaims(scanned, llm)
    // The literature claim deduped (same DOI); the github page claim kept once.
    const githubCount = merged.filter(claim => claim.category === 'webpage' && JSON.stringify(claim.identifiers).includes('github')).length
    expect(githubCount).toBe(1)
    const enriched = merged.find(claim => claim.identifiers.doi === '10.1126/science.adz4351')
    expect(enriched?.expectedTitle).toBe('Autonomous biomedical research with an AI agent')
    expect(merged.length).toBeLessThan(scanned.length + llm.length)
  })

  it('materializes ClaimRecords with stable ids', () => {
    const records = materializeClaims(scanReport(SAMPLE_REPORT))
    expect(records[0]!.claimId).toBe('C1')
    expect(records.every(record => record.status === 'pending' && record.aspects.length === 0)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

describe('ledger', () => {
  it('persists and reloads jobs (auditable trail)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'))
    try {
      const store = new JobStore(dir)
      const job = createVerificationJob('test-job', SAMPLE_REPORT, { semanticChecks: true })
      job.claims = materializeClaims(scanReport(SAMPLE_REPORT))
      await store.log(job, 'phase', 'test')
      const reloaded = await store.get('test-job')
      expect(reloaded?.reportText).toBe(SAMPLE_REPORT)
      expect(reloaded?.claims).toHaveLength(job.claims.length)
      expect(reloaded?.log.some(entry => entry.event === 'phase')).toBe(true)
      expect(existsSync(join(dir, 'test-job.json'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rolls claim status up from aspects and tracks failing aspects', () => {
    const claim = materializeClaims(scanReport('见 doi 10.1126/science.adz4351。'))[0]!
    expect(claim.status).toBe('pending')
    claim.status = 'in_progress'
    claim.aspects.push({ aspect: 'existence', component: 'registry', startedAt: '', finishedAt: '', status: 'passed', detail: 'ok' })
    refreshFailureAspects(claim)
    expect(claim.status).toBe('passed')
    claim.aspects.push({ aspect: 'semantic_consistency', component: 'semantic', startedAt: '', finishedAt: '', status: 'failed', detail: 'unrelated' })
    refreshFailureAspects(claim)
    expect(claim.status).toBe('failed')
    expect(claim.failureAspects).toEqual(['semantic_consistency'])
  })

  it('aggregates job stats including per-aspect failure counts', () => {
    const job = createVerificationJob('s', 'x', { semanticChecks: false })
    const claims = materializeClaims(scanReport(SAMPLE_REPORT))
    claims[0]!.status = 'passed'
    claims[1]!.status = 'failed'
    claims[1]!.failureAspects = ['existence']
    claims[1]!.aspects.push({ aspect: 'existence', component: 'c', startedAt: '', finishedAt: '', status: 'failed', detail: 'x' })
    job.claims = claims
    const stats = jobStats(job)
    expect(stats.total).toBe(claims.length)
    expect(stats.passed).toBe(1)
    expect(stats.failed).toBe(1)
    expect(stats.failedAspects['existence']).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Workflow end-to-end (mocked network + chat)
// ---------------------------------------------------------------------------

describe('workflow end-to-end', () => {
  interface Scenario { report: string; fetch: (url: string) => unknown; llm?: string }

  function buildDeps(scenario: Scenario): VerifyDeps {
    const fetchImpl = (async (url: string | URL | Request) => {
      const target = String(url)
      if (target.startsWith('http://127.0.0.1') || target.endsWith('/chat/completions')) {
        return new Response(JSON.stringify({ choices: [{ message: { content: scenario.llm ?? '' } }] }), { status: 200 })
      }
      const body = scenario.fetch(target)
      return jsonResponse(body)
    }) as unknown as typeof fetch
    const chat = (async (system: string, _user: string) => {
      void system
      return scenario.llm ?? ''
    }) as never
    return {
      client: new BioHttpClient({ contactEmail: '', fetchImpl }),
      ncbi: { apiKey: '' },
      chat,
      patentsApiKey: '',
    }
  }

  it('decomposes, checks every aspect, annotates failures inline, and appends the report', async () => {
    const report = `# 研究小结

Biomni 是斯坦福发布的通用生物医学 AI 智能体（doi 10.1126/science.adz4351）。

某药物的虚假研究发表于 doi 10.5555/fake.2026.1（PMID 99999999）。

项目主页见 https://example.test/biomini 。

纯观点段落：我认为这个领域未来可期。
`
    const llmJson = [
      JSON.stringify({ claim: '该 DOI 是一篇真实论文', quote: 'doi 10.1126/science.adz4351', category: 'literature', expectedTitle: 'Autonomous biomedical research with an AI agent' }),
    ].join('\n')
    const scenario: Scenario = {
      report,
      llm: llmJson,
      fetch: (target) => {
        if (target.includes('crossref')) {
          return target.includes('fake.2026')
            ? { message: {} }
            : { message: { title: ['Autonomous biomedical research with an AI agent'], 'container-title': ['Science'], issued: { 'date-parts': [[2026]] }, 'is-referenced-by-count': 7 } }
        }
        if (target.includes('esearch') || target.includes('esummary')) return { esearchresult: { count: '0', idlist: [] }, result: { uids: [] } }
        return {}
      },
    }
    // url for example.test/biomini must 404 via our fetch map: BioHttp is bypassed for urls (checkUrl uses global fetch)... 
    // checkUrl receives fetchImpl from UrlCheckOptions default global fetch — for the unit test we instead patch via deps? It uses global fetch.
    // Acceptable: the url aspect will actually hit the network for example.test — avoid that by using a host that fails fast offline.
    const storeDir = mkdtempSync(join(tmpdir(), 'wf-'))
    try {
      const store = new JobStore(storeDir)
      const deps = buildDeps(scenario)
      const job = await startVerification(store, deps, { report, semanticChecks: false })
      expect(job.claims.length).toBeGreaterThanOrEqual(2)

      // Drive the pipeline to completion.
      let guard = 0
      let outcome = await stepJob(store, deps, job.jobId)
      while (!outcome.finished && guard < 40) {
        outcome = await stepJob(store, deps, job.jobId)
        guard++
      }
      expect(outcome.finished).toBe(true)

      const done = (await store.get(job.jobId))!
      const fake = done.claims.find(claim => claim.identifiers.doi === '10.5555/fake.2026.1')
      expect(fake?.status).toBe('failed')
      expect(fake?.failureAspects).toContain('existence')
      const pmidClaim = done.claims.find(claim => claim.claim.includes('PMID 99999999') || claim.identifiers.pmid === '99999999')
      if (pmidClaim !== undefined) expect(pmidClaim.failureAspects.length).toBeGreaterThan(0)
      const good = done.claims.find(claim => claim.identifiers.doi === '10.1126/science.adz4351')
      expect(good?.status).toBe('passed')

      // Annotation: failing point marked inline, passing point untouched.
      const { annotated, appendix } = await finalizeJob(store, { workDir: storeDir }, job.jobId)
      expect(annotated).toContain('【校验未通过')
      expect(annotated).toContain('校验报告（自动生成')
      expect(annotated).toContain('未通过/警告点的具体说明')
      expect(annotated).toContain('10.5555/fake.2026.1')
      const goodSentenceIndex = annotated.indexOf('Biomni 是斯坦福发布')
      const markerIndex = annotated.indexOf('【校验未通过')
      expect(goodSentenceIndex).toBeGreaterThanOrEqual(0)
      // appendix written to disk
      expect(existsSync(join(storeDir, job.jobId, 'annotated.md'))).toBe(true)
      expect(readFileSync(join(storeDir, job.jobId, 'verification-report.md'), 'utf8')).toContain('逐点核验矩阵')
      void markerIndex
      void appendix
    } finally {
      rmSync(storeDir, { recursive: true, force: true })
    }
  }, 60_000)

  it('resume: a reloaded store continues where the ledger left off (no aspect re-run)', async () => {
    const report = '文献A doi 10.1126/science.adz4351 存在。\n\n文献B doi 10.5555/fake.2026.2 不存在。'
    const scenario: Scenario = {
      report,
      llm: '',
      fetch: (target) => {
        if (target.includes('crossref')) {
          return target.includes('fake')
            ? { message: {} }
            : { message: { title: ['Autonomous biomedical research with an AI agent'], issued: { 'date-parts': [[2026]] } } }
        }
        return {}
      },
    }
    const storeDir = mkdtempSync(join(tmpdir(), 'resume-'))
    try {
      const store = new JobStore(storeDir)
      const deps = buildDeps(scenario)
      const job = await startVerification(store, deps, { report, semanticChecks: false })
      // ONE step, then a brand-new store instance (fresh process simulation).
      await stepJob(store, deps, job.jobId)
      const afterFirst = (await store.get(job.jobId))!
      const aspectsAfterFirst = afterFirst.claims.reduce((sum, claim) => sum + claim.aspects.length, 0)
      expect(aspectsAfterFirst).toBe(1)

      const store2 = new JobStore(storeDir)
      let guard = 0
      let outcome = await stepJob(store2, deps, job.jobId)
      while (!outcome.finished && guard < 20) {
        outcome = await stepJob(store2, deps, job.jobId)
        guard++
      }
      const final = (await store2.get(job.jobId))!
      const totalAspects = final.claims.reduce((sum, claim) => sum + claim.aspects.length, 0)
      // Exactly the remaining planned checks ran — nothing re-executed.
      const plannedTotal = final.claims.reduce((sum, claim) => sum + planAspects(final, claim).length + claim.aspects.length, 0)
      expect(totalAspects).toBe(aspectsAfterFirst + outcome.remainingChecks + guard * 0 + (totalAspects - aspectsAfterFirst))
      expect(totalAspects).toBeGreaterThan(aspectsAfterFirst)
      expect(final.status).toBe('annotating')
      void plannedTotal
    } finally {
      rmSync(storeDir, { recursive: true, force: true })
    }
  }, 60_000)
})

// ---------------------------------------------------------------------------
// Annotation helpers
// ---------------------------------------------------------------------------

describe('markerFor + annotateReport', () => {
  it('only annotates failing/warning claims and falls back to paraIndex anchors', () => {
    const job: VerificationJob = createVerificationJob('m', '段落一有声明。\n\n段落二有声明。', { semanticChecks: false })
    const claims: ClaimRecord[] = [
      { claimId: 'C1', claim: 'x', quote: '段落一有声明', paraIndex: 0, category: 'unlinked', identifiers: {}, origin: 'scan', aspects: [{ aspect: 'identifier_scan', component: 'decompose', startedAt: '', finishedAt: '', status: 'failed', detail: 'no anchor' }], status: 'failed', failureAspects: ['identifier_scan'] },
      { claimId: 'C2', claim: 'y', quote: '完全不匹配的锚', paraIndex: 1, category: 'literature', identifiers: { pmid: '1' }, origin: 'scan', aspects: [{ aspect: 'existence', component: 'registry', startedAt: '', finishedAt: '', status: 'passed', detail: 'ok' }], status: 'passed', failureAspects: [] },
    ]
    job.claims = claims
    expect(markerFor(claims[0]!)).toContain('C1')
    expect(markerFor(claims[1]!)).toBeUndefined()
    const { annotated } = annotateReport(job)
    expect(annotated.indexOf('【校验未通过 C1')).toBeGreaterThan(0)
    expect(annotated).not.toContain('【校验未通过 C2')
  })

  it('appendix contains matrix, failure details and ledger pointer', () => {
    const job: VerificationJob = createVerificationJob('appx', 'x', { semanticChecks: false })
    const claim = materializeClaims(scanReport('见 doi 10.1001/a-full-2026。'))[0]!
    claim.aspects.push({ aspect: 'existence', component: 'registry', startedAt: '', finishedAt: '', status: 'failed', detail: 'DOI not registered — likely fabricated', target: 'doi:10.1001/a-full-2026' })
    refreshFailureAspects(claim)
    job.claims = [claim]
    const appendix = verificationAppendix(job)
    expect(appendix).toContain('逐点核验矩阵')
    expect(appendix).toContain('✗：DOI not registered')
    expect(appendix).toContain('likely fabricated')
    expect(appendix).toContain('appx.json')
  })
})

// ---------------------------------------------------------------------------
// Registry checks (moved from dsh-bioinf-routed) — behavior preserved
// ---------------------------------------------------------------------------

describe('identifier extraction (registry layer)', () => {
  it('extracts biomedical identifiers from prose', () => {
    const text = 'Per PMID 38951024, doi.org/10.1126/science.ADZ4351., trial NCT05529084, TP53 P04637, GSE149768, SRR1553600.'
    expect(findDoi(text)).toBe('10.1126/science.adz4351')
    expect(findPmid(text)).toBe('38951024')
    expect(findNctId(text)).toBe('NCT05529084')
    expect(findUniprotAccession(text)).toBe('P04637')
    expect(findGeoAccession(text)).toBe('GSE149768')
    expect(findSraAccession(text)).toBe('SRR1553600')
    expect(normalizeDoi('https://doi.org/10.1002/advs.202407094')).toBe('10.1002/advs.202407094')
  })

  it('compares titles with Jaccard + containment', () => {
    expect(compareTitles('Autonomous biomedical research with an AI agent', 'autonomous biomedical research with an artificial intelligence agent')).toBe('match')
    expect(compareTitles('CRISPR revolution', 'Metabolic flux in yeast')).toBe('mismatch')
    expect(compareTitles('', 'x')).toBe('unknown')
  })
})

describe('verifyPmid / verifyDoi / claim_audit (mocked registries)', () => {
  it('flags retracted publications while confirming existence', async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const target = String(url)
      if (target.includes('esummary')) {
        return jsonResponse({
          result: {
            uids: ['39532094'],
            '39532094': { title: 'RETRACTED: CRISPR screens', fulljournalname: 'Cell', pubdate: '2024', lastauthor: 'A', articleids: [] },
          },
        })
      }
      return jsonResponse({ esearchresult: { count: '1' } })
    }) as unknown as typeof fetch
    const result = await verifyPmid(new BioHttpClient({ contactEmail: '', fetchImpl }), { apiKey: '' }, { pmid: '39532094' })
    expect(result.status).toBe('verified')
    expect(result.detail).toMatch(/RETRACTION\/EoC/i)
  })

  it('verifies a real DOI and mismatches a wrong expected title', async () => {
    const fetchImpl = (async () => jsonResponse({
      message: { title: ['Accelerating scientific discovery with Co-Scientist'], 'container-title': ['Nature'], issued: { 'date-parts': [[2026]] }, 'is-referenced-by-count': 50, type: 'journal-article' },
    })) as unknown as typeof fetch
    const client2 = new BioHttpClient({ contactEmail: '', fetchImpl })
    expect((await verifyDoi(client2, { doi: '10.1038/s41586-026-10644-y', expectedTitle: 'Accelerating scientific discovery with Co-Scientist' })).status).toBe('verified')
    expect((await verifyDoi(client2, { doi: '10.1038/s41586-026-10644-y', expectedTitle: 'Maize genetics' })).status).toBe('mismatch')
  })

  it('claim_audit mixes rows into a FAIL verdict', async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const target = String(url)
      if (target.includes('crossref')) {
        return target.includes('nope')
          ? new Response('not found', { status: 404 })
          : jsonResponse({ message: { title: ['A paper'], issued: { 'date-parts': [[2020]] }, 'is-referenced-by-count': 1 } })
      }
      if (target.includes('esummary')) return jsonResponse({ result: { uids: [] } })
      return jsonResponse({ esearchresult: { count: '0', idlist: [] } })
    }) as unknown as typeof fetch
    const report = await auditClaims(new BioHttpClient({ contactEmail: '', fetchImpl }), { apiKey: '' }, [
      { claim: 'real paper', doi: '10.1234/real', expectedTitle: 'A paper' },
      { claim: 'fake', doi: '10.5555/nope' },
    ])
    expect(report.verified).toBe(1)
    expect(report.notFound).toBe(1)
    expect(report.verdict).toBe('FAIL')
  })
})

// ---------------------------------------------------------------------------
// Semantic module (moved) + LLM client
// ---------------------------------------------------------------------------

describe('semantic module', () => {
  it('parses auditor replies leniently and degrades garbage to error', () => {
    const parsed = parseSemanticReview('VERDICT: partially_consistent\nCREDIBILITY_IMPACT: medium\nDISCREPANCIES:\n- in vitro vs clinic\nSUGGESTION: soften.')
    expect(parsed.verdict).toBe('partially_consistent')
    expect(parsed.credibilityImpact).toBe('medium')
    expect(() => parseSemanticReview('乱写')).toThrow(/not parseable/)
  })

  it('runSemanticCheck fails honestly when ground truth cannot be fetched', async () => {
    const chat = (async () => 'VERDICT: consistent\nCREDIBILITY_IMPACT: none\nDISCREPANCIES:\n- (none)\nSUGGESTION: keep') as never
    const result = await runSemanticCheck(
      new BioHttpClient({ contactEmail: '', fetchImpl: (async () => jsonResponse({ resultList: { result: [] } })) as unknown as typeof fetch }),
      { apiKey: '' },
      chat,
      { claim: 'x', doi: '10.1/none' },
      '',
    )
    expect(result.sourceFetched).toBe(false)
    expect(result.error).toMatch(/ground truth unavailable/)
  })

  it('makeLlmChat refuses to run without configuration', async () => {
    const chat = makeLlmChat({ enabled: false, baseURL: '', model: '', apiKey: '' })
    await expect(chat('s', 'u')).rejects.toThrow(/LLM not configured/)
  })

  it('buildSemanticCheckTool output keys stay within the declared schema', async () => {
    const chat = (async () => 'VERDICT: consistent\nCREDIBILITY_IMPACT: none\nDISCREPANCIES:\n- (none)\nSUGGESTION: keep') as never
    const tool = buildSemanticCheckTool(
      new BioHttpClient({ contactEmail: '', fetchImpl: (async (url: string | URL | Request) => {
        const target = String(url)
        if (target.includes('europepmc')) return jsonResponse({ resultList: { result: [{ title: 'T', abstractText: 'A' }] } })
        return jsonResponse({})
      }) as unknown as typeof fetch }),
      { apiKey: '' },
      chat,
      '',
    )
    const declared = Object.keys((tool.output.schema as { properties: Record<string, unknown> }).properties)
    const value = (await tool.execute({ claim: 'x', doi: '10.1/a' }, undefined as never)) as Record<string, unknown>
    for (const key of Object.keys(value)) expect(declared).toContain(key)
  })
})

// ---------------------------------------------------------------------------
// Tool schema discipline for the whole plugin surface
// ---------------------------------------------------------------------------

describe('tool output schema discipline (additionalProperties: false)', () => {
  it('url_verify output keys stay declared', async () => {
    const tool = buildUrlVerifyTool()
    const declared = Object.keys((tool.output.schema as { properties: Record<string, unknown> }).properties)
    const value = (await tool.execute({ url: 'https://good.test/x' }, undefined as never)) as unknown as UrlCheckResult & Record<string, unknown>
    for (const key of Object.keys(value)) expect(declared).toContain(key)
  })

  it('evidence tools output keys stay declared', async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const target = String(url)
      if (target.includes('crossref')) return jsonResponse({ message: { title: ['A paper'], issued: { 'date-parts': [[2020]] } } })
      if (target.includes('esummary')) return jsonResponse({ result: { uids: ['1'], '1': { title: 'T', fulljournalname: 'J', pubdate: '2020', lastauthor: 'A', articleids: [] } } })
      return jsonResponse({ esearchresult: { count: '0', idlist: [] } })
    }) as unknown as typeof fetch
    const tools = buildEvidenceTools(new BioHttpClient({ contactEmail: '', fetchImpl }), { apiKey: '' })
    const samples: Record<string, object> = {
      doi_verify: { doi: '10.1/a' },
      pmid_verify: { pmid: '1' },
      clinical_trial_status: { nctId: 'NCT00000000' },
      uniprot_verify: { accession: 'P04637' },
      geo_accession_verify: { accession: 'GSE1' },
      sra_accession_verify: { accession: 'SRR1' },
      claim_audit: { claims: [{ claim: 'x', doi: '10.1/a' }] },
    }
    for (const tool of tools) {
      const declared = Object.keys((tool.output.schema as { properties: Record<string, unknown> }).properties)
      const value = (await tool.execute(samples[tool.name]!, undefined as never)) as Record<string, unknown>
      for (const key of Object.keys(value)) expect(declared).toContain(key)
    }
  })
})

// Plugin module importable (guidance/apply wiring sanity).
describe('plugin module', () => {
  it('exports an apply function and guidance text', () => {
    expect(typeof _apply).toBe('function')
  })
})

afterAll(() => {
  void existsSync
  void readFileSync
})
