#!/usr/bin/env node
/**
 * build-log-server — an MCP server exposing tools to query this repo's
 * step-by-step build log (README.md checklist + docs/NN-*.md files).
 *
 * Transport: stdio (local process, spawned by the MCP client).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// This server lives at mcp-servers/build-log-server/src — repo root is three up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DOCS_DIR = path.join(REPO_ROOT, "docs");
const README_PATH = path.join(REPO_ROOT, "README.md");

interface StepStatus {
  step: number;
  name: string;
  done: boolean;
}

/** Parse the "## Status" checklist out of README.md. */
async function parseReadmeStatus(): Promise<StepStatus[]> {
  const readme = await readFile(README_PATH, "utf-8");
  const lines = readme.split("\n");
  const results: StepStatus[] = [];
  const lineRe = /^- \[( |x)\] Step (\d+): (.+)$/;
  for (const line of lines) {
    const m = line.match(lineRe);
    if (m) {
      results.push({
        done: m[1] === "x",
        step: parseInt(m[2], 10),
        name: m[3].trim(),
      });
    }
  }
  return results;
}

/** List docs/NN-*.md files, sorted by step number. */
async function listDocFiles(): Promise<{ step: number; filename: string }[]> {
  let entries: string[];
  try {
    entries = await readdir(DOCS_DIR);
  } catch {
    return [];
  }
  const docRe = /^(\d+)-.+\.md$/;
  return entries
    .map((f) => {
      const m = f.match(docRe);
      return m ? { step: parseInt(m[1], 10), filename: f } : null;
    })
    .filter((x): x is { step: number; filename: string } => x !== null)
    .sort((a, b) => a.step - b.step);
}

/** Result of attempting to mark a step done in README.md's checklist. */
interface MarkStepDoneResult {
  ok: boolean;
  message: string;
}

/**
 * Flip a step's README.md checkbox from "[ ]" to "[x]".
 *
 * Refuses if there's no docs/NN-*.md for that step yet — without this
 * guard, this tool could create the exact "checked off but undocumented"
 * inconsistency the check_build_log_consistency.py Stop hook exists to
 * catch. No-ops (without error) if the step is already marked done.
 */
async function markStepDone(step: number): Promise<MarkStepDoneResult> {
  const readme = await readFile(README_PATH, "utf-8");
  const lines = readme.split("\n");
  const lineRe = /^- \[( |x)\] Step (\d+): (.+)$/;
  let found = false;
  let alreadyDone = false;
  const updated = lines.map((line) => {
    const m = line.match(lineRe);
    if (!m || parseInt(m[2], 10) !== step) return line;
    found = true;
    if (m[1] === "x") {
      alreadyDone = true;
      return line;
    }
    return `- [x] Step ${m[2]}: ${m[3]}`;
  });

  if (!found) {
    return { ok: false, message: `Step ${step} isn't in README.md's status checklist at all.` };
  }
  if (alreadyDone) {
    return { ok: true, message: `Step ${step} was already marked done.` };
  }

  const docs = await listDocFiles();
  if (!docs.some((d) => d.step === step)) {
    return {
      ok: false,
      message: `Refusing to mark step ${step} done: no docs/${String(step).padStart(2, "0")}-*.md file exists yet. Write the build log entry first.`,
    };
  }

  await writeFile(README_PATH, updated.join("\n"), "utf-8");
  return { ok: true, message: `Marked step ${step} done in README.md.` };
}

/** Result of checking README.md's checklist against docs/NN-*.md files. */
interface ValidateBuildLogResult {
  consistent: boolean;
  problems: string[];
}

/**
 * Compare README.md's status checklist against docs/NN-*.md files in both
 * directions. Mirrors check_build_log_consistency.py's find_inconsistencies
 * (same message text), since that Python Stop hook can only run at
 * turn-end — this exposes the identical check as a tool, callable on demand.
 */
async function validateBuildLog(): Promise<ValidateBuildLogResult> {
  const readmeSteps = await parseReadmeStatus();
  const docs = await listDocFiles();
  const docStepSet = new Set(docs.map((d) => d.step));

  const problems: string[] = [];
  for (const { step, done } of readmeSteps) {
    const docName = `docs/${String(step).padStart(2, "0")}-*.md`;
    if (done && !docStepSet.has(step)) {
      problems.push(`Step ${step} is checked off in README.md but has no ${docName} file.`);
    }
    if (!done && docStepSet.has(step)) {
      problems.push(`Step ${step} has a ${docName} file but is not checked off in README.md.`);
    }
  }
  return { consistent: problems.length === 0, problems };
}

const server = new McpServer({
  name: "build-log-server",
  version: "0.1.0",
});

server.registerTool(
  "list_build_steps",
  {
    title: "List Build Steps",
    description:
      "Lists every step in this repo's build log (from README.md's status checklist), with step number, name, and whether it's marked done. Use this to check overall progress before starting new work.",
    inputSchema: {},
  },
  async () => {
    const steps = await parseReadmeStatus();
    return {
      content: [{ type: "text", text: JSON.stringify(steps, null, 2) }],
    };
  }
);

server.registerTool(
  "get_step_log",
  {
    title: "Get Step Build Log",
    description:
      "Returns the full content of the docs/NN-*.md build log entry for a given step number. Use this to see exactly what was built, why, and what was deliberately deferred for a specific step.",
    inputSchema: {
      step: z.number().int().positive().describe("Step number, e.g. 3 for Step 3"),
    },
  },
  async ({ step }) => {
    const docs = await listDocFiles();
    const match = docs.find((d) => d.step === step);
    if (!match) {
      return {
        content: [
          {
            type: "text",
            text: `No build log found for step ${step}. Available steps: ${docs.map((d) => d.step).join(", ") || "none"}`,
          },
        ],
        isError: true,
      };
    }
    const content = await readFile(path.join(DOCS_DIR, match.filename), "utf-8");
    return { content: [{ type: "text", text: content }] };
  }
);

server.registerTool(
  "mark_step_done",
  {
    title: "Mark Build Step Done",
    description:
      "Flips a step's checkbox to done in README.md's status checklist. Refuses (isError) if no docs/NN-*.md exists for that step yet — write the build log entry first. No-ops if already marked done.",
    inputSchema: {
      step: z.number().int().positive().describe("Step number, e.g. 6 for Step 6"),
    },
  },
  async ({ step }) => {
    const result = await markStepDone(step);
    return {
      content: [{ type: "text", text: result.message }],
      isError: !result.ok,
    };
  }
);

server.registerTool(
  "validate_build_log",
  {
    title: "Validate Build Log Consistency",
    description:
      "Checks whether README.md's status checklist and docs/NN-*.md files agree about which steps are done, in both directions. Mirrors the check_build_log_consistency.py Stop hook, but callable on demand mid-session instead of only at turn-end. isError is true if any inconsistency is found.",
    inputSchema: {},
  },
  async () => {
    const result = await validateBuildLog();
    const text = result.consistent
      ? "Build log is consistent: README.md and docs/ agree on every step."
      : `Build log inconsistencies found:\n- ${result.problems.join("\n- ")}`;
    return {
      content: [{ type: "text", text }],
      isError: !result.consistent,
    };
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("build-log-server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in build-log-server:", error);
  process.exit(1);
});
