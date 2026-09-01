/**
 * Strict evidence-verification tooling ("证据核验组").
 *
 * Biomedical answers must stand on verifiable primary records — GeneAgent's
 * self-verification lesson applied at the citation level, with deterministic
 * API checks rather than model self-assessment (the ChemCrow caveat). Every
 * check talks to an authoritative registry:
 *
 * - DOI      -> Crossref `/works` metadata + title agreement
 * - PMID     -> PubMed E-Summary + a retraction/"expression of concern" scan
 * - Trials   -> ClinicalTrials.gov v2 record, live status, results posted?
 * - Protein  -> UniProtKB accession, gene names, organism
 * - GEO/SRA  -> NCBI accessions via `esearch db=gds/sra`
 *
 * `claim_audit` is the closing gate: it batches every citation of a draft
 * answer into one pass/fail matrix so weak links are impossible to miss.
 *
 * @module dsh-bioinf-routed/evidence
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
// ---------------------------------------------------------------------------
// Identifier parsing/normalization (pure, unit-tested)
// ---------------------------------------------------------------------------
/** Canonicalize a DOI string: strip resolvers/prefixes, keep `10.xxxx/yyyy` lowercase. */
export function normalizeDoi(raw) {
    let doi = raw.trim().toLowerCase();
    doi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
    doi = doi.replace(/^doi:\s*/i, '');
    doi = doi.replace(/^info:doi\//, '');
    const match = /10\.\d{4,9}\/[^\s，。；！？（）【】《》]+/.exec(doi);
    return (match?.[0] ?? doi).replace(/[.,;)\]）】」》]+$/, '');
}
/** Pull the first DOI-looking identifier out of free text ('' if none). */
export function findDoi(text) {
    const match = /\b10\.\d{4,9}\/[^\s"'<>|，。；！？（）【】《》]+/.exec(text);
    return match === null ? '' : normalizeDoi(match[0]);
}
/** Explicit PMID mention (`PMID: 12345`, `pmid=12345`) out of free text. */
export function findPmid(text) {
    return /\bpmid[\s:=#]*(\d{5,9})\b/i.exec(text)?.[1] ?? '';
}
export function findNctId(text) {
    return /\bnct\d{8}\b/i.exec(text)?.[0]?.toUpperCase() ?? '';
}
/** A plausible UniProtKB primary accession (e.g. P04637, Q9NXW2-2): letter(O/P/Q) + digit + 3×alnum + digit, optional isoform suffix. */
export function findUniprotAccession(text) {
    return /\b[OPQ][0-9][A-Z0-9]{3}[0-9](?:-\d+)?\b/.exec(text)?.[0]?.toUpperCase() ?? '';
}
export function findGeoAccession(text) {
    return /\b(GSE|GDS|GPL|GSM)\d{3,10}\b/i.exec(text)?.[0]?.toUpperCase() ?? '';
}
export function findSraAccession(text) {
    return /\b(SRR|SRS|SRX|SRP|DRR|DRS|DRX|ERR|ERS|ERX)\d{4,12}\b/i.exec(text)?.[0]?.toUpperCase() ?? '';
}
const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'in', 'and', 'or', 'to', 'for', 'on', 'with', 'by', 'via', 'from', 'at', 'as', 'is', 'are']);
function tokenizeTitle(title) {
    return title.toLowerCase()
        .replaceAll(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(token => token !== '' && !STOPWORDS.has(token));
}
/** Similarity primitives shared by compareTitles and the title_verify component. */
export function titleSimilarity(expectedTitle, actualTitle) {
    const expected = tokenizeTitle(expectedTitle ?? '');
    const actual = tokenizeTitle(actualTitle ?? '');
    if (expected.length === 0 || actual.length === 0)
        return { jaccard: 0, contained: false };
    const setA = new Set(expected);
    const setB = new Set(actual);
    let overlap = 0;
    for (const token of setA)
        if (setB.has(token))
            overlap++;
    const jaccard = overlap / (setA.size + setB.size - overlap);
    const shorter = expected.join(' ');
    const longer = actual.join(' ');
    const contained = shorter.length > 8 && (longer.includes(shorter) || shorter.includes(longer));
    return { jaccard, contained };
}
/**
 * Title-agreement verdict. Token-Jaccard with stopwords dropped, plus a
 * containment fallback for subtitles; `unknown` when no expectation given.
 */
export function compareTitles(expectedTitle, actualTitle, threshold = 0.55) {
    if ((expectedTitle ?? '') === '' || (actualTitle ?? '') === '')
        return 'unknown';
    const { jaccard, contained } = titleSimilarity(expectedTitle, actualTitle);
    return jaccard >= threshold || contained ? 'match' : 'mismatch';
}
function crossrefMeta(work) {
    const issuedParts = work.issued?.['date-parts']?.[0];
    return {
        title: typeof work.title === 'string' ? work.title : Array.isArray(work.title) ? String(work.title[0] ?? '') : '',
        journal: typeof work['container-title'] === 'string'
            ? work['container-title']
            : Array.isArray(work['container-title']) ? String(work['container-title'][0] ?? '') : '',
        year: Array.isArray(issuedParts) ? String(issuedParts[0] ?? '') : '',
        type: typeof work.type === 'string' ? work.type : '',
        citedByCount: typeof work['is-referenced-by-count'] === 'number' ? String(work['is-referenced-by-count']) : '',
    };
}
function pubmedMeta(doc) {
    const articleIds = Array.isArray(doc.articleids) ? doc.articleids : [];
    const doiEntry = articleIds.find(entry => entry?.idtype === 'doi');
    return {
        title: typeof doc.title === 'string' ? doc.title : '',
        journal: typeof doc.fulljournalname === 'string' && doc.fulljournalname !== '' ? doc.fulljournalname : String(doc.source ?? ''),
        pubDate: String(doc.pubdate ?? ''),
        lastAuthor: String(doc.lastauthor ?? ''),
        doi: doiEntry !== undefined ? String(doiEntry.value ?? '') : '',
    };
}
export async function verifyDoi(client, opts) {
    const doi = normalizeDoi(opts.doi);
    try {
        const payload = await client.getJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
        const meta = crossrefMeta(payload.message ?? {});
        const agreement = compareTitles(opts.expectedTitle, meta.title);
        const status = agreement === 'mismatch' ? 'mismatch' : 'verified';
        return {
            check: 'doi', identifier: doi, status,
            detail: agreement === 'mismatch'
                ? `DOI exists on Crossref but the recorded title disagrees with the claimed one: "${meta.title}"`
                : `Crossref record confirmed (${meta.journal || meta.type}${meta.year !== '' ? `, ${meta.year}` : ''}, cited-by ${meta.citedByCount || '?'})`,
            record: { ...meta },
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            check: 'doi', identifier: doi,
            status: /HTTP 404/.test(message) ? 'not_found' : 'error',
            detail: /HTTP 404/.test(message) ? 'DOI not registered with Crossref — likely fabricated or mistyped' : message,
        };
    }
}
export async function verifyPmid(client, ncbi, opts) {
    const common = client.ncbiParams(ncbi.apiKey);
    const url = new URL(`${EUTILS_BASE}/esummary.fcgi`);
    for (const [key, value] of Object.entries({ ...common, db: 'pubmed', id: opts.pmid, retmode: 'json' }))
        url.searchParams.set(key, value);
    try {
        const payload = await client.getJson(url.toString());
        const doc = payload.result?.[opts.pmid];
        if (doc === undefined || squash(String(doc.error ?? '')) !== '') {
            return { check: 'pmid', identifier: opts.pmid, status: 'not_found', detail: 'PubMed has no record for this PMID' };
        }
        const meta = pubmedMeta(doc);
        // Retraction / expression-of-concern scan against the publication-type filter.
        const retrUrl = new URL(`${EUTILS_BASE}/esearch.fcgi`);
        for (const [key, value] of Object.entries({
            ...common,
            db: 'pubmed',
            term: `${opts.pmid}[PMID] AND ("retracted publication"[PT] OR "expression of concern"[PT])`,
            retmode: 'json',
        }))
            retrUrl.searchParams.set(key, value);
        const retrSearch = await client.getJson(retrUrl.toString());
        const retrCount = Number(retrSearch.esearchresult?.count ?? 0);
        const agreement = compareTitles(opts.expectedTitle, meta.title);
        if (agreement === 'mismatch') {
            return { check: 'pmid', identifier: opts.pmid, status: 'mismatch', detail: `Record exists (${meta.pubDate}, ${meta.journal}) but its title disagrees with the claimed one: "${meta.title}"`, record: { ...meta } };
        }
        return {
            check: 'pmid',
            identifier: opts.pmid,
            status: 'verified',
            detail: `${meta.lastAuthor !== '' ? `${meta.lastAuthor} et al., ` : ''}${meta.journal} ${meta.pubDate}${meta.doi !== '' ? ` · doi:${meta.doi}` : ''}` +
                (retrCount > 0 ? ' · ⚠ RETRACTION/EoC FLAGGED — do not cite as valid support' : ''),
            record: { ...meta, retractedOrConcernFlagged: retrCount > 0 },
        };
    }
    catch (error) {
        return { check: 'pmid', identifier: opts.pmid, status: 'error', detail: error instanceof Error ? error.message : String(error) };
    }
}
export async function verifyTrial(client, opts) {
    try {
        const study = await client.getJson(`https://clinicaltrials.gov/api/v2/studies/${opts.nctId}`, { cacheTtlMs: 300_000 });
        const protocol = study.protocolSection;
        if (protocol === undefined) {
            return { check: 'clinical_trial', identifier: opts.nctId, status: 'not_found', detail: 'Registry returned an empty record' };
        }
        const identification = (protocol.identificationModule ?? {});
        const statusMod = (protocol.statusModule ?? {});
        const design = (protocol.designModule ?? {});
        const conditionsModule = (protocol.conditionsModule ?? {});
        const conditions = Array.isArray(conditionsModule.conditions) ? conditionsModule.conditions.map(String) : [];
        const hasResults = study.resultsSection !== undefined &&
            Object.keys(study.resultsSection).length > 1; // participantFlow etc., not just a flag object
        return {
            check: 'clinical_trial',
            identifier: opts.nctId,
            status: 'verified',
            detail: [
                `status=${String(statusMod.overallStatus ?? '?')}`,
                Array.isArray(design.phases) && design.phases.length > 0 ? `phase=${design.phases.map(String).join('/')}` : '',
                conditions.length > 0 ? `condition=${conditions.slice(0, 3).join(', ')}` : '',
                hasResults ? 'results POSTED' : 'no results posted yet',
            ].filter(Boolean).join(' · '),
            record: {
                briefTitle: String(identification.briefTitle ?? ''),
                overallStatus: String(statusMod.overallStatus ?? ''),
                hasResults,
            },
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            check: 'clinical_trial', identifier: opts.nctId,
            status: /HTTP 404/.test(message) ? 'not_found' : 'error',
            detail: /HTTP 404/.test(message) ? 'No trial registered under this NCT ID' : message,
        };
    }
}
export async function verifyUniprot(client, opts) {
    try {
        const entry = await client.getJson(`https://rest.uniprot.org/uniprotkb/${encodeURIComponent(opts.accession)}.json?fields=accession,id,gene_primary,protein_name,organism_name`, { cacheTtlMs: 600_000 });
        const geneNames = (entry.genes ?? []).flatMap(gene => typeof gene.geneName?.value === 'string' ? [gene.geneName.value] : []);
        const description = entry.proteinDescription;
        const recommended = description?.recommendedName?.fullName?.value;
        const alternative = description?.alternativeNames?.[0]?.fullName?.value;
        const proteinName = typeof recommended === 'string' && recommended !== ''
            ? recommended
            : typeof alternative === 'string' ? alternative : '(unnamed)';
        const organism = typeof entry.organism?.scientificName === 'string' ? entry.organism.scientificName : '';
        const geneMatched = opts.expectedGene === undefined || opts.expectedGene === ''
            ? 'unknown'
            : geneNames.some(name => name.toLowerCase() === opts.expectedGene.toLowerCase()) ? 'match' : 'mismatch';
        return {
            check: 'uniprot',
            identifier: opts.accession,
            status: geneMatched === 'mismatch' ? 'mismatch' : 'verified',
            detail: `UniProtKB ${String(entry.uniProtkbId ?? '')}: ${proteinName} [${organism}] genes=${geneNames.join(', ') || '(none listed)'}` +
                (geneMatched === 'mismatch' ? ` — expected gene "${opts.expectedGene}" NOT among them` : ''),
            record: {
                uniProtkbId: String(entry.uniProtkbId ?? ''),
                proteinName,
                genes: geneNames.join(','),
                organism,
            },
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // UniProt answers malformed accessions with 400 and unknown ones with 404;
        // both mean "this accession does not identify a real entry".
        const absent = /HTTP 40[04]/.test(message);
        return {
            check: 'uniprot', identifier: opts.accession,
            status: absent ? 'not_found' : 'error',
            detail: absent
                ? 'Accession does not exist in UniProtKB (bad format, or merged/deleted)'
                : message,
        };
    }
}
export async function verifyGds(client, ncbi, opts) {
    const common = client.ncbiParams(ncbi.apiKey);
    try {
        const searchedIds = await eutilsIdList(client, common, 'gds', `${opts.accession}[ACCN]`, 25);
        if (searchedIds.length === 0) {
            return { check: 'geo_accession', identifier: opts.accession, status: 'not_found', detail: 'Not found in NCBI GEO DataSets under this accession' };
        }
        const sumUrl = new URL(`${EUTILS_BASE}/esummary.fcgi`);
        for (const [key, value] of Object.entries({ ...common, db: 'gds', id: searchedIds.join(','), retmode: 'json' }))
            sumUrl.searchParams.set(key, value);
        const summarized = await client.getJson(sumUrl.toString());
        const result = summarized.result ?? {};
        const wanted = opts.accession.toLowerCase();
        for (const uid of searchedIds) {
            const doc = result[uid];
            if (doc === undefined)
                continue;
            const accession = String(doc.accession ?? '').toLowerCase();
            if (accession !== wanted)
                continue;
            const title = String(doc.title ?? '');
            const agreement = compareTitles(opts.expectedTitle, title);
            return {
                check: 'geo_accession',
                identifier: opts.accession,
                status: agreement === 'mismatch' ? 'mismatch' : 'verified',
                detail: `GEO record present: [${String(doc.entrytype ?? '?')}] ${title.slice(0, 140)}${agreement === 'mismatch' ? ' — title disagrees with the claim' : ''}`,
                record: { accession: String(doc.accession), entrytype: String(doc.entrytype ?? ''), taxon: String(doc.taxon ?? ''), samples: String(doc.n_samples ?? ''), title },
            };
        }
        return { check: 'geo_accession', identifier: opts.accession, status: 'not_found', detail: 'The [ACCN] hit list did not contain this exact accession' };
    }
    catch (error) {
        return { check: 'geo_accession', identifier: opts.accession, status: 'error', detail: error instanceof Error ? error.message : String(error) };
    }
}
/**
 * E-utilities esearch -> normalized numeric UID list. Both verification
 * helpers share this so the response shape is parsed in exactly one place.
 */
async function eutilsIdList(client, common, db, term, retmax) {
    const url = new URL(`${EUTILS_BASE}/esearch.fcgi`);
    for (const [key, value] of Object.entries({ ...common, db, term, retmax: String(retmax), retmode: 'json' }))
        url.searchParams.set(key, value);
    const payload = await client.getJson(url.toString());
    return (payload.esearchresult?.idlist ?? []).map(String).filter(id => /^\d+$/.test(id));
}
export async function verifySra(client, ncbi, opts) {
    const common = client.ncbiParams(ncbi.apiKey);
    try {
        const ids = await eutilsIdList(client, common, 'sra', `${opts.accession}[ACCN]`, 5);
        if (ids.length === 0) {
            return { check: 'sra_accession', identifier: opts.accession, status: 'not_found', detail: 'Not present in SRA under this accession' };
        }
        return { check: 'sra_accession', identifier: opts.accession, status: 'verified', detail: `SRA record confirmed (${ids.length} matching archive entr${ids.length > 1 ? 'ies' : 'y'})` };
    }
    catch (error) {
        return { check: 'sra_accession', identifier: opts.accession, status: 'error', detail: error instanceof Error ? error.message : String(error) };
    }
}
/** Registry-existence check for a US patent number (needs PatentsView key). */
export async function verifyPatent(client, opts) {
    if (opts.apiKey === '') {
        return { check: 'patent', identifier: opts.patent, status: 'skipped', detail: 'PATENTSVIEW_API_KEY 未配置，无法核验专利存在性（免费申请：patentsview.org/apis/keyrequest）' };
    }
    const number = opts.patent.replace(/^US/i, '').trim();
    try {
        const payload = await client.postJson('https://search.patentsview.org/api/v1/patent/', { q: { patent_id: number }, f: ['patent_id', 'patent_title', 'patent_date'] }, { headers: { 'x-api-key': opts.apiKey } });
        if (payload.error_message !== undefined && payload.error_message !== null) {
            throw new Error(String(payload.error_message));
        }
        const patent = payload.patents?.[0];
        if (patent === undefined) {
            return { check: 'patent', identifier: opts.patent, status: 'not_found', detail: `US${number} 不存在于 PatentsView 授权专利库` };
        }
        const title = typeof patent.patent_title === 'string' ? patent.patent_title : '';
        return {
            check: 'patent', identifier: opts.patent, status: 'verified',
            detail: `专利确认：US${number} — ${title.slice(0, 140)}（${String(patent.patent_date ?? '')}）`,
            record: { title, date: String(patent.patent_date ?? '') },
        };
    }
    catch (error) {
        return { check: 'patent', identifier: opts.patent, status: 'error', detail: error instanceof Error ? error.message : String(error) };
    }
}
function squash(text) {
    return typeof text === 'string' ? text.replaceAll(/\s+/g, ' ').trim() : '';
}
export async function auditClaims(client, ncbi, claims) {
    const rows = [];
    for (const input of claims) {
        const text = input.claim ?? '';
        const ids = {
            doi: input.doi !== undefined && input.doi !== '' ? input.doi : findDoi(text),
            pmid: input.pmid !== undefined && input.pmid !== '' ? input.pmid : findPmid(text),
            nctId: input.nctId !== undefined && input.nctId !== '' ? input.nctId : findNctId(text),
            uniprot: input.uniprot !== undefined && input.uniprot !== '' ? input.uniprot : findUniprotAccession(text),
            geo: input.geo !== undefined && input.geo !== '' ? input.geo : findGeoAccession(text),
            sra: input.sra !== undefined && input.sra !== '' ? input.sra : findSraAccession(text),
        };
        const label = text === '' ? collectLabel(ids) : text;
        const results = [];
        if (ids.doi !== '')
            results.push({ ...(await verifyDoi(client, { doi: ids.doi, ...(input.expectedTitle !== undefined ? { expectedTitle: input.expectedTitle } : {}) })), claim: label });
        if (ids.pmid !== '')
            results.push({ ...(await verifyPmid(client, ncbi, { pmid: ids.pmid, ...(input.expectedTitle !== undefined ? { expectedTitle: input.expectedTitle } : {}) })), claim: label });
        if (ids.nctId !== '')
            results.push({ ...(await verifyTrial(client, { nctId: ids.nctId })), claim: label });
        if (ids.uniprot !== '')
            results.push({ ...(await verifyUniprot(client, { accession: ids.uniprot, ...(input.expectedGene !== undefined ? { expectedGene: input.expectedGene } : {}) })), claim: label });
        if (ids.geo !== '')
            results.push({ ...(await verifyGds(client, ncbi, { accession: ids.geo, ...(input.expectedTitle !== undefined ? { expectedTitle: input.expectedTitle } : {}) })), claim: label });
        if (ids.sra !== '')
            results.push({ ...(await verifySra(client, ncbi, { accession: ids.sra })), claim: label });
        if (results.length === 0) {
            results.push({ check: 'identifier-scan', identifier: '-', status: 'not_found', detail: 'No recognizable biomedical identifier in this entry — supply doi/pmid/nctId/uniprot/geo/sra explicitly.', claim: label });
        }
        rows.push(...results);
    }
    let verified = 0;
    let notFound = 0;
    let mismatch = 0;
    let errors = 0;
    for (const row of rows) {
        if (row.status === 'verified')
            verified++;
        else if (row.status === 'not_found')
            notFound++;
        else if (row.status === 'mismatch')
            mismatch++;
        else
            errors++;
    }
    const verdict = mismatch > 0 || notFound > 0 ? 'FAIL' :
        errors > 0 ? 'REVIEW_REQUIRED' : 'PASS';
    const icon = { verified: '✅', mismatch: '❌', not_found: '🟡', error: '⚠️', skipped: '⏭' };
    const markdownTable = [
        '| Status | Check | ID | Claim | Detail |',
        '|---|---|---|---|---|',
        ...rows.map(row => `| ${icon[row.status]} ${row.status} | ${row.check} | \`${row.identifier}\` | ${row.claim.replaceAll('|', '\\|').slice(0, 80)} | ${row.detail.replaceAll('|', '\\|').slice(0, 220)} |`),
    ].join('\n');
    return {
        totalChecks: rows.length,
        verified,
        notFound,
        mismatch,
        errors,
        verdict,
        rows,
        markdownTable,
    };
}
function collectLabel(ids) {
    return Object.values(ids).filter(Boolean).join(' + ') || '(empty claim)';
}
// ---------------------------------------------------------------------------
// Tool builders
// ---------------------------------------------------------------------------
const CHECK_PROPERTIES = {
    status: { type: 'string' },
    check: { type: 'string' },
    identifier: { type: 'string' },
    detail: { type: 'string' },
    error: { type: 'string' },
};
/** Render helper shared by every single-check tool (schema is CHECK_PROPERTIES). */
function renderCheck(toolLabel, extraHint = '') {
    return (_args, value) => [{
            type: 'text',
            text: value.error !== undefined && value.error !== ''
                ? `${toolLabel} failed: ${value.error}`
                : `${String(value.status ?? '').toUpperCase()} — ${value.check ?? toolLabel}/${value.identifier ?? ''}: ${value.detail ?? ''}${extraHint}`,
        }];
}
function presentFor(title) {
    return args => ({ card: 'generic', title, kind: 'read', rawInput: JSON.stringify(args).slice(0, 200) });
}
/** Narrow a full CheckResult into exactly what the wire schema declares. */
function toWire(result) {
    return { status: result.status, check: result.check, identifier: result.identifier, detail: result.detail };
}
export function buildEvidenceTools(client, ncbi) {
    const str = (raw) => String(raw ?? '');
    return [
        defineTool({
            name: 'doi_verify',
            description: 'Hard verification of a DOI against Crossref: existence, bibliographic metadata, and (optionally) title agreement with your claimed source. Fabricated DOIs fail here.',
            parameters: {
                doi: { type: 'string', required: true, description: 'The DOI (raw or full URL).' },
                expectedTitle: { type: 'string', description: 'Title as you intend to cite it; enables strict title comparison.' },
            },
            output: { schema: { type: 'object', additionalProperties: false, properties: CHECK_PROPERTIES }, render: renderCheck('doi_verify') },
            async execute(args) {
                try {
                    const result = await verifyDoi(client, {
                        doi: str(args.doi),
                        ...(typeof args.expectedTitle === 'string' ? { expectedTitle: args.expectedTitle } : {}),
                    });
                    return toWire(result);
                }
                catch (error) {
                    return { status: 'error', check: 'doi', identifier: str(args.doi), detail: error instanceof Error ? error.message : String(error) };
                }
            },
            presentCall: presentFor('Verify DOI'),
        }),
        defineTool({
            name: 'pmid_verify',
            description: 'Verify a PMID against PubMed (metadata + title agreement) AND check for retraction/expression-of-concern flags. Use before citing any paper by PMID.',
            parameters: {
                pmid: { type: 'string', required: true, description: 'PubMed numeric ID.' },
                expectedTitle: { type: 'string', description: 'Claimed article title for agreement checking.' },
            },
            output: { schema: { type: 'object', additionalProperties: false, properties: CHECK_PROPERTIES }, render: renderCheck('pmid_verify', ' If retracted/EoC-flagged, replace the citation.') },
            async execute(args) {
                try {
                    const result = await verifyPmid(client, ncbi, {
                        pmid: str(args.pmid),
                        ...(typeof args.expectedTitle === 'string' ? { expectedTitle: args.expectedTitle } : {}),
                    });
                    return toWire(result);
                }
                catch (error) {
                    return { status: 'error', check: 'pmid', identifier: str(args.pmid), detail: error instanceof Error ? error.message : String(error) };
                }
            },
            presentCall: presentFor('Verify PMID'),
        }),
        defineTool({
            name: 'clinical_trial_status',
            description: 'Live ClinicalTrials.gov v2 lookup for one NCT ID: current status, phase, condition, whether results are posted. Confirms trials actually exist and are described accurately.',
            parameters: {
                nctId: { type: 'string', required: true, description: 'NCT-prefixed registry ID.' },
            },
            output: { schema: { type: 'object', additionalProperties: false, properties: CHECK_PROPERTIES }, render: renderCheck('clinical_trial_status') },
            async execute(args) {
                try {
                    return toWire(await verifyTrial(client, { nctId: str(args.nctId) }));
                }
                catch (error) {
                    return { status: 'error', check: 'clinical_trial', identifier: str(args.nctId), detail: error instanceof Error ? error.message : String(error) };
                }
            },
            presentCall: presentFor('Check trial status'),
        }),
        defineTool({
            name: 'uniprot_verify',
            description: 'Confirm a UniProtKB accession exists and (optionally) matches the expected gene name; returns entry/protein/organism.',
            parameters: {
                accession: { type: 'string', required: true, description: 'UniProtKB primary accession (e.g. P04637).' },
                expectedGene: { type: 'string', description: 'Gene symbol you expect, e.g. TP53.' },
            },
            output: { schema: { type: 'object', additionalProperties: false, properties: CHECK_PROPERTIES }, render: renderCheck('uniprot_verify') },
            async execute(args) {
                try {
                    const result = await verifyUniprot(client, {
                        accession: str(args.accession),
                        ...(typeof args.expectedGene === 'string' ? { expectedGene: args.expectedGene } : {}),
                    });
                    return toWire(result);
                }
                catch (error) {
                    return { status: 'error', check: 'uniprot', identifier: str(args.accession), detail: error instanceof Error ? error.message : String(error) };
                }
            },
            presentCall: presentFor('Verify UniProt accession'),
        }),
        defineTool({
            name: 'geo_accession_verify',
            description: 'Confirm a GEO accession (GSE/GDS/GPL/GSM) exists in NCBI GEO DataSets, optionally comparing the dataset title.',
            parameters: {
                accession: { type: 'string', required: true, description: 'e.g. GSE149768.' },
                expectedTitle: { type: 'string', description: 'Expected dataset title/scope.' },
            },
            output: { schema: { type: 'object', additionalProperties: false, properties: CHECK_PROPERTIES }, render: renderCheck('geo_accession_verify') },
            async execute(args) {
                try {
                    const result = await verifyGds(client, ncbi, {
                        accession: str(args.accession),
                        ...(typeof args.expectedTitle === 'string' ? { expectedTitle: args.expectedTitle } : {}),
                    });
                    return toWire(result);
                }
                catch (error) {
                    return { status: 'error', check: 'geo_accession', identifier: str(args.accession), detail: error instanceof Error ? error.message : String(error) };
                }
            },
            presentCall: presentFor('Verify GEO accession'),
        }),
        defineTool({
            name: 'sra_accession_verify',
            description: 'Confirm an SRA accession (SRR/SRX/SRP/ERR...) exists in the Sequence Read Archive.',
            parameters: {
                accession: { type: 'string', required: true, description: 'e.g. SRR1553600.' },
            },
            output: { schema: { type: 'object', additionalProperties: false, properties: CHECK_PROPERTIES }, render: renderCheck('sra_accession_verify') },
            async execute(args) {
                try {
                    return toWire(await verifySra(client, ncbi, { accession: str(args.accession) }));
                }
                catch (error) {
                    return { status: 'error', check: 'sra_accession', identifier: str(args.accession), detail: error instanceof Error ? error.message : String(error) };
                }
            },
            presentCall: presentFor('Verify SRA accession'),
        }),
        defineTool({
            name: 'claim_audit',
            description: 'FINAL GATE before publishing any literature/hypothesis report: batch-verifies every citation (DOI/PMID/NCT/UniProt/GEO/SRA auto-detected from each claim text) against Crossref/PubMed/ClinicalTrials.gov/UniProt/NCBI and returns a pass/fail matrix. Fix all ❌ (nonexistent/mismatched/retracted) rows before delivering.',
            parameters: {
                claims: {
                    type: 'array',
                    required: true,
                    items: { type: 'object', additionalProperties: true },
                    description: 'One object per factual claim/citation: {claim, doi?, pmid?, nctId?, uniprot?, geo?, sra?, expectedTitle?, expectedGene?}. Identifiers may be left out when embedded in the claim text.',
                },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        totalChecks: { type: 'number' },
                        verified: { type: 'number' },
                        notFound: { type: 'number' },
                        mismatch: { type: 'number' },
                        errors: { type: 'number' },
                        verdict: { type: 'string' },
                        markdownTable: { type: 'string' },
                    },
                },
                render: (_args, value) => [{
                        type: 'text',
                        text: value.verdict !== undefined
                            ? `VERDICT: ${value.verdict} (quote this verdict VERBATIM in your answer — do not re-derive or soften it)\nCounters: ${value.verified ?? 0} verified / ${value.notFound ?? 0} not-found / ${value.mismatch ?? 0} mismatch / ${value.errors ?? 0} errors\n\n${value.markdownTable ?? ''}`
                            : 'claim_audit failed.',
                    }],
            },
            async execute(args) {
                const rawClaims = Array.isArray(args.claims) ? args.claims : [];
                const claims = rawClaims.flatMap(entry => typeof entry === 'object' && entry !== null ? [entry] : []);
                if (claims.length === 0) {
                    return { totalChecks: 0, verified: 0, notFound: 0, mismatch: 0, errors: 0, verdict: 'REVIEW_REQUIRED', markdownTable: 'No claims supplied.' };
                }
                try {
                    const report = await auditClaims(client, ncbi, claims);
                    return {
                        totalChecks: report.totalChecks,
                        verified: report.verified,
                        notFound: report.notFound,
                        mismatch: report.mismatch,
                        errors: report.errors,
                        verdict: report.verdict,
                        markdownTable: report.markdownTable,
                    };
                }
                catch (error) {
                    return {
                        totalChecks: 0, verified: 0, notFound: 0, mismatch: 0, errors: 0, verdict: 'REVIEW_REQUIRED',
                        markdownTable: `Audit crashed: ${error instanceof Error ? error.message : String(error)}`,
                    };
                }
            },
            presentCall(args) {
                const count = Array.isArray(args.claims) ? args.claims.length : 0;
                return { card: 'generic', title: `Claim audit (${count} claim(s))`, kind: 'read', rawInput: '' };
            },
        }),
    ];
}
//# sourceMappingURL=evidence.js.map