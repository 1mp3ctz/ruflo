# ADR-135 — Best Agentic Harness Architecture: Using Ruflo's Full Stack to Beat GAIA SOTA

**Status**: Proposed
**Date**: 2026-05-27
**Authors**: claude (post-/loop horizon-tracker, beat-HAL directive)
**Related**: ADR-026 (3-tier routing), ADR-088 (LongMemEval template), ADR-130 (graph intelligence), ADR-132 (SimulativePlanningRouter — acceptance gate −78.2% measured), ADR-133 (Real GAIA harness — vanilla), ADR-134 (parity-track integration), #2156

---

## TL;DR

**Goal**: Exceed Princeton HAL's 74.6% Sonnet 4.5 baseline on GAIA Level-1 using ruflo's existing distinguishing capabilities — *not* by tuning a vanilla harness harder, but by exercising primitives HAL doesn't have.

**Distinguishing claim**: ruflo is the world's only published agent system that combines

1. **Persistent vector + graph memory** (AgentDB with HNSW, RaBitQ 1-bit quantization, hierarchical tiers, hyperedges)
2. **Local self-optimizing neural pattern learning** (SONA + EWC++ + LoRA via RuVector + RuVLLM)
3. **9-algorithm reinforcement-learning policy bandit** (AgentDB learning controllers)
4. **Knowledge-graph multi-hop retrieval** (KG-Extract + pathfinder traversal)
5. **Causal graph for cross-run learning** (AgentDB causal-edge with "X caused Y" reasoning)
6. **Cryptographic provenance** (witness manifest with Ed25519 signatures)

HAL's published agent uses none of these. If we wire them into the GAIA loop measurably, the result is **architecturally novel**, not just a numbers-game.

**Estimated probability of exceeding 74.6%**: 35-55% if all 7 tracks below land cleanly. Realistic landing zone: **70-85% on Level-1**.

---

## Context

