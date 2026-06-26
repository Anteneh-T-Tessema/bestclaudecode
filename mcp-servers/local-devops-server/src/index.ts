#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as net from "net";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const BLOCKED_PATTERNS = [
  /rm\s+-[a-zA-Z]*r[a-zA-Z]*f\s+(\/|~|\$HOME|\$\{HOME\})/i,
  /:\(\)\s*\{\s*:|:\s*&\s*\}/,
  /dd\s+if=\/dev\/zero\s+of=\/dev\//i,
  /\bmkfs\b/i,
];

const server = new McpServer({
  name: "local-devops-server",
  version: "0.1.0",
});

/** Verify if a local port is listening via a TCP socket. */
function checkPort(port: number, host: string = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

/** Check process using the port via 'lsof' (macOS/Linux). */
function getPortOwner(port: number): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn("lsof", ["-i", `:${port}`]);
    let stdout = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.on("close", () => {
      resolve(stdout.trim() || "No active process owner found");
    });
    proc.on("error", () => {
      resolve("Unknown (lsof error)");
    });
  });
}

server.registerTool(
  "check_ports",
  {
    title: "Check Local Ports",
    description: "Checks whether specific TCP ports (e.g. 3000, 8080, 8787) are active and listening on localhost, and attempts to find which process PIDs own them.",
    inputSchema: {
      ports: z.array(z.number().int().positive()).describe("List of port numbers to check"),
    },
  },
  async ({ ports }) => {
    const results = [];
    for (const port of ports) {
      const active = await checkPort(port);
      const owner = active ? await getPortOwner(port) : "N/A";
      results.push({ port, active, owner });
    }
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

server.registerTool(
  "query_server_status",
  {
    title: "Query Local Server Status",
    description: "Pings a local HTTP/HTTPS url (e.g. http://localhost:3000) and returns HTTP response codes, headers, and a preview of the response body. Useful for checking if local dev servers started correctly.",
    inputSchema: {
      url: z.string().url().describe("HTTP/HTTPS URL of the local server to query"),
      method: z.enum(["GET", "POST", "HEAD"]).optional().default("GET"),
      timeout: z.number().int().positive().optional().default(5000),
    },
  },
  async ({ url, method = "GET", timeout = 5000 }) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, { method, signal: controller.signal });
      const text = await res.text();
      clearTimeout(id);

      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: res.status,
              statusText: res.statusText,
              headers,
              bodyPreview: text.slice(0, 1000) + (text.length > 1000 ? "..." : ""),
            }, null, 2),
          },
        ],
      };
    } catch (err) {
      clearTimeout(id);
      return {
        content: [{ type: "text", text: `Error querying ${url}: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "run_playwright_tests",
  {
    title: "Run Playwright E2E Tests",
    description: "Executes Playwright E2E test commands inside the workspace (e.g. 'npx playwright test' or a specific test file) and returns the standard output/errors. Safety checks block destructive commands.",
    inputSchema: {
      command: z.string().describe("Playwright test command to execute, e.g. 'npx playwright test' or 'npm run test:e2e'"),
      cwd: z.string().optional().describe("Subdirectory inside the workspace (defaults to repo root)"),
    },
  },
  async ({ command, cwd }) => {
    if (BLOCKED_PATTERNS.some((re) => re.test(command))) {
      return {
        content: [{ type: "text", text: "Command blocked by Lakoora safety policy." }],
        isError: true,
      };
    }

    const workDir = cwd ? path.resolve(REPO_ROOT, cwd) : REPO_ROOT;
    
    return new Promise((resolve) => {
      const proc = spawn("/bin/sh", ["-c", command], { cwd: workDir });
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (d) => { stdout += d.toString(); });
      proc.stderr.on("data", (d) => { stderr += d.toString(); });

      proc.on("close", (code) => {
        const payload = {
          stdout: stdout.slice(0, 5000),
          stderr: stderr.slice(0, 2000),
          exitCode: code ?? 1,
        };
        resolve({
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          isError: code !== 0,
        });
      });

      proc.on("error", (err) => {
        resolve({
          content: [{ type: "text", text: `Failed to spawn process: ${err.message}` }],
          isError: true,
        });
      });
    });
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("local-devops-server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in local-devops-server:", error);
  process.exit(1);
});
