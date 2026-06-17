/**
 * MetaHarness MCP Tools — ADR-150 Phase-2 deep-integration surface.
 *
 * Exposes the static-analysis MetaHarness CLIs as first-class MCP tools
 * so Claude Code agents can call them programmatically without shelling
 * out themselves. Five tools, all read-only / subprocess-isolated:
 *
 *   - metaharness_score          5-dim readiness scorecard
 *   - metaharness_genome         7-section categorical report
 *   - metaharness_mcp_scan       static MCP security findings
 *   - metaharness_threat_model   enterprise-grade threat model
 *   - metaharness_oia_audit      composite audit (score + threat + mcp) → memory
 *
 * Every tool resolves the corresponding plugin script
 * (`plugins/ruflo-metaharness/scripts/<X>.mjs`) via the same locator
 * the commands/metaharness.ts dispatcher uses, then spawns it with
 * `--format json` and parses the response.
 *
 * ADR-150 ARCHITECTURAL CONSTRAINT
 * --------------------------------
 * This file has ZERO static `@metaharness/*` imports. All metaharness
 * invocation stays in the plugin scripts behind the `_harness.mjs`
 * subprocess bridge. When the plugin scripts aren't reachable at
 * runtime, each tool returns a structured `{ degraded: true }` payload
 * — never throws.
 *
 * @module @claude-flow/cli/mcp-tools/metaharness
 */

import type { MCPTool, getProjectCwd as _ } from './types.js';
import { getProjectCwd } from './types.js';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Walk up from this module to find plugins/ruflo-metaharness/scripts/.
 * Handles three install layouts (mirrors commands/metaharness.ts).
 */
function locatePluginScripts(): string | null {
  const candidates: string[] = [];
  let p = resolve(__dirname);
  for (let i = 0; i < 8; i++) {
    candidates.push(join(p, 'plugins', 'ruflo-metaharness', 'scripts'));
    candidates.push(join(p, '..', 'plugins', 'ruflo-metaharness', 'scripts'));
    p = dirname(p);
  }
  const cwd = getProjectCwd();
  candidates.push(join(cwd, 'plugins', 'ruflo-metaharness', 'scripts'));
  candidates.push(join(cwd, 'node_modules', '@claude-flow', 'cli', 'plugins', 'ruflo-metaharness', 'scripts'));
  for (const c of candidates) {
    if (existsSync(join(c, '_harness.mjs'))) return c;
  }
  return null;
}

/**
 * Result of running a metaharness plugin script.
 *
 * SUCCESS SEMANTICS (iter 44 — fix for iter-43-flagged bug)
 * `success` is computed from the canonical signal: exitCode === 0.
 *
 * Three observable cases:
 *   1. exitCode 0 + valid JSON          → success: true, degraded: false
 *      (happy path; data is the script's JSON output)
 *
 *   2. exitCode 0 + degraded payload    → success: true, degraded: true
 *      (ADR-150 constraint #3 — upstream `@metaharness/*` absent, script
 *      emits `{degraded:true, reason:"metaharness-not-available"}` and
 *      exits 0 so ruflo stays operational. `success: true` because the
 *      script DID run as designed; the agent reads `degraded: true` to
 *      know the dep was missing.)
 *
 *   3. exitCode != 0                    → success: false
 *      Two sub-cases:
 *        a. exitCode 1 with alert.triggered JSON  → intentional alert
 *           failure (e.g. --alert-on-fit-below 70). Agents read
 *           `data.alert.triggered` for the reason.
 *        b. exitCode 2 with stderr-only           → user error (bad arg).
 *           `data` is null because no JSON was on stdout.
 *
 * BEFORE iter 44 `success` was computed as `!degraded`, which collapsed
 * case 3b into success: true / exitCode: 2 — contradictory.
 */
