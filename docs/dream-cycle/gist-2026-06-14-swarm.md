# Swarm SOTA Report — 2026-06-14

**TL;DR:** Shapley-value credit attribution (+23.66% over single-agent, +14.05% over multi-agent) is now SOTA for multi-agent routing in 2026; Ruflo's hierarchical coordinator has no per-agent marginal-contribution scoring. RuView launched RuField (multimodal sensing spec, today) and Weaviate launched Engram (managed agent memory, June 6) — both widen Ruflo integration gaps.

---

## What's New in Swarm 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| SHARP: Shapley-value credit attribution achieves +23.66% vs single-agent, +14.05% vs multi-agent on real-world benchmarks | arXiv:2602.08335, revised Jun 2, 2026 | **A** — reproducible, CCv4 license |
| SwarmHarness: DHT-based peer discovery + Shapley-value reward distribution for decentralized compute routing without central authority | arXiv:2605.28764, May 27, 2026 | **B** — single source, no cross-check of benchmark numbers |
| AgentJet: decoupled multi-node RL training framework for heterogeneous swarms achieves 1.5-10× speedup via timeline-merged context tracking | arXiv:2606.04484, Jun 3, 2026 | **B** — vendor paper, no independent reproduction |
| SPIN: Matrix Product State factorization reduces joint-policy complexity O(n^m)→O(m·n·χ²) for edge swarms | arXiv:2606.07557, May 25, 2026 | **C** — single source, no concrete latency benchmark |
| Framework latency (2026 independent test): LangGraph fastest across 5 task types; CrewAI 30-60% faster than AutoGen on simple tasks | tensoria.fr comparison benchmark | **B** — crosschecked with 2025-Q4 results |

---

## Ruflo Current Capability

| Capability | Ruflo v3.6.10 Status |
|-----------|---------------------|
| Task routing | Role + availability lookup in hierarchical coordinator; no per-agent credit score |
| Swarm topology | Hierarchical (anti-drift default); Raft consensus |
| Agent credit tracking | None — no marginal contribution scoring per agent |
| Stopping decision RL | None (gap confirmed in prior run #2332, arXiv:2605.02801) |
| Swarm training loop | None — all execution is stateless per session |
| Parallel agent limit | maxAgents=8 hardcoded default |

---

## Competitor Comparison

| Framework | Credit Attribution | Topology | RL Training | Stopping Decision | Notes |
|-----------|-------------------|----------|-------------|-------------------|-------|
| **SHARP/AG2** | Shapley-value marginal contribution (+23.66%) | GroupChat + selector | Yes (RL finetuning) | None documented | arXiv:2602.08335, Jun 2026 |
| **SwarmHarness** | Shapley DHT credit tokens | Decentralized mesh | No | Utility-based drain | arXiv:2605.28764 |
| **LangGraph Swarm** | None (handoff-based) | Supervisor or swarm | No | Agent handoff terminates | v0.0.12, 2026 |
| **CrewAI v1.14.7** | Role-based reward | Hierarchical crew | No | Crew runner async | Released Jun 11, 2026 |
| **OpenAI Agents SDK** | None | Handoff graph | No (Swarm deprecated) | Handoff terminates | Production successor to Swarm |
| **Ruflo v3.6.10** | **None** | Hierarchical/mesh/adaptive | **None** | **None** | Gap: credit routing + stopping-RL both missing |

---

## Benchmarks

| Benchmark | Method | Value | Grade |
|-----------|--------|-------|-------|
| Multi-agent task matching | SHARP Shapley credit | +23.66% vs single-agent, +14.05% vs multi-agent | **A** — arXiv:2602.08335, reproducible artifact |
| Swarm training throughput | AgentJet timeline merge | 1.5-10× speedup vs baseline RL | **B** — vendor paper |
| Framework task latency | LangGraph vs CrewAI vs AutoGen | LangGraph fastest; CrewAI 30-60% faster than AutoGen | **B** — independent test |
| No 2026 data available | SPIN edge swarm latency | Qualitative only | — |

---

## Scan Findings

### Scan 1 — ruview-integration

**Source:** github.com/ruvnet/RuView releases (v1749, today Jun 14, 2026)

**Finding (B — GitHub repo, single source):** RuView released **RuField** today — an open specification for camera-free multimodal field sensing covering WiFi CSI/CIR, UWB, BLE, mmWave radar, and quantum sensors (v0.1 reference stack: 6 crates, 60 tests). Ruflo's `@claude-flow/plugin-iot-cognitum` only supports WiFi CSI. No UWB/BLE/mmWave sensor type exists in the plugin. Additionally, RuView filed ADR-148 (ruview-swarm: drone swarm with MAPPO RL, Raft consensus, MAVLink) — collides with Ruflo's in-flight ADR-148 claim from prior dream cycle PRs. The drone swarm uses a hierarchical-mesh topology and Raft consensus identical to Ruflo's default — no interoperability bridge currently exists.

### Scan 2 — ruvector-integration

**Source:** Weaviate press release Jun 6, 2026; Qdrant cloud blog Apr 28, 2026; Milvus roadmap docs

**Finding (B — multiple sources, no independent benchmark):** Three developments widen the gap:
1. **Weaviate Engram** (Jun 6, 2026): managed memory service for agent user preferences, past decisions, workflow context — directly competing with AgentDB on the agent memory use case. MCP server went GA in v1.37.0 (Apr 23).
2. **Qdrant GPU-accelerated indexing** (Apr 28, 2026): GPU indexing + Multi-AZ clusters in Qdrant Cloud; Ruflo's AgentDB uses CPU HNSW only.
3. **Milvus v3.0 roadmap** (late 2026): unified Tensor/StructList for ColBERT + multi-vector — Ruflo has no multi-vector support in AgentDB.
RuVector scale claim (50K-100K QPS at 1M vectors) remains Grade C unverified; no third-party benchmark above 20K vectors exists for Ruflo.

---

## SOTA Proof & Witness

*Session commit: `c5308381e2239ddc0c95153a867c54013a3d56c5`\nReport SHA-256: `359ff43e9267a8ea200ce5e56d1847da2e684b4bef361ba65d9390fce9f62047`\nWitness stamp: `a6e6f1f020de06065c5c18e79bbd2a3b3933f90ae7c0dbee5f2c4d6ee2e82d11`\nVerifier: `sha256(report_sha256 + session_commit)` = witness stamp*

---

## Recommended Next Steps

1. **Add per-agent Shapley credit scoring to task router** (arXiv:2602.08335): Implement approximate Shapley value tracking in `@claude-flow/memory`—each agent accumulates a marginal-contribution score per task type updated post-task; the hierarchical coordinator weights routing by `credit_score × availability`. Target: narrow the +23.66% gap vs SHARP within 3 months. Estimated ~250 LOC in `src/orchestration/credit-router.ts`. *ADR-157 filed tonight.*

2. **Extend `@claude-flow/plugin-iot-cognitum` to RuField spec**: Add UWB and BLE sensor types to the plugin's type system following the RuField v0.1 spec (6 crates released today). Priority is UWB (higher precision positioning than WiFi CSI alone) since the drone-swarm bridge (ADR-148 in RuView) will need it for MAVLink/PX4 integration.

3. **Benchmark AgentDB at N ≥ 100K vectors and publish results**: Weaviate Engram + Qdrant GPU indexing target the same use case as AgentDB. Before any competitor recommendation changes, run the benchmark defined in ADR-153 at 100K, 500K, and 1M vectors and publish as a Grade A finding. Until done, keep RuVector as Grade C.
