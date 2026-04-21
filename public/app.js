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
  client: [],
  bidi: [],
};

function scrollToSection(id) {
  document.getElementById(id).scrollIntoView({ behavior: 'smooth' });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getPayload() {
  return {
    name: document.getElementById('studentName').value || 'Алексей',
    text: document.getElementById('payloadText').value || 'Покажи, как работает gRPC без боли',
    count: 3,
    startedAt: 1337,
  };
}

function renderProgress() {
  const root = document.getElementById('interactiveProgress');
  const labels = [
    ['unary', 'Unary'],
    ['server', 'Server stream'],
    ['client', 'Client stream'],
    ['bidi', 'Bidi'],
    ['compare', 'Сравнение'],
  ];
  root.innerHTML = labels.map(([key, label]) => `
    <div class="progress-pill ${progress[key] ? 'done' : ''}">
      <span class="dot"></span>${label}
    </div>
  `).join('');
}

function showToast(text) {
  const toast = document.getElementById('unlockToast');
  toast.textContent = text;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2200);
}

function maybeUnlockNext() {
  if (progress.unary) {
    document.getElementById('serverCard').classList.remove('hidden');
    document.getElementById('compare').classList.remove('hidden');
    document.getElementById('breakdownCard').classList.remove('hidden');
    document.getElementById('wirePreviewCard').classList.remove('hidden');
  }
  if (progress.server) document.getElementById('clientCard').classList.remove('hidden');
  if (progress.client) document.getElementById('bidiCard').classList.remove('hidden');
  if (Object.values(progress).every(Boolean)) {
    document.getElementById('quizSection').classList.remove('hidden');
  }
}

function markComplete(key) {
  const firstTime = !progress[key];
  progress[key] = true;
  renderProgress();
  maybeUnlockNext();
  if (firstTime) {
    const messages = {
      unary: 'Открылся server streaming и блок сравнения.',
      server: 'Открылся client streaming.',
      client: 'Открылся bidirectional streaming.',
      bidi: 'Осталось пройти сравнение.',
      compare: 'Сравнение пройдено.',
    };
    showToast(messages[key] || 'Открылись новые блоки.');
  }
}

function storyCard(side, title, text) {
  return `
    <div class="lane-card ${side}">
      <div class="lane-head">
        <div class="lane-tag">${side === 'client' ? 'клиент' : side === 'server' ? 'сервер' : 'что важно заметить'}</div>
        <div class="lane-title">${escapeHtml(title)}</div>
      </div>
      <div class="lane-text">${escapeHtml(text)}</div>
    </div>
  `;
}

function setStory(targetId, title, subtitle, cards, footer = '') {
  const root = document.getElementById(targetId);
  root.classList.remove('placeholder-box');
  root.innerHTML = `
    <div class="flow-head">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(subtitle)}</span>
    </div>
    <div class="lane-grid">
      ${cards.map((card) => storyCard(card.side, card.title, card.text)).join('')}
    </div>
    ${footer ? `<div class="flow-footer">${escapeHtml(footer)}</div>` : ''}
  `;
}

function renderWirePreview(payload, data) {
  document.getElementById('wirePreview').innerHTML = `
    <div class="wire-row">
      <div class="wire-key">Имя</div>
      <div class="wire-value">${escapeHtml(payload.name)}</div>
    </div>
    <div class="wire-row">
      <div class="wire-key">Фраза</div>
      <div class="wire-value">${escapeHtml(payload.text)}</div>
    </div>
    <div class="wire-row">
      <div class="wire-key">gRPC / protobuf</div>
      <div class="wire-value">${data.compactness.protobufBytes} Б</div>
    </div>
    <div class="wire-row">
      <div class="wire-key">JSON</div>
      <div class="wire-value">${data.compactness.jsonBytes} Б</div>
    </div>
  `;
}

async function loadTheory() {
  const res = await fetch('/api/theory');
  const data = await res.json();
  document.getElementById('theoryCards').innerHTML = data.cards.map((item) => `
    <article class="glass card theory-card">
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.text)}</p>
    </article>
  `).join('');
}

function renderArchitecture() {
  document.getElementById('architectureDiagram').innerHTML = `
    <div class="scheme-simple">
      <div class="scheme-box">
        <span>Шаг 1</span>
        <strong>Браузер</strong>
        <small>Пользователь нажал кнопку и отправил фразу.</small>
      </div>
      <div class="scheme-arrow">HTTP</div>
      <div class="scheme-box">
        <span>Шаг 2</span>
        <strong>Backend</strong>
        <small>Node.js принял запрос и вызвал gRPC-метод.</small>
      </div>
      <div class="scheme-arrow bright">HTTP/2 + protobuf</div>
      <div class="scheme-box">
        <span>Шаг 3</span>
        <strong>gRPC service</strong>
        <small>Сервис обработал unary или потоковый вызов.</small>
      </div>
    </div>
  `;
}

