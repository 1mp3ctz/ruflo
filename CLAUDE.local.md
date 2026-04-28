# Local Development Configuration

## Ruflo Native Integration (ADR-091) — PREFER THESE

### /loop for Periodic Monitoring & Workers
Use `/loop` with ScheduleWakeup for all recurring work. Never use `daemon start` interactively.
- `/loop "Run audit worker"` — self-pacing, cache-aware (270s warm window)
- `/loop "Check swarm progress"` — monitor swarm without polling
- Formula: `delay = min(270, cache_ttl * 0.9)` — keeps prompt cache warm

### Monitor for Live Event Streams
Use `Monitor` for any process that emits state changes:
- `Monitor("npx @claude-flow/cli swarm watch --stream")` — live NDJSON swarm events
- Events include `schema: "ruflo.event.v1"`, `runId`, `agentId` for correlation
- React to events (agent completed → spawn reviewer) instead of polling

### CronCreate for Background Workers
Use `CronCreate` for workers that should persist across sessions:
- `CronCreate("audit", "*/15 * * * *", "Run security audit")` — no orphan processes
- `CronCreate("map", "*/30 * * * *", "Run codebase map")` — persistent, managed
- Use `daemon schedule -w <type> -i <min>` to generate the CronCreate command

### Teams + SendMessage for Multi-Agent Coordination
Use native Agent Teams for structured multi-agent work:
- `TeamCreate({ team_name: "feature-dev" })` to form a team
- `SendMessage({ recipient: "coder-1", content: "Design ready" })` for direct comms
- `TaskCreate({ subject: "Implement auth" })` for shared task visibility
- Always use `isolation: "worktree"` for agents that modify files

### PushNotification + RemoteTrigger for Cross-Session
For long-running tasks that span sessions:
- `PushNotification` to alert when a background task completes
- `RemoteTrigger` to resume work from another session or device

### MCP Response Hints (follow these when you see them)
| Hint | Action |
|------|--------|
| `[LOOP_SUGGESTION]` | Use `/loop` instead of daemon |
| `[MONITOR_AVAILABLE]` | Use `Monitor("...")` instead of polling |
| `[CRON_SUGGESTION]` | Use `CronCreate` for persistent workers |
| `[TEAM_SUGGESTION]` | Use `TeamCreate` + `SendMessage` |
| `[WORKTREE_SUGGESTION]` | Use `isolation: "worktree"` on Task |
| `[NOTIFY_SUGGESTION]` | Use `PushNotification` for long tasks |

---

## Environment Variables

```bash
CLAUDE_FLOW_CONFIG=./claude-flow.config.json
CLAUDE_FLOW_LOG_LEVEL=info
CLAUDE_FLOW_MEMORY_BACKEND=hybrid
CLAUDE_FLOW_MEMORY_PATH=./data/memory
CLAUDE_FLOW_MCP_PORT=3000
CLAUDE_FLOW_MCP_TRANSPORT=stdio
```

## Plugin Registry Maintenance (IPFS/Pinata)

Registry CID stored in: `v3/@claude-flow/cli/src/plugins/store/discovery.ts`
Gateway: `https://gateway.pinata.cloud/ipfs/{CID}`

Steps to add a plugin:
1. Fetch current registry: `curl -s "https://gateway.pinata.cloud/ipfs/$(grep LIVE_REGISTRY_CID v3/@claude-flow/cli/src/plugins/store/discovery.ts | cut -d"'" -f2)" > /tmp/registry.json`
2. Add plugin entry to `plugins` array, increment `totalPlugins`, update category counts
3. Upload: `curl -X POST "https://api.pinata.cloud/pinning/pinJSONToIPFS" -H "Authorization: Bearer $PINATA_JWT" -H "Content-Type: application/json" -d @/tmp/registry.json`
4. Update `LIVE_REGISTRY_CID` in discovery.ts and the `demoPluginRegistry` fallback

Security: NEVER hardcode API keys. Source from .env at runtime. NEVER commit .env.

## Doctor Health Checks

`npx claude-flow@v3alpha doctor` checks: Node 20+, npm 9+, git, config, daemon, memory DB, API keys, MCP servers, disk space, TypeScript.

## Hooks Quick Reference

```bash
npx claude-flow@v3alpha hooks pre-task --description "[task]"
npx claude-flow@v3alpha hooks post-task --task-id "[id]" --success true
npx claude-flow@v3alpha hooks session-start --session-id "[id]"
npx claude-flow@v3alpha hooks route --task "[task]"
npx claude-flow@v3alpha hooks worker list
```

## Intelligence System (RuVector)

4-step pipeline: RETRIEVE (HNSW) → JUDGE (verdicts) → DISTILL (LoRA) → CONSOLIDATE (EWC++)

Components: SONA (<0.05ms), MoE (8 experts), HNSW (150x-12,500x), Flash Attention (2.49x-7.47x)
