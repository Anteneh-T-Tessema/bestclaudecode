/**
 * Static, dependency-free HTML+JS page for remote viewers of a shared agent
 * session — served by webhookServer.ts at GET /watch. Deliberately not the
 * Electron renderer bundle: a teammate just needs to see live events and
 * click Approve/Reject, not run the whole IDE in a browser.
 */

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
}

export function renderWatchPage(sessionId: string, token: string): string {
  const safeSessionId = escapeHtml(sessionId)
  const safeToken = escapeHtml(token)
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Meshflow — Session ${safeSessionId.slice(0, 8)}</title>
<style>
  body { background: #0c0c10; color: #d8d8de; font-family: -apple-system, sans-serif; margin: 0; padding: 16px; }
  h1 { font-size: 14px; font-weight: 700; margin: 0 0 12px; }
  #events { background: #15151a; border-radius: 6px; padding: 10px; height: 60vh; overflow-y: auto; font-family: monospace; font-size: 12px; line-height: 1.6; }
  .ev { margin-bottom: 4px; }
  .ev .status { color: #8b8bf5; font-weight: 700; margin-right: 6px; }
  .approval { background: #1f1a10; border: 1px solid #5a4a1f; border-radius: 6px; padding: 12px; margin-top: 12px; display: none; }
  .approval.visible { display: block; }
  button { font-size: 12px; font-weight: 700; padding: 6px 14px; border-radius: 4px; border: none; cursor: pointer; margin-right: 8px; }
  .approve { background: #1f5a2f; color: #aef0bb; }
  .reject { background: #5a1f1f; color: #f0aeae; }
  #name { font-size: 11px; padding: 4px 6px; border-radius: 4px; border: 1px solid #333; background: #1a1a1f; color: #eee; margin-bottom: 8px; width: 240px; }
</style>
</head>
<body>
  <h1>Meshflow session ${safeSessionId.slice(0, 8)} — live view</h1>
  <input id="name" placeholder="Your name (for the audit log)" />
  <div id="events"></div>
  <div id="approvalBox" class="approval">
    <div id="approvalText" style="margin-bottom:8px;"></div>
    <button class="approve" onclick="respond(true)">Approve</button>
    <button class="reject" onclick="respond(false)">Reject</button>
  </div>

<script>
  const sessionId = ${JSON.stringify(safeSessionId)}
  const token = ${JSON.stringify(safeToken)}
  const eventsEl = document.getElementById('events')
  const approvalBox = document.getElementById('approvalBox')
  const approvalText = document.getElementById('approvalText')
  const nameInput = document.getElementById('name')
  nameInput.value = sessionStorage.getItem('meshflow-collab-name') || ''
  nameInput.addEventListener('change', () => sessionStorage.setItem('meshflow-collab-name', nameInput.value))

  function appendEvent(ev) {
    const div = document.createElement('div')
    div.className = 'ev'
    const status = document.createElement('span')
    status.className = 'status'
    status.textContent = '[' + (ev.status || '') + ']'
    div.appendChild(status)
    div.appendChild(document.createTextNode(ev.subtaskDescription || ev.error || ''))
    eventsEl.appendChild(div)
    eventsEl.scrollTop = eventsEl.scrollHeight
    if (ev.status === 'pending-approval') {
      approvalText.textContent = ev.error || 'Approval required'
      approvalBox.classList.add('visible')
    } else if (ev.status === 'approval-rejected' || ev.status === 'running') {
      approvalBox.classList.remove('visible')
    }
  }

  async function respond(approved) {
    approvalBox.classList.remove('visible')
    await fetch('/session/' + sessionId + '/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, token, approver: nameInput.value || 'remote-viewer' }),
    })
  }

  const stream = new EventSource('/watch-stream?session=' + sessionId + '&token=' + encodeURIComponent(token))
  stream.onmessage = (e) => {
    try { appendEvent(JSON.parse(e.data)) } catch { /* ignore malformed event */ }
  }
</script>
</body>
</html>`
}
