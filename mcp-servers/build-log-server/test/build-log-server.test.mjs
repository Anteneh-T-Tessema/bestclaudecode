import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, "..");

const README_FIXTURE = `## Status

- [x] Step 1: Already done with doc
- [ ] Step 9: No doc yet
- [ ] Step 10: Has doc ready
`;

// Builds an isolated repo-shaped tmp dir so tests never touch the real
// README.md/docs/. Mirrors the relative path the server resolves
// REPO_ROOT from (dist/index.js -> ../../.. -> repo root).
const DECISION_1 = `# Decision: Add BM25 index

**Agent**: coding-agent
**Retries**: 0
**Verdict**: LGTM
**Outcome**: Added BM25Index class with persistence
`;

const DECISION_2 = `# Decision: Fix auth bug

**Agent**: coding-agent
**Retries**: 1
**Verdict**: Blocking
**Outcome**: Fixed null check in login handler

## Reviewer findings

- src/auth.py:42 — missing null check
`;

// Actual repo root (two levels above mcp-servers/build-log-server).
const ACTUAL_REPO_ROOT = path.resolve(SERVER_DIR, "..", "..");

async function makeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "build-log-server-test-"));
  await mkdir(path.join(root, "docs"), { recursive: true });
  await mkdir(path.join(root, "docs", "decisions"), { recursive: true });
  await mkdir(path.join(root, "mcp-servers", "build-log-server"), { recursive: true });
  // Decision log fixtures
  await writeFile(path.join(root, "docs", "decisions", "2026-06-19_120000_add-bm25-index.md"), DECISION_1, "utf-8");
  await writeFile(path.join(root, "docs", "decisions", "2026-06-20_080000_fix-auth-bug.md"), DECISION_2, "utf-8");
  await cp(
    path.join(SERVER_DIR, "dist"),
    path.join(root, "mcp-servers", "build-log-server", "dist"),
    { recursive: true }
  );
  // Symlinked, not copied: the spawned server resolves imports
  // (@modelcontextprotocol/sdk, zod) relative to its own location and
  // needs node_modules on disk there, but copying it would be slow.
  await symlink(
    path.join(SERVER_DIR, "node_modules"),
    path.join(root, "mcp-servers", "build-log-server", "node_modules")
  );
  await writeFile(path.join(root, "README.md"), README_FIXTURE, "utf-8");
  await writeFile(path.join(root, "docs", "01-already-done-with-doc.md"), "doc for step 1\n", "utf-8");
  await writeFile(path.join(root, "docs", "10-has-doc-ready.md"), "doc for step 10\n", "utf-8");
  // Symlink real .venv and src so search_codebase / get_repo_map tools can
  // spawn Python from within the isolated fixture root.
  await symlink(path.join(ACTUAL_REPO_ROOT, ".venv"), path.join(root, ".venv"));
  await symlink(path.join(ACTUAL_REPO_ROOT, "src"), path.join(root, "src"));
  return root;
}

async function connect(root) {
  const serverScript = path.join(root, "mcp-servers", "build-log-server", "dist", "index.js");
  const transport = new StdioClientTransport({ command: "node", args: [serverScript] });
  const client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(transport);
  return client;
}

