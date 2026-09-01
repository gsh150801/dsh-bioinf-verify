# dsh-bioinf-verify

[![topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin)

**独立校验插件** for [DeepSeek Harness (`dsh`)](https://github.com/deepseek-ai/deepseek-harness)。
与资源路由类插件（`dsh-bioinf` / `dsh-bioinf-routed`）职责分离：本插件专注一件事——
**让生物医学/科研报告中的每一个证据都经得起核验**。

> English summary: a standalone verification plugin that (1) checks citations against
> authoritative registries (Crossref / PubMed / ClinicalTrials.gov / UniProt / GEO / SRA /
> PatentsView) including retraction scans, (2) verifies URLs are real and reachable,
> (3) verifies claimed titles against source titles (papers, patents, datasets, news/web
> articles via og:title), (4) verifies meaning consistency between a report claim and the
> verbatim source text (temperature-0 LLM entailment), and (5) runs whole-report
> verification: decompose → per-claim multi-aspect checks over a durable auditable ledger →
> annotated original report + appended verification report.

## 为什么需要它

生物医学 AI 报告最常见的失败不是"编造结果"，而是更隐蔽的三类：

1. **引用不存在**（幻觉 DOI/PMID/accession）；
2. **链接失效**（引用了打不开的网页）；
3. **张冠李戴**——DOI 真实存在，但报告说它的内容与原文完全是两回事。

GeneAgent 证明了"回查原始库"是抗幻觉的正道，ChemCrow 证明了"确定性工具 > LLM 自评"。
本插件把这套纪律工程化：**存在性/撤稿/标题用确定性注册库核验，含义一致性用注册库原文 +
温度 0 的 LLM 蕴含判定**（LLM 只对比两段逐字原文，不依赖模型记忆）。

## 组件

### 报告级工作流（核心功能）

| 工具 | 作用 |
|---|---|
| `report_verify_start` | 把整篇报告分解为若干待校验点：确定性扫描（段落/句子切分 + 标识符正则）+ LLM 分解（温度 0，标识符由代码再提取）合并去重；每点分类为 `literature / patent / clinical_trial / dataset / protein / webpage` 并记录原文锚点 |
| `report_verify_step` | 执行下一个"方面检查"（一次一个），**每次检查后立即持久化账本**；崩溃可恢复，已完成方面不重跑 |
| `report_verify_status` | 从账本读取结构化进度（每点 × 每方面） |
| `report_verify_finish` | 生成 **① 原报告内联标注**（未通过点句段后追加 `❌【校验未通过 C2·literature：存在性(未通过)…】`）与 **② 文末完整校验报告**（汇总统计、逐点核验矩阵、每个失败点的具体说明、账本路径） |
| `report_verify_list` | 列出历史校验任务 |

### 组件工具（可独立调用，也是工作流的部件）

| 工具 | 校验内容 | 数据源 |
|---|---|---|
| `url_verify` | 链接真实存在/可访问：重定向跟随、404/410 vs 401/403 区分、**软 404 启发** | 直接 HTTP |
| `title_verify` | **标题核验**（论文/专利/数据集/新闻网页文章）：match ≥75%或包含 / close 40–75% / mismatch | Crossref、PubMed、PatentsView、GEO、页面 og:title |
| `doi_verify` | DOI 存在性 + 元数据 + 标题比对 | Crossref |
| `pmid_verify` | PMID 核验 + **撤稿/Expression-of-Concern 扫描** | PubMed |
| `clinical_trial_status` | 试验存在性/状态/期相/结果 posted | ClinicalTrials.gov v2 |
| `geo_accession_verify` / `sra_accession_verify` | 数据集/测序存档 accession | NCBI gds / sra |
| `uniprot_verify` | 蛋白 accession + 基因对应 | UniProtKB |
| `claim_audit` | 批量引用审计矩阵（终稿闸门） | 以上聚合 |
| `claim_semantic_check` | 单条"报告说法 vs 原文含义"一致性 | 注册库原文 + 温度 0 LLM |

## 账本数据结构（可审计 / 可追溯 / 可恢复）

每次校验任务是一个持久化 JSON（`<workDir>/<jobId>.json`）：

```
job ── status / 原报告全文 / options
      ├─ claims[] ── claimId、claim、quote、paraIndex、category、identifiers
      │              └─ aspects[] ── aspect(existence/retraction/title_agreement/
      │                               semantic_consistency/url_accessibility/…)、
      │                               component、起止时间、status、detail、
      │                               evidence(原始核验载荷)
      └─ log[]（追加式事件日志）
```

## 配置（profile patch 示例）

```yaml
- insert:
    - id: bioinf-verify
      name: dsh-bioinf-verify          # 已随 bundles 安装；也可用 file:// 绝对路径指向 lib/index.js
      config:
        workDir: ''                # 账本/输出根目录；默认 ~/.dsh/science-verification
        contactEmail: ''           # 或环境变量 CONTACT_EMAIL（NCBI/Crossref polite pool）
        pubmedApiKey: ''           # 或环境变量 PUBMED_API_KEY（3→10 rps）
        patentsviewApiKey: ''      # 或环境变量 PATENTSVIEW_API_KEY（免费申请）
        guidance: true             # 注入工作流使用规范到系统提示
        llmRouter:                 # 分解 + 语义蕴含用（温度 0）
          enabled: true
          baseURL: 'http://127.0.0.1:8012/v1'   # OpenAI 兼容端点（本地 vLLM 即可）
          model: 'deepseek-v4-flash'
          apiKey: ''
```

所有密钥**只从 profile 配置或环境变量读取**，仓库内不含任何密钥。全部 API 均免费；
仅 PatentsView 需要免费申请 key，未配置时相关组件返回申请引导而非报错。

## 安装

### 方式一：dsh plugin add 直接安装（推荐）

本包发布为**可独立安装的 profile bundle**：打包产物自包含 `lib/index.js`
（schemastery / dsh-tools 已融入单文件），唯一外部依赖是每个 profile 都内置的
`@deepseek-ai/cordis`，因此无需任何配套安装：

```sh
dsh plugin --profile <profile> add git+https://github.com/gsh150801/dsh-bioinf-verify.git
```

安装成功后包名会依据 `dsh.bundle.patch` 声明自动追加进该 profile 的
`dsh.profile.bundles`（`~/.dsh/profiles/<profile>/package.json`）。随后：
- 为 `bioinf-verify` 行补充本机配置（llmRouter 的 `baseURL`/`model`、密钥等）——见上文配置节，
  或通过 dsh 设置面板编辑；
- 重启 `dsh web`，`report_verify_*` 与各组件工具即生效。

### 方式二：源码 checkout（二次开发）

需要 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 源码 checkout：

```sh
git clone https://github.com/gsh150801/dsh-bioinf-verify packages/examples/dsh-bioinf-verify
pnpm install && pnpm run build:lib:host
# 然后在 profile patch 中按上面的示例挂载（name 用 file:// 绝对路径指向 lib/index.js）
```

## 开发

```sh
pnpm install
vitest run packages/examples/dsh-bioinf-verify/tests/verify.spec.ts       # 离线（mock）
RUN_LIVE=1 vitest run packages/examples/dsh-bioinf-verify/tests/live.spec.ts  # 实网验收
```

## License

MIT
