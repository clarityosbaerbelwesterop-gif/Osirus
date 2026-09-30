# Frontier reference 2026: public lessons for Rouge

Status: 2026-09-30.

**Scope.** Only publicly stated facts, each with its source. No private architecture detail is inferred: none of the three labs publishes its architecture, parameter count or data mixture.

**Rouge's position.** Rouge learns from what is public: the training recipe shape, capability targets and measurement conventions. It does not claim to match any of these models until it is measured on a comparable harness.

**Source quality**

| Tag | Meaning |
|---|---|
| **P** | Primary page fetched and read in full. |
| **PS** | Primary page, but read only through a search-index excerpt: openai.com and cdn.anthropic.com are blocked from this environment's network. The claim is quoted from the excerpt. Re-verify before any external use. |
| **S** | Secondary source only (press, aggregators). Marked **unverified**. |

**Sources**
- [Anthropic: Introducing Claude Opus 5.5](https://www.anthropic.com/claude-opus-5-5) (P)
- [Claude Fable 5.1 model page](https://platform.claude.com/docs/en/models/fable-5-1/overview) (P)
- [Claude Fable 5.1 & Mythos 5.1 System Card](https://www-cdn.anthropic.com/0339e6a7c5c7b87f5c07798616dc32c215d14235/Claude%20Fable%205.1%20&%20Claude%20Mythos%205.1%20System%20Card.pdf) (PS)
- [OpenAI: GPT-6 Astra](https://openai.com/index/gpt-6-astra/) (PS)
- [GPT-6 Astra System Card](https://deploymentsafety.openai.com/gpt-6-astra) (PS)
- [GPT-6 Astra model data and training](https://deploymentsafety.openai.com/gpt-6-astra/model-data-and-training) (PS)
- [OpenAI API: GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) (PS)

## 1. Reference results

These are external reference points, not optimisation targets. The first two columns come from Anthropic's own comparison table; the Astra column is taken from the same table where it appears there.

| Benchmark | Claude Opus 5.5 | GPT-6 Astra | Note |
|---|---|---|---|
| Terminal-Bench 4.0 | **66.4%** (P, xhigh effort) | 57.9% (P, high effort) | Different effort levels |
| FrontierCode v1.1 Main | **54.4%** (P) | 53.3% (P) | |
| Humanity's Last Exam, with tools | **67.7%** (P) | 57.2% (P) | Harness: with tools |
| OSWorld 2.1 | **81.8%** (P, "partial") | – | Computer use: harness-dependent |
| GDPval-AA v2.1 | **1846 Elo** (P) | 1542 (P) | Relative Elo |
| Terminal-Bench-Science 0.1 | 58.7% (P) | **64.6%** (P) | |
| AutomationBench | 40.0% (P) | 41.4% (P) | |
| FrontierMath Tier 4 | – | **97.6%** (S); "98%" (PS) | Saturated |
| GPQA Diamond | – | **96.0%** (PS) | Near saturation |
| BrowseComp | – | 91.5% (**unverified**, owner-supplied; not found in primary excerpts) | Browsing harness |
| ARC-AGI-3 | – | **99.9%** with a provider adapter harness; 62.7% with the standard harness (PS/S) | Harness result, not a raw model result |

**Anthropic's measurement note (P):** "Unless otherwise noted, all Claude Opus 5.5 results use adaptive thinking at max effort."

**Consequences for Rouge**
1. **Saturated benchmarks carry no signal at the top.** FrontierMath T4, GPQA and ARC-AGI-3 with an adapter are at 96–99.9%, so "beating them by miles" is meaningless there. Rouge's frontier suite (`training/rouge/native/eval`) will favour unsaturated, contamination-controlled tasks and efficiency ratios.
2. **Harness and effort change results.** Terminal-Bench compares xhigh against high effort, and ARC-AGI-3 moves from 62.7% to 99.9% with an adapter. Every Rouge comparison must fix the harness, the effort or compute budget, and the tools.
3. **Agent benchmarks measure model plus harness.** Terminal-Bench, OSWorld, BrowseComp and GDPval all do. They are Osirus-plus-Rouge measurements, never pure Rouge model measurements.

## 2. Public facts about the models

| Fact | Source | Class |
|---|---|---|
| Fable 5.1 and Opus 5.5: 1M-token context, 128K max output, text and images in, text out; knowledge cutoff June 2026 | Fable 5.1 model page (P) | CONTEXT, MODEL ARCHITECTURE (I/O only) |
| "Adaptive thinking lets the model decide how much to think, steered by effort." Fable 5.1: always on, default effort `high`; Opus 5.5: default `medium` | Fable 5.1 model page (P) | INFERENCE |
| Per-message effort changes are possible without invalidating the prompt cache | Fable 5.1 model page (P) | INFERENCE / PRODUCT HARNESS |
| Opus 5.5: "at default settings it will cost 40% less than Opus 5 on typical workloads"; "generates output more than 30% faster than Opus 5"; fast mode up to 2.5× speed | Opus 5.5 (P) | INFERENCE (efficiency) |
| Opus 5.5: "we're tightening how we filter the environments used in reinforcement learning" | Opus 5.5 (P) | POST-TRAINING, SAFETY |
| Opus 5.5 launches with "preserved thinking, the anti-distillation safeguard"; cyber tasks re-routed to another model; biology safeguards as for Fable 5.1 | Opus 5.5 (P) | SAFETY, PRODUCT HARNESS |
| Anthropic data processing "includes deduplication and classification"; its crawler follows robots.txt and does not access sign-in or CAPTCHA pages | Anthropic system cards (PS) | TRAINING (data) |
| Fable 5.1 and Mythos 5.1 are the same capabilities; Fable adds classifiers on top | Fable 5.1 model page (P); system card (S) | SAFETY / PRODUCT HARNESS |
| Astra "was trained on diverse datasets and filtered through our data processing pipeline, including to reduce personal information" | Astra system card (PS) | TRAINING (data) |
| OpenAI reasoning models "are trained to reason through reinforcement learning … learn to refine their thinking process, try different strategies, and recognize their mistakes" | Astra system card (PS) | POST-TRAINING |
| Astra alignment improvements span "the composition of our pre-training data to our grading during reinforcement learning" | Astra system card (PS) | TRAINING, POST-TRAINING, SAFETY |
| Astra: 1,050,000-token context, 128,000 max output; eight-needle retrieval 100% at 256K–512K, 96.3% at 512K–1M | Secondary (S) | CONTEXT |
| Astra API supports computer use, structured outputs, persisted reasoning, compaction, multi-agent orchestration, prompt caching, pro mode | OpenAI API guide (PS) | PRODUCT HARNESS, TOOLS |
| Astra is described as state of the art in computer use, browsing, software engineering, cybersecurity, science and professional work | Astra (PS) | capability claim (model + harness) |

**Not public.** Architecture, parameter counts, token counts, data mixtures, tokenizer details, attention patterns, MoE use and training compute for all three models. None of this is assumed in Rouge.

## 3. Lessons for Rouge, classified

Each lesson separates what is model capability from what is harness. The Rouge action points to the step of the frontier build plan (`/docs/rouge/architecture-v1-candidates.md`, Steps 2–9).

| # | Lesson (public basis) | Class | Model or harness | Rouge action |
|---|---|---|---|---|
| 1 | Large, diverse pretraining data, cleaned with deduplication and classification (Anthropic, OpenAI) | TRAINING | Model | Data engine with licence, dedup (MinHash), quality classifier and contamination check per shard |
| 2 | Pretraining is followed by substantial post-training, and reasoning is learned through RL on verifiable or graded outcomes (OpenAI, Anthropic) | POST-TRAINING | Model | SFT, then reasoning SFT, then rejection sampling, DPO, then RLVR on an SFT model. R1.39/R1.39b showed that RL from scratch fails. |
| 3 | RL environments must be filtered, and grading shapes alignment (Opus 5.5, Astra) | POST-TRAINING, SAFETY | Model | RL environments and graders are part of the immutable control plane; a candidate never grades itself |
| 4 | Adaptive thinking steered by an effort level; default effort differs by model | INFERENCE | Model trained for it, harness exposes it | FAST/STANDARD/DEEP/MAX only after a capable base exists; measure gain per extra FLOP. R1.17/R1.20/R1.21 showed that naive adaptive depth fails. |
| 5 | Efficiency is a headline metric: 40% cheaper and 30% faster at similar quality (Opus 5.5) | INFERENCE | Model + serving | Score per GB, per FLOP, per token and per dollar in every Rouge scorecard |
| 6 | 1M-token context is productised; retrieval is measured with multi-needle tests at 256K–1M (Fable, Opus, Astra) | CONTEXT | Model (attention/memory) + serving | Long context requires exact retrieval: R1.16 showed compressed state holds no retrievable content. Rouge v1 needs global or sparse exact access. MRCR-style evals from 4K to 128K first. |
| 7 | Persisted reasoning and compaction across context windows (Astra API) | MEMORY | **Harness** | Belongs to Osirus (agent), not to the Rouge model. The model only needs to use long context well. |
| 8 | Computer use, browsing and terminal agents are frontier benchmarks | TOOLS | **Harness + model** | Later post-training stage (tool-use data); evaluated through Osirus, never counted as Rouge model capability |
| 9 | Text and image input is standard | MODEL ARCHITECTURE | Model | Vision extension point in the v1 spec (patch encoder into the embedding stream); not trained in v1 |
| 10 | Safety classifiers, re-routing and anti-distillation sit around the model | SAFETY | **Harness** | Separate from the model; Rouge v1 gets safety data slots in post-training and evaluation gates in the CRI control plane |
| 11 | Harness and effort differences move benchmark results a lot (ARC-AGI-3: 62.7% vs 99.9%) | Measurement | – | The Rouge frontier suite fixes harness, effort and tools per comparison, and reports saturation |

## 4. Open techniques Rouge can use (published, reproducible)

These are research results, not frontier-lab disclosures.

| Technique | Source | Rouge evidence so far |
|---|---|---|
| Ternary weights trained from scratch (b1.58) | BitNet b1.58, arXiv 2402.17764 | R1.29 PASS (synthetic tasks); R1.29b (enwik8) running |
| Local:global attention interleaving | Gemma 2 (2408.00118), Gemma 3 (2503.19786), Griffin (2402.19427) | R1.14: the window model is best on long streams; R1.16: exact retrieval beyond the window needs global access |
| Auxiliary-loss-free MoE load balancing, shared experts | DeepSeek-V3, arXiv 2412.19437 | R1.19: dead experts with an auxiliary loss; R1.22: sparse dispatch is 3.3× faster |
| Compute-optimal data/parameter ratio | Chinchilla, arXiv 2203.15556 | Used for the 100M/300M/1B ladder token budgets |
| Warmup-stable-decay learning-rate schedule | MiniCPM, arXiv 2404.06395 | Allows continued training and cheap scaling-law fits |
| Web data filtering and deduplication at scale | FineWeb, arXiv 2406.17557 | Data engine design |
| Direct preference optimisation | DPO, arXiv 2305.18290 | Post-training stage |
| Group-relative policy optimisation (RLVR) | DeepSeekMath, arXiv 2402.03300 | Post-training on an SFT model only |

## 5. What Rouge will and will not claim

- **Will claim:** only measured results on a fixed harness, with seeds, contamination checks and a baseline trained on the same data.
- **Will not claim:** parity with or superiority over Opus 5.5, Fable 5.1 or GPT-6 Astra on any benchmark unless it is measured with a comparable harness, and never from a single benchmark.
- **Frontier success means** statistically significant superiority across several unrelated benchmark families plus better efficiency (score per FLOP, per byte, per dollar). It is not a higher number on one saturated benchmark.
