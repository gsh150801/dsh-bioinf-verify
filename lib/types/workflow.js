/**
 * Verification workflow — per-claim, per-aspect checking pipeline over the
 * durable job ledger, plus report annotation and the verification appendix.
 *
 * One call to `stepJob` executes exactly ONE aspect check and persists the
 * ledger, so any crash leaves a resumable, auditable trail. `planAspects`
 * derives, per claim category, which components run:
 *
 *   literature      existence (+retraction for PMID) + title_agreement + semantic
 *   patent          existence (PatentsView; skipped without a key)
 *   clinical_trial  existence (ClinicalTrials.gov)
 *   dataset         existence (GEO / SRA)
 *   protein         existence (UniProt)
 *   webpage         url_accessibility (one check per cited URL)
 *   unlinked        identifier_scan (fails with advice — nothing to verify)
 *
 * @module dsh-bioinf-verify/workflow
 */
import { join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { verifyDoi, verifyGds, verifyPatent, verifyPmid, verifySra, verifyTrial, verifyUniprot } from "./evidence.js";
import { checkUrl } from "./urlverify.js";
import { runSemanticCheck } from "./semantic.js";
import { verifyTitle } from "./titleverify.js";
import { decomposeWithLlm, materializeClaims, mergeClaims, scanReport } from "./decompose.js";
import { createVerificationJob, JobStore, jobStats, refreshFailureAspects } from "./ledger.js";
// ---------------------------------------------------------------------------
// Planning + single-step execution
// ---------------------------------------------------------------------------
/** Queue of pending checks for one claim, in execution order. */
export function planAspects(job, claim) {
    const plan = [];
    const ids = claim.identifiers;
    // A claim classified into a sourced category but carrying NO verifiable
    // anchor cannot run any registry aspect — funnel it to identifier_scan.
    const hasAnchor = [ids.doi, ids.pmid, ids.nctId, ids.uniprot, ids.geo, ids.sra, ids.patent].some(value => value !== undefined)
        || (ids.urls?.length ?? 0) > 0;
    if (!hasAnchor)
        return [{ aspect: 'identifier_scan' }];
    switch (claim.category) {
        case 'literature':
            if (ids.doi !== undefined)
                plan.push({ aspect: 'existence', target: `doi:${ids.doi}` });
            if (ids.pmid !== undefined) {
                plan.push({ aspect: 'existence', target: `pmid:${ids.pmid}` });
                plan.push({ aspect: 'retraction', target: `pmid:${ids.pmid}` });
            }
            if (claim.expectedTitle !== undefined && (ids.doi !== undefined || ids.pmid !== undefined)) {
                plan.push({ aspect: 'title_agreement', target: ids.doi !== undefined ? `doi:${ids.doi}` : `pmid:${ids.pmid}` });
            }
            if (job.options.semanticChecks)
                plan.push({ aspect: 'semantic_consistency' });
            break;
        case 'patent':
            if (ids.patent !== undefined) {
                plan.push({ aspect: 'existence', target: `patent:${ids.patent}` });
                if (claim.expectedTitle !== undefined)
                    plan.push({ aspect: 'title_agreement', target: `patent:${ids.patent}` });
            }
            break;
        case 'clinical_trial':
            if (ids.nctId !== undefined)
                plan.push({ aspect: 'existence', target: `nct:${ids.nctId}` });
            break;
        case 'dataset':
            if (ids.geo !== undefined) {
                plan.push({ aspect: 'existence', target: `geo:${ids.geo}` });
                if (claim.expectedTitle !== undefined)
                    plan.push({ aspect: 'title_agreement', target: `geo:${ids.geo}` });
            }
            if (ids.sra !== undefined)
                plan.push({ aspect: 'existence', target: `sra:${ids.sra}` });
            if (job.options.semanticChecks && ids.geo !== undefined)
                plan.push({ aspect: 'semantic_consistency' });
            break;
        case 'protein':
            if (ids.uniprot !== undefined)
                plan.push({ aspect: 'existence', target: `uniprot:${ids.uniprot}` });
            break;
        case 'webpage':
            for (const url of ids.urls ?? [])
                plan.push({ aspect: 'url_accessibility', target: url });
            if (claim.expectedTitle !== undefined && ids.urls !== undefined && ids.urls.length > 0) {
                plan.push({ aspect: 'title_agreement', target: `url:${ids.urls[0]}` });
            }
            break;
        case 'unlinked':
            plan.push({ aspect: 'identifier_scan' });
            break;
    }
    const done = new Set(claim.aspects.map(aspect => `${aspect.aspect}:${aspect.target ?? ''}`));
    return plan.filter(item => !done.has(`${item.aspect}:${item.target ?? ''}`));
}
function componentName(aspect) {
    switch (aspect) {
        case 'existence':
        case 'retraction':
        case 'title_agreement':
            return 'registry (evidence.ts)';
        case 'semantic_consistency':
            return 'semantic (temp-0 LLM entailment)';
        case 'url_accessibility':
            return 'url_verify';
        case 'identifier_scan':
            return 'decompose';
    }
}
async function runAspect(deps, claim, plan) {
    const startedAt = new Date().toISOString();
    const finish = (status, detail, evidence) => ({
        aspect: plan.aspect,
        component: componentName(plan.aspect),
        startedAt,
        finishedAt: new Date().toISOString(),
        status,
        detail: detail.slice(0, 500),
        ...(plan.target !== undefined ? { target: plan.target } : {}),
        ...(evidence !== undefined ? { evidence } : {}),
    });
    const mapCheck = (result) => result.status === 'verified' ? 'passed'
        : result.status === 'skipped' ? 'skipped'
            : result.status === 'mismatch' || result.status === 'not_found' ? 'failed'
                : 'error';
    if (plan.aspect === 'identifier_scan') {
        return finish('failed', '该点未找到任何可核验锚点（DOI/PMID/NCT/GEO/SRA/UniProt/专利号/URL）——无法自动校验，请补充来源标识符。');
    }
    if (plan.aspect === 'url_accessibility') {
        const target = plan.target ?? '';
        let result;
        try {
            result = await checkUrl(target);
        }
        catch (error) {
            return finish('error', `url check crashed: ${error instanceof Error ? error.message : String(error)}`);
        }
        const status = result.verdict === 'accessible' || result.verdict === 'redirect' ? (result.soft404Suspected ? 'warning' : 'passed')
            : result.verdict === 'blocked' ? 'warning'
                : result.verdict === 'error' ? 'error'
                    : 'failed';
        return finish(status, result.detail, { ...result });
    }
    if (plan.aspect === 'semantic_consistency') {
        const ids = claim.identifiers;
        const result = await runSemanticCheck(deps.client, deps.ncbi, deps.chat, {
            claim: claim.claim,
            ...(ids.pmid !== undefined ? { pmid: ids.pmid } : {}),
            ...(ids.doi !== undefined ? { doi: ids.doi } : {}),
            ...(ids.geo !== undefined ? { geo: ids.geo } : {}),
            ...(ids.uniprot !== undefined ? { uniprot: ids.uniprot } : {}),
        }, deps.patentsApiKey);
        if (!result.sourceFetched) {
            return finish('error', `semantic check could not fetch the source: ${result.error}`);
        }
        const status = result.verdict === 'consistent' ? 'passed'
            : result.verdict === 'partially_consistent' ? 'warning'
                : 'failed';
        const label = {
            consistent: '语义一致',
            partially_consistent: '部分一致（夸大/超范围）',
            inconsistent: '语义不一致',
            unrelated: '引用与声明主题无关',
        };
        const firstDiscrepancy = result.discrepancies[0] !== undefined ? ` 首要差异：${result.discrepancies[0]}` : '';
        return finish(status, `${label[result.verdict]}（可信度影响：${result.credibilityImpact}）。${firstDiscrepancy}`, { ...result });
    }
    const ids = claim.identifiers;
    if (plan.aspect === 'existence') {
        const expectedTitle = claim.expectedTitle;
        const result = await (async () => {
            const target = plan.target ?? '';
            if (target === `doi:${ids.doi ?? '#'}` && ids.doi !== undefined) {
                return verifyDoi(deps.client, { doi: ids.doi, ...(expectedTitle !== undefined ? { expectedTitle } : {}) });
            }
            if (target === `pmid:${ids.pmid ?? '#'}` && ids.pmid !== undefined) {
                return verifyPmid(deps.client, deps.ncbi, { pmid: ids.pmid, ...(expectedTitle !== undefined ? { expectedTitle } : {}) });
            }
            if (target === `nct:${ids.nctId ?? '#'}` && ids.nctId !== undefined) {
                return verifyTrial(deps.client, { nctId: ids.nctId });
            }
            if (target === `geo:${ids.geo ?? '#'}` && ids.geo !== undefined) {
                return verifyGds(deps.client, deps.ncbi, { accession: ids.geo, ...(expectedTitle !== undefined ? { expectedTitle } : {}) });
            }
            if (target === `sra:${ids.sra ?? '#'}` && ids.sra !== undefined) {
                return verifySra(deps.client, deps.ncbi, { accession: ids.sra });
            }
            if (target === `uniprot:${ids.uniprot ?? '#'}` && ids.uniprot !== undefined) {
                return verifyUniprot(deps.client, { accession: ids.uniprot });
            }
            if (target === `patent:${ids.patent ?? '#'}` && ids.patent !== undefined) {
                return verifyPatent(deps.client, { patent: ids.patent, apiKey: deps.patentsApiKey });
            }
            return undefined;
        })();
        if (result === undefined)
            return finish('skipped', 'existence planned without a matching identifier');
        return finish(mapCheck(result), result.detail);
    }
    if (plan.aspect === 'retraction') {
        if (ids.pmid === undefined)
            return finish('skipped', 'retraction scan only applies to PMID citations');
        const result = await verifyPmid(deps.client, deps.ncbi, { pmid: ids.pmid });
        if (result.status !== 'verified')
            return finish('error', `retraction scan needs a verifiable PMID: ${result.detail}`);
        const flagged = result.record?.['retractedOrConcernFlagged'] === true;
        return finish(flagged ? 'failed' : 'passed', flagged ? '该文献已被撤稿或被标记 Expression of Concern —— 不得作为有效支持引用'
            : '无撤稿/Expression-of-Concern 记录', { ...result });
    }
    if (plan.aspect === 'title_agreement') {
        if (claim.expectedTitle === undefined)
            return finish('skipped', '报告未给出期望标题');
        const idsLocal = claim.identifiers;
        const target = plan.target ?? '';
        const result = await verifyTitle(deps.client, deps.ncbi, {
            title: claim.expectedTitle,
            ...(target === `doi:${idsLocal.doi ?? '#'}` && idsLocal.doi !== undefined ? { doi: idsLocal.doi } : {}),
            ...(target === `pmid:${idsLocal.pmid ?? '#'}` && idsLocal.pmid !== undefined ? { pmid: idsLocal.pmid } : {}),
            ...(target === `patent:${idsLocal.patent ?? '#'}` && idsLocal.patent !== undefined ? { patent: idsLocal.patent } : {}),
            ...(target === `geo:${idsLocal.geo ?? '#'}` && idsLocal.geo !== undefined ? { geo: idsLocal.geo } : {}),
            ...(target.startsWith('url:') ? { url: target.slice(4) } : {}),
            ...(idsLocal.doi === undefined && idsLocal.pmid === undefined && target === '' && idsLocal.urls?.[0] !== undefined ? { url: idsLocal.urls[0] } : {}),
        }, deps.patentsApiKey);
        const status = result.verdict === 'match' ? 'passed'
            : result.verdict === 'close' ? 'warning'
                : result.verdict === 'mismatch' ? 'failed'
                    : 'skipped';
        return finish(status, result.detail, { ...result });
    }
    return finish('skipped', 'unknown aspect');
}
/**
 * Execute ONE pending aspect check and persist. Returns a progress summary;
 * `finished` when nothing is pending.
 */
export async function stepJob(store, deps, jobId) {
    const job = await store.get(jobId);
    if (job === undefined)
        return { finished: true, action: 'error', summary: `no verification job "${jobId}"`, remainingChecks: 0 };
    if (job.status === 'decomposing') {
        return { finished: false, action: 'noop', summary: 'decomposition not finished yet', remainingChecks: 0 };
    }
    for (const claim of job.claims) {
        const plan = planAspects(job, claim);
        if (plan.length === 0)
            continue;
        if (claim.status === 'pending')
            claim.status = 'in_progress';
        let check;
        try {
            check = await runAspect(deps, claim, plan[0]);
        }
        catch (error) {
            check = {
                aspect: plan[0].aspect,
                component: componentName(plan[0].aspect),
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                status: 'error',
                detail: `aspect crashed: ${error instanceof Error ? error.message : String(error)}`,
                ...(plan[0].target !== undefined ? { target: plan[0].target } : {}),
            };
        }
        claim.aspects.push(check);
        refreshFailureAspects(claim);
        await store.log(job, 'aspect', `${claim.claimId}/${check.aspect}${check.target !== undefined ? ` [${check.target}]` : ''} → ${check.status}: ${check.detail}`);
        const remaining = job.claims.reduce((sum, candidate) => sum + planAspects(job, candidate).length, 0);
        if (remaining === 0) {
            for (const candidate of job.claims)
                refreshFailureAspects(candidate);
            job.status = 'annotating';
            await store.log(job, 'phase', 'all aspect checks done; ready for report_verify_finish');
        }
        return {
            finished: remaining === 0,
            action: `checked ${claim.claimId}.${check.aspect}`,
            summary: `${check.status.toUpperCase()} — ${check.detail.slice(0, 200)}`,
            remainingChecks: remaining,
            claim: { claimId: claim.claimId, status: claim.status, failureAspects: [...claim.failureAspects] },
        };
    }
    for (const claim of job.claims)
        refreshFailureAspects(claim);
    job.status = 'annotating';
    await store.log(job, 'phase', 'all aspect checks done; ready for report_verify_finish');
    return { finished: true, action: 'complete', summary: '所有校验点已处理完毕，调用 report_verify_finish 生成标注报告。', remainingChecks: 0 };
}
// ---------------------------------------------------------------------------
// Decomposition entry
// ---------------------------------------------------------------------------
export async function startVerification(store, deps, options) {
    const job = createVerificationJob(JobStore.newJobId(), options.report, {
        ...(options.reportName !== undefined && options.reportName !== '' ? { reportName: options.reportName } : {}),
        semanticChecks: options.semanticChecks !== false,
    });
    await store.log(job, 'phase', 'decomposition started');
    const scanned = scanReport(options.report);
    const llm = await decomposeWithLlm(options.report, deps.chat);
    const merged = mergeClaims(scanned, llm);
    job.claims = materializeClaims(merged);
    job.status = 'checking';
    await store.log(job, 'phase', `decomposition: ${scanned.length} scanned + ${llm.length} llm → ${job.claims.length} unique claims`);
    return job;
}
// ---------------------------------------------------------------------------
// Annotation + appendix
// ---------------------------------------------------------------------------
export const ASPECT_LABEL = {
    identifier_scan: '锚点',
    existence: '存在性',
    retraction: '撤稿',
    title_agreement: '标题一致',
    semantic_consistency: '语义一致',
    url_accessibility: '链接可访问',
};
const STATUS_MARK = {
    passed: '✓',
    failed: '✗',
    warning: '⚠',
    error: '⚠',
    skipped: '—',
};
/** Build the inline marker for one failing/warning claim. */
export function markerFor(claim) {
    if (claim.status === 'passed' || claim.status === 'pending' || claim.status === 'in_progress')
        return undefined;
    const parts = claim.failureAspects.map(aspect => {
        const check = claim.aspects.find(item => item.aspect === aspect);
        const mark = check?.status === 'error' ? '未能核验' : '未通过';
        return `${ASPECT_LABEL[aspect] ?? aspect}(${mark})`;
    }).join('、');
    const icon = claim.status === 'failed' ? '❌' : '⚠️';
    return ` ${icon}【校验未通过 ${claim.claimId}·${claim.category}：${parts}——详见文末校验报告】`;
}
/** Insert annotation markers into the original report after each anchored quote. */
export function annotateReport(job) {
    const paragraphs = job.reportText.replace(/\r\n/g, '\n').split(/\n{2,}/);
    const unanchored = [];
    const norm = (text) => text.replace(/\s+/g, '');
    for (const claim of job.claims) {
        const marker = markerFor(claim);
        if (marker === undefined)
            continue;
        const needle = norm(claim.quote).slice(0, 100);
        let target = -1;
        if (needle !== '') {
            target = paragraphs.findIndex(paragraph => norm(paragraph).includes(needle));
        }
        if (target < 0 && claim.paraIndex >= 0 && claim.paraIndex < paragraphs.length)
            target = claim.paraIndex;
        if (target < 0) {
            unanchored.push(`${claim.claimId}（${claim.claim.slice(0, 60)}…）`);
            continue;
        }
        paragraphs[target] = `${paragraphs[target] ?? ''}${marker}`;
    }
    return { annotated: paragraphs.join('\n\n'), unanchored };
}
/** Full verification appendix: summary, per-claim matrix, failure details. */
export function verificationAppendix(job) {
    const stats = jobStats(job);
    const lines = [];
    lines.push('---');
    lines.push('');
    lines.push('## 校验报告（自动生成 · dsh-bioinf-verify）');
    lines.push('');
    lines.push(`- 校验任务：\`${job.jobId}\` · 完成于 ${job.updatedAt}`);
    lines.push(`- 汇总：共 ${stats.total} 个待校验点 · ✅ 通过 ${stats.passed} · ❌ 未通过 ${stats.failed} · ⚠️ 警告 ${stats.warning} · 待处理 ${stats.pending}`);
    if (Object.keys(stats.failedAspects).length > 0) {
        lines.push(`- 未通过方面分布：${Object.entries(stats.failedAspects).map(([aspect, count]) => `${ASPECT_LABEL[aspect] ?? aspect}×${count}`).join('、')}`);
    }
    lines.push('');
    lines.push('### 逐点核验矩阵');
    lines.push('');
    lines.push('| ID | 类别 | 校验点 | 存在性 | 撤稿 | 标题 | 语义 | 链接 | 结论 |');
    lines.push('|---|---|---|---|---|---|---|---|---|');
    for (const claim of job.claims) {
        const cell = (aspect) => {
            const found = claim.aspects.filter(item => item.aspect === aspect);
            if (found.length === 0)
                return '—';
            return found.map(item => STATUS_MARK[item.status]).join('/');
        };
        const verdictIcon = claim.status === 'passed' ? '✅' : claim.status === 'failed' ? '❌' : claim.status === 'warning' ? '⚠️' : '⏳';
        lines.push(`| ${claim.claimId} | ${claim.category} | ${claim.claim.slice(0, 46).replaceAll('|', '\\|')}… | ${cell('existence')} | ${cell('retraction')} | ${cell('title_agreement')} | ${cell('semantic_consistency')} | ${cell('url_accessibility')} | ${verdictIcon} ${claim.status} |`);
    }
    lines.push('');
    const problems = job.claims.filter(claim => claim.status === 'failed' || claim.status === 'warning');
    lines.push('### 未通过/警告点的具体说明');
    lines.push('');
    if (problems.length === 0)
        lines.push('（全部校验点通过，无未通过项。）');
    for (const claim of problems) {
        lines.push(`**${claim.claimId}【${claim.category}】${claim.status === 'failed' ? '未通过' : '警告'}** — 声明：${claim.claim.slice(0, 160).replaceAll('\n', ' ')}`);
        lines.push('');
        const relevant = claim.aspects.filter(aspect => aspect.status === 'failed' || aspect.status === 'error' || aspect.status === 'warning');
        for (const aspect of relevant) {
            lines.push(`- ${ASPECT_LABEL[aspect.aspect] ?? aspect.aspect}${aspect.target !== undefined ? `（${aspect.target}）` : ''} ${STATUS_MARK[aspect.status]}：${aspect.detail.replaceAll('\n', ' ').slice(0, 320)}`);
        }
        if (relevant.length === 0)
            lines.push('- （无明细）');
        lines.push('');
    }
    lines.push(`- 完整账本（含全部原始证据，可审计/可恢复）：\`${job.jobId}.json\``);
    return lines.join('\n');
}
/** Produce annotated.md + verification-report.md and mark the job done. */
export async function finalizeJob(store, deps, jobId) {
    const job = await store.get(jobId);
    if (job === undefined)
        throw new Error(`no verification job "${jobId}"`);
    job.status = 'annotating';
    await store.save(job);
    const { annotated, unanchored } = annotateReport(job);
    const appendix = verificationAppendix(job);
    const unanchoredNote = unanchored.length > 0
        ? `\n> 注：以下未通过点因未能在原文中定位锚点，仅在文末列出：${unanchored.join('；')}\n`
        : '';
    const finalDocument = `${annotated}${unanchoredNote}\n${appendix}\n`;
    const outDir = join(deps.workDir, jobId);
    await mkdir(outDir, { recursive: true });
    const annotatedPath = join(outDir, 'annotated.md');
    const reportPath = join(outDir, 'verification-report.md');
    await writeFile(annotatedPath, finalDocument, 'utf8');
    await writeFile(reportPath, appendix, 'utf8');
    job.outputs = { annotatedPath, reportPath };
    job.status = 'done';
    await store.log(job, 'phase', `annotated report written to ${annotatedPath}`);
    return { annotatedPath, reportPath, annotated: finalDocument, appendix };
}
//# sourceMappingURL=workflow.js.map