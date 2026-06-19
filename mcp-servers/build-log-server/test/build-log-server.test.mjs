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
async function makeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "build-log-server-test-"));
  await mkdir(path.join(root, "docs"), { recursive: true });
  await mkdir(path.join(root, "mcp-servers", "build-log-server"), { recursive: true });
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
});
