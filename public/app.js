let socket;

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
    const targetByChannel = {
      'server-stream': 'serverStreamOutput',
      'server-stream-end': 'serverStreamOutput',
      'client-stream-result': 'clientStreamOutput',
      'client-stream-error': 'clientStreamOutput',
      'bidi': 'bidiOutput',
      'bidi-end': 'bidiOutput',
      'ws-demo': 'wsOutput',
    };
    const id = targetByChannel[data.channel];
    if (!id) return;
    const el = document.getElementById(id);
    if (data.channel.endsWith('-end')) {
      el.innerHTML += '\n— поток завершён —';
      return;
    }
    if (data.error) {
      el.innerHTML += `\nОшибка: ${data.error}`;
      return;
    }
    el.innerHTML += `\n• ${data.item.protocol}: ${data.item.message}`;
  };
}

async function runUnary() {
  const payload = getPayload();
  const out = document.getElementById('unaryOutput');
  out.textContent = 'Выполняем unary вызов...';
  const res = await fetch('/api/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  out.textContent = [
    `gRPC latency: ${data.grpc.latencyMs} ms`,
    `bytes (protobuf): ${data.grpc.bytes}`,
    `transport: ${data.grpc.transport}`,
    'Смысл: самый понятный и простой режим для первого знакомства.',
  ].join('\n');
}

function runServerStream() {
  const out = document.getElementById('serverStreamOutput');
  out.textContent = 'Открываем серверный поток...';
  socket.send(JSON.stringify({ type: 'grpc-server-stream', ...getPayload() }));
}

function runClientStream() {
  const out = document.getElementById('clientStreamOutput');
  out.textContent = 'Отправляем поток сообщений на сервер...';
  socket.send(JSON.stringify({ type: 'grpc-client-stream', ...getPayload() }));
}

function runBidi() {
  const out = document.getElementById('bidiOutput');
  out.textContent = 'Запускаем bidirectional streaming...';
  socket.send(JSON.stringify({ type: 'grpc-bidi', ...getPayload() }));
}

async function runCompare() {
  const box = document.getElementById('compareTable');
  const insight = document.getElementById('compareInsight');
  box.innerHTML = 'Считаем и сравниваем...';
  const res = await fetch('/api/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(getPayload()),
  });
  const data = await res.json();
  box.innerHTML = `
    <div class="compare-row header">
      <div>Параметр</div><div>gRPC</div><div>REST</div><div>WebSocket</div>
    </div>
    <div class="compare-row">
      <div>Транспорт</div><div>${data.grpc.transport}</div><div>${data.rest.transport}</div><div>${data.websocket.transport}</div>
    </div>
    <div class="compare-row">
      <div>Контракт</div><div>${data.grpc.contract}</div><div>${data.rest.contract}</div><div>${data.websocket.contract}</div>
    </div>
    <div class="compare-row">
      <div>Условная задержка</div><div>${data.grpc.latencyMs} ms</div><div>${data.rest.latencyMs} ms</div><div>${data.websocket.latencyMs}</div>
    </div>
    <div class="compare-row">
      <div>Размер полезной нагрузки</div><div>${data.compactness.protobufBytes} B</div><div>${data.compactness.jsonBytes} B</div><div>${data.websocket.bytes} B</div>
    </div>
  `;
  insight.innerHTML = `protobuf уменьшил размер сообщения на <strong>${data.compactness.savedPercent}%</strong>. Это наглядно показывает, почему gRPC удобен для высоконагруженных и межсервисных сценариев.`;
}

function runWsDemo() {
  const out = document.getElementById('wsOutput');
  out.textContent = 'Запускаем realtime-сценарий через WebSocket...';
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

loadTheory();
loadQuiz();
connectSocket();