async function loadProtoExample() {
  const payload = getPayload();
  const params = new URLSearchParams({
    name: payload.name,
    text: payload.text,
    count: String(payload.count),
    startedAt: String(payload.startedAt),
  });
  const res = await fetch(`/api/proto-inspect?${params}`);
  const data = await res.json();

  document.getElementById('protoCode').textContent = data.proto;
  renderArchitecture();

  document.getElementById('liveFieldBreakdown').innerHTML = `
    <div class="live-pill"><span>name</span><strong>${escapeHtml(payload.name)}</strong></div>
    <div class="live-pill"><span>text</span><strong>${escapeHtml(payload.text)}</strong></div>
    <div class="live-pill"><span>count</span><strong>${payload.count}</strong></div>
    <div class="live-pill"><span>startedAt</span><strong>${payload.startedAt}</strong></div>
  `;

  document.getElementById('protoSummary').innerHTML = `
    <div><span>protobuf размер</span><strong>${data.protobufBytes} Б</strong></div>
    <div><span>json размер</span><strong>${data.jsonBytes} Б</strong></div>
  `;

  document.getElementById('byteBreakdown').innerHTML = data.breakdown.map((row) => `
    <div class="byte-item">
      <div class="byte-hex">${escapeHtml(row.hex)}</div>
      <div class="byte-copy">
        <strong>${escapeHtml(row.field)}</strong>
        <span>${escapeHtml(row.explanation)}</span>
      </div>
    </div>
  `).join('');
}

function connectSocket() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.channel === 'server-stream') {
      streamState.server.push(data.item.message);
      setStory(
        'serverStreamOutput',
        'Server streaming: живая история',
        'Один запрос уже ушёл. Теперь сервер присылает новые ответы в рамках того же соединения.',
        [
          { side: 'client', title: 'Что сделал клиент', text: `Один раз отправил фразу: «${getPayload().text}».` },
          { side: 'server', title: `Что прислал сервер сейчас`, text: data.item.message },
          { side: 'notice', title: 'На что смотреть', text: 'Клиент не создаёт новый запрос на каждый следующий ответ.' },
        ],
        `Сообщений в потоке: ${streamState.server.length}`
      );
      return;
    }

    if (data.channel === 'server-stream-end') {
      markComplete('server');
      return;
    }

    if (data.channel === 'client-stream-result') {
      setStory(
        'clientStreamOutput',
        'Client streaming: живая история',
        'Клиент отправил несколько частей, а сервер ответил только один раз в конце.',
        [
          { side: 'client', title: 'Что сделал клиент', text: 'Отправил 3 части подряд в одном исходящем потоке.' },
          { side: 'server', title: 'Что собрал сервер', text: data.item.message },
          { side: 'notice', title: 'На что смотреть', text: 'Здесь не три ответа, а один общий итог после завершения потока.' },
        ],
        'Подходит, когда маленьких сообщений много, а результат нужен один.'
      );
      markComplete('client');
      return;
    }

    if (data.channel === 'bidi') {
      streamState.bidi.push(data.item.message);
      setStory(
        'bidiOutput',
        'Bidirectional streaming: живая история',
        'Обе стороны говорят параллельно: клиент пишет новую часть, сервер сразу отвечает.',
        [
          { side: 'client', title: `Сообщение клиента #${streamState.bidi.length}`, text: 'Клиент отправил следующий кусок в двусторонний поток.' },
          { side: 'server', title: `Ответ сервера #${streamState.bidi.length}`, text: data.item.message },
          { side: 'notice', title: 'На что смотреть', text: 'Это уже диалог в обе стороны, а не «сначала всё отправили, потом ждём».' },
        ],
        `Шагов обмена: ${streamState.bidi.length}`
      );
      return;
    }

    if (data.channel === 'bidi-end') {
      markComplete('bidi');
      return;
    }
  };
}

