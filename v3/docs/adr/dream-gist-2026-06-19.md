# Swarm Orchestration SOTA Report — 2026-06-19

**TL;DR:** AdaptOrch (arXiv 2602.16873, Feb 2026) proves that task-adaptive topology selection delivers +9.8–22.9% on SWE-bench / GPQA / HotpotQA over any static topology — Ruflo's hardcoded `hierarchical` default leaves this gain on the table; the fix is a lightweight dependency-graph classifier before `swarm_init`.

---

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| AdaptOrch: dynamic topology (parallel/sequential/hierarchical/hybrid) beats static best baseline by +22.9% on SWE-bench Verified (52.6% vs 42.8%) | arXiv 2602.16873, Feb 2026 | A |
| Hybrid topology wins 49.7% of real tasks; hierarchical wins only 19% — static hierarchical default is suboptimal for the majority of workloads | AdaptOrch Table 3 | A |
| AgentJet (arXiv 2606.04484, Jun 2026): decoupled server/client swarm training achieves 1.5–10x RL training speedup via timeline merging | arXiv abstract | B |
| SPIN (arXiv 2606.07557, Jun 2026): reduces swarm coordination complexity O(n^m) → O(m·n·χ²) for edge-device swarms via tensorized policy coordination | arXiv abstract | B |
| Independent swarm overhead +58% tokens; centralized +285% — coordination cost must be budgeted per task | Industry survey, 2026 | B |
| Kimi K2.5: vendor claims 100 sub-agents / 1,500 parallel tool calls via Parallel-Agent RL (PARL) | Vendor announcement | C |
| LangGraph ships swarm as first-class native primitive; holds ~38% of production multi-agent deployments | Presenc AI Q1 2026 | B |

---

## Ruflo Current Capability

| Capability | Status | Notes |
|---|---|---|
| Swarm topologies available | 5 (hierarchical, mesh, hierarchical-mesh, adaptive, ring) | Configured at init time |
| Default topology | `hierarchical` (anti-drift) | CLAUDE.md mandates this |
| Task-adaptive topology selection | ❌ absent | No dependency-graph parser |
| Max agents (anti-drift default) | 8 | Tight coordination |
| Consensus | `raft` | Leader-based |
| Token overhead budget | Not tracked | Per-swarm cost unknown |
| Training speedup (AgentJet-style) | ❌ absent | No decoupled server/client RL |
| Edge swarm (SPIN-style) | ❌ absent | N/A for current scope |

---

## Competitor Comparison

| Competitor | Swarm Model | Key 2026 Signal | Benchmark | Confidence |
|---|---|---|---|---|
| LangGraph | Native swarm primitive (peer handoff via `Command`) + supervisor pattern | 38% production share; static topology only | No published task benchmark | B |
| AutoGen/AG2 | GroupChat; event-driven async; GA Feb 2026 | Conversational multi-agent debate; pluggable orchestration | Research-benchmark leader | B |
| CrewAI 0.95 | Role-based crews + Flows (event-driven pipelines) | Added async crew runner Feb 2026 | 12% production share | B |
| OpenAI Agents SDK | Handoff pattern; replaced Swarm Mar 2025 | Production-grade; 2% share | No swarm benchmark published | B |
| AdaptOrch (research) | Dynamic 4-topology selector via dependency graph | +9.8% SWE-bench, +6.9% GPQA, +8.1% HotpotQA | SWE-bench Verified / GPQA Diamond / HotpotQA | A |

---

## Benchmarks

| Benchmark | Result | Method | Dataset | Confidence |
|---|---|---|---|---|
| SWE-bench Verified | AdaptOrch 52.6% vs static best 42.8% (+9.8pp) | AdaptOrch dynamic topology | 500 instances, multi-file bug fixing | A |
| GPQA Diamond | AdaptOrch 53.1% vs static best 46.2% (+6.9pp) | AdaptOrch dynamic topology | 198 graduate science questions | A |
| HotpotQA | AdaptOrch 76.4% vs static best 68.3% (+8.1pp) | AdaptOrch dynamic topology | 500 multi-hop QA | A |
| AgentJet RL training | 1.5–10x speedup | Timeline merging; server/client split | Multi-model, multi-turn, multi-agent | B |
| SPIN coordination | O(n^m) → O(m·n·χ²) complexity | Tensorized policy; 250-agent zero-shot transfer | UAV simulation | B |

---

## Scan: ruview-integration

**Source:** RuView SOTA survey gist (ruvnet/12a235ec17ad5132f1cc4601537c97c7) — maps 28 ADRs.

**Competitive signal:** RuView already integrates AgentDB/HNSW/ReasoningBank loop. Critical open gap: `coherence_gate.rs::Recalibrate` only flags CSI drift — MU-SHOT-Fi source-free domain adaptation (SFDA) action is wired but empty.

**Finding (C — single internal source):** Swarm agents experiencing domain shift (cross-environment CSI drift) currently hard-restart rather than adapt in-place. SFDA adaptation loop (MicroLoRA+EWC++) would replace hard-restart, reducing re-spin latency and preserving learned CSI patterns.

---

## Scan: ruvector-integration

**Source:** CallSphere vector DB benchmark 2026; DataCamp top vector DB 2026.

**Competitive signal:** Qdrant 30K–80K QPS (OSS speed leader); Milvus 100K+ QPS at scale. Ruflo ruvector NAPI HNSW measured ~1.9x at N=20k vs brute force (CLAUDE.md audit). External Qdrant at same workload: estimated 15–40x absolute QPS.

**Finding (B — vendor + benchmark data):** For swarm deployments with >10M vectors (e.g., 50-agent swarm × 200K memories each), ruvector's single-node NAPI backend saturates. Qdrant's gRPC adapter and payload filtering would maintain <100ms p99 at this scale; Ruflo has no pluggable backend path today.

---

## SOTA Proof & Witness

| Field | Value |
|---|---|
| Session commit | `9c28fe038cf49ac6db0bb4e04b6158076f03894d` |
| Report SHA-256 | `46dc1766e9e08bca91b79ef9ad734598753098214b3301eeef144dc83f734975` |
| Witness stamp | `cf3920e9c7ab11c10d0fdc4066d43fe4a405708e919863984ae70891a28fd0b1` |
| Verifier | `sha256(report_sha256 + session_commit)` must equal witness stamp |

---

## Recommended Next Steps

1. **Implement AdaptOrch-style topology selector** (ADR-162): before every `swarm_init`, parse the task's dependency graph (leaf count, depth, fan-out ratio) and auto-select from `[parallel, sequential, hierarchical, hybrid]`; keep `hierarchical` as fallback when graph is unavailable. Expected lift: +9–23% on coding/reasoning tasks per arXiv 2602.16873 (Grade A evidence).

2. **Wire SFDA adaptation into swarm agent failover** (implementation-level, no ADR): replace the hard-restart path for consensus-failing agents with a bounded MicroLoRA+EWC++ adaptation loop (≤5 gradient steps, witness-logged) — reuses the existing EWC++ infrastructure already in `@claude-flow/memory`. Directly addresses the ruview-integration coherence gap.

3. **Add `RUVECTOR_BACKEND=qdrant|milvus` adapter** in `@claude-flow/memory` (implementation-level, no ADR): pluggable backend for swarm deployments >10M vectors; Qdrant gRPC client is MIT-licensed and ~200 LOC to wire. Keep ruvector NAPI as default (it wins below the 10M crossover).
