/**
 * Verification job ledger — the structured backbone of every report check.
 *
 * dsh philosophy applied to verification: the whole process is ONE durable,
 * inspectable data structure. Every decomposition decision, every aspect
 * check (with timestamps, component name, and raw evidence payload) is
 * recorded and **persisted to disk immediately after each unit of work**, so
 * a run is auditable after the fact, resumable after a crash, and every
 * verdict in the final report traces to a ledger row.
 *
 * @module dsh-bioinf-verify/ledger
 */

import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

export type ClaimCategory = 'literature' | 'patent' | 'clinical_trial' | 'dataset' | 'protein' | 'webpage' | 'unlinked'

export type AspectName =
  | 'identifier_scan'     // no verifiable anchor found in the claim
  | 'existence'           // registry says the identifier is real
  | 'retraction'          // publication retracted / expression of concern
  | 'title_agreement'     // fetched title matches the claimed title
  | 'semantic_consistency'// fetched source text entails the claim (LLM, temp 0)
  | 'url_accessibility'   // cited URL resolves

export type CheckStatus = 'passed' | 'failed' | 'warning' | 'error' | 'skipped'

export interface AspectCheck {
  readonly aspect: AspectName
  /** Which plugin component produced this result (doi_verify, url_verify, semantic…). */
  readonly component: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly status: CheckStatus
  /** Human-readable verdict line, quoted into the verification report. */
  readonly detail: string
  /** Target of this specific check when the claim carries several (e.g. each URL). */
  readonly target?: string
  /** Full component payload — the audit trail. */
  readonly evidence?: Record<string, unknown>
}

export interface ClaimIdentifiers {
  doi?: string
  pmid?: string
  nctId?: string
  uniprot?: string
  geo?: string
  sra?: string
  patent?: string
  urls?: string[]
}

export interface ClaimRecord {
  readonly claimId: string
  readonly claim: string
  /** Verbatim fragment of the report this claim anchors to (for annotation). */
  readonly quote: string
  /** Paragraph index in the original report (annotation fallback anchor). */
  readonly paraIndex: number
  readonly category: ClaimCategory
  readonly identifiers: ClaimIdentifiers
  /** Title the report claims for this source (drives title_agreement). */
  readonly expectedTitle?: string
  /** Source of the decomposition: deterministic scan or LLM pass. */
  readonly origin: 'scan' | 'llm' | 'merged'
  readonly aspects: AspectCheck[]
  status: 'pending' | 'in_progress' | 'passed' | 'failed' | 'warning'
  /** Names of the aspects that did NOT pass — the report points at these. */
  failureAspects: string[]
}

export type JobStatus = 'decomposing' | 'checking' | 'annotating' | 'done' | 'error'

export interface JobEvent {
  readonly at: string
  readonly event: string
  readonly detail: string
}

export interface VerificationJob {
  readonly jobId: string
  createdAt: string
  updatedAt: string
  status: JobStatus
  /** The original report exactly as received. */
  reportText: string
  reportName: string
  options: { semanticChecks: boolean }
  claims: ClaimRecord[]
  /** Append-only event log (audit trail beyond the per-aspect records). */
  log: JobEvent[]
  /** Set by report_verify_finish: where annotated outputs were written. */
  outputs?: { annotatedPath: string; reportPath: string }
}

export function newClaimId(claims: readonly ClaimRecord[]): string {
  return `C${claims.length + 1}`
}

/** Recompute a claim's roll-up status from its aspect rows. */
export function rollUpClaim(claim: ClaimRecord): ClaimRecord['status'] {
  if (claim.aspects.length === 0) return 'pending'
  const failing = claim.aspects.some(aspect => aspect.status === 'failed')
  if (failing) return 'failed'
  const blocking = claim.aspects.some(aspect => aspect.status === 'error')
  if (blocking) return 'warning' // errors mean "could not verify", not "verified false"
  const warned = claim.aspects.some(aspect => aspect.status === 'warning')
  return warned ? 'warning' : 'passed'
}

export function refreshFailureAspects(claim: ClaimRecord): void {
  claim.failureAspects = claim.aspects
    .filter(aspect => aspect.status === 'failed' || aspect.status === 'error')
    .map(aspect => aspect.aspect)
  claim.status = rollUpClaim(claim)
}

export class JobStore {
  constructor(private readonly dir: string) {}

  get directory(): string {
    return this.dir
  }

  private pathFor(jobId: string): string {
    return join(this.dir, `${encodeURIComponent(jobId)}.json`)
  }

  static newJobId(now = new Date()): string {
    const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14)
    return `verify-${stamp}-${Math.random().toString(36).slice(2, 6)}`
  }

  /** Persist immediately — called after EVERY mutation by the workflow. */
  async save(job: VerificationJob): Promise<void> {
    job.updatedAt = new Date().toISOString()
    await mkdir(this.dir, { recursive: true })
    await writeFile(this.pathFor(job.jobId), JSON.stringify(job, null, 1), 'utf8')
  }

  async get(jobId: string): Promise<VerificationJob | undefined> {
    try {
      return JSON.parse(await readFile(this.pathFor(jobId), 'utf8')) as VerificationJob
    } catch {
      return undefined
    }
  }

  /** Append a log line AND persist — one call, always durable. */
  async log(job: VerificationJob, event: string, detail: string): Promise<void> {
    job.log.push({ at: new Date().toISOString(), event, detail: detail.slice(0, 300) })
    await this.save(job)
  }

  async list(limit: number): Promise<VerificationJob[]> {
    let names: string[] = []
    try {
      const { readdir } = await import('node:fs/promises')
      names = await readdir(this.dir)
    } catch {
      return []
    }
    const loaded = await Promise.all(names.filter(name => name.endsWith('.json')).map(async name => {
      try {
        return JSON.parse(await readFile(join(this.dir, name), 'utf8')) as VerificationJob
      } catch {
        return undefined
      }
    }))
    return loaded.filter((job): job is VerificationJob => job !== undefined)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
  }
}

/** Create a fresh job shell (pre-decomposition). */
export function createVerificationJob(jobId: string, report: string, options: {
  reportName?: string
  semanticChecks: boolean
}): VerificationJob {
  const now = new Date().toISOString()
  return {
    jobId,
    createdAt: now,
    updatedAt: now,
    status: 'decomposing',
    reportText: report,
    reportName: options.reportName ?? '',
    options: { semanticChecks: options.semanticChecks },
    claims: [],
    log: [{ at: now, event: 'created', detail: `${report.length} chars received` }],
  }
}

/** Statistics helper used by the annotated appendix and status tools. */
export function jobStats(job: VerificationJob): {
  total: number
  passed: number
  failed: number
  warning: number
  pending: number
  failedAspects: Record<string, number>
} {
  const failedAspects: Record<string, number> = {}
  let passed = 0
  let failed = 0
  let warning = 0
  let pending = 0
  for (const claim of job.claims) {
    if (claim.status === 'passed') passed++
    else if (claim.status === 'failed') failed++
    else if (claim.status === 'warning') warning++
    else pending++
    for (const aspect of claim.aspects) {
      if (aspect.status === 'failed' || aspect.status === 'error') {
        failedAspects[aspect.aspect] = (failedAspects[aspect.aspect] ?? 0) + 1
      }
    }
  }
  return { total: job.claims.length, passed, failed, warning, pending, failedAspects }
}
