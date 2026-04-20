let socket;

const progress = {
  unary: false,
  server: false,
  client: false,
  bidi: false,
  compare: false,
};

const streamState = {
  server: [],
  bidi: [],
  charts: {
    unary: [],
    server: [],
    client: [],
    bidi: [],
  },
};

function scrollToSection(id) {
  document.getElementById(id).scrollIntoView({ behavior: 'smooth' });
}

function getPayload() {
  return {
    name: document.getElementById('studentName').value || 'Alex',
    text: document.getElementById('payloadText').value || 'Show how gRPC works without pain',
    count: 3,
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderProgress() {
  const root = document.getElementById('interactiveProgress');
  const labels = [
    ['unary', 'Unary'],
    ['server', 'Server stream'],
    ['client', 'Client stream'],
    ['bidi', 'Bidi'],
    ['compare', 'Compare'],
  ];
  root.innerHTML = labels.map(([key, label]) => `
    <div class="progress-pill ${progress[key] ? 'done' : ''}">
      <span class="dot"></span>${label}
    </div>
  `).join('');
}

function markComplete(key) {
  progress[key] = true;
  renderProgress();
  if (Object.values(progress).every(Boolean)) {
    const section = document.getElementById('quizSection');
    if (section.classList.contains('hidden')) {
      section.classList.remove('hidden');
      document.getElementById('unlockToast').classList.remove('hidden');
      setTimeout(() => document.getElementById('unlockToast').classList.add('hidden'), 3200);
      loadQuiz();
      setTimeout(() => scrollToSection('quizSection'), 500);
    }
  }
}

function setVisualState(id, title, subtitle, lanes = [], footer = '') {
  const el = document.getElementById(id);
  el.innerHTML = `
    <div class="flow-head">
      <strong>${title}</strong>
      <span>${subtitle}</span>
    </div>
    <div class="lane-grid">
      ${lanes.map((lane) => `
        <div class="lane-card ${lane.side}">
          <div class="lane-tag">${lane.side === 'client' ? 'Client' : lane.side === 'server' ? 'Server' : 'Notice'}</div>
          <div class="lane-title">${lane.title}</div>
          <div class="lane-text">${lane.text}</div>
        </div>
      `).join('')}
    </div>
    ${footer ? `<div class="flow-footer">${footer}</div>` : ''}
  `;
}

function renderMiniChart(id, points, unitLabel = 'bytes') {
  const root = document.getElementById(id);
  if (!points.length) {
    root.innerHTML = '';
    return;
  }
  const max = Math.max(...points.map((p) => p.value), 1);
  root.innerHTML = `
    <div class="mini-chart-head">Transferred ${unitLabel}</div>
    <div class="mini-chart-bars">
      ${points.map((p) => `
        <div class="bar-wrap">
          <div class="bar" style="height:${Math.max(18, (p.value / max) * 100)}%"></div>
          <span>${p.label}</span>
          <strong>${p.value}</strong>
        </div>
      `).join('')}
    </div>
  `;
}

function renderLineChart(id, grpcPoints, wsPoints) {
  const root = document.getElementById(id);
  if (!grpcPoints.length || !wsPoints.length) {
    root.innerHTML = '';
    return;
  }
  const maxValue = Math.max(...grpcPoints, ...wsPoints, 1);
  const width = 760;
  const height = 260;
  const pad = 34;
  const steps = Math.max(grpcPoints.length, wsPoints.length);

  const toPolyline = (points) => points.map((value, index) => {
    const x = pad + ((width - pad * 2) / (steps - 1 || 1)) * index;
    const y = height - pad - ((height - pad * 2) * value / maxValue);
    return `${x},${y}`;
  }).join(' ');

  const grpcLine = toPolyline(grpcPoints);
  const wsLine = toPolyline(wsPoints);

  root.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="chart-svg" role="img" aria-label="protobuf vs json bytes chart">
      <defs>
        <linearGradient id="grpcLine" x1="0" x2="1">
          <stop offset="0%" stop-color="#38ffe3" />
          <stop offset="100%" stop-color="#8afff3" />
        </linearGradient>
        <linearGradient id="wsLine" x1="0" x2="1">
          <stop offset="0%" stop-color="#9f5dff" />
          <stop offset="100%" stop-color="#ff78cc" />
        </linearGradient>
      </defs>
      <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="axis" />
      <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" class="axis" />
      ${[0.25, 0.5, 0.75, 1].map((tick) => {
        const y = height - pad - ((height - pad * 2) * tick);
        const value = Math.round(maxValue * tick);
        return `<g><line x1="${pad}" y1="${y}" x2="${width - pad}" y2="${y}" class="gridline" /><text x="6" y="${y + 4}" class="tick-label">${value}B</text></g>`;
      }).join('')}
      <polyline points="${grpcLine}" fill="none" stroke="url(#grpcLine)" stroke-width="4" stroke-linecap="round" />
      <polyline points="${wsLine}" fill="none" stroke="url(#wsLine)" stroke-width="4" stroke-linecap="round" />
      ${grpcPoints.map((value, index) => {
        const x = pad + ((width - pad * 2) / (steps - 1 || 1)) * index;
        const y = height - pad - ((height - pad * 2) * value / maxValue);
        return `<circle cx="${x}" cy="${y}" r="5" fill="#38ffe3" />`;
      }).join('')}
      ${wsPoints.map((value, index) => {
        const x = pad + ((width - pad * 2) / (steps - 1 || 1)) * index;
        const y = height - pad - ((height - pad * 2) * value / maxValue);
        return `<circle cx="${x}" cy="${y}" r="5" fill="#ff78cc" />`;
      }).join('')}
      ${Array.from({ length: steps }).map((_, index) => {
        const x = pad + ((width - pad * 2) / (steps - 1 || 1)) * index;
        return `<text x="${x - 8}" y="${height - 10}" class="tick-label">${index + 1}</text>`;
      }).join('')}
    </svg>
    <div class="chart-legend">
      <span><i class="legend-dot grpc"></i>gRPC protobuf</span>
      <span><i class="legend-dot ws"></i>WebSocket JSON</span>
    </div>
  `;
}

async function loadTheory() {
  const res = await fetch('/api/theory');
  const data = await res.json();
  const root = document.getElementById('theoryCards');
  root.innerHTML = data.cards.map((card) => `
    <article class="glass card">
      <div class="badge">base</div>
      <h3>${card.title}</h3>
      <p>${card.text}</p>
    </article>
  `).join('');
}

async function loadProtoExample() {
  const res = await fetch('/api/proto-inspect');
  const data = await res.json();

  document.getElementById('protoCode').textContent = data.proto;
  document.getElementById('architectureDiagram').innerHTML = `
    <div class="arch-box client-box">
      <span>Browser UI</span>
      <strong>Student clicks demo buttons</strong>
      <small>HTML + JS visual layer</small>
    </div>
    <div class="arch-arrow">HTTP / WebSocket</div>
    <div class="arch-box middle-box">
      <span>Demo backend</span>
      <strong>Node.js server</strong>
      <small>Runs REST, WebSocket, and gRPC demo logic</small>
    </div>
    <div class="arch-arrow">HTTP/2 + protobuf</div>
    <div class="arch-box server-box">
      <span>gRPC service</span>
      <strong>Unary / Stream / Bidi</strong>
      <small>Uses the .proto contract shown on the left</small>
    </div>
  `;

  document.getElementById('hexRibbon').innerHTML = data.hex.map((chunk) => `
    <div class="hex-chip">
      <span>${chunk.hex}</span>
      <small>${chunk.meaning}</small>
    </div>
  `).join('');

  document.getElementById('protoSummary').innerHTML = `
    <div><span>Demo message</span><strong>${escapeHtml(data.sample.name)}</strong></div>
    <div><span>Text payload</span><strong>${escapeHtml(data.sample.text)}</strong></div>
    <div><span>protobuf bytes</span><strong>${data.protobufBytes} B</strong></div>
    <div><span>json bytes</span><strong>${data.jsonBytes} B</strong></div>
  `;

  document.getElementById('byteBreakdown').innerHTML = `
    <div class="byte-row header">
      <div>Bytes</div><div>Field</div><div>Meaning</div>
    </div>
    ${data.breakdown.map((row) => `
      <div class="byte-row">
        <div>${row.hex}</div>
        <div>${row.field}</div>
        <div>${row.explanation}</div>
      </div>
    `).join('')}
  `;
}

async function loadQuiz() {
  const res = await fetch('/api/quiz');
  const data = await res.json();
  const root = document.getElementById('quizQuestions');
  root.innerHTML = data.questions.map((item) => `
    <div class="quiz-item">
      <label><strong>${item.id}. ${item.question}</strong></label>
      <input id="quiz-${item.id}" placeholder="Type your answer" />
    </div>
  `).join('');
}

function connectSocket() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.channel === 'server-stream') {
      streamState.server.push(data.item.message);
      streamState.charts.server.push({ label: `${streamState.server.length}`, value: data.item.bytes });
      setVisualState(
        'serverStreamOutput',
        'Server streaming explained',
        'One client request, then the server keeps pushing updates through the same HTTP/2 connection.',
        [
          { side: 'client', title: 'Client action', text: `Sent one request with message: “${getPayload().text}”.` },
          { side: 'server', title: `Server update ${streamState.server.length}`, text: data.item.message },
          { side: 'notice', title: 'What to notice', text: 'The client did not reconnect. The server kept sending the next response in the same stream.' },
        ],
        'Typical fit: logs, progress updates, event feeds, partial results.'
      );
      renderMiniChart('serverChart', streamState.charts.server);
      return;
    }

    if (data.channel === 'server-stream-end') {
      markComplete('server');
      return;
    }

    if (data.channel === 'client-stream-result') {
      const points = data.meta?.chunks?.map((value, index) => ({ label: `${index + 1}`, value })) || [];
      streamState.charts.client = points;
      renderMiniChart('clientChart', points);
      setVisualState(
        'clientStreamOutput',
        'Client streaming explained',
        'The client sent several chunks first, then the server answered once after aggregation.',
        [
          { side: 'client', title: 'Client action', text: 'Sent three chunks as one stream: the server waited and collected them.' },
          { side: 'server', title: 'Server result', text: data.item.message },
          { side: 'notice', title: 'What to notice', text: 'This is useful when many small pieces should become one final answer.' },
        ],
        'Typical fit: batch upload, telemetry, collecting data packets, chunked file handling.'
      );
      markComplete('client');
      return;
    }

    if (data.channel === 'client-stream-error') {
      document.getElementById('clientStreamOutput').textContent = `Error: ${data.error}`;
      return;
    }

    if (data.channel === 'bidi') {
      streamState.bidi.push(data.item.message);
      streamState.charts.bidi.push({ label: `${streamState.bidi.length}`, value: data.item.bytes });
      renderMiniChart('bidiChart', streamState.charts.bidi);
      setVisualState(
        'bidiOutput',
        'Bidirectional streaming explained',
        'Client and server exchange messages in parallel without waiting for the whole session to finish.',
        [
          { side: 'client', title: `Client message ${streamState.bidi.length}`, text: `Sent chunk ${streamState.bidi.length} into the duplex stream.` },
          { side: 'server', title: `Server reply ${streamState.bidi.length}`, text: data.item.message },
          { side: 'notice', title: 'What to notice', text: 'Both sides stay active at once. This is the closest gRPC pattern to true realtime dialogue.' },
        ],
        'Typical fit: collaborative sessions, gaming state, assistants, live event processing.'
      );
      return;
    }

    if (data.channel === 'bidi-end') {
      markComplete('bidi');
      return;
    }

    if (data.channel === 'ws-demo') {
      const el = document.getElementById('wsOutput');
      el.innerHTML += `\n• ${data.item.message}`;
    }
  };
}

async function runUnary() {
  const payload = getPayload();
  const res = await fetch('/api/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  streamState.charts.unary = [
    { label: 'request', value: data.compactness.protobufBytes },
    { label: 'response', value: data.grpc.bytes },
  ];
  renderMiniChart('unaryChart', streamState.charts.unary);
  setVisualState(
    'unaryOutput',
    'Unary explained',
    'The easiest gRPC pattern: one request in, one response out.',
    [
      { side: 'client', title: 'Client action', text: `Sent exactly one structured request: “${payload.text}”.` },
      { side: 'server', title: 'Server action', text: 'Processed the request and returned one complete answer immediately.' },
      { side: 'notice', title: 'What to notice', text: `Transport = ${data.grpc.transport}, contract = ${data.grpc.contract}, request size = ${data.compactness.protobufBytes} bytes.` },
    ],
    'Typical fit: validate, fetch, create, acknowledge, or trigger one business operation.'
  );
  markComplete('unary');
}

function runServerStream() {
  streamState.server = [];
  streamState.charts.server = [];
  renderMiniChart('serverChart', []);
  setVisualState(
    'serverStreamOutput',
    'Server streaming starting',
    'The server is about to open one stream and send several responses in sequence.',
    [
      { side: 'client', title: 'Client action', text: 'A single request has been sent to start the stream.' },
      { side: 'server', title: 'Server action', text: 'Preparing multiple responses under the same connection.' },
      { side: 'notice', title: 'What to notice', text: 'No new handshake for every next message.' },
    ]
  );
  socket.send(JSON.stringify({ type: 'grpc-server-stream', ...getPayload() }));
}

function runClientStream() {
  streamState.charts.client = [];
  renderMiniChart('clientChart', []);
  setVisualState(
    'clientStreamOutput',
    'Client streaming starting',
    'The client is about to send multiple chunks before the server answers once.',
    [
      { side: 'client', title: 'Client action', text: 'Preparing three chunks for one outgoing stream.' },
      { side: 'server', title: 'Server action', text: 'Will wait until the stream finishes, then build one final result.' },
      { side: 'notice', title: 'What to notice', text: 'Many incoming messages can still lead to one clean response.' },
    ]
  );
  socket.send(JSON.stringify({ type: 'grpc-client-stream', ...getPayload() }));
}

function runBidi() {
  streamState.bidi = [];
  streamState.charts.bidi = [];
  renderMiniChart('bidiChart', []);
  setVisualState(
    'bidiOutput',
    'Bidirectional streaming starting',
    'The duplex channel is opening, so both sides can speak without waiting for the other side to finish.',
    [
      { side: 'client', title: 'Client action', text: 'Opening a duplex stream and sending the first chunk.' },
      { side: 'server', title: 'Server action', text: 'Ready to answer each chunk as it arrives.' },
      { side: 'notice', title: 'What to notice', text: 'This is not request-then-response. It is ongoing dialogue.' },
    ]
  );
  socket.send(JSON.stringify({ type: 'grpc-bidi', ...getPayload() }));
}

async function runCompare() {
  const box = document.getElementById('compareTable');
  const insight = document.getElementById('compareInsight');
  const grpcPayloadView = document.getElementById('grpcPayloadView');
  const jsonPayloadView = document.getElementById('jsonPayloadView');
  const res = await fetch('/api/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(getPayload()),
  });
  const data = await res.json();

  box.classList.remove('compare-placeholder');
  box.innerHTML = `
    <div class="compare-row header">
      <div>Compare</div><div>gRPC</div><div>REST</div><div>WebSocket</div>
    </div>
    <div class="compare-row">
      <div>Transport</div><div>${data.grpc.transport}</div><div>${data.rest.transport}</div><div>${data.websocket.transport}</div>
    </div>
    <div class="compare-row">
      <div>Contract</div><div>${data.grpc.contract}</div><div>${data.rest.contract}</div><div>${data.websocket.contract}</div>
    </div>
    <div class="compare-row">
      <div>Communication style</div><div>Unary + streams</div><div>Request / response</div><div>Realtime channel</div>
    </div>
    <div class="compare-row">
      <div>Payload size in this demo</div><div>${data.compactness.protobufBytes} B</div><div>${data.compactness.jsonBytes} B</div><div>${data.websocket.bytes} B</div>
    </div>
    <div class="compare-row">
      <div>Best fit</div><div>Microservices, strict contracts, efficiency</div><div>Public APIs, CRUD, simple integrations</div><div>Chats, live state, realtime updates</div>
    </div>
  `;

  grpcPayloadView.textContent = data.protobufHex.join(' ');
  jsonPayloadView.textContent = JSON.stringify(data.jsonPayload, null, 2);

  insight.innerHTML = `Protocol Buffers reduced this payload by <strong>${data.compactness.savedPercent}%</strong> compared with JSON. That is why gRPC is attractive for service-to-service traffic and repeated streaming exchanges.`;
  renderLineChart('compareChart', data.streamChart.grpc, data.streamChart.websocket);
  markComplete('compare');
}

function runWsDemo() {
  const out = document.getElementById('wsOutput');
  out.textContent = 'WebSocket realtime demo:';
  socket.send(JSON.stringify({ type: 'ws-demo', ...getPayload() }));
}

async function checkQuiz() {
  const answers = [1, 2, 3, 4].map((n) => document.getElementById(`quiz-${n}`).value);
  const res = await fetch('/api/quiz/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  });
  const data = await res.json();
  document.getElementById('quizResult').innerHTML = [
    data.message,
    ...data.results.map((item) => `Question ${item.id}: ${item.correct ? 'correct' : `wrong, expected: ${item.expected}`}`),
  ].join('<br>');
}

renderProgress();
loadTheory();
loadProtoExample();
connectSocket();
