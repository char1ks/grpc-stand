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
    name: document.getElementById('studentName').value || 'Алексей',
    text: document.getElementById('payloadText').value || 'Покажи, как работает gRPC без боли',
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
    ['unary', 'Unary пройден'],
    ['server', 'Server streaming пройден'],
    ['client', 'Client streaming пройден'],
    ['bidi', 'Bidi пройден'],
    ['compare', 'Сравнение пройдено'],
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
  el.classList.remove('placeholder-box');
  el.innerHTML = `
    <div class="flow-head">
      <strong>${title}</strong>
      <span>${subtitle}</span>
    </div>
    <div class="lane-grid">
      ${lanes.map((lane) => `
        <div class="lane-card ${lane.side}">
          <div class="lane-head">
            <div class="lane-tag">${lane.side === 'client' ? 'Клиент' : lane.side === 'server' ? 'Сервер' : 'Что важно заметить'}</div>
            <div class="lane-title">${lane.title}</div>
          </div>
          <div class="lane-text">${lane.text}</div>
        </div>
      `).join('')}
    </div>
    ${footer ? `<div class="flow-footer">${footer}</div>` : ''}
  `;
}

function renderMiniChart(id, points, unitLabel = 'байт') {
  const root = document.getElementById(id);
  if (!points.length) {
    root.innerHTML = '';
    return;
  }
  const max = Math.max(...points.map((p) => p.value), 1);
  root.innerHTML = `
    <div class="mini-chart-head">Сколько данных прошло на этом шаге, ${unitLabel}</div>
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
    <svg viewBox="0 0 ${width} ${height}" class="chart-svg" role="img" aria-label="график байт protobuf и json">
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
        return `<g><line x1="${pad}" y1="${y}" x2="${width - pad}" y2="${y}" class="gridline" /><text x="6" y="${y + 4}" class="tick-label">${value} Б</text></g>`;
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
      <div class="badge">база</div>
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
    <div class="scheme-wrap">
      <div class="scheme-node scheme-client">
        <span class="scheme-kicker">Шаг 1</span>
        <strong>Браузерный интерфейс</strong>
        <small>Студент нажимает кнопки, вводит сообщение и запускает демо.</small>
      </div>
      <div class="scheme-link">
        <div class="scheme-line"></div>
        <div class="scheme-label">HTTP / WebSocket</div>
      </div>
      <div class="scheme-node scheme-backend">
        <span class="scheme-kicker">Шаг 2</span>
        <strong>Node.js backend</strong>
        <small>Показывает REST, WebSocket и gRPC-логику стенда.</small>
      </div>
      <div class="scheme-link">
        <div class="scheme-line bright"></div>
        <div class="scheme-label">HTTP/2 + protobuf</div>
      </div>
      <div class="scheme-node scheme-server">
        <span class="scheme-kicker">Шаг 3</span>
        <strong>gRPC service</strong>
        <small>Выполняет Unary, Server Stream, Client Stream и Bidi по .proto контракту.</small>
      </div>
    </div>
    <div class="scheme-note">Смысл схемы: интерфейс общается с backend, а backend уже вызывает gRPC-сервис по HTTP/2 с protobuf.</div>
  `;

  document.getElementById('hexRibbon').innerHTML = data.hex.map((chunk) => `
    <div class="hex-chip">
      <span>${chunk.hex}</span>
      <small>${chunk.meaning}</small>
    </div>
  `).join('');

  document.getElementById('protoSummary').innerHTML = `
    <div><span>Пример поля name</span><strong>${escapeHtml(data.sample.name)}</strong></div>
    <div><span>Пример поля text</span><strong>${escapeHtml(data.sample.text)}</strong></div>
    <div><span>protobuf размер</span><strong>${data.protobufBytes} Б</strong></div>
    <div><span>json размер</span><strong>${data.jsonBytes} Б</strong></div>
  `;

  document.getElementById('byteBreakdown').innerHTML = `
    <div class="byte-row header">
      <div>Байты</div><div>Поле</div><div>Что это значит</div>
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
      <input id="quiz-${item.id}" placeholder="Введите ответ" />
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
        'Server streaming: что происходит',
        'Клиент сделал один вызов, а сервер продолжает присылать новые сообщения в том же соединении.',
        [
          { side: 'client', title: 'Действие клиента', text: `Отправил один запрос с текстом: «${getPayload().text}».` },
          { side: 'server', title: `Ответ сервера #${streamState.server.length}`, text: data.item.message },
          { side: 'notice', title: 'Главная мысль', text: 'Клиент не переподключается. Следующие ответы приходят в уже открытом потоке.' },
        ],
        'Где полезно: прогресс-бар, логи, события, частичные результаты.'
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
        'Client streaming: что происходит',
        'Клиент сначала отправил несколько частей, а сервер ответил только один раз в конце.',
        [
          { side: 'client', title: 'Действие клиента', text: 'Отправил три части в одном потоке. Сервер не отвечал после каждой из них отдельно.' },
          { side: 'server', title: 'Итог сервера', text: data.item.message },
          { side: 'notice', title: 'Главная мысль', text: 'Этот режим подходит там, где из многих маленьких частей нужен один общий результат.' },
        ],
        'Где полезно: batch upload, телеметрия, загрузка чанков, сбор данных.'
      );
      markComplete('client');
      return;
    }

    if (data.channel === 'client-stream-error') {
      document.getElementById('clientStreamOutput').textContent = `Ошибка: ${data.error}`;
      return;
    }

    if (data.channel === 'bidi') {
      streamState.bidi.push(data.item.message);
      streamState.charts.bidi.push({ label: `${streamState.bidi.length}`, value: data.item.bytes });
      renderMiniChart('bidiChart', streamState.charts.bidi);
      setVisualState(
        'bidiOutput',
        'Bidirectional streaming: что происходит',
        'Клиент и сервер обмениваются сообщениями параллельно, не дожидаясь полного завершения сессии.',
        [
          { side: 'client', title: `Сообщение клиента #${streamState.bidi.length}`, text: `Клиент отправил новую часть в двусторонний поток.` },
          { side: 'server', title: `Ответ сервера #${streamState.bidi.length}`, text: data.item.message },
          { side: 'notice', title: 'Главная мысль', text: 'Это уже не схема «запрос-потом-ответ». Здесь идёт настоящий диалог в обе стороны.' },
        ],
        'Где полезно: real-time ассистенты, игры, совместная работа, живые события.'
      );
      return;
    }

    if (data.channel === 'bidi-end') {
      markComplete('bidi');
      return;
    }

    if (data.channel === 'ws-demo') {
      const el = document.getElementById('wsOutput');
      el.classList.remove('placeholder-box');
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
    { label: 'запрос', value: data.compactness.protobufBytes },
    { label: 'ответ', value: data.grpc.bytes },
  ];
  renderMiniChart('unaryChart', streamState.charts.unary);
  setVisualState(
    'unaryOutput',
    'Unary: что происходит',
    'Самый простой паттерн gRPC: один запрос пришёл, один ответ ушёл.',
    [
      { side: 'client', title: 'Действие клиента', text: `Отправил один структурированный запрос: «${payload.text}».` },
      { side: 'server', title: 'Действие сервера', text: 'Сразу обработал запрос и вернул один полный ответ.' },
      { side: 'notice', title: 'Главная мысль', text: `Транспорт — ${data.grpc.transport}, контракт — ${data.grpc.contract}, размер запроса — ${data.compactness.protobufBytes} байт.` },
    ],
    'Где полезно: проверка, создание, получение данных, подтверждение одного действия.'
  );
  markComplete('unary');
}