describe("build-log-server", () => {
  let root;
  let client;

  before(async () => {
    root = await makeFixture();
    client = await connect(root);
  });

  after(async () => {
    await client.close();
    await rm(root, { recursive: true, force: true });
  });

  test("list_build_steps parses the README checklist", async () => {
    const res = await client.callTool({ name: "list_build_steps", arguments: {} });
    const steps = JSON.parse(res.content[0].text);
    assert.deepEqual(steps, [
      { step: 1, name: "Already done with doc", done: true },
      { step: 9, name: "No doc yet", done: false },
      { step: 10, name: "Has doc ready", done: false },
    ]);
  });

  test("get_step_log returns real doc content for an existing step", async () => {
    const res = await client.callTool({ name: "get_step_log", arguments: { step: 1 } });
    assert.ok(!res.isError);
    assert.equal(res.content[0].text, "doc for step 1\n");
  });

  test("get_step_log returns isError for a nonexistent step", async () => {
    const res = await client.callTool({ name: "get_step_log", arguments: { step: 99 } });
    assert.equal(res.isError, true);
  });

  test("validate_build_log reports a doc-exists-but-unchecked inconsistency", async () => {
    const res = await client.callTool({ name: "validate_build_log", arguments: {} });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /Step 10 has a docs\/10-\*\.md file but is not checked off in README\.md/);
  });

  test("mark_step_done no-ops when the step is already done", async () => {
    const res = await client.callTool({ name: "mark_step_done", arguments: { step: 1 } });
    assert.equal(res.isError, false);
    assert.match(res.content[0].text, /already marked done/);
  });

  test("mark_step_done refuses when no doc exists yet for an in-checklist step", async () => {
    const res = await client.callTool({ name: "mark_step_done", arguments: { step: 9 } });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /no docs\/09-\*\.md file exists/);
  });

  test("mark_step_done refuses for a step not in the checklist at all", async () => {
    const res = await client.callTool({ name: "mark_step_done", arguments: { step: 99 } });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /isn't in README\.md's status checklist/);
  });

  test("mark_step_done flips the checkbox when a doc exists and it's unchecked", async () => {
    const res = await client.callTool({ name: "mark_step_done", arguments: { step: 10 } });
    assert.equal(res.isError, false);
    assert.match(res.content[0].text, /Marked step 10 done/);

    const readme = await readFile(path.join(root, "README.md"), "utf-8");
    assert.match(readme, /- \[x\] Step 10: Has doc ready/);
  });

  test("validate_build_log reports consistent once README and docs agree", async () => {
    const res = await client.callTool({ name: "validate_build_log", arguments: {} });
    assert.equal(res.isError, false);
    assert.match(res.content[0].text, /Build log is consistent/);
  });

  // --- decision log tools --------------------------------------------------

  test("list_decisions returns both entries newest-first", async () => {
    const res = await client.callTool({ name: "list_decisions", arguments: {} });
    assert.ok(!res.isError);
    const entries = JSON.parse(res.content[0].text);
    assert.equal(entries.length, 2);
    // Newest first: fix-auth-bug (2026-06-20) before add-bm25 (2026-06-19)
    assert.match(entries[0].task, /Fix auth bug/i);
    assert.match(entries[1].task, /Add BM25/i);
  });

  test("list_decisions respects limit", async () => {
    const res = await client.callTool({ name: "list_decisions", arguments: { limit: 1 } });
    const entries = JSON.parse(res.content[0].text);
    assert.equal(entries.length, 1);
  });

  test("list_decisions parses retries correctly", async () => {
    const res = await client.callTool({ name: "list_decisions", arguments: {} });
    const entries = JSON.parse(res.content[0].text);
    const auth = entries.find((e) => /auth/i.test(e.task));
    assert.equal(auth.retries, 1);
    const bm25 = entries.find((e) => /bm25/i.test(e.task));
    assert.equal(bm25.retries, 0);
  });

  test("list_decisions parses findings", async () => {
    const res = await client.callTool({ name: "list_decisions", arguments: {} });
    const entries = JSON.parse(res.content[0].text);
    const auth = entries.find((e) => /auth/i.test(e.task));
    assert.ok(auth.findings.length > 0);
    assert.match(auth.findings[0], /null check/i);
  });

  test("search_decisions finds matching entry", async () => {
    const res = await client.callTool({ name: "search_decisions", arguments: { query: "BM25 persistence" } });
    assert.ok(!res.isError);
    const entries = JSON.parse(res.content[0].text);
    assert.ok(entries.some((e) => /bm25/i.test(e.task)));
  });

  test("search_decisions returns no-match message when nothing matches", async () => {
    const res = await client.callTool({ name: "search_decisions", arguments: { query: "xyzzy-nonexistent" } });
    assert.match(res.content[0].text, /no decisions matched/i);
  });

  test("get_decision_stats returns total and retry rate", async () => {
    const res = await client.callTool({ name: "get_decision_stats", arguments: {} });
    assert.ok(!res.isError);
    const stats = JSON.parse(res.content[0].text);
    assert.equal(stats.total, 2);
    assert.equal(stats.withRetry, 1);
    assert.ok(stats.retryRate.includes("%"));
  });

  test("get_decision_stats includes verdictCounts", async () => {
    const res = await client.callTool({ name: "get_decision_stats", arguments: {} });
    const stats = JSON.parse(res.content[0].text);
    assert.ok(typeof stats.verdictCounts === "object");
    assert.ok(Object.keys(stats.verdictCounts).length > 0);
  });

  // --- Phase 10-E: search_codebase, get_repo_map, execute_command ----------

  test("execute_command runs safe command and returns stdout + exitCode 0", async () => {
    const res = await client.callTool({
      name: "execute_command",
      arguments: { command: "echo hello-lakoora" },
    });
    assert.equal(res.isError, false);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.exitCode, 0);
    assert.match(payload.stdout, /hello-lakoora/);
  });

  test("execute_command blocks rm -rf on root-level paths", async () => {
    const res = await client.callTool({
      name: "execute_command",
      arguments: { command: "rm -rf /" },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /blocked by Lakoora safety policy/i);
  });

  test("execute_command blocks fork-bomb patterns", async () => {
    const res = await client.callTool({
      name: "execute_command",
      arguments: { command: ":(){ :|:& };:" },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /blocked by Lakoora safety policy/i);
  });

  test("search_codebase returns content for any query", async () => {
    const res = await client.callTool({
      name: "search_codebase",
      arguments: { query: "decision", limit: 3 },
    });
    // Tool always returns text — either JSON results, a no-match message, or an
    // error message if Python isn't available. We only assert structure, not
    // content, so the test is environment-independent.
    assert.ok(res.content.length > 0);
    assert.equal(typeof res.content[0].text, "string");
    assert.ok(res.content[0].text.length > 0);
  });

  test("get_repo_map returns non-empty text", async () => {
    const res = await client.callTool({
      name: "get_repo_map",
      arguments: {},
    });
    assert.ok(res.content.length > 0);
    assert.equal(typeof res.content[0].text, "string");
    assert.ok(res.content[0].text.length > 0);
  });
});
