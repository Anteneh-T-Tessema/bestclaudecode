/**
 * Static, dependency-free HTML+JS page for remote viewers of a shared agent
 * session — served by webhookServer.ts at GET /watch. Deliberately not the
 * Electron renderer bundle: a teammate just needs to see live events, leave
 * a comment, click Approve/Reject, or (with no session yet) start a new
 * agent session from a phone browser — not run the whole IDE in a browser.
 */

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
}

/**
 * Renders the launcher form shown when no `session` query param is given —
 * remote/mobile dispatch: a single bookmarked /watch?token=... URL becomes a
 * "start a new agent session" page, reusing the same createSessionFromGoal()
 * path the Slack slash command already goes through.
 */
function renderLauncherPage(token: string): string {
  const safeToken = escapeHtml(token)
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Meshflow — Start a session</title>
<style>
  body { background: #0c0c10; color: #d8d8de; font-family: -apple-system, sans-serif; margin: 0; padding: 16px; }
  h1 { font-size: 14px; font-weight: 700; margin: 0 0 12px; }
  textarea { width: 100%; box-sizing: border-box; background: #15151a; border: 1px solid #333; border-radius: 6px; color: #eee; font-size: 13px; padding: 10px; margin-bottom: 10px; }
  button { font-size: 13px; font-weight: 700; padding: 8px 16px; border-radius: 4px; border: none; cursor: pointer; }
  .start { background: #1f5a2f; color: #aef0bb; }
  #status { font-size: 12px; color: #f0aeae; margin-top: 10px; }
</style>
</head>
<body>
  <h1>Meshflow — start a new agent session</h1>
  <textarea id="goal" rows="3" placeholder="Describe what you want the agent to do…"></textarea>
  <button class="start" onclick="start()">Start Agent</button>
  <div id="status"></div>

<script>
  const token = ${JSON.stringify(safeToken)}
  async function start() {
    const goal = document.getElementById('goal').value.trim()
    const statusEl = document.getElementById('status')
    if (!goal) return
    statusEl.textContent = 'Starting…'
    try {
      const res = await fetch('/session/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, token }),
      })
      const data = await res.json()
      if (data.sessionId) {
        location.href = '/watch?session=' + data.sessionId + '&token=' + encodeURIComponent(token)
      } else {
        statusEl.textContent = data.error || 'Failed to start session'
      }
    } catch (e) {
      statusEl.textContent = 'Request failed: ' + e
    }
  }
</script>
</body>
</html>`
}

export function renderWatchPage(sessionId: string | null, token: string): string {
  if (!sessionId) return renderLauncherPage(token)

  const safeSessionId = escapeHtml(sessionId)
  const safeToken = escapeHtml(token)
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Meshflow — Session ${safeSessionId.slice(0, 8)}</title>
<style>
  body { background: #0c0c10; color: #d8d8de; font-family: -apple-system, sans-serif; margin: 0; padding: 16px; }
  h1 { font-size: 14px; font-weight: 700; margin: 0 0 12px; }
  #events { background: #15151a; border-radius: 6px; padding: 10px; height: 50vh; overflow-y: auto; font-family: monospace; font-size: 12px; line-height: 1.6; }
  .ev { margin-bottom: 4px; }
  .ev .status { color: #8b8bf5; font-weight: 700; margin-right: 6px; }
  .ev.comment .status { color: #f0c674; }
  .ev.comment .from { color: #6fb8e8; font-weight: 700; margin-right: 4px; }
  .approval { background: #1f1a10; border: 1px solid #5a4a1f; border-radius: 6px; padding: 12px; margin-top: 12px; display: none; }
  .approval.visible { display: block; }
  button { font-size: 12px; font-weight: 700; padding: 6px 14px; border-radius: 4px; border: none; cursor: pointer; margin-right: 8px; }
  .approve { background: #1f5a2f; color: #aef0bb; }
  .reject { background: #5a1f1f; color: #f0aeae; }
  .send { background: #2a3a5a; color: #aecbf0; }
  #name { font-size: 11px; padding: 4px 6px; border-radius: 4px; border: 1px solid #333; background: #1a1a1f; color: #eee; margin-bottom: 8px; width: 240px; }
  #commentRow { display: flex; gap: 6px; margin-top: 10px; }
  #commentInput { flex: 1; font-size: 12px; padding: 6px 8px; border-radius: 4px; border: 1px solid #333; background: #1a1a1f; color: #eee; }
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
  <div id="commentRow">
    <input id="commentInput" placeholder="Leave a comment…" onkeydown="if(event.key==='Enter') sendComment()" />
    <button class="send" onclick="sendComment()">Send</button>
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
    div.className = 'ev' + (ev.status === 'comment' ? ' comment' : '')
    const status = document.createElement('span')
    status.className = 'status'
    status.textContent = '[' + (ev.status === 'comment' ? 'comment' : (ev.status || '')) + ']'
    div.appendChild(status)
    if (ev.status === 'comment' && ev.viewerName) {
      const from = document.createElement('span')
      from.className = 'from'
      from.textContent = ev.viewerName + ':'
      div.appendChild(from)
    }
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

  async function sendComment() {
    const input = document.getElementById('commentInput')
    const text = input.value.trim()
    if (!text) return
    input.value = ''
    await fetch('/session/' + sessionId + '/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, token, from: nameInput.value || 'remote-viewer' }),
    })
  }

  const streamName = encodeURIComponent(nameInput.value || 'remote-viewer')
  const stream = new EventSource('/watch-stream?session=' + sessionId + '&token=' + encodeURIComponent(token) + '&name=' + streamName)
  stream.onmessage = (e) => {
    try { appendEvent(JSON.parse(e.data)) } catch { /* ignore malformed event */ }
  }
</script>
</body>
</html>`
}
