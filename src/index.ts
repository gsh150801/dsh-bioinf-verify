/**
 * `dsh-bioinf-verify`: standalone verification plugin for DeepSeek Harness.
 *
 * Verification is a different concern from resource routing (dsh-bioinf-
 * routed), so it lives in its own package. Two layers:
 *
 * COMPONENT TOOLS (each independently callable, and the pipeline's parts):
 *   - url_verify                — cited link exists/reachable (redirect, soft-404)
 *   - doi/pmid/trial/uniprot/…  — registry existence checks (+retraction scan)
 *   - claim_audit               — batch citation matrix
 *   - claim_semantic_check      — claim-vs-source meaning consistency (temp 0)
 *
 * REPORT WORKFLOW (the headline feature — verify a whole report):
 *   - report_verify_start  — decompose the report into categorized evidence
 *                            points (deterministic scan + LLM pass, merged)
 *   - report_verify_step   — run the NEXT aspect check, persisting the ledger
 *                            after every single check (auditable/resumable)
 *   - report_verify_status — structured per-claim/per-aspect status
 *   - report_verify_finish — original report with inline failure annotations
 *                            + full verification report appended
 *   - report_verify_list   — recent jobs
 *
 * Everything runs through the durable job ledger (`~/.dsh/science-verification/
 * <jobId>.json`): structured, auditable, traceable, recoverable.
 *
 * @module dsh-bioinf-verify
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { BioHttpClient } from './biohttp.ts'
import { buildEvidenceTools } from './evidence.ts'
import { buildSemanticCheckTool } from './semantic.ts'
import { buildUrlVerifyTool } from './urlverify.ts'
import { buildTitleVerifyTool } from './titleverify.ts'
import { makeLlmChat } from './llm.ts'
import { JobStore, jobStats } from './ledger.ts'
import { finalizeJob, planAspects, startVerification, stepJob, verificationAppendix, type VerifyDeps } from './workflow.ts'

export const name = 'dsh-bioinf-verify'

export const inject = ['tools', 'systemPrompt']

export interface Config {
  /** Ledger + annotated outputs root (default ~/.dsh/science-verification). */
  workDir: string
  contactEmail: string
  pubmedApiKey: string
  patentsviewApiKey: string
  /** Register the report-verification workflow guidance section. */
  guidance: boolean
  /** Chat endpoint powering decomposition + semantic entailment. */
  llmRouter: {
    enabled: boolean
    baseURL: string
    model: string
    apiKey: string
  }
}

export const Config: z<Config> = z.object({
  workDir: z.string().default(''),
  contactEmail: z.string().default(''),
  pubmedApiKey: z.string().default(''),
  patentsviewApiKey: z.string().default(''),
  guidance: z.boolean().default(true),
  llmRouter: z.object({
    enabled: z.boolean().default(false),
    baseURL: z.string().default(''),
    model: z.string().default('deepseek-v4-flash'),
    apiKey: z.string().default(''),
  }),
})

export const GUIDANCE = [
  '## Report verification pipeline (dsh-bioinf-verify)',
  'Before delivering ANY report with external citations, run the verification workflow:',
  '1) `report_verify_start(report=...)` — decomposes the draft into categorized evidence points (literature/patent/clinical_trial/dataset/protein/webpage).',
  '2) `report_verify_step(jobId)` repeatedly until finished — each call runs ONE aspect check (existence / retraction / title agreement / semantic consistency / URL accessibility) and persists the ledger.',
  '3) `report_verify_finish(jobId)` — returns the ORIGINAL report with inline ❌/⚠️ annotations on failing points, plus the complete verification report appended at the end. Deliver THAT document.',
  'Standalone components (`title_verify`, `url_verify`, `pmid_verify`, `doi_verify`, `claim_audit`, `claim_semantic_check`, …) are available for spot checks; the workflow composes them per claim category. `title_verify` checks paper/patent/dataset/news/web-article titles against the authoritative source.',
].join('\n')