async function runUnary() {
  const payload = getPayload();
  await loadProtoExample();
  const res = await fetch('/api/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  setStory(
    'simpleUnaryStory',
    'Простой unary: живая история',
    'Это самый базовый сценарий gRPC: один запрос пришёл, один ответ ушёл.',
    [
      { side: 'client', title: 'Что сделал клиент', text: `Отправил имя «${payload.name}» и фразу «${payload.text}».` },
      { side: 'server', title: 'Что сделал сервер', text: `Сразу обработал запрос и вернул один ответ: ${data.grpc.bytes} Б.` },
      { side: 'notice', title: 'Что важно понять', text: `Даже такой простой вызов уже использует ${data.grpc.transport} и контракт ${data.grpc.contract}.` },
    ],
    'Сначала достаточно понять именно этот базовый паттерн.'
  );

  setStory(
    'unaryOutput',
    'Unary RPC',
    'Один запрос → один ответ. Самый простой и самый понятный режим.',
    [
      { side: 'client', title: 'Что отправили', text: `Один структурированный запрос с именем ${payload.name}.` },
      { side: 'server', title: 'Что вернул сервер', text: 'Один полный ответ без открытия потока.' },
      { side: 'notice', title: 'Главная мысль', text: `Protobuf в этом примере занял ${data.compactness.protobufBytes} Б, JSON — ${data.compactness.jsonBytes} Б.` },
    ],
    'После этого можно переходить к более сложным режимам.'
  );

  renderWirePreview(payload, data);
  markComplete('unary');
}

function runServerStream() {
  streamState.server = [];
  setStory(
    'serverStreamOutput',
    'Server streaming: запуск',
    'Сейчас клиент отправит один запрос, а сервер начнёт присылать обновления по одному.',
    [
      { side: 'client', title: 'Что сделал клиент', text: 'Один раз открыл поток запроса.' },
      { side: 'server', title: 'Что сделает сервер', text: 'Пришлёт несколько ответов подряд в том же соединении.' },
      { side: 'notice', title: 'На что смотреть', text: 'Новые ответы будут появляться без нового запроса со стороны клиента.' },
    ]
  );
  socket.send(JSON.stringify({ type: 'grpc-server-stream', ...getPayload() }));
}

function runClientStream() {
  setStory(
    'clientStreamOutput',
    'Client streaming: запуск',
    'Сейчас клиент будет отправлять части, а сервер подождёт и соберёт их в один результат.',
    [
      { side: 'client', title: 'Что сделает клиент', text: 'Отправит три части в одном исходящем потоке.' },
      { side: 'server', title: 'Что сделает сервер', text: 'Ничего не вернёт до конца потока, а потом выдаст общий итог.' },
      { side: 'notice', title: 'На что смотреть', text: 'Это обратная логика по сравнению с server streaming.' },
    ]
  );
  socket.send(JSON.stringify({ type: 'grpc-client-stream', ...getPayload() }));
}

function runBidi() {
  streamState.bidi = [];
  setStory(
    'bidiOutput',
    'Bidirectional streaming: запуск',
    'Сейчас начнётся живой двусторонний обмен сообщениями.',
    [
      { side: 'client', title: 'Что сделает клиент', text: 'Начнёт слать части одну за другой.' },
      { side: 'server', title: 'Что сделает сервер', text: 'Будет отвечать сразу после каждой части.' },
      { side: 'notice', title: 'На что смотреть', text: 'Обе стороны активны одновременно.' },
    ]
  );
  socket.send(JSON.stringify({ type: 'grpc-bidi', ...getPayload() }));
}

function renderCompareTimeline(root, steps) {
  root.innerHTML = steps.map((step, index) => `
    <div class="compare-step ${step.done ? 'done' : ''}">
      <div class="compare-step-index">${index + 1}</div>
      <div class="compare-step-copy">
        <strong>${escapeHtml(step.title)}</strong>
        <span>${escapeHtml(step.text)}</span>
      </div>
    </div>
  `).join('');
}

