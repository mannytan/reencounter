const express = require('express');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const app = express();
const PORT = 3030;
const WORKSPACE = path.resolve(__dirname, '..');
const CLAUDE_BIN = '/Users/mannytan/.nvm/versions/node/v20.20.2/bin/claude';

app.use(express.json());

// --- SSE clients for dashboard ---
const dashboardClients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of dashboardClients) client.write(msg);
}

// --- Dashboard ---
app.get('/dashboard', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Encounter Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #013220; --surface: #111; --border: #222;
      --accent: #4f8ef7; --text: #e8e8e8; --muted: #555;
      --prompt-color: #4f8ef7; --response-color: #ccc;
      --success: #4caf50;
    }
    html, body { height: 100%; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    body { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

    header {
      padding: 14px 20px; border-bottom: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
    }
    header h1 { font-size: 14px; font-weight: 600; color: var(--accent); letter-spacing: 0.08em; }
    #status-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--muted); transition: background 0.3s;
    }
    #status-dot.running { background: var(--accent); box-shadow: 0 0 6px var(--accent); }
    #status-dot.done    { background: var(--success); }

    #log {
      flex: 1; overflow-y: auto; padding: 20px;
      display: flex; flex-direction: column; gap: 20px;
    }

    .entry { display: flex; flex-direction: column; gap: 10px; }
    .entry-meta { font-size: 11px; color: var(--muted); }

    .bubble {
      padding: 12px 16px; border-radius: 12px;
      font-size: 13px; line-height: 1.6; max-width: 100%;
    }
    .prompt-bubble {
      background: #0d1f3c; border: 1px solid #1a3a70;
      color: var(--prompt-color); font-weight: 500;
      border-radius: 12px 12px 12px 2px;
    }
    .response-bubble {
      background: var(--surface); border: 1px solid var(--border);
      color: var(--response-color);
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 12px; white-space: pre-wrap; word-break: break-word;
      border-radius: 12px 12px 2px 12px;
    }
    .response-bubble.streaming { border-color: var(--accent); }

    .empty { color: var(--muted); font-size: 13px; text-align: center; margin: auto; }
  </style>
</head>
<body>
  <header>
    <h1>⬡ ENCOUNTER DASHBOARD</h1>
    <div id="status-dot"></div>
  </header>
  <div id="log">
    <div class="empty" id="empty">Waiting for prompts from phone…</div>
  </div>

  <script>
    const log = document.getElementById('log');
    const empty = document.getElementById('empty');
    const dot = document.getElementById('status-dot');
    let currentResponse = null;

    const es = new EventSource('/events');

    es.addEventListener('prompt', e => {
      const { text, time } = JSON.parse(e.data);
      if (empty) empty.remove();
      dot.className = 'running';

      const entry = document.createElement('div');
      entry.className = 'entry';
      entry.innerHTML = \`
        <div class="entry-meta">\${time}</div>
        <div class="bubble prompt-bubble">\${escapeHtml(text)}</div>
      \`;

      currentResponse = document.createElement('div');
      currentResponse.className = 'bubble response-bubble streaming';
      entry.appendChild(currentResponse);
      log.appendChild(entry);
      log.scrollTop = log.scrollHeight;
    });

    es.addEventListener('chunk', e => {
      const { text } = JSON.parse(e.data);
      if (currentResponse) {
        currentResponse.textContent += text;
        log.scrollTop = log.scrollHeight;
      }
    });

    es.addEventListener('done', e => {
      dot.className = 'done';
      if (currentResponse) {
        currentResponse.classList.remove('streaming');
        currentResponse = null;
      }
      setTimeout(() => dot.className = '', 2000);
    });

    function escapeHtml(str) {
      return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
  </script>
</body>
</html>`);
});

// --- SSE endpoint ---
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  dashboardClients.add(res);
  req.on('close', () => dashboardClients.delete(res));
});

