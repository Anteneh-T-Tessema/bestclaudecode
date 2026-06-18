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
import { readFile, readdir } from "node:fs/promises";
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

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("build-log-server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in build-log-server:", error);
  process.exit(1);
});
