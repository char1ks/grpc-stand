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
};

function scrollToSection(id) {
  document.getElementById(id).scrollIntoView({ behavior: 'smooth' });
}

function getPayload() {
  return {
    name: document.getElementById('studentName').value || 'student',
    text: document.getElementById('payloadText').value || 'hello grpc',
    count: 3,
  };
}

function renderProgress() {
  const root = document.getElementById('interactiveProgress');
  const labels = [
    ['unary', 'Unary'],
    ['server', 'Server Stream'],
    ['client', 'Client Stream'],
    ['bidi', 'Bidi Stream'],
    ['compare', 'Сравнение'],
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
  const unlocked = Object.values(progress).every(Boolean);
  if (unlocked) {
    const section = document.getElementById('quizSection');
    if (section.classList.contains('hidden')) {
      section.classList.remove('hidden');
      document.getElementById('unlockToast').classList.remove('hidden');
      setTimeout(() => document.getElementById('unlockToast').classList.add('hidden'), 3600);
      loadQuiz();
      setTimeout(() => scrollToSection('quizSection'), 500);
    }
  }
}

function setVisualState(id, title, subtitle, steps = [], footer = '') {
  const el = document.getElementById(id);
  el.innerHTML = `
    <div class="flow-head">
      <strong>${title}</strong>
      <span>${subtitle}</span>
    </div>
    <div class="flow-steps">
      ${steps.map((step) => `
        <div class="flow-step">
          <div class="flow-step-label">${step.label}</div>
          <div class="flow-step-text">${step.text}</div>
        </div>
      `).join('')}
    </div>
    ${footer ? `<div class="flow-footer">${footer}</div>` : ''}
  `;
}

async function loadTheory() {
  const res = await fetch('/api/theory');
  const data = await res.json();
  const root = document.getElementById('theoryCards');
  root.innerHTML = data.cards.map((card) => `
    <article class="glass card">
      <div class="badge">основа</div>
      <h3>${card.title}</h3>
      <p>${card.text}</p>
    </article>
  `).join('');
}

async function loadQuiz() {
  const res = await fetch('/api/quiz');
  const data = await res.json();
  const root = document.getElementById('quizQuestions');
  root.innerHTML = data.questions.map((item) => `
    <div class="quiz-item">
      <label><strong>${item.id}. ${item.question}</strong></label>
      <input id="quiz-${item.id}" placeholder="Введи ответ" />
    </div>
  `).join('');
}

function connectSocket() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.channel === 'server-stream') {
      streamState.server.push(data.item.message);
      setVisualState(
        'serverStreamOutput',
        'Server Streaming в действии',
        'Один запрос удерживает одно HTTP/2-соединение и получает несколько ответов.',
        streamState.server.map((msg, idx) => ({
          label: idx === 0 ? 'Клиент → сервер' : `Ответ ${idx}`,
          text: msg,
        })),
        'Сценарий подходит для событий, логов, обновлений статуса и частичных результатов.'
      );
      return;
    }

    if (data.channel === 'server-stream-end') {
      markComplete('server');
      return;
    }

    if (data.channel === 'client-stream-result') {
      setVisualState(
        'clientStreamOutput',
        'Client Streaming в действии',
        'Клиент отправил несколько сообщений, а сервер вернул один итог.',
        [
          { label: 'Клиент → сервер', text: 'Отправлены 3 части данных одним потоком.' },
          { label: 'Сервер обрабатывает', text: 'Сообщения собираются в единый результат.' },
          { label: 'Сервер → клиент', text: data.item.message },
        ],
        'Такой режим удобен для батчей, загрузки чанков и телеметрии.'
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
      setVisualState(
        'bidiOutput',
        'Bidirectional Streaming в действии',
        'Клиент и сервер общаются параллельно, не дожидаясь завершения друг друга.',
        streamState.bidi.map((msg, idx) => ({
          label: `Обмен ${idx + 1}`,
          text: msg,
        })),
        'Этот режим нужен там, где важен realtime-обмен: чаты, совместные сессии, игровые и событийные системы.'
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
  setVisualState(
    'unaryOutput',
    'Unary RPC в действии',
    'Один запрос — один ответ. Самый понятный способ начать знакомство с gRPC.',
    [
      { label: 'Клиент → сервер', text: `Отправлен один запрос с текстом: «${payload.text}».` },
      { label: 'Сервер → клиент', text: 'Сервер вернул один готовый ответ без стриминга.' },
      { label: 'Что важно', text: `HTTP/2, protobuf ${data.grpc.bytes} B, условная задержка ${data.grpc.latencyMs} ms.` },
    ],
    'Подходит для обычных бизнес-операций: проверить, получить, создать, подтвердить.'
  );
  markComplete('unary');
}

function runServerStream() {
  streamState.server = [];
  setVisualState(
    'serverStreamOutput',
    'Server Streaming запускается',
    'Сейчас сервер начнёт отправлять несколько сообщений подряд в ответ на один запрос.',
    [
      { label: 'Старт', text: 'Соединение открыто. Ожидаем последовательность ответов.' },
    ]
  );
  socket.send(JSON.stringify({ type: 'grpc-server-stream', ...getPayload() }));
}

function runClientStream() {
  setVisualState(
    'clientStreamOutput',
    'Client Streaming запускается',
    'Клиент сейчас отправит несколько сообщений одним потоком.',
    [
      { label: 'Подготовка', text: 'Формируем серию сообщений и отправляем серверу.' },
    ]
  );
  socket.send(JSON.stringify({ type: 'grpc-client-stream', ...getPayload() }));
}

function runBidi() {
  streamState.bidi = [];
  setVisualState(
    'bidiOutput',
    'Bidirectional Streaming запускается',
    'Сейчас сообщения начнут ходить в обе стороны параллельно.',
    [
      { label: 'Старт', text: 'Открыт двусторонний поток.' },
    ]
  );
  socket.send(JSON.stringify({ type: 'grpc-bidi', ...getPayload() }));
}

async function runCompare() {
  const box = document.getElementById('compareTable');
  const insight = document.getElementById('compareInsight');
  const res = await fetch('/api/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(getPayload()),
  });
  const data = await res.json();
  box.classList.remove('compare-placeholder');
  box.innerHTML = `
    <div class="compare-row header">
      <div>Что сравниваем</div><div>gRPC</div><div>REST</div><div>WebSocket</div>
    </div>
    <div class="compare-row">
      <div>На чём работает</div><div>${data.grpc.transport}</div><div>${data.rest.transport}</div><div>${data.websocket.transport}</div>
    </div>
    <div class="compare-row">
      <div>Как описан контракт</div><div>${data.grpc.contract}</div><div>${data.rest.contract}</div><div>${data.websocket.contract}</div>
    </div>
    <div class="compare-row">
      <div>Какой стиль общения</div><div>Запросы + стриминг</div><div>Запрос / ответ</div><div>Realtime-канал</div>
    </div>
    <div class="compare-row">
      <div>Размер примера</div><div>${data.compactness.protobufBytes} B</div><div>${data.compactness.jsonBytes} B</div><div>${data.websocket.bytes} B</div>
    </div>
    <div class="compare-row">
      <div>Когда особенно уместен</div><div>Микросервисы, строгие контракты, производительность</div><div>Публичные API, простые CRUD-сценарии</div><div>Чаты, realtime-обновления, live-каналы</div>
    </div>
  `;
  insight.innerHTML = `protobuf уменьшил размер сообщения на <strong>${data.compactness.savedPercent}%</strong>. Это хорошо показывает, почему gRPC выгоден для межсервисного и высоконагруженного взаимодействия.`;
  markComplete('compare');
}

function runWsDemo() {
  const out = document.getElementById('wsOutput');
  out.textContent = 'WebSocket realtime-сценарий:';
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
  const root = document.getElementById('quizResult');
  root.innerHTML = [
    data.message,
    ...data.results.map((item) => `Вопрос ${item.id}: ${item.correct ? 'верно' : `неверно, ожидалось: ${item.expected}`}`),
  ].join('<br>');
}

renderProgress();
loadTheory();
connectSocket();
