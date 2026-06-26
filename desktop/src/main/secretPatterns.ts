/**
 * Single source of truth for secret-shaped string detection, shared by:
 *   - autonomousAgent.ts's detectSecret() — refuses to apply a file edit
 *     containing a secret, before it ever touches disk.
 *   - sandboxScanner.ts — pre-commit scan of files changed in a shadow
 *     workspace.
 *   - redactSecrets() below — scrubs secrets out of agent output text
 *     (chat responses, RUN command stdout/stderr) before it's broadcast to
 *     the event log, the Electron UI, or a remote SSE viewer. This is a
 *     different failure mode from the two above: an agent can echo a secret
 *     it *read* (e.g. `cat .env`) without ever writing it to a file, so
 *     file-edit and pre-commit scanning never see it.
 *
 * Previously duplicated verbatim between autonomousAgent.ts and
 * sandboxScanner.ts — consolidated here so the pattern list only needs
 * updating in one place.
 */

export const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub PAT', re: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'PEM private key', re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  { name: 'generic API secret', re: /(?:api[_-]?key|api[_-]?secret|password|access[_-]?token)\s*[:=]\s*['"][A-Za-z0-9+/]{24,}['"]/i },
]

/** Returns the name of the first matching secret pattern, or null if content has none. */
export function detectSecret(content: string): string | null {
  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(content)) return name
  }
  return null
}

/** A global-matching clone of `re` for use with String.replace(), which needs the 'g' flag to replace every occurrence rather than just the first. */
function asGlobal(re: RegExp): RegExp {
  return re.global ? re : new RegExp(re.source, `${re.flags}g`)
}

/**
 * Replaces every secret-shaped substring in `text` with a `[REDACTED:<pattern
 * name>]` placeholder. Pure string transform — never throws, returns `text`
 * unchanged if nothing matches. Intended for output text an agent didn't
 * author as a file edit (chat responses, command stdout/stderr) right before
 * it's broadcast/logged/displayed, so a secret the agent merely *read* and
 * echoed back never reaches the event log, the UI, or a remote viewer.
 */
export function redactSecrets(text: string): string {
  let result = text
  for (const { name, re } of SECRET_PATTERNS) {
    result = result.replace(asGlobal(re), `[REDACTED:${name}]`)
  }
  return result
}
