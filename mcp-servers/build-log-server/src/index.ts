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
import { spawn } from "node:child_process";

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

// ---------------------------------------------------------------------------
// Decision log helpers
// ---------------------------------------------------------------------------

const DECISIONS_DIR = path.join(REPO_ROOT, "docs", "decisions");

interface DecisionEntry {
  filename: string;
  date: string;
  slug: string;
  task: string;
  agent: string;
  verdict: string;
  retries: number;
  outcome: string;
  findings: string[];
}

/** Parse one decision Markdown file into a structured object. */
function parseDecisionFile(filename: string, content: string): DecisionEntry {
  const taskMatch = content.match(/^# Decision: (.+)$/m);
  const agentMatch = content.match(/\*\*Agent\*\*:\s*(.+?)(?:\s*\\)?$/m);
  const retriesMatch = content.match(/\*\*Retries\*\*:\s*(\d+)/m);
  const verdictMatch = content.match(/\*\*Verdict\*\*:\s*(.+?)(?:\s*\\)?$/m);
  const outcomeMatch = content.match(/\*\*Outcome\*\*:\s*(.+?)(?:\s*\\)?$/m);

  const findingLines = content
    .split("\n")
    .filter((l) => l.startsWith("- ") && content.includes("## Reviewer findings"))
    .map((l) => l.slice(2).trim());

  // Filename: YYYY-MM-DD_HHMMSS_slug.md
  const nameParts = filename.replace(/\.md$/, "").split("_");
  const date = nameParts.slice(0, 2).join("T").replace(/(\d{2})(\d{2})(\d{2})$/, "$1:$2:$3") + "Z";
  const slug = nameParts.slice(2).join("_");

  return {
    filename,
    date,
    slug,
    task: taskMatch?.[1]?.trim() ?? slug,
    agent: agentMatch?.[1]?.trim() ?? "unknown",
    verdict: verdictMatch?.[1]?.trim() ?? "unknown",
    retries: retriesMatch ? parseInt(retriesMatch[1], 10) : 0,
    outcome: outcomeMatch?.[1]?.trim() ?? "",
    findings: findingLines,
  };
}

/** Load all decision entries from docs/decisions/, newest first. */
async function loadDecisions(): Promise<DecisionEntry[]> {
  let files: string[];
  try {
    const entries = await readdir(DECISIONS_DIR);
    files = entries.filter((f) => f.endsWith(".md")).sort().reverse();
  } catch {
    return [];
  }
  const results: DecisionEntry[] = [];
  for (const f of files) {
    const content = await readFile(path.join(DECISIONS_DIR, f), "utf-8").catch(() => "");
    if (content) results.push(parseDecisionFile(f, content));
  }
  return results;
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

server.registerTool(
  "list_decisions",
  {
    title: "List Decision Log Entries",
    description:
      "Returns the N most recent agent decision log entries from docs/decisions/. Each entry includes task, verdict, retry count, outcome, and reviewer findings. Use this to audit what the agent has done and why.",
    inputSchema: {
      limit: z.number().int().positive().optional().describe("Max entries to return (default 10)"),
    },
  },
  async ({ limit = 10 }) => {
    const decisions = await loadDecisions();
    const slice = decisions.slice(0, limit);
    if (slice.length === 0) {
      return { content: [{ type: "text", text: "(no decision log entries found)" }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(slice, null, 2) }] };
  }
);

server.registerTool(
  "search_decisions",
  {
    title: "Search Decision Log",
    description:
      "Searches decision log entries whose task, outcome, or findings contain all of the given keywords (case-insensitive). Returns matching entries newest-first.",
    inputSchema: {
      query: z.string().describe("Space-separated keywords to search for"),
      limit: z.number().int().positive().optional().describe("Max results (default 10)"),
    },
  },
  async ({ query, limit = 10 }) => {
    const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
    const all = await loadDecisions();
    const matches = all.filter((d) => {
      const haystack = `${d.task} ${d.outcome} ${d.findings.join(" ")}`.toLowerCase();
      return keywords.every((k) => haystack.includes(k));
    });
    const slice = matches.slice(0, limit);
    if (slice.length === 0) {
      return { content: [{ type: "text", text: `(no decisions matched: ${query})` }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(slice, null, 2) }] };
  }
);

server.registerTool(
  "get_decision_stats",
  {
    title: "Decision Log Analytics",
    description:
      "Aggregates all decision log entries and returns statistics: total cycles, retry rate, verdict distribution, and top recurring reviewer findings. Use this to identify systemic patterns across agent runs.",
    inputSchema: {},
  },
  async () => {
    const all = await loadDecisions();
    if (all.length === 0) {
      return { content: [{ type: "text", text: "(no decision log entries found)" }] };
    }
    const total = all.length;
    const withRetry = all.filter((d) => d.retries > 0).length;
    const retryRate = ((withRetry / total) * 100).toFixed(1);

    const verdictCounts: Record<string, number> = {};
    for (const d of all) {
      const v = d.verdict.split(":")[0].trim();
      verdictCounts[v] = (verdictCounts[v] ?? 0) + 1;
    }

    const findingCounts: Record<string, number> = {};
    for (const d of all) {
      for (const f of d.findings) {
        const key = f.slice(0, 60);
        findingCounts[key] = (findingCounts[key] ?? 0) + 1;
      }
    }
    const topFindings = Object.entries(findingCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([f, n]) => ({ finding: f, count: n }));

    const stats = { total, withRetry, retryRate: `${retryRate}%`, verdictCounts, topFindings };
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Subprocess helpers + safety gate (mirrors Phase 1-A/1-B BLOCKED_PATTERNS)
// ---------------------------------------------------------------------------

const BLOCKED_PATTERNS = [
  /rm\s+-[a-zA-Z]*r[a-zA-Z]*f\s+(\/|~|\$HOME|\$\{HOME\})/i,
  /:\(\)\s*\{\s*:|:\s*&\s*\}/,
  /dd\s+if=\/dev\/zero\s+of=\/dev\//i,
  /\bmkfs\b/i,
];

const VENV_PYTHON = path.join(REPO_ROOT, ".venv", "bin", "python");

interface SpawnResult { stdout: string; stderr: string; exitCode: number }

function spawnProc(cmd: string, args: string[], cwd: string): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString() });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString() });
    proc.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
    proc.on("error", (err) => resolve({ stdout: "", stderr: err.message, exitCode: 1 }));
  });
}

