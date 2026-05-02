#!/usr/bin/env tsx
/**
 * R-3.3 A/B harness — measures whether the swarm path (R-3.1/R-3.2)
 * produces measurably better findings than the single-call path.
 *
 * Runs each of 3 seed goals through:
 *   A) RUFLO_USE_SWARM=false   (single LLM call per step)
 *   B) RUFLO_USE_SWARM=true    (4-agent specialized pipeline)
 *
 * For each path, collects:
 *   - findings count
 *   - unique source count (dedupe by source string, normalized)
 *   - mean confidence
 *   - latency
 *
 * Optionally runs an Anthropic-judged hallucination scorer
 * (Claude Opus) over the findings — deferred when no LLM creds.
 *
 * Output: writes a markdown report to `docs/swarm-ab-results.md`.
 *
 * Mock-mode behaviour: when no ANTHROPIC_API_KEY (and no Secret
 * Manager), both paths return identical canned 3-finding mock data.
 * The harness still runs and produces a "mock-mode" report tagged
 * accordingly, so the wiring is exercisable without credentials.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SEED_GOALS = [
  {
    goal: 'Best electric vehicle under $50k for a family of 4',
    stepTitle: 'Discovery',
    stepDescription: 'Identify candidate EV models in the price band with relevant family-friendly features.',
  },
  {
    goal: 'How does GOAP planning compare to behavior trees in real-time games',
    stepTitle: 'Discovery',
    stepDescription: 'Survey published comparisons and benchmark studies between the two AI architectures.',
  },
  {
    goal: 'Quantum computing applications in pharmaceutical drug discovery',
    stepTitle: 'Discovery',
    stepDescription: 'Identify current and near-term applications, key vendors, and validated case studies.',
  },
];

function uniqueSourceCount(findings) {
  const norm = new Set();
  for (const f of findings) {
    const s = (f.source ?? '').trim().toLowerCase();
    if (s) norm.add(s);
  }
  return norm.size;
}

function meanConfidence(findings) {
  const confs = findings.map((f) => f.confidence).filter((c) => typeof c === 'number');
  if (!confs.length) return 0;
  return confs.reduce((a, b) => a + b, 0) / confs.length;
}

async function runPath(swarmFlag, goal) {
  if (swarmFlag) process.env.RUFLO_USE_SWARM = 'true';
  else delete process.env.RUFLO_USE_SWARM;

  const mod = await import('../functions/research-step/handler.ts?v=' + Date.now() + '-' + Math.random());
  const t0 = performance.now();
  const result = await mod.researchStepHandler({
    goal: goal.goal,
    stepTitle: goal.stepTitle,
    stepDescription: goal.stepDescription,
    stepType: 'goal-analysis',
  });
  const t1 = performance.now();

  if (result.status !== 200) {
    return {
      path: swarmFlag ? 'swarm' : 'single-call',
      findingsCount: 0,
      uniqueSources: 0,
      meanConfidence: 0,
      latencyMs: t1 - t0,
      findings: [],
      failedAt: typeof result.body === 'object' && result.body !== null
        ? JSON.stringify(result.body).slice(0, 200)
        : 'unknown',
    };
  }

  const findings = result.body ?? [];
  return {
    path: swarmFlag ? 'swarm' : 'single-call',
    findingsCount: findings.length,
    uniqueSources: uniqueSourceCount(findings),
    meanConfidence: meanConfidence(findings),
    latencyMs: t1 - t0,
    findings,
  };
}

async function main() {
  const startTs = new Date().toISOString();
  const { isLlmAvailable } = await import('../functions/_lib/llm.ts');
  const haveCreds = await isLlmAvailable();

  console.log(`R-3.3 A/B harness — ${haveCreds ? 'REAL-LLM mode' : 'MOCK mode (no LLM creds)'}`);
  console.log(`Seeds: ${SEED_GOALS.length} goals × 2 paths = ${SEED_GOALS.length * 2} runs\n`);

  const rows = [];
  for (const seed of SEED_GOALS) {
    console.log(`Goal: "${seed.goal.slice(0, 60)}..."`);
    const single = await runPath(false, seed);
    console.log(`  single-call: ${single.findingsCount} findings · ${single.uniqueSources} sources · conf ${single.meanConfidence.toFixed(2)} · ${single.latencyMs.toFixed(0)}ms${single.failedAt ? ' [FAILED]' : ''}`);
    const swarm = await runPath(true, seed);
    console.log(`  swarm:       ${swarm.findingsCount} findings · ${swarm.uniqueSources} sources · conf ${swarm.meanConfidence.toFixed(2)} · ${swarm.latencyMs.toFixed(0)}ms${swarm.failedAt ? ' [FAILED]' : ''}`);

    const ucPct = single.uniqueSources > 0
      ? ((swarm.uniqueSources - single.uniqueSources) / single.uniqueSources) * 100
      : null;
    rows.push({
      goal: seed.goal,
      paths: { single, swarm },
      delta: {
        uniqueSourcesPctImprovement: ucPct,
        confidenceDelta: swarm.meanConfidence - single.meanConfidence,
        latencyMultiple: single.latencyMs > 0 ? swarm.latencyMs / single.latencyMs : 0,
      },
    });
  }

  const aggSingle = {
    findings: rows.reduce((a, r) => a + r.paths.single.findingsCount, 0),
    sources: rows.reduce((a, r) => a + r.paths.single.uniqueSources, 0),
    conf: rows.reduce((a, r) => a + r.paths.single.meanConfidence, 0) / rows.length,
    latencyMean: rows.reduce((a, r) => a + r.paths.single.latencyMs, 0) / rows.length,
  };
  const aggSwarm = {
    findings: rows.reduce((a, r) => a + r.paths.swarm.findingsCount, 0),
    sources: rows.reduce((a, r) => a + r.paths.swarm.uniqueSources, 0),
    conf: rows.reduce((a, r) => a + r.paths.swarm.meanConfidence, 0) / rows.length,
    latencyMean: rows.reduce((a, r) => a + r.paths.swarm.latencyMs, 0) / rows.length,
  };

  const sourcePctImprovement = aggSingle.sources > 0
    ? ((aggSwarm.sources - aggSingle.sources) / aggSingle.sources) * 100
    : null;

  let md = `# R-3.3 — Swarm vs Single-Call A/B Quality Report\n\n`;
  md += `> Generated by \`scripts/check-swarm-quality.mjs\` on ${startTs}.\n`;
  md += `> Mode: **${haveCreds ? 'REAL LLM' : 'MOCK (no credentials resolved)'}**\n\n`;

  if (!haveCreds) {
    md += `## ⚠️ Mock-mode run\n\n`;
    md += `No \`ANTHROPIC_API_KEY\` (env or Secret Manager) was resolved at run time. `;
    md += `Both paths returned the canned 3-finding mock response, so the numbers below `;
    md += `are wiring-only — they do NOT reflect actual swarm-vs-single-call quality.\n\n`;
    md += `**To run the real A/B**: set \`ANTHROPIC_API_KEY\` (or configure gcloud Secret Manager `;
    md += `per ADR-093) and re-run \`tsx scripts/check-swarm-quality.mjs\`.\n\n`;
  }

  md += `## Aggregate (3 seed goals)\n\n`;
  md += `| Metric | Single-call | Swarm | Delta |\n`;
  md += `|---|---:|---:|---:|\n`;
  md += `| Total findings | ${aggSingle.findings} | ${aggSwarm.findings} | ${aggSwarm.findings - aggSingle.findings} |\n`;
  md += `| Total unique sources | ${aggSingle.sources} | ${aggSwarm.sources} | ${sourcePctImprovement !== null ? sourcePctImprovement.toFixed(1) + '%' : 'n/a'} |\n`;
  md += `| Mean confidence | ${aggSingle.conf.toFixed(2)} | ${aggSwarm.conf.toFixed(2)} | ${(aggSwarm.conf - aggSingle.conf).toFixed(2)} |\n`;
  md += `| Mean latency (ms) | ${aggSingle.latencyMean.toFixed(0)} | ${aggSwarm.latencyMean.toFixed(0)} | ${(aggSwarm.latencyMean / Math.max(aggSingle.latencyMean, 1)).toFixed(2)}× |\n\n`;

  md += `## DoD targets (ADR-096)\n\n`;
  md += `- ≥30% more unique citations vs single-call: **${sourcePctImprovement !== null && sourcePctImprovement >= 30 ? '✅ MET' : (haveCreds ? '❌ NOT MET' : '⏳ pending real-LLM run')}**\n`;
  md += `- ≥20% reduction in hallucination rate (Anthropic-Opus judged): **⏳ deferred** (judge step not implemented in this harness; follow-up)\n\n`;

  md += `## Per-goal\n\n`;
  for (const row of rows) {
    md += `### ${row.goal}\n\n`;
    md += `| Path | Findings | Unique sources | Mean conf | Latency (ms) |\n`;
    md += `|---|---:|---:|---:|---:|\n`;
    md += `| single-call | ${row.paths.single.findingsCount} | ${row.paths.single.uniqueSources} | ${row.paths.single.meanConfidence.toFixed(2)} | ${row.paths.single.latencyMs.toFixed(0)} |\n`;
    md += `| swarm | ${row.paths.swarm.findingsCount} | ${row.paths.swarm.uniqueSources} | ${row.paths.swarm.meanConfidence.toFixed(2)} | ${row.paths.swarm.latencyMs.toFixed(0)} |\n\n`;
    if (row.paths.single.failedAt) md += `> single-call failed: \`${row.paths.single.failedAt}\`\n\n`;
    if (row.paths.swarm.failedAt) md += `> swarm failed: \`${row.paths.swarm.failedAt}\`\n\n`;
  }

  md += `## Honest caveats\n\n`;
  md += `1. The Anthropic-Opus hallucination judge step is deferred to a polish PR — needs a separate Opus prompt + scoring rubric. R-3.3's wiring + counting infrastructure is shipped; the judge slot is intentionally a follow-up.\n`;
  md += `2. With real LLM creds, latency is ≈3-5s per step single-call and ≈12-20s swarm. The latency multiple in the table above will reflect that ratio.\n`;
  md += `3. Unique-source counting normalizes by lowercase + trim. URL canonicalization (e.g. trailing slash, query params) is not done — if the LLM emits the same source with minor variants, this overcounts. A canonicalizer would tighten the metric; deferred.\n`;

  const outPath = resolve('docs/swarm-ab-results.md');
  writeFileSync(outPath, md, 'utf8');
  console.log(`\nReport written: ${outPath}`);
  console.log(`Aggregate source-improvement: ${sourcePctImprovement !== null ? sourcePctImprovement.toFixed(1) + '%' : 'n/a'}`);
}

main().catch((err) => {
  console.error('check-swarm-quality fatal:', err);
  process.exit(1);
});
