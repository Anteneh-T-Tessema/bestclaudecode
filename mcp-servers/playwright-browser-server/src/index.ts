#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { chromium, type Browser, type Page } from "playwright";

const server = new McpServer({
  name: "playwright-browser-server",
  version: "0.1.0",
});

// Maintain a single browser/page instance across tool calls
let browser: Browser | null = null;
let page: Page | null = null;
const consoleLogs: string[] = [];
const MAX_LOGS = 200;

async function getOrCreatePage(): Promise<Page> {
  if (!browser) {
    browser = await chromium.launch({ headless: true });
  }
  if (!page || page.isClosed()) {
    const ctx = await browser.newContext();
    page = await ctx.newPage();
    consoleLogs.length = 0;
    page.on("console", (msg: { type: () => string; text: () => string }) => {
      consoleLogs.push(`[${new Date().toLocaleTimeString()}] [${msg.type()}] ${msg.text()}`);
      if (consoleLogs.length > MAX_LOGS) consoleLogs.shift();
    });
  }
  return page;
}

server.registerTool(
  "browser_navigate",
  {
    title: "Navigate Browser",
    description: "Navigates the headless browser to a URL and returns the page title.",
    inputSchema: {
      url: z.string().url().describe("URL to navigate to"),
    },
  },
  async ({ url }: { url: string }) => {
    try {
      const pg = await getOrCreatePage();
      await pg.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      const title = await pg.title();
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, title }) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: false, error: String(err) }) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "browser_screenshot",
  {
    title: "Take Screenshot",
    description: "Takes a screenshot of the current page and returns it as a base64 PNG data URL.",
    inputSchema: {},
  },
  async () => {
    try {
      if (!page || page.isClosed()) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "No page loaded — navigate first" }) }],
          isError: true,
        };
      }
      const buf = await page.screenshot({ type: "png" });
      const dataUrl = `data:image/png;base64,${buf.toString("base64")}`;
      const vp = page.viewportSize();
      return {
        content: [{ type: "text", text: JSON.stringify({ dataUrl, width: vp?.width ?? 1280, height: vp?.height ?? 800 }) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: String(err) }) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "browser_get_console_logs",
  {
    title: "Get Console Logs",
    description: "Returns the browser console log messages captured since the last navigate.",
    inputSchema: {},
  },
  async () => {
    return {
      content: [{ type: "text", text: JSON.stringify({ logs: [...consoleLogs] }) }],
    };
  }
);

server.registerTool(
  "browser_click",
  {
    title: "Click Element",
    description: "Clicks an element matching the given CSS selector.",
    inputSchema: {
      selector: z.string().describe("CSS selector of the element to click"),
    },
  },
  async ({ selector }: { selector: string }) => {
    try {
      if (!page || page.isClosed()) {
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: false, error: "No page loaded — navigate first" }) }],
          isError: true,
        };
      }
      await page.click(selector, { timeout: 10000 });
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: false, error: String(err) }) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "browser_fill",
  {
    title: "Fill Input",
    description: "Fills an input element matching the given CSS selector with the given value.",
    inputSchema: {
      selector: z.string().describe("CSS selector of the input element"),
      value: z.string().describe("Value to fill into the input"),
    },
  },
  async ({ selector, value }: { selector: string; value: string }) => {
    try {
      if (!page || page.isClosed()) {
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: false, error: "No page loaded — navigate first" }) }],
          isError: true,
        };
      }
      await page.fill(selector, value, { timeout: 10000 });
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: false, error: String(err) }) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "browser_get_text",
  {
    title: "Get Page Text",
    description: "Returns the visible text of the page or a specific element if a selector is provided.",
    inputSchema: {
      selector: z.string().optional().describe("Optional CSS selector to narrow down text extraction"),
    },
  },
  async ({ selector }: { selector?: string }) => {
    try {
      if (!page || page.isClosed()) {
        return {
          content: [{ type: "text", text: JSON.stringify({ text: "" }) }],
          isError: true,
        };
      }
      let text: string;
      if (selector) {
        text = await page.locator(selector).first().innerText({ timeout: 10000 });
      } else {
        text = await page.evaluate(() => document.body.innerText);
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ text }) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: JSON.stringify({ text: "", error: String(err) }) }],
        isError: true,
      };
    }
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("playwright-browser-server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in playwright-browser-server:", error);
  process.exit(1);
});