// ---------------------------------------------------------------------------
// Phase 10-E: search_codebase, get_repo_map, execute_command
// ---------------------------------------------------------------------------

server.registerTool(
  "search_codebase",
  {
    title: "Search Codebase (BM25)",
    description:
      "Full-text BM25 search across the repository source files. Returns the top matching results with file path, line hint, and relevance score. Use this to find relevant code before making changes.",
    inputSchema: {
      query: z.string().describe("Keywords or identifiers to search for"),
      limit: z.number().int().positive().optional().describe("Max results (default 10)"),
    },
  },
  async ({ query, limit = 10 }) => {
    const result = await spawnProc(
      VENV_PYTHON,
      ["-m", "src.bm25_index", query, REPO_ROOT, "--json"],
      REPO_ROOT
    );
    if (result.exitCode !== 0) {
      return {
        content: [{ type: "text", text: `search_codebase failed: ${result.stderr.slice(0, 300)}` }],
        isError: true,
      };
    }
    let parsed: { results?: Array<{ score: number; file: string; line: string }> };
    try {
      parsed = JSON.parse(result.stdout) as typeof parsed;
    } catch {
      return {
        content: [{ type: "text", text: `JSON parse error: ${result.stdout.slice(0, 300)}` }],
        isError: true,
      };
    }
    const hits = (parsed.results ?? []).slice(0, limit);
    if (hits.length === 0) {
      return { content: [{ type: "text", text: `(no results for: ${query})` }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(hits, null, 2) }] };
  }
);

server.registerTool(
  "get_repo_map",
  {
    title: "Get Repository Map",
    description:
      "Returns a structured symbol-level map of the repository (files, classes, functions, exports) generated by src.repo_map. Use this to understand the codebase structure before navigating or modifying it.",
    inputSchema: {},
  },
  async () => {
    const result = await spawnProc(
      VENV_PYTHON,
      ["-m", "src.repo_map", REPO_ROOT],
      REPO_ROOT
    );
    if (result.exitCode !== 0) {
      return {
        content: [{ type: "text", text: `get_repo_map failed: ${result.stderr.slice(0, 300)}` }],
        isError: true,
      };
    }
    const out = result.stdout.trim() || "(empty map)";
    return { content: [{ type: "text", text: out }] };
  }
);

server.registerTool(
  "execute_command",
  {
    title: "Execute Shell Command",
    description:
      "Runs an arbitrary shell command in the repository root and returns stdout, stderr, and exit code. Blocked: rm -rf on root paths, fork bombs, dd if=/dev/zero, mkfs. Use only for safe read-only or build commands.",
    inputSchema: {
      command: z.string().describe("Shell command to run"),
      cwd: z.string().optional().describe("Working directory (defaults to repo root)"),
    },
  },
  async ({ command, cwd }) => {
    if (BLOCKED_PATTERNS.some((re) => re.test(command))) {
      return {
        content: [{ type: "text", text: "Command blocked by Lakoora safety policy." }],
        isError: true,
      };
    }
    const workDir = cwd ?? REPO_ROOT;
    const result = await spawnProc("/bin/sh", ["-c", command], workDir);
    const payload = {
      stdout: result.stdout.slice(0, 4000),
      stderr: result.stderr.slice(0, 1000),
      exitCode: result.exitCode,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      isError: result.exitCode !== 0,
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
