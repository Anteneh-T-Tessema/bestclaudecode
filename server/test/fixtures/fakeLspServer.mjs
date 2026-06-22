#!/usr/bin/env node
// Minimal fake LSP server for testing JsonRpcProcessClient's
// Content-Length framing and request/notification handling without needing
// a real language server binary installed.
let buffer = ''

function send(msg) {
  const json = JSON.stringify(msg)
  const header = `Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n`
  process.stdout.write(header + json)
}

function handle(msg) {
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } })
  } else if (msg.method === 'textDocument/hover') {
    send({ jsonrpc: '2.0', id: msg.id, result: { contents: 'fake hover text' } })
  } else if (msg.method === 'textDocument/didOpen') {
    const uri = msg.params.textDocument.uri
    send({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri,
        diagnostics: [{
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          message: 'fake diagnostic',
          severity: 1,
        }],
      },
    })
  }
}

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf-8')
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) return
    const header = buffer.slice(0, headerEnd)
    const match = header.match(/Content-Length: (\d+)/i)
    if (!match) { buffer = ''; return }
    const length = parseInt(match[1], 10)
    const bodyStart = headerEnd + 4
    if (buffer.length < bodyStart + length) return
    const body = buffer.slice(bodyStart, bodyStart + length)
    buffer = buffer.slice(bodyStart + length)
    try {
      handle(JSON.parse(body))
    } catch {
      // malformed frame — drop it
    }
  }
})
