const state = {
  unaryDone: false,
  compareDone: false,
  decoded: false,
  compareTimer: null,
  compareTick: 0,
};

const els = {
  studentName: document.getElementById('studentName'),
  studentText: document.getElementById('studentText'),
  runUnaryBtn: document.getElementById('runUnaryBtn'),
  unaryClientText: document.getElementById('unaryClientText'),
  unaryServerText: document.getElementById('unaryServerText'),
  unaryInsight: document.getElementById('unaryInsight'),
  compareSection: document.getElementById('compareSection'),
  runCompareBtn: document.getElementById('runCompareBtn'),
  grpcBytes: document.getElementById('grpcBytes'),
  wsBytes: document.getElementById('wsBytes'),
  grpcPayloadBox: document.getElementById('grpcPayloadBox'),
  wsPayloadBox: document.getElementById('wsPayloadBox'),
  compareChart: document.getElementById('compareChart'),
  timeline: document.getElementById('timeline'),
  breakdownSection: document.getElementById('breakdownSection'),
  protoBox: document.getElementById('protoBox'),
  decodeBtn: document.getElementById('decodeBtn'),
  byteChips: document.getElementById('byteChips'),
  byteTable: document.getElementById('byteTable'),
  summaryName: document.getElementById('summaryName'),
  summaryText: document.getElementById('summaryText'),
  summaryProtoBytes: document.getElementById('summaryProtoBytes'),
  summaryJsonBytes: document.getElementById('summaryJsonBytes'),
  advancedSection: document.getElementById('advancedSection'),
  serverStreamBtn: document.getElementById('serverStreamBtn'),
  clientStreamBtn: document.getElementById('clientStreamBtn'),
  bidiBtn: document.getElementById('bidiBtn'),
  serverStreamHistory: document.getElementById('serverStreamHistory'),
  clientStreamHistory: document.getElementById('clientStreamHistory'),
  bidiHistory: document.getElementById('bidiHistory'),
};

const encoder = new TextEncoder();