function renderLineChart(containerId, grpcPoints, wsPoints) {
  const root = document.getElementById(containerId);
  const width = 820;
  const height = 280;
  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const max = Math.max(...grpcPoints, ...wsPoints, 1);
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  function pointSet(values) {
    return values.map((value, index) => {
      const x = padding.left + (innerW / Math.max(values.length - 1, 1)) * index;
      const y = padding.top + innerH - (value / max) * innerH;
      return { x, y, value, label: index + 1 };
    });
  }

  const grpc = pointSet(grpcPoints);
  const ws = pointSet(wsPoints);
  const grpcPath = grpc.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const wsPath = ws.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  const yTicks = 4;
  const grid = Array.from({ length: yTicks + 1 }, (_, i) => {
    const value = Math.round((max / yTicks) * i);
    const y = padding.top + innerH - (i / yTicks) * innerH;
    return { value, y };
  });

  root.innerHTML = `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="График роста байт">
      ${grid.map((tick) => `<line x1="${padding.left}" y1="${tick.y}" x2="${width - padding.right}" y2="${tick.y}" class="gridline" />`).join('')}
      <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" class="axis" />
      <line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" class="axis" />
      ${grid.map((tick) => `<text x="${padding.left - 10}" y="${tick.y + 4}" class="tick-label" text-anchor="end">${tick.value} Б</text>`).join('')}
      ${grpc.map((p) => `<text x="${p.x}" y="${height - padding.bottom + 20}" class="tick-label" text-anchor="middle">${p.label}</text>`).join('')}
      <path d="${grpcPath}" fill="none" stroke="#39f4df" stroke-width="4" stroke-linecap="round" />
      <path d="${wsPath}" fill="none" stroke="#ff76ca" stroke-width="4" stroke-linecap="round" />
      ${grpc.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="5" fill="#39f4df" />`).join('')}
      ${ws.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="5" fill="#ff76ca" />`).join('')}
    </svg>
    <div class="chart-legend">
      <span><i class="legend-dot grpc"></i>gRPC protobuf</span>
      <span><i class="legend-dot ws"></i>WebSocket JSON</span>
    </div>
  `;
}

async function runCompare() {
  const root = document.getElementById('compareStory');
  const visuals = document.getElementById('compareVisuals');
  const chartPanel = document.getElementById('compareChartPanel');
  const grpcPayloadView = document.getElementById('grpcPayloadView');
  const jsonPayloadView = document.getElementById('jsonPayloadView');

  root.classList.remove('placeholder-box');
  renderCompareTimeline(root, [
    { title: 'Шаг 1', text: 'Берём один и тот же payload для всех трёх подходов.', done: true },
    { title: 'Шаг 2', text: 'Сейчас посчитаем размер protobuf и JSON.', done: false },
    { title: 'Шаг 3', text: 'Потом покажем, как выглядит payload.', done: false },
    { title: 'Шаг 4', text: 'И в конце сравним рост трафика в потоке.', done: false },
  ]);

  const res = await fetch('/api/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(getPayload()),
  });
  const data = await res.json();

  setTimeout(() => {
    renderCompareTimeline(root, [
      { title: 'Размер payload', text: `protobuf: ${data.compactness.protobufBytes} Б, JSON: ${data.compactness.jsonBytes} Б. Экономия: ${data.compactness.savedPercent}%.`, done: true },
      { title: 'Где это важно', text: 'Разница особенно заметна во внутренних сервисах и потоковых сценариях.', done: true },
      { title: 'Как выглядит payload', text: 'Ниже появляются protobuf-байты и JSON для одной и той же фразы.', done: false },
      { title: 'Поток', text: 'После этого покажем график роста байт.', done: false },
    ]);
    visuals.classList.remove('hidden');
    grpcPayloadView.textContent = data.protobufHex.join(' ');
    jsonPayloadView.textContent = JSON.stringify(data.jsonPayload, null, 2);
  }, 450);

  setTimeout(() => {
    renderCompareTimeline(root, [
      { title: 'Размер payload', text: `protobuf: ${data.compactness.protobufBytes} Б, JSON: ${data.compactness.jsonBytes} Б.`, done: true },
      { title: 'Внешний вид', text: 'Protobuf — бинарные байты, JSON — читаемый текст.', done: true },
      { title: 'Поток', text: 'Теперь видно, как разница по размеру накапливается при серии сообщений.', done: true },
      { title: 'Вывод', text: 'REST проще для открытых API, WebSocket — для realtime, gRPC — для строгих и эффективных внутренних вызовов.', done: true },
    ]);
    chartPanel.classList.remove('hidden');
    renderLineChart('compareChart', data.streamChart.grpc, data.streamChart.websocket);
    markComplete('compare');
  }, 900);
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

async function loadQuiz() {
  const res = await fetch('/api/quiz');
  const data = await res.json();
  document.getElementById('quizQuestions').innerHTML = data.questions.map((item) => `
    <div class="quiz-item">
      <label>${item.id}. ${escapeHtml(item.question)}</label>
      <input id="quiz-${item.id}" placeholder="Введи ответ" />
    </div>
  `).join('');
}

document.getElementById('studentName').addEventListener('input', () => {
  if (progress.unary) loadProtoExample();
});
document.getElementById('payloadText').addEventListener('input', () => {
  if (progress.unary) loadProtoExample();
});

renderProgress();
loadTheory();
loadProtoExample();
loadQuiz();
connectSocket();