function runScript(scriptName: string, args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  json: unknown;
  degraded: boolean;
  success: boolean;
}> {
  return new Promise((resolve) => {
    const dir = locatePluginScripts();
    if (!dir) {
      resolve({
        exitCode: 0, stdout: '', json: { degraded: true, reason: 'plugin-not-found' },
        degraded: true, success: true,  // plugin absent → equivalent to case 2
      });
      return;
    }
    const scriptPath = join(dir, scriptName);
    const argv = [...args];
    if (!argv.includes('--format')) argv.push('--format', 'json');
    const p = spawn('node', [scriptPath, ...argv], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    p.stdout?.on('data', (d) => { stdout += d.toString(); });
    p.stderr?.on('data', () => { /* swallow — graceful */ });
    const timer = setTimeout(() => { try { p.kill('SIGTERM'); } catch { /* ignore */ } }, 120_000);
    p.on('close', (code) => {
      clearTimeout(timer);
      let json: unknown = null;
      const m = /\{[\s\S]*\}/.exec(stdout);
      if (m) { try { json = JSON.parse(m[0]); } catch { /* leave null */ } }
      const looksDegraded = !!(json && typeof json === 'object' && (json as { degraded?: unknown }).degraded === true);
      const exitCode = code ?? 0;
      // iter 44 — success now reflects exit code, not the degraded marker.
      // exit 0 = script ran as designed (whether the result was happy
      // data or a graceful-degradation payload). exit != 0 = something
      // went wrong (intentional alert OR user/system error).
      const success = exitCode === 0;
      resolve({ exitCode, stdout, json, degraded: looksDegraded, success });
    });
    p.on('error', () => {
      clearTimeout(timer);
      resolve({
        exitCode: 127, stdout, json: { degraded: true, reason: 'spawn-failed' },
        degraded: true, success: false,
      });
    });
  });
}

/**
 * iter 46 — success-semantic footnote appended to every tool description
 * so agents reading the registry know how to interpret the return shape.
 * Reflects the iter-44 fix: `success` derives from exitCode, not from the
 * degraded marker. Three observable cases an agent can branch on.
 */
const MCP_SUCCESS_SEMANTIC =
  '[Return shape: {success, data, degraded, exitCode}. success===true iff exitCode===0 ' +
  '(includes graceful-degradation path where dep is absent — check degraded for that). ' +
  'success===false with exitCode===1 = intentional alert exit (read data.alert.triggered). ' +
  'success===false with exitCode===2 = input error (data is null).]';

export const metaharnessTools: MCPTool[] = [
  {
    name: 'metaharness_score',
    description: 'ADR-150 — 5-dimension harness readiness scorecard from `metaharness score <path>` (harnessFit / compileConfidence / taskCoverage / toolSafety / memoryUsefulness + estCostPerRunUsd). Pure-read subprocess; graceful degradation when metaharness optional dep absent. Use BEFORE recommending the user run `ruflo metaharness mint` so you have an evidence-based readiness signal. ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo path to score (default: cwd)', default: '.' },
        alertOnFitBelow: { type: 'number', description: 'Set to make the tool flag harnessFit < N (informational only; tool result has alert.triggered field)' },
      },
    },
    handler: async (input) => {
      const path = (input.path as string) || '.';
      const args = ['--path', path];
      if (input.alertOnFitBelow !== undefined) args.push('--alert-on-fit-below', String(input.alertOnFitBelow));
      const r = await runScript('score.mjs', args);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
  {
    name: 'metaharness_genome',
    description: 'ADR-150 — 7-section categorical readiness report from `metaharness genome <path>` (repo_type / agent_topology / risk_score / mcp_surface / test_confidence / publish_readiness). Pairs with metaharness_score for the full readiness view — score is numeric, genome is categorical. ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo path to analyze (default: cwd)', default: '.' },
        alertOnRiskAbove: { type: 'number', description: 'Set to flag risk_score > N' },
      },
    },
    handler: async (input) => {
      const path = (input.path as string) || '.';
      const args = ['--path', path];
      if (input.alertOnRiskAbove !== undefined) args.push('--alert-on-risk-above', String(input.alertOnRiskAbove));
      const r = await runScript('genome.mjs', args);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
  {
    name: 'metaharness_mcp_scan',
    description: 'ADR-150 — static security scan of `.mcp/servers.json` + `.harness/claims.json` via `harness mcp-scan <path>`. Reads only; no dispatch. Use before exposing a new MCP server config to humans/agents. ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo path with .mcp/servers.json (default: cwd)', default: '.' },
        failOn: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Severity floor for tool.alert.triggered (default: high)', default: 'high' },
      },
    },
    handler: async (input) => {
      const path = (input.path as string) || '.';
      const failOn = (input.failOn as string) || 'high';
      const r = await runScript('mcp-scan.mjs', ['--path', path, '--fail-on', failOn]);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
  {
    name: 'metaharness_threat_model',
    description: 'ADR-150 — enterprise-grade threat model from `harness threat-model <path>`. Returns worst-severity verdict (clean/low/medium/high) + categorized findings suitable for sharing with infosec. ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo path (default: cwd)', default: '.' },
        failOn: { type: 'string', enum: ['clean', 'low', 'medium', 'high'], description: 'Severity floor for tool.alert.triggered (default: high)', default: 'high' },
      },
    },
    handler: async (input) => {
      const path = (input.path as string) || '.';
      const failOn = (input.failOn as string) || 'high';
      const r = await runScript('threat-model.mjs', ['--path', path, '--fail-on', failOn]);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
  {
    name: 'metaharness_oia_audit',
    description: 'ADR-150 — composite weekly audit. Bundles oia-manifest + threat-model + mcp-scan into one timestamped record persisted to `metaharness-audit` memory namespace (or --dry-run to skip persistence). Designed for periodic drift detection. ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo path (default: cwd)', default: '.' },
        dryRun: { type: 'boolean', description: 'Skip memory persistence — local-only run', default: false },
        alertOnWorst: { type: 'string', enum: ['clean', 'low', 'medium', 'high'], description: 'Composite worst-severity floor for tool.alert.triggered' },
      },
    },
    handler: async (input) => {
      const path = (input.path as string) || '.';
      const args = ['--path', path];
      if (input.dryRun === true) args.push('--dry-run');
      if (input.alertOnWorst !== undefined) args.push('--alert-on-worst', String(input.alertOnWorst));
      const r = await runScript('oia-audit.mjs', args);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
  {
    name: 'metaharness_audit_list',
    description: 'ADR-150 iter 16 — list timestamped records from the `metaharness-audit` memory namespace. Use this BEFORE metaharness_audit_trend to discover which audit keys exist to diff. ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max records to return, newest first (default: 20)', default: 20 },
        since: { type: 'string', description: 'Filter to last N(h|d|w|m), e.g. "30d" for last 30 days' },
      },
    },
    handler: async (input) => {
      const args: string[] = [];
      if (input.limit !== undefined) args.push('--limit', String(input.limit));
      if (input.since !== undefined) args.push('--since', String(input.since));
      const r = await runScript('audit-list.mjs', args);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
  {
    name: 'metaharness_similarity',
    description: 'ADR-152 §3.1 — weighted similarity between two harness fingerprints (genome + score JSON). Returns overall ∈ [0,1] plus per-component breakdown (cosine over 9 numerics, categorical over 4 enums, jaccard over agent_topology). Pure-TS, zero `@metaharness/*` dep. Use to (a) rank candidate templates against a target repo, (b) decide fork-vs-scaffold, (c) feed ADR-151 §3.2 Recommender / §3.3 Drift / §3.5 Plugin Compat. ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        aFile: { type: 'string', description: 'Path to harness A genome+score JSON file (mutually exclusive with aKey)' },
        bFile: { type: 'string', description: 'Path to harness B genome+score JSON file (mutually exclusive with bKey)' },
        aKey: { type: 'string', description: 'Memory key for harness A in `metaharness-audit` namespace (mutually exclusive with aFile)' },
        bKey: { type: 'string', description: 'Memory key for harness B in `metaharness-audit` namespace (mutually exclusive with bFile)' },
        perDimension: { type: 'boolean', description: 'Include per-dimension contribution breakdown (used by ADR-151 §3.2 Recommender)', default: false },
        alertBelow: { type: 'number', description: 'Set tool.alert.triggered when overall < N (used by ADR-151 §3.3 Drift Detection)' },
      },
    },
    handler: async (input) => {
      const args: string[] = [];
      if (input.aFile) args.push('--a', String(input.aFile));
      if (input.bFile) args.push('--b', String(input.bFile));
      if (input.aKey) args.push('--a-key', String(input.aKey));
      if (input.bKey) args.push('--b-key', String(input.bKey));
      if (input.perDimension === true) args.push('--per-dimension');
      if (input.alertBelow !== undefined) args.push('--alert-below', String(input.alertBelow));
      const r = await runScript('similarity.mjs', args);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
  {
    name: 'metaharness_drift_from_history',
    description: 'iter 53 — one-command drift detection. Composes audit-list + oia-audit + audit-trend: finds the most recent record in `metaharness-audit` namespace (or skips that with `baselineKey`/`baselineFile`), runs a fresh audit against the current path, diffs via ADR-152 §3.1 similarity, alerts when structural similarity falls below `threshold`. Use BEFORE recommending the user act on drift — this returns a structured report rather than requiring 3 separate tool calls. Iter 66+67 added fastpaths: `baselineKey` skips audit-list (~14x faster); `baselineFile` skips both audit-list AND memory roundtrip (~19x faster, ideal for CI artifact pipelines). ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo path to audit (default: cwd)', default: '.' },
        baselineSince: { type: 'string', description: 'Use a baseline at least N(h|d|w) old, e.g. "7d" — skips drift against ultra-recent audits' },
        baselineKey: { type: 'string', description: 'iter 66 — explicit memory key for the baseline audit. Skips audit-list (no ONNX warmup). Get from `metaharness_audit_list` first.' },
        baselineFile: { type: 'string', description: 'iter 67 — file path to a saved oia-audit JSON. Skips audit-list AND memory roundtrip. Ideal for CI artifact pipelines (e.g., comparing this run vs a downloaded prior-run artifact).' },
        threshold: { type: 'number', description: 'Alert when structural similarity < N. Default 0.95.', default: 0.95 },
        alertOnNewSeverity: { type: 'string', enum: ['info', 'low', 'medium', 'warn', 'high', 'error', 'critical'], description: 'iter 78 — ALSO alert when any introduced finding meets or exceeds this severity. Orthogonal to `threshold`: a CRITICAL finding triggers even if structural similarity > threshold.' },
        dryRun: { type: 'boolean', description: 'Skip persisting the fresh audit to memory', default: false },
      },
    },
    handler: async (input) => {
      const args: string[] = [];
      args.push('--path', String(input.path ?? '.'));
      if (input.baselineSince) args.push('--baseline-since', String(input.baselineSince));
      if (input.baselineKey) args.push('--baseline-key', String(input.baselineKey));
      if (input.baselineFile) args.push('--baseline-file', String(input.baselineFile));
      if (input.threshold !== undefined) args.push('--threshold', String(input.threshold));
      if (input.alertOnNewSeverity) args.push('--alert-on-new-severity', String(input.alertOnNewSeverity));
      if (input.dryRun === true) args.push('--dry-run');
      const r = await runScript('drift-from-history.mjs', args);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
  {
    name: 'metaharness_audit_trend',
    description: 'ADR-150 iter 15 — diff two oia-audit records (drift detection). Accepts EITHER memory keys (run metaharness_audit_list first to discover them) OR direct file paths (useful for diffing CI artifacts). Surfaces composite worst-severity delta + per-component status change + introduced/cleared findings + (iter 38) ADR-152 §3.1 structural distance when both records carry a fingerprint. ' + MCP_SUCCESS_SEMANTIC,
    category: 'metaharness',
    inputSchema: {
      type: 'object',
      properties: {
        baselineKey: { type: 'string', description: 'Memory key for the older audit (mutually exclusive with baselineFile)' },
        currentKey: { type: 'string', description: 'Memory key for the newer audit (mutually exclusive with currentFile)' },
        baselineFile: { type: 'string', description: 'iter 46 — file path to older audit JSON (mutually exclusive with baselineKey)' },
        currentFile: { type: 'string', description: 'iter 46 — file path to newer audit JSON (mutually exclusive with currentKey)' },
        alertOnWorsening: { type: 'boolean', description: 'Set tool.alert.triggered when composite worst severity worsened', default: false },
        alertOnDistanceBelow: { type: 'number', description: 'iter 38 — set tool.alert.triggered when structural similarity falls below N (uses fingerprint field added in iter 38; older records emit verdict=unavailable)' },
      },
      // No required[] — caller picks key OR file inputs. The script
      // emits a graceful degraded payload if neither is supplied.
    },
    handler: async (input) => {
      const args: string[] = [];
      if (input.baselineKey) args.push('--baseline-key', String(input.baselineKey));
      if (input.currentKey) args.push('--current-key', String(input.currentKey));
      if (input.baselineFile) args.push('--baseline', String(input.baselineFile));
      if (input.currentFile) args.push('--current', String(input.currentFile));
      if (input.alertOnWorsening === true) args.push('--alert-on-worsening');
      if (input.alertOnDistanceBelow !== undefined) args.push('--alert-on-distance-below', String(input.alertOnDistanceBelow));
      const r = await runScript('audit-trend.mjs', args);
      return { success: r.success, data: r.json, degraded: r.degraded, exitCode: r.exitCode };
    },
  },
];