function escapeHtml(str){
  return str.replace(/[&<>"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]));
}

function toHex(bytes){
  return Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(' ');
}

function encodeVarint(num){
  const out = [];
  let n = Number(num);
  while(n > 127){
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return out;
}

function encodeFieldString(fieldNo, value){
  const bytes = Array.from(encoder.encode(value));
  return [(fieldNo << 3) | 2, ...encodeVarint(bytes.length), ...bytes];
}

function encodeFieldInt(fieldNo, value){
  return [(fieldNo << 3) | 0, ...encodeVarint(value)];
}

function buildPayload(name, text){
  const count = 3;
  const startedAt = Math.floor(Date.now() / 1000);
  const bytes = [
    ...encodeFieldString(1, name),
    ...encodeFieldString(2, text),
    ...encodeFieldInt(3, count),
    ...encodeFieldInt(4, startedAt),
  ];
  return {
    count,
    startedAt,
    protobuf: bytes,
    protobufHex: toHex(bytes),
    json: {
      name, text, count, startedAt
    }
  };
}

function protoText(){
  return `syntax = "proto3";

package demo;

message DemoRequest {
  string name = 1;
  string text = 2;
  int32 count = 3;
  int64 startedAt = 4;
}

message DemoReply {
  string protocol = 1;
  string message = 2;
  int64 timestamp = 3;
  int32 bytes = 4;
}

service DemoService {
  rpc UnaryHello (DemoRequest) returns (DemoReply);
  rpc ServerStream (DemoRequest) returns (stream DemoReply);
  rpc ClientStream (stream DemoRequest) returns (DemoReply);
  rpc BidiStream (stream DemoRequest) returns (stream DemoReply);
}`;
}

function renderUnary(){
  const name = els.studentName.value.trim() || 'Алексей';
  const text = els.studentText.value.trim() || 'Покажи, как работает gRPC без боли';
  const payload = buildPayload(name, text);
  state.unaryDone = true;

  els.unaryClientText.textContent = `Клиент отправил один структурированный запрос: name="${name}", text="${text}".`;
  els.unaryServerText.textContent = `Сервер сразу вернул один цельный ответ и не держал соединение ради потока. Размер protobuf payload в этом примере: ${payload.protobuf.length} Б.`;
  els.unaryInsight.textContent = 'Это самый понятный режим: один запрос пришёл, один ответ ушёл. После него уже проще понимать стриминг.';
  els.compareSection.classList.remove('hidden');
  els.breakdownSection.classList.remove('hidden');
  els.protoBox.textContent = protoText();
}

function renderTimeline(payload){
  const grpcBytes = payload.protobuf.length;
  const wsBytes = encoder.encode(JSON.stringify(payload.json, null, 2)).length;

  els.timeline.innerHTML = `
    <div class="timeline-item">
      <div class="timeline-step">1</div>
      <div>
        <div class="timeline-title">Размер первого сообщения</div>
        <div class="timeline-text">protobuf: ${grpcBytes} Б, JSON: ${wsBytes} Б.</div>
      </div>
    </div>
    <div class="timeline-item">
      <div class="timeline-step">2</div>
      <div>
        <div class="timeline-title">Как это выглядит</div>
        <div class="timeline-text">gRPC прячет данные в бинарный payload, WebSocket здесь несёт JSON-строку.</div>
      </div>
    </div>
    <div class="timeline-item">
      <div class="timeline-step">3</div>
      <div>
        <div class="timeline-title">Почему график динамический</div>
        <div class="timeline-text">График не ограничен пятью точками: каждую секунду добавляется ещё одно сообщение, и видно, как расходятся линии.</div>
      </div>
    </div>
  `;
}

function renderChart(payload){
  const svg = els.compareChart;
  const grpcUnit = payload.protobuf.length;
  const wsUnit = encoder.encode(JSON.stringify(payload.json)).length;
  const grpcSeries = [1,2,3,4,5].map(i => grpcUnit * i);
  const wsSeries = [1,2,3,4,5].map(i => wsUnit * i);
  const max = Math.max(...grpcSeries, ...wsSeries);

  const pad = {l: 54, r: 16, t: 18, b: 34};
  const w = 760, h = 260, innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
  const x = i => pad.l + (innerW / 4) * i;
  const y = val => pad.t + innerH - (val / max) * innerH;

  function poly(series){
    return series.map((v,i) => `${x(i)},${y(v)}`).join(' ');
  }

  const yTicks = [0, Math.round(max*0.25), Math.round(max*0.5), Math.round(max*0.75), max];
  svg.innerHTML = `
    <rect x="0" y="0" width="${w}" height="${h}" rx="18" fill="transparent"></rect>
    ${yTicks.map(v => `<line x1="${pad.l}" y1="${y(v)}" x2="${w-pad.r}" y2="${y(v)}" stroke="rgba(255,255,255,.08)" />`).join('')}
    <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${h-pad.b}" stroke="rgba(255,255,255,.18)" />
    <line x1="${pad.l}" y1="${h-pad.b}" x2="${w-pad.r}" y2="${h-pad.b}" stroke="rgba(255,255,255,.18)" />
    ${yTicks.map(v => `<text x="12" y="${y(v)+4}" fill="rgba(255,255,255,.62)" font-size="12" font-family="Inter">${v} Б</text>`).join('')}
    ${[1,2,3,4,5].map((n,i) => `<text x="${x(i)-4}" y="${h-10}" fill="rgba(255,255,255,.62)" font-size="12" font-family="Inter">${n}</text>`).join('')}
    <polyline fill="none" stroke="#44f0e1" stroke-width="4" points="${poly(grpcSeries)}"></polyline>
    <polyline fill="none" stroke="#ff79c9" stroke-width="4" points="${poly(wsSeries)}"></polyline>
    ${grpcSeries.map((v,i) => `<circle cx="${x(i)}" cy="${y(v)}" r="5" fill="#44f0e1"></circle>`).join('')}
    ${wsSeries.map((v,i) => `<circle cx="${x(i)}" cy="${y(v)}" r="5" fill="#ff79c9"></circle>`).join('')}
    <text x="${pad.l}" y="14" fill="#44f0e1" font-size="12" font-family="Inter">gRPC protobuf</text>
    <text x="${pad.l+120}" y="14" fill="#ff79c9" font-size="12" font-family="Inter">WebSocket JSON</text>
  `;
}

function renderCompare(){
  const name = els.studentName?.value?.trim() || 'Алексей';
  const text = els.studentText?.value?.trim() || 'Покажи, как работает gRPC без боли';
  const payload = buildPayload(name, text);
  const grpcBytes = payload.protobuf.length;
  const wsJson = JSON.stringify(payload.json, null, 2);
  const wsBytes = encoder.encode(wsJson).length;
  state.compareDone = true;
  hideDecode();

  els.grpcBytes.textContent = `${grpcBytes} Б`;
  els.wsBytes.textContent = `${wsBytes} Б`;
  els.grpcPayloadBox.textContent = payload.protobufHex;
  els.wsPayloadBox.textContent = wsJson;
  renderTimeline(payload);
  startCompareTimeline(payload);

  els.summaryName.textContent = name;
  els.summaryText.textContent = text;
  els.summaryProtoBytes.textContent = `${grpcBytes} Б`;
  els.summaryJsonBytes.textContent = `${wsBytes} Б`;

  if (els.advancedSection) els.advancedSection.classList.remove('hidden');
}

function decodePayload(){
  state.decoded = true;
  els.decodeBtn.textContent = 'Скрыть разбор';
  const name = els.studentName?.value?.trim() || 'Алексей';
  const text = els.studentText?.value?.trim() || 'Покажи, как работает gRPC без боли';
  const payload = buildPayload(name, text);
  const nameBytes = Array.from(encoder.encode(name));
  const textBytes = Array.from(encoder.encode(text));
  const rows = [
    {hex:'0a', field:'тег name', meaning:'Поле №1, строка с длиной.'},
    {hex:nameBytes.length.toString(16).padStart(2,'0'), field:'длина name', meaning:`Следующие ${nameBytes.length} байт относятся к имени.`},
    {hex:toHex(nameBytes), field:'значение name', meaning:`UTF-8 байты строки "${name}".`},
    {hex:'12', field:'тег text', meaning:'Поле №2, ещё одна строка.'},
    {hex:textBytes.length.toString(16).padStart(2,'0'), field:'длина text', meaning:`Следующие ${textBytes.length} байт относятся к тексту.`},
    {hex:toHex(textBytes), field:'значение text', meaning:`UTF-8 байты строки "${text}".`},
    {hex:'18 03', field:'count', meaning:'Поле №3, varint, значение = 3.'},
    {hex:`20 ${toHex(encodeVarint(startedAt))}`, field:'startedAt', meaning:`Поле №4, varint, значение = ${startedAt}.`},
  ];

  els.byteChips.innerHTML = rows.slice(0,6).map(r => `
    <div class="byte-chip">
      <strong>${escapeHtml(r.hex)}</strong>
      <small>${escapeHtml(r.field)}</small>
    </div>
  `).join('');

  els.byteTable.innerHTML = rows.map(r => `
    <div class="byte-row">
      <div>${escapeHtml(r.hex)}</div>
      <div>${escapeHtml(r.field)}</div>
      <div>${escapeHtml(r.meaning)}</div>
    </div>
  `).join('');
}


function hideDecode(){
  state.decoded = false;
  els.decodeBtn.textContent = 'Показать разбор';
  els.byteChips.innerHTML = '';
  els.byteTable.innerHTML = '';
}

function startCompareTimeline(payload){
  if (state.compareTimer) clearInterval(state.compareTimer);
  state.compareTick = 0;

  const svg = els.compareChart;
  const grpcUnit = payload.protobuf.length;
  const wsUnit = encoder.encode(JSON.stringify(payload.json)).length;

  function renderStreamingChart(tick){
    const seconds = Math.max(1, tick);
    const grpcSeries = Array.from({length: seconds}, (_, i) => grpcUnit * (i + 1));
    const wsSeries = Array.from({length: seconds}, (_, i) => wsUnit * (i + 1));
    const max = Math.max(...grpcSeries, ...wsSeries);

    const pad = {l: 54, r: 16, t: 18, b: 34};
    const w = 760, h = 260, innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
    const x = i => pad.l + (seconds === 1 ? 0 : (innerW / (seconds - 1)) * i);
    const y = val => pad.t + innerH - (val / max) * innerH;
    function poly(series){ return series.map((v,i) => `${x(i)},${y(v)}`).join(' '); }
    const yTicks = [0, Math.round(max*0.25), Math.round(max*0.5), Math.round(max*0.75), max];

    svg.innerHTML = `
      <rect x="0" y="0" width="${w}" height="${h}" rx="18" fill="transparent"></rect>
      ${yTicks.map(v => `<line x1="${pad.l}" y1="${y(v)}" x2="${w-pad.r}" y2="${y(v)}" stroke="rgba(255,255,255,.08)" />`).join('')}
      <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${h-pad.b}" stroke="rgba(255,255,255,.18)" />
      <line x1="${pad.l}" y1="${h-pad.b}" x2="${w-pad.r}" y2="${h-pad.b}" stroke="rgba(255,255,255,.18)" />
      ${yTicks.map(v => `<text x="12" y="${y(v)+4}" fill="rgba(255,255,255,.62)" font-size="12" font-family="Inter">${v} Б</text>`).join('')}
      ${Array.from({length: seconds}, (_, i) => `<text x="${x(i)-8}" y="${h-10}" fill="rgba(255,255,255,.62)" font-size="12" font-family="Inter">${i+1}с</text>`).join('')}
      <polyline fill="none" stroke="#44f0e1" stroke-width="4" points="${poly(grpcSeries)}"></polyline>
      <polyline fill="none" stroke="#ff79c9" stroke-width="4" points="${poly(wsSeries)}"></polyline>
      ${grpcSeries.map((v,i) => `<circle cx="${x(i)}" cy="${y(v)}" r="5" fill="#44f0e1"></circle>`).join('')}
      ${wsSeries.map((v,i) => `<circle cx="${x(i)}" cy="${y(v)}" r="5" fill="#ff79c9"></circle>`).join('')}
      <text x="${pad.l}" y="14" fill="#44f0e1" font-size="12" font-family="Inter">gRPC protobuf</text>
      <text x="${pad.l+120}" y="14" fill="#ff79c9" font-size="12" font-family="Inter">WebSocket JSON</text>
    `;
  }

  renderStreamingChart(1);
  state.compareTimer = setInterval(() => {
    state.compareTick += 1;
    renderStreamingChart(state.compareTick + 1);
    if (state.compareTick >= 9) {
      clearInterval(state.compareTimer);
    }
  }, 1000);
}

function renderHistory(target, items){
  target.innerHTML = items.map((item, idx) => `
    <div class="history-item">
      <div class="history-head">
        <div class="history-badge">${idx+1}</div>
        <div class="history-title">${escapeHtml(item.title)}</div>
      </div>
      <div class="history-text">${escapeHtml(item.text)}</div>
    </div>
  `).join('');
}

function showServerStream(){
  const text = els.studentText.value.trim() || 'Покажи, как работает gRPC без боли';
  renderHistory(els.serverStreamHistory, [
    {title:'Клиент отправил один запрос', text:`Ушла одна фраза: "${text}".`},
    {title:'Сервер ответил обновлением #1', text:'Сначала прислал короткий статус о начале обработки.'},
    {title:'Сервер ответил обновлением #2', text:'Потом прислал следующий кусок без нового запроса от клиента.'},
    {title:'Сервер ответил обновлением #3', text:'В конце прислал финальное сообщение и только потом закрыл поток.'},
  ]);
}

function showClientStream(){
  renderHistory(els.clientStreamHistory, [
    {title:'Клиент отправил часть #1', text:'Первая маленькая часть ушла без отдельного ответа.'},
    {title:'Клиент отправил часть #2', text:'Потом ушла вторая часть, сервер всё ещё только собирает.'},
    {title:'Клиент отправил часть #3', text:'После последней части сервер получил весь набор.'},
    {title:'Сервер вернул один итог', text:'Только в конце сервер собрал общий результат и отдал один ответ.'},
  ]);
}

function showBidi(){
  renderHistory(els.bidiHistory, [
    {title:'Клиент отправил сообщение #1', text:'Диалог стартовал.'},
    {title:'Сервер сразу ответил на сообщение #1', text:'Ответ пришёл, пока клиент ещё не закончил всю сессию.'},
    {title:'Клиент отправил сообщение #2', text:'Следующее сообщение ушло в том же соединении.'},
    {title:'Сервер ответил на сообщение #2', text:'Вот здесь уже видно, что это именно живой двусторонний обмен.'},
  ]);
}

if (els.runUnaryBtn) els.runUnaryBtn.addEventListener('click', renderUnary);
if (els.runCompareBtn) els.runCompareBtn.addEventListener('click', renderCompare);
els.decodeBtn.addEventListener('click', () => {
  if (state.decoded) {
    hideDecode();
  } else {
    decodePayload();
  }
});
if (els.serverStreamBtn) els.serverStreamBtn.addEventListener('click', showServerStream);
if (els.clientStreamBtn) els.clientStreamBtn.addEventListener('click', showClientStream);
if (els.bidiBtn) els.bidiBtn.addEventListener('click', showBidi);

if (els.studentName) {
  els.studentName.addEventListener('input', () => {
    if (state.unaryDone) renderUnary();
    if (state.compareDone) {
      renderCompare();
      if (state.decoded) decodePayload();
    }
  });
}
if (els.studentText) {
  els.studentText.addEventListener('input', () => {
    if (state.unaryDone) renderUnary();
    if (state.compareDone) {
      renderCompare();
      if (state.decoded) decodePayload();
    }
  });
}

els.protoBox.textContent = protoText();