export function apply(ctx: Context, config: Config): void {
  const workDir = config.workDir !== '' ? config.workDir : join(homedir(), '.dsh', 'science-verification')
  const contactEmail = config.contactEmail !== '' ? config.contactEmail : (process.env.CONTACT_EMAIL ?? '')
  const ncbi = {
    apiKey: config.pubmedApiKey !== '' ? config.pubmedApiKey : (process.env.PUBMED_API_KEY ?? process.env.NCBI_API_KEY ?? ''),
  }
  const patentsApiKey = config.patentsviewApiKey !== '' ? config.patentsviewApiKey : (process.env.PATENTSVIEW_API_KEY ?? '')
  const client = new BioHttpClient({ contactEmail })
  const chat = makeLlmChat(config.llmRouter)
  const store = new JobStore(workDir)
  const deps: VerifyDeps = { client, ncbi, chat, patentsApiKey }

  for (const tool of [
    buildUrlVerifyTool(),
    buildTitleVerifyTool(client, ncbi, patentsApiKey),
    ...buildEvidenceTools(client, ncbi),
    buildSemanticCheckTool(client, ncbi, chat, patentsApiKey),
  ]) {
    ctx.tools.register(tool)
  }

  ctx.tools.register(defineTool({
    name: 'report_verify_start',
    description: 'Start verifying a whole report: decomposes it into individually verifiable evidence points, each classified (literature/patent/clinical_trial/dataset/protein/webpage), and plans per-point aspect checks. Returns the claim list and the verification job id. Call this on the FULL draft before delivering.',
    parameters: {
      report: { type: 'string', required: true, description: 'The full Markdown report text to verify.' },
      reportName: { type: 'string', description: 'Optional file name/title of the report.' },
      semanticChecks: { type: 'boolean', description: 'Also verify meaning consistency against fetched source texts (default true; needs the LLM).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          jobId: { type: 'string' },
          claimCount: { type: 'number' },
          categories: { type: 'array', items: { type: 'string' } },
          plannedChecks: { type: 'number' },
          claims: { type: 'array', items: { type: 'string' } },
          protocol: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.error !== undefined && value.error !== ''
          ? `report_verify_start failed: ${value.error}`
          : `Job ${value.jobId}: ${value.claimCount ?? 0} evidence points, ${value.plannedChecks ?? 0} planned checks.\n${(value.claims ?? []).join('\n')}\n${value.protocol ?? ''}`,
      }],
    },
    async execute(args) {
      const report = String(args.report ?? '')
      if (report.trim().length < 40) return { error: 'report text too short to verify' }
      try {
        const job = await startVerification(store, deps, {
          report,
          ...(typeof args.reportName === 'string' && args.reportName !== '' ? { reportName: args.reportName } : {}),
          semanticChecks: args.semanticChecks !== false,
        })
        const planned = job.claims.reduce((sum, claim) => sum + planAspects(job, claim).length, 0)
        return {
          jobId: job.jobId,
          claimCount: job.claims.length,
          categories: [...new Set(job.claims.map(claim => claim.category))],
          plannedChecks: planned,
          claims: job.claims.map(claim => `${claim.claimId}[${claim.category}] ${claim.claim.slice(0, 100)}`),
          protocol: 'Call report_verify_step until finished=true, then report_verify_finish.',
        }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    },
    presentCall(args) {
      return { card: 'generic', title: 'Report verification: start', kind: 'execute', rawInput: `${String(args.report ?? '').slice(0, 80)}…` }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'report_verify_step',
    description: 'Run the NEXT single aspect check of a verification job (one registry/semantic/url check) with immediate ledger persistence. Repeat until finished=true. Crash-safe: the job resumes where the ledger left off.',
    parameters: { jobId: { type: 'string', required: true } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          finished: { type: 'boolean' },
          action: { type: 'string' },
          summary: { type: 'string' },
          remainingChecks: { type: 'number' },
          claim: { type: 'object', additionalProperties: true },
          hint: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.finished === true
          ? `${value.action}: ${value.summary}`
          : `${value.action} → ${value.summary}${value.remainingChecks !== undefined ? ` (${value.remainingChecks} checks remaining)` : ''}`,
      }],
    },
    async execute(args) {
      try {
        const outcome = await stepJob(store, deps, String(args.jobId ?? ''))
        return { ...outcome, hint: outcome.finished ? 'Call report_verify_finish.' : 'Call report_verify_step again.' }
      } catch (error) {
        return { finished: true, action: 'error', summary: error instanceof Error ? error.message : String(error), remainingChecks: 0 }
      }
    },
    presentCall(args) {
      return { card: 'generic', title: 'Report verification: step', kind: 'execute', rawInput: String(args.jobId ?? '') }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'report_verify_status',
    description: 'Structured status of a verification job: per-claim status, failed aspects, and job statistics — straight from the durable ledger.',
    parameters: { jobId: { type: 'string', required: true } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          jobId: { type: 'string' },
          status: { type: 'string' },
          stats: { type: 'string' },
          claims: { type: 'array', items: { type: 'string' } },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.error !== undefined && value.error !== '' ? `report_verify_status failed: ${value.error}` : `${value.jobId} [${value.status}] ${value.stats ?? ''}\n${(value.claims ?? []).join('\n')}`,
      }],
    },
    async execute(args) {
      const job = await store.get(String(args.jobId ?? ''))
      if (job === undefined) return { error: `no verification job "${String(args.jobId ?? '')}"` }
      const stats = jobStats(job)
      return {
        jobId: job.jobId,
        status: job.status,
        stats: `total=${stats.total} passed=${stats.passed} failed=${stats.failed} warning=${stats.warning} pending=${stats.pending}`,
        claims: job.claims.map(claim =>
          `${claim.claimId}[${claim.category}] ${claim.status}${claim.failureAspects.length > 0 ? ` (failed: ${claim.failureAspects.join(',')})` : ''} — ${claim.claim.slice(0, 80)}`),
      }
    },
    presentCall(args) {
      return { card: 'generic', title: 'Report verification: status', kind: 'read', rawInput: String(args.jobId ?? '') }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'report_verify_finish',
    description: 'Finalize a verification job: produces (1) the ORIGINAL report with inline ❌/⚠️ annotations on every failing/warning point, and (2) the complete verification report appended at the end (summary, per-point matrix, concrete failure explanations, ledger path). Files are written under the workDir and the full document is returned.',
    parameters: { jobId: { type: 'string', required: true } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          annotatedPath: { type: 'string' },
          reportPath: { type: 'string' },
          annotated: { type: 'string', description: 'The full annotated report + verification appendix (deliver this).' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.error !== undefined && value.error !== ''
          ? `report_verify_finish failed: ${value.error}`
          : `Annotated report: ${value.annotatedPath ?? ''}\nVerification report: ${value.reportPath ?? ''}\n\n${value.annotated ?? ''}`,
      }],
    },
    async execute(args) {
      try {
        const outcome = await finalizeJob(store, { workDir }, String(args.jobId ?? ''))
        return { annotatedPath: outcome.annotatedPath, reportPath: outcome.reportPath, annotated: outcome.annotated }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    },
    presentCall(args) {
      return { card: 'generic', title: 'Report verification: finish', kind: 'edit', rawInput: String(args.jobId ?? '') }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'report_verify_list',
    description: 'List recent verification jobs with status and progress (from the ledger directory).',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { jobs: { type: 'array', items: { type: 'string' } } },
      },
      render: (_args, value) => [{ type: 'text', text: (value.jobs ?? []).join('\n') || '(none)' }],
    },
    async execute() {
      const jobs = await store.list(20)
      return {
        jobs: jobs.map(job => {
          const stats = jobStats(job)
          return `${job.jobId} [${job.status}] ${stats.passed}/${stats.total} passed (${stats.failed} failed, ${stats.warning} warning) — ${job.reportName !== '' ? job.reportName : job.reportText.slice(0, 40)}`
        }),
      }
    },
    presentCall() {
      return { card: 'generic', title: 'Report verification: list', kind: 'read', rawInput: '' }
    },
  }))

  if (config.guidance) {
    ctx.systemPrompt.section({
      name: 'verify:guidance',
      order: 51,
      text: GUIDANCE,
    })
  }
}

// Keep the appendix builder importable for tests/tools without executing.
void verificationAppendix
