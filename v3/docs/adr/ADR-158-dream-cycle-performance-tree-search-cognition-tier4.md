# ADR-158: Tier-4 Tree-Search Cognition Layer for Inference-Time Performance Optimization

- **Status:** Proposed
- **Authors:** claude (dream-cycle agent, 2026-06-15)
- **Related:** ADR-026 (3-tier model routing), ADR-143 (deterministic Tier-1 codemods)
- **Dream Cycle Issue:** #TBD (filed same session)

---

## Context

The 2026-06-15 Dream Cycle performance deep-dive surfaced two findings that expose a structural gap in Ruflo's 3-tier model routing:

1. **Arbor** (arXiv June 10, 2026): A tree-search cognition layer placed above vendor-optimized inference achieves a **+193% throughput-latency Pareto improvement** for complex agent tasks. Without the harness, single-agent approaches plateau at +33%. The key insight: per-query inference configuration (batch size, attention kernel, KV-cache policy) can be autonomously selected at dispatch time via structured tree search rather than static routing rules.

2. **Flash Attention verification gap**: Ruflo's CLAUDE.md documents a "2.49x–7.47x Flash Attention speedup" as **Unverified (no benchmark exists)**. Meanwhile MiniMax Sparse Attention achieves **14.2× prefill and 7.6× decode** on H800 (Grade A, arXiv June 11, 2026), setting a credible upper bound that makes Ruflo's unverified claim implausible without empirical confirmation.

Current Tier structure:
- **Tier 1** — Deterministic codemods (~1ms, $0): `var-to-const`, `remove-console`, `add-logging`
- **Tier 2** — Haiku (~500ms, low cost): simple tasks <30% complexity
- **Tier 3** — Sonnet/Opus (2–5s, higher cost): complex reasoning, security, architecture

Tier 3 tasks with expected latency >5s receive no further optimization. There is no mechanism to search over inference configurations before committing to a Tier-3 dispatch.

---

## Decision

Add a **Tier-4 tree-search cognition layer** that activates for Tier-3 tasks estimated to exceed 5 seconds (e.g., swarm orchestration, multi-file refactors, security audits).

The Tier-4 pass:
1. **Samples** a lightweight tree of candidate inference configurations (3–5 branches: batch size, attention variant, KV-cache TTL, streaming vs. batch).
2. **Scores** each branch against a cost-latency objective using SONA's 0.0043ms adaptation cycle.
3. **Selects** the Pareto-optimal configuration and dispatches the actual Tier-3 call with those parameters.
4. **Records** the (task-signature → config) mapping in AgentDB for future cache hits.

The goal is to narrow the 193% throughput gap to <50% within two sprints using Ruflo's existing SONA + AgentDB infrastructure.

---

## Consequences

**Positive:**
- Reduces average Tier-3 wall-clock latency for complex tasks.
- Provides empirical data to confirm or retract the Flash Attention claim.
- Leverages SONA's sub-millisecond adaptation without additional model calls.
- Builds a reusable cache of (task-type → optimal-config) pairs over time.

**Negative:**
- Adds latency for the tree-search pass itself (~10–50ms estimated; acceptable against >5s tasks).
- Increases implementation surface area in the routing module.
- Requires benchmark infrastructure to measure and validate gains.

**Neutral:**
- Does not change Tier-1/2/3 boundaries or cost structure.
- Does not require new MCP tools — purely a routing-module concern.

---

## Implementation Sketch

```typescript
// v3/@claude-flow/cli/src/routing/tier4-tree-search.ts
interface InferenceConfig {
  batchSize: number;
  attentionKernel: 'flash' | 'standard' | 'sparse';
  kvCacheTTL: number;  // seconds, 0 = no cache
  streamingMode: boolean;
}

async function tier4Dispatch(task: Task, sonaContext: SonaContext): Promise<TaskResult> {
  if (task.estimatedLatencyMs < 5000) return tier3Dispatch(task);

  const branches = sampleConfigBranches(task, 5);
  const scored = await scoreWithSona(branches, sonaContext);
  const optimal = paretoSelect(scored);

  agentDB.store(`tier4:${task.signature}`, optimal);
  return tier3Dispatch(task, optimal);
}
```

Target files:
- `v3/@claude-flow/cli/src/routing/tier4-tree-search.ts` (new)
- `v3/@claude-flow/cli/src/routing/model-router.ts` (extend dispatch logic)
- `scripts/benchmark-intelligence.mjs` (add Flash Attention benchmark suite)

---

## Alternatives Considered

- **Static config table per task-type**: Simpler but cannot adapt to runtime conditions (token budget, current GPU load, context length variance). Rejected.
- **Always use tree search**: Too slow for Tier-2 tasks. Scope-limited to Tier-3 >5s. Rejected (scope).
- **Wait for Flash Attention verification first**: No causal dependency — tree search and Flash Attention benchmarking are parallel tracks. Rejected.