function runServerStream() {
  streamState.server = [];
  streamState.charts.server = [];
  renderMiniChart('serverChart', []);
  setVisualState(
    'serverStreamOutput',
    'Server streaming: запуск',
    'Сейчас сервер откроет один поток и начнёт отправлять несколько ответов по очереди.',
    [
      { side: 'client', title: 'Действие клиента', text: 'Клиент уже отправил один запрос на старт потока.' },
      { side: 'server', title: 'Действие сервера', text: 'Сервер готовит несколько последовательных обновлений.' },
      { side: 'notice', title: 'Главная мысль', text: 'Для каждого нового сообщения не нужно заново открывать новое соединение.' },
    ]
  );
  socket.send(JSON.stringify({ type: 'grpc-server-stream', ...getPayload() }));
}

function runClientStream() {
  streamState.charts.client = [];
  renderMiniChart('clientChart', []);
  setVisualState(
    'clientStreamOutput',
    'Client streaming: запуск',
    'Сейчас клиент отправит несколько частей, а сервер дождётся конца потока и ответит один раз.',
    [
      { side: 'client', title: 'Действие клиента', text: 'Подготавливает три части для одного исходящего потока.' },
      { side: 'server', title: 'Действие сервера', text: 'Ждёт завершения потока, чтобы потом собрать один итоговый ответ.' },
      { side: 'notice', title: 'Главная мысль', text: 'Много входящих сообщений всё ещё могут привести к одному чистому ответу.' },
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
    'Bidirectional streaming: запуск',
    'Открывается двусторонний канал, в котором обе стороны могут говорить параллельно.',
    [
      { side: 'client', title: 'Действие клиента', text: 'Открывает duplex stream и начинает отправлять первую часть.' },
      { side: 'server', title: 'Действие сервера', text: 'Готов отвечать сразу по мере поступления новых частей.' },
      { side: 'notice', title: 'Главная мысль', text: 'Это уже полноценный живой обмен, а не просто «запрос, потом ответ».' },
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
      <div>Сравнение</div><div>gRPC</div><div>REST</div><div>WebSocket</div>
    </div>
    <div class="compare-row">
      <div>Транспорт</div><div>${data.grpc.transport}</div><div>${data.rest.transport}</div><div>${data.websocket.transport}</div>
    </div>
    <div class="compare-row">
      <div>Контракт</div><div>${data.grpc.contract}</div><div>${data.rest.contract}</div><div>${data.websocket.contract}</div>
    </div>
    <div class="compare-row">
      <div>Стиль общения</div><div>Unary + потоки</div><div>Запрос / ответ</div><div>Постоянный real-time канал</div>
    </div>
    <div class="compare-row">
      <div>Размер payload в этом демо</div><div>${data.compactness.protobufBytes} Б</div><div>${data.compactness.jsonBytes} Б</div><div>${data.websocket.bytes} Б</div>
    </div>
    <div class="compare-row">
      <div>Где лучше всего</div><div>Микросервисы, строгие контракты, эффективность</div><div>Открытые API, CRUD, простые интеграции</div><div>Чаты, лайв-состояние, realtime</div>
    </div>
  `;

  grpcPayloadView.textContent = data.protobufHex.join(' ');
  jsonPayloadView.textContent = JSON.stringify(data.jsonPayload, null, 2);

  insight.innerHTML = `В этом примере Protocol Buffers уменьшил размер payload на <strong>${data.compactness.savedPercent}%</strong> по сравнению с JSON. Поэтому gRPC особенно хорошо смотрится во внутренних сервисах и потоковых сценариях.`;
  renderLineChart('compareChart', data.streamChart.grpc, data.streamChart.websocket);
  markComplete('compare');
}

function runWsDemo() {
  const out = document.getElementById('wsOutput');
  out.classList.remove('placeholder-box');
  out.textContent = 'WebSocket demo:';
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
    ...data.results.map((item) => `${item.id}. ${item.correct ? 'верно' : `неверно, ожидается: ${item.expected}`}`),
  ].join('<br>');
}

renderProgress();
loadTheory();
loadProtoExample();
connectSocket();