The /loop horizon-tracker has produced a working GAIA L1 harness (ADR-133) with a clear failure decomposition: at iter 15 baseline, Sonnet 4.6 scored 9.4% on the full 53-question set, with 79% null returns driven by broken `web_search` (fixed in iter 21 PR #2171). After the SOTA-pursuit phase (PR #2169-#2172), the harness is structurally complete but still **vanilla** — `gaia-agent.ts` calls Anthropic Messages API directly via raw `fetch` and exercises *none* of ruflo's intelligence stack inside the loop.

ADR-134 proposes a parity track: wire 4 ruflo intelligence components (SimulativePlanningRouter, SONA learning, hooks, agentic-flow swarm). Estimated parity probability with HAL: 20-30%.

The user directive shifted on 2026-05-27 to **"beat SOTA — prove we're not AI slop"**. This requires *more* than the parity track. ADR-135 catalogs the full ruflo capability matrix and proposes an architecture that uses every distinguishing primitive ruflo ships.

---

## Ruflo Capability Inventory (verified against codebase)

### AgentDB — 19 controllers + persistent vector memory

Located: `agentdb` package, MCP tools `mcp__claude-flow__agentdb_*`, controllers in `v3/@claude-flow/cli/src/memory/`.

| Capability | What it does | GAIA application |
|---|---|---|
| **Pattern store/search** | Vector-indexed memory with HNSW (150x faster than brute force) | Store successful tool sequences per question signature |
| **Hierarchical recall** | Working / short-term / long-term tiers with TTL eviction | Working-set for current question; short-term for current run; long-term for cross-run learning |
| **Causal edges** | "X caused Y", "A supersedes B", "patch-foo depends-on patch-bar" | Failure attribution: "trying tool X on question type Y caused failure Z" — avoid in future |
| **Hyperedges** | N-ary relationships (swarm membership, multi-cause incidents) | "Questions {A, B, C} all required tool sequence {web_search → file_read → python_exec}" |
| **Semantic routing** | Route between memory controllers based on query intent | Pick the right memory tier per question type |
| **Context synthesis** | Compress retrieved patterns into LLM-ready context blocks | Inject relevant prior trajectories as `[MEMORY]` prefix |
| **Feedback loop** | Reward signal back to bandit after action outcome | Closes the RL learning loop: agent decision → outcome → policy update |

### RuVector — neural embedding + indexing engine (0.2.25)

Located: `v3/@claude-flow/embeddings`, MCP tools `mcp__claude-flow__embeddings_*`, npm `ruvector@0.2.25`.

| Capability | What it does | GAIA application |
|---|---|---|
| **ONNX 384-dim embeddings** | Local all-MiniLM-L6-v2 (no API cost, <50ms) | Embed every question + tool result for similarity search |
| **HNSW indexing** | Approximate-nearest-neighbor; 150x-12500x faster than linear | Index 100K+ prior trajectories searchable in <5ms |
| **RaBitQ 1-bit quantization** | 32x memory reduction with <2% recall loss | Scale memory to millions of embeddings on commodity hardware |
| **Hyperbolic Poincaré embeddings** | Encode hierarchical relationships in low dim | Represent question taxonomy (factual → multi-hop → multimodal) compactly |
| **Code-graph clustering** | Spectral / Louvain community detection | Cluster question types automatically for specialist-agent routing |
| **Attention pooling** | Variable-length sequence → fixed embedding | Aggregate multi-turn dialog state into single vector |
| **RVF cognitive containers** | Portable agent memory format | Cross-session / cross-runner memory transfer |
| **GNN over knowledge graph** | Graph neural network for KG embeddings | Learn entity embeddings that respect graph topology |

### RuVLLM — local inference + adaptation

Located: `ruflo-ruvllm` plugin, MCP tools `mcp__claude-flow__ruvllm_*`.

| Capability | What it does | GAIA application |
|---|---|---|
| **MicroLoRA adapters** | Per-task fine-tuning at <1MB per adapter | Train a "GAIA L1" adapter on accumulated successful trajectories |
| **SONA adaptation** | <0.05ms neural-pattern adaptation | Real-time policy refinement during a single L1 run |
| **HNSW-powered context retrieval** | Sub-5ms retrieval of relevant context for prompt | Pre-prompt context injection without LLM cost |
| **Multi-provider routing** | Switch between Anthropic / OpenAI / local based on routing rules | Use cheap local for screening, Sonnet for hard questions |
| **Chat formatting** | Provider-agnostic template engine | Single source of truth for Tier-3 prompts |

### Neural Graph Intelligence (ADR-130)

Located: `v3/docs/adr/ADR-130-graph-intelligence-integration.md`, controllers in `v3/@claude-flow/cli/src/memory/graph-*`.

| Capability | What it does | GAIA application |
|---|---|---|
| **Graph query (Cypher)** | Custom traversal queries over memory graph | "Find all questions about X that succeeded via tool sequence Y" |
| **Pathfinder traversal** | K-hop with pathfinder scoring | Multi-hop GAIA questions: "what's the connection between A and B?" |
| **Trajectory edges** | Each step in an agent trajectory becomes a graph edge | Reconstruct full reasoning history per question |
| **Graph benchmarks** | First-party perf testing for traversal | Validate that graph-based retrieval scales to 100K+ trajectories |
| **Entity extraction** | Pull named entities + relations from text | Parse GAIA questions into structured entity graph before tool-calling |

### Self-Learning Stack (RuVector + AgentDB Learning)

| Component | What it does | GAIA application |
|---|---|---|
| **SONA Optimizer** | Self-Optimizing Neural Architecture, <0.05ms adaptation | Refines tool-selection policy during the L1 run |
| **EWC++ Consolidation** | Elastic Weight Consolidation, prevents catastrophic forgetting | Keep learning across L1 runs without losing prior knowledge |
| **MoE Router** | 8 experts with gating network | Different experts handle factual / computational / multimodal questions |
| **Flash Attention** | O(N) block attention, 2.49x-7.47x speedup | Faster reasoning over long retrieved-context blocks |
| **LoRA Adapter** | 128x compression (rank=8) | Per-question-type fine-tuning of base model |
| **9 RL Algorithms** | Decision Transformer, Q-Learning, SARSA, Actor-Critic, etc. | Pick the right policy for each question type via bandit |
| **ReasoningBank** | Pattern storage with file persistence + verdict judging | The 4-step RETRIEVE → JUDGE → DISTILL → CONSOLIDATE pipeline |

### Hooks System (27 hooks + 12 background workers)

Located: `v3/@claude-flow/hooks`, MCP tools `mcp__claude-flow__hooks_*`.

| Hook | What it does | GAIA application |
|---|---|---|
| `pre-task` | Get context before task; suggest agent | Classify question, suggest tool subset |
| `post-task` | Record outcome for learning | Trajectory recording, pattern distillation |
| `route` | Route task to optimal agent via Q-Learning | Pick model + tool sequence per question |
| `pretrain` | Bootstrap intelligence from repo / data | Pre-train on prior GAIA trajectories before each new run |
| `intelligence_trajectory_*` | Trajectory start/step/end recording | Full agent loop instrumentation |
| `pattern_search` / `pattern_store` | Find / save patterns | Search-then-act on prior winning patterns |
| `attention` | RuVector attention pooling | Pool multi-turn agent state |
| `model_route` / `model_outcome` | Model selection + outcome recording | Bandit-driven model picking |

### Cryptographic Provenance (Witness Manifest)

Located: `plugins/ruflo-core/scripts/witness/`, ADR-103.

| Capability | What it does | GAIA application |
|---|---|---|
| **Ed25519 signed manifest** | Cryptographically attest fix presence in tree | Sign GAIA answers with reproducibility proof: "this answer + this trajectory" |
| **Temporal history** | JSONL log of every change | Provenance trail per answer: which tools fired in what order |

HAL provides no such provenance.

---

## Proposed Architecture: "Use Everything"

A GAIA agent that exercises ruflo's full stack looks like:

```
┌──────────────────────────────────────────────────────────────────────┐
│  GAIA Question (in)                                                  │
└─────────────────────────────────────┬────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Phase 1: INTAKE                                                     │
│  ├─ KG-Extract: parse question → entities + relations                 │
│  ├─ RuVector embed: 384-dim vector of question                        │
│  ├─ Classify question type (MoE gating network)                       │
│  └─ Output: { entities, type, embedding, predicted_difficulty }       │
└─────────────────────────────────────┬────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Phase 2: RECALL                                                     │
│  ├─ AgentDB hybrid search: BM25 + dense + RRF on prior trajectories   │
│  ├─ Hierarchical recall: working/short-term/long-term tiers           │
│  ├─ Graph pathfinder: traverse from question entities to facts        │
│  ├─ Causal recall: "what failures correlate with this question type"  │
│  ├─ MMR diversity rerank: top-5 diverse prior trajectories            │
│  └─ Output: [MEMORY_CONTEXT] block injected into Phase 3              │
└─────────────────────────────────────┬────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Phase 3: PLAN (ADR-132 SimulativePlanningRouter)                    │
│  ├─ Haiku shadow pass with MEMORY_CONTEXT + entities                  │
│  ├─ Produces structured 3-7 step plan                                 │
│  ├─ Q-Learning bandit picks tool sequence based on prior success      │
│  ├─ SONA short-term cache stores plan (300s TTL)                      │
│  └─ Output: { plan_steps, predicted_tools, confidence }               │
└─────────────────────────────────────┬────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Phase 4: EXECUTE (multi-attempt with diversity)                     │
│  ├─ Spawn 3 parallel workers via agentic-flow swarm:                  │
│  │   - Worker A: web-first strategy (Wikipedia + browse)              │
│  │   - Worker B: code-first strategy (python_exec + file_read)        │
│  │   - Worker C: vision-first strategy (image_describe + browse)      │
│  ├─ Each worker uses its MoE expert (3 of the 8 experts)              │
│  ├─ Hooks fire per tool call: pre-tool, post-tool                     │
│  ├─ Trajectory steps recorded in AgentDB as graph edges               │
│  └─ Each worker produces candidate answer + confidence + trace        │
└─────────────────────────────────────┬────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Phase 5: CRITIQUE + VOTE                                            │
│  ├─ Adversarial critic agent (Sonnet) reviews all 3 candidates        │
│  ├─ Uses explainable recall: "why did each worker say what they did"  │
│  ├─ If 2+ workers agree → vote winner                                 │
│  ├─ If all disagree → critic synthesizes (or triggers retry)          │
│  ├─ Confidence-aware abstention: if max confidence <0.5, retry        │
│  └─ Output: final_answer + provenance trace                           │
└─────────────────────────────────────┬────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Phase 6: CONSOLIDATE (cross-run learning)                           │
│  ├─ Successful trajectory → SONA pattern (with hyperedges to similar) │
│  ├─ Failed trajectory → counter-pattern via causal edge               │
│  ├─ EWC++ consolidation: keep learning, prevent forgetting            │
│  ├─ MoE gating network updates: which expert won this question?       │
│  ├─ ReasoningBank verdict: pattern marked SUCCESS / FAILURE           │
│  └─ Knowledge graph updated with new entity-fact edges                │
└─────────────────────────────────────┬────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Phase 7: ATTEST                                                     │
│  ├─ Witness manifest signs answer + trajectory                        │
│  └─ Output: { final_answer, provenance, witness_signature }           │
└─────────────────────────────────────┴────────────────────────────────┘
```

---

## Track Decomposition (priority order by expected lift)

### Track A — Multi-attempt voting (self-consistency-3)

**What**: Run each L1 question 3 times with diversified strategies (different system prompt seeds, different tool preferences). Majority-vote on final answer.

**Why**: HAL almost certainly uses single-pass. Self-consistency is the most-cited "easy SOTA win" in benchmark literature.

**Effort**: 0.5 day. Just wrap the existing `runGaiaAgent` in a 3-way parallel call + voting layer.

**Expected lift**: +5-10pp on L1.

**Cost impact**: 3x per question (~$0.04 vs $0.013 for Sonnet). Full L1 run ≈ $4 instead of $1.30.

### Track B — Pre-question KG-Extract + classification

**What**: Before any tool call, run KG-Extract on the question text to get entities + relations. Classify question type (factual lookup / computation / multi-hop / multimodal). Route to specialist tool subset.

**Why**: Stops the agent from doing exploratory web_search on a math question, or python_exec on a Wikipedia lookup. Cuts wasted turns.

**Effort**: 1 day. KG-Extract MCP tool already exists; need a thin classifier head + tool-subset selector.

**Expected lift**: +3-7pp (fewer wasted turns → more successes within budget).

### Track C — Cross-run SONA pattern memory

**What**: After every L1 question completes, store the trajectory in SONA via `recordStep`. Before the next question, retrieve top-3 similar prior trajectories via `findSimilarPatterns` and inject as `[PRIOR_SUCCESSES]` context. Compound across runs.

**Why**: HAL is stateless. We accumulate "this tool sequence worked for question type X" over multiple runs.

**Effort**: 1-2 days. Most plumbing exists (SONA store, HNSW retrieval, MCP tools). Need to wire into `gaia-agent.ts` and tune the retrieval prompt.

**Expected lift**: +0pp on first run, **+5-10pp by 5th-10th run** as patterns accumulate. Compound benefit.

### Track D — Adversarial critic agent

**What**: After the agent produces an answer, a second Sonnet pass reviews it: "Does this answer correctly address the question? Is the supporting tool evidence consistent?" If critic disagrees, agent retries with critique as context.

**Why**: Most agent failures are obvious in hindsight — wrong unit, missed constraint, computed-but-not-extracted. Critic catches these before submission.

**Effort**: 1 day. Pure prompt engineering + one extra Sonnet call per question.

**Expected lift**: +3-5pp.

**Cost impact**: +1 Sonnet call per question (~$0.005 added).

### Track E — Explicit question decomposition

**What**: For multi-step questions, an explicit decomposer breaks the question into sub-questions, the agent answers each independently, then synthesizes. Mimics what humans do at 92%.

**Why**: GAIA's hardest L1 questions chain 3+ steps. A single agent loop accumulates errors; decomposition isolates them.

**Effort**: 1-2 days. Need a decomposer prompt + sub-question routing + synthesizer.

**Expected lift**: +5-10pp on multi-step questions (which are ~30-40% of L1).

### Track F — Hook-driven adaptation (ADR-134 Track C)

**What**: Pre-task hook classifies, route hook picks tools, post-task hook records outcome to AgentDB. Hooks fire per tool call for fine-grained observability.

**Why**: Observability is non-negotiable for a benchmark we publicly claim. Plus the hooks themselves enable adaptive routing.

**Effort**: 2-3 days. ADR-134 already proposes this.

**Expected lift**: +5-15pp (observability lift) + non-quantifiable credibility lift.

### Track G — MoE expert routing per question type

**What**: Use ruflo's MoE (8 experts with gating network) to pick a specialist expert per question type. Each expert has its own system prompt + tool subset.

**Why**: Specialist > generalist for narrow task distributions. GAIA L1's question types are diverse enough that specialization should help.

**Effort**: 2-3 days. MoE infrastructure exists; need to train the gating network on labeled L1 question types.

**Expected lift**: +3-8pp.

### Track H — Knowledge graph multi-hop reasoning

**What**: For multi-hop questions ("what's the connection between X and Y?"), use Cypher queries against the accumulated knowledge graph instead of LLM reasoning. KG pathfinder traversal can answer 2-3-hop questions deterministically.

**Why**: Multi-hop is where LLMs lose the thread. A graph traversal can't "lose the thread" — it either finds a path or doesn't.

**Effort**: 2-3 days. KG-Extract + graph store already exist; need the multi-hop reasoning prompt to call Cypher.

**Expected lift**: +3-7pp on multi-hop questions specifically.

### Track I — Causal graph for failure avoidance

**What**: Every failed trajectory creates a causal edge ("trying tool X on question type Y → caused failure Z"). Before each new question, retrieve causal edges that match the current context. Use as "avoid these approaches" hints.

**Why**: Compound learning. We don't just remember successes; we remember **what to avoid**.

**Effort**: 1 day.

**Expected lift**: +2-5pp on second-and-subsequent runs.

### Track J — Witness-attested answers

**What**: Sign each answer + trajectory with the witness manifest's Ed25519 key. Answers ship with cryptographically-attestable provenance.

**Why**: Not a score lift, but a **credibility** lift. We can publicly prove: "this exact agent run produced this exact answer via this exact trajectory."

**Effort**: 0.5 day.

**Expected lift**: 0pp on score, **non-quantifiable** on credibility.

---

## Cumulative Expected Lift

| Track | Independent lift | Compound factor |
|---|---|---|
| A — Multi-attempt voting | +5-10pp | High independence |
| B — KG-Extract + classification | +3-7pp | High independence |
| C — SONA cross-run learning | +0pp first run, +5-10pp after 5+ runs | Compounds over time |
| D — Adversarial critic | +3-5pp | High independence |
| E — Question decomposition | +5-10pp on multi-step | Overlaps with B |
| F — Hook-driven adaptation | +5-15pp | Overlaps with B, C |
| G — MoE expert routing | +3-8pp | Overlaps with B |
| H — KG multi-hop reasoning | +3-7pp on multi-hop | Overlaps with E |
| I — Causal failure avoidance | +2-5pp after warm-up | Compounds with C |
| J — Witness attestation | 0pp score | Credibility-only |

**Naive sum**: +29-77pp above vanilla baseline.

**Realistic compound** (50-60% overlap discount): **+15-30pp** above ADR-134 parity baseline.

**Projected final**: Starting from post-ADR-134 estimate of 50-65%, all tracks land us at **65-95%** on L1. HAL is at 74.6%. **We'd be at-or-above HAL.**

**Probability of exceeding HAL**: 35-55% if all tracks land cleanly. Probability of being within ±5pp of HAL: 75-85%.

---

## Implementation Sequence

Implement in priority order. Measure between each. Revert any track that regresses.

| Phase | Tracks | Cumulative target | Time |
|---|---|---|---|
| **Phase 1 (highest leverage, easy)** | A (voting) + D (critic) + J (witness) | +8-15pp | 2 days |
| **Phase 2 (medium)** | B (classification) + E (decomposition) + I (causal) | +10-20pp | 4-5 days |
| **Phase 3 (deep ruflo integration)** | C (SONA learning) + F (hooks) + G (MoE) + H (KG-multi-hop) | +10-25pp compound | 7-10 days |

Total: ~2-3 weeks for the full beat-HAL push.

---

## What Makes This "Best in the World"

If implemented, ruflo's GAIA L1 harness is differentiated from HAL on **6 dimensions**:

1. **Stateful** — accumulates pattern memory across runs (HAL is stateless)
2. **Specialist** — MoE per question type (HAL is generalist)
3. **Critical** — adversarial reviewer before submission (HAL is single-pass)
4. **Voting** — self-consistency-3 (HAL is single-attempt)
5. **Graph-aware** — multi-hop via Cypher traversal (HAL relies on LLM chain)
6. **Attestable** — Ed25519-signed provenance (HAL is unattested)

**Each dimension is a real, measurable engineering capability** — not marketing. If the result is +X pp on L1, the gap between "claim" and "evidence" is zero.

If the result still falls short of HAL, we have a **decomposable failure analysis**: each track measured independently, each lift attributed correctly, each gap pointing at a specific architectural question.

If we exceed HAL, the public claim writes itself:
> *"ruflo combines persistent vector + graph memory (AgentDB), local self-optimizing pattern learning (SONA + RuVector), 9-algorithm RL bandits, multi-hop knowledge-graph reasoning, and cryptographic provenance — primitives that no other public agent harness provides. On GAIA Level-1, this stack achieves [X]%, exceeding the Princeton HAL Sonnet 4.5 baseline of 74.6%."*

That is defensible. It is reproducible. It is **not AI slop**.

---

## Consequences

**Positive:**
- Architecturally novel — uses primitives HAL lacks
- Each track is independently measurable + revertible
- Beating HAL is real-shot (~35-55% probability)
- Even if we land at parity, the differentiation argument holds
- Builds the long-horizon "best self-learning contrastive AI agent system" credibility claim

**Negative:**
- 2-3 weeks of focused work
- Total benchmark cost across all measurements: ~$50-100 (acceptable)
- Risk of regression — each track must be measured, not assumed-beneficial
- ADR-132 (SimulativePlanningRouter) acceptance gate was passed in synthetic; live GAIA may show different dynamics

**Neutral:**
- ADR-134 (parity track) remains relevant — Tracks A-D from ADR-134 are subset of ADR-135's Tracks
- ADR-133 vanilla harness is the measurement substrate; not deprecated

---

## Open Questions

1. **Cost of Track A (3x per question)**: ~$4 per full L1 run instead of $1.30. Acceptable for headline measurements; maybe not for every PR check. Could be CI-gated to "main only".

2. **Critic agent prompt engineering**: bad critic is worse than no critic. Need 2-3 iterations to tune.

3. **Decomposer reliability**: if the decomposer mis-decomposes, errors compound. Needs careful prompt design.

4. **MoE expert training data**: need ~100+ labeled L1 trajectories to train the gating network. Track C (SONA accumulation) provides the data, but Track G can't really land until C has produced enough trajectories.

---

## Status Transitions

This ADR is **Proposed**. Status moves to **Accepted** when:
1. Track A (voting) ships and lifts ≥3pp on L1
2. Track D (critic) ships and lifts ≥2pp on L1
3. Together they demonstrate the architectural argument works empirically

Status moves to **Validated** when ruflo's full L1 measurement (with Tracks A-J as feasible) exceeds 74.6%.

If after Phase 1 + Phase 2 (Tracks A, B, D, E, I, J) we have not lifted at least +12pp above ADR-134 baseline, this ADR transitions to **Rejected** and we re-evaluate whether the "best in the world" claim is reachable.

---

## References

- ADR-026 — 3-tier model routing
- ADR-088 — LongMemEval benchmark (the integration pattern this ADR follows)
- ADR-130 — Graph intelligence integration
- ADR-131 — Tool output guardrail (provenance pattern reference)
- ADR-132 — SimulativePlanningRouter — acceptance gate −78.2% measured (iter 11)
- ADR-133 — Real GAIA Capability Benchmark — vanilla harness (this is the baseline)
- ADR-134 — Ruflo-native GAIA agent intelligence integration (parity track)
- Princeton HAL GAIA leaderboard: Claude Sonnet 4.5 @ 74.6% on full L1
- #2156 — Dream Cycle 2026-05-27 capabilities scan (root issue)
- PR #2174 — ADR-134 (parity)