// --- Mobile UI ---
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
  <title>Encounter Remote</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #013220; --surface: #141414; --border: #2a2a2a;
      --accent: #4f8ef7; --text: #e8e8e8; --muted: #666;
      --success: #4caf50; --error: #f44336;
    }
    html, body { height: 100%; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    body { display: flex; flex-direction: column; padding: 16px; gap: 12px; }
    h1 { font-size: 16px; font-weight: 600; color: var(--accent); letter-spacing: 0.05em; }
    .subtitle { font-size: 12px; color: var(--muted); }
    textarea {
      width: 100%; min-height: 120px; padding: 12px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 10px; color: var(--text); font-size: 15px;
      resize: vertical; outline: none;
    }
    textarea:focus { border-color: var(--accent); }
    button {
      width: 100%; padding: 14px; border-radius: 10px; border: none;
      background: var(--accent); color: #fff; font-size: 16px;
      font-weight: 600; cursor: pointer; transition: opacity 0.15s;
    }
    button:active { opacity: 0.75; }
    button:disabled { opacity: 0.4; cursor: not-allowed; }
    #status { font-size: 12px; color: var(--muted); text-align: center; min-height: 16px; }
    #status.running { color: var(--accent); }
    #status.done    { color: var(--success); }
    #status.error   { color: var(--error); }
    #output {
      flex: 1; overflow-y: auto; padding: 12px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 10px; font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 12px; line-height: 1.6; white-space: pre-wrap;
      word-break: break-word; color: #ccc; min-height: 160px;
    }
    .prompt-echo { color: var(--accent); margin-bottom: 8px; }
    .divider { border-top: 1px solid var(--border); margin: 8px 0; }
  </style>
</head>
<body>
  <div>
    <h1>⬡ Encounter Remote</h1>
    <div class="subtitle">workspace: encounter/</div>
  </div>
  <textarea id="prompt" placeholder="Describe what you want to change…" autofocus></textarea>
  <button id="run-btn" onclick="runPrompt()">Run</button>
  <div id="status"></div>
  <div id="output">Output will appear here.</div>
  <script>
    const promptEl = document.getElementById('prompt');
    const btn = document.getElementById('run-btn');
    const status = document.getElementById('status');
    const output = document.getElementById('output');

    promptEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runPrompt();
    });

    async function runPrompt() {
      const text = promptEl.value.trim();
      if (!text) return;
      btn.disabled = true;
      status.textContent = 'Running…';
      status.className = 'running';
      output.textContent = '';

      const echo = document.createElement('div');
      echo.className = 'prompt-echo';
      echo.textContent = '> ' + text;
      output.appendChild(echo);
      output.appendChild(Object.assign(document.createElement('div'), { className: 'divider' }));

      const content = document.createElement('span');
      output.appendChild(content);

      try {
        const res = await fetch('/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: text })
        });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          content.textContent += decoder.decode(value, { stream: true });
          output.scrollTop = output.scrollHeight;
        }
        status.textContent = 'Done.';
        status.className = 'done';
      } catch (err) {
        content.textContent += '\\n[Error: ' + err.message + ']';
        status.textContent = 'Error';
        status.className = 'error';
      }
      btn.disabled = false;
    }
  </script>
</body>
</html>`);
});

// --- Run claude CLI ---
app.post('/run', (req, res) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt required' });
  }

  const time = new Date().toLocaleTimeString();
  console.log(`\n[${time}] Phone prompt:\n  ${prompt}\n`);
  broadcast('prompt', { text: prompt, time });

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');

  const proc = spawn(CLAUDE_BIN, [
    '--print',
    '--allowedTools', 'Bash,Read,Write,Edit,Glob,Grep',
    '--dangerously-skip-permissions',
    prompt
  ], {
    cwd: WORKSPACE,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  proc.stdout.on('data', chunk => {
    res.write(chunk);
    broadcast('chunk', { text: chunk.toString() });
  });

  proc.stderr.on('data', chunk => {
    res.write(chunk);
  });

  proc.on('close', (code) => {
    if (code !== 0) res.write(`\n[Process exited with code ${code}]`);
    broadcast('done', {});
    res.end();
  });

  proc.on('error', (err) => {
    res.write(`\n[Failed to start claude: ${err.message}]`);
    broadcast('done', {});
    res.end();
  });
});

// --- Start ---
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`\n  Encounter Remote running\n`);
  console.log(`  Phone:     http://${ip}:${PORT}`);
  console.log(`  Dashboard: http://localhost:${PORT}/dashboard\n`);
  console.log(`  Workspace: ${WORKSPACE}\n`);
});
