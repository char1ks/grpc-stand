const path = require('path');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const protobuf = require('protobufjs');

const HTTP_PORT = process.env.PORT || 8080;
const GRPC_PORT = process.env.GRPC_PORT || 50051;
const PROTO_PATH = path.join(__dirname, 'proto', 'demo.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
const demo = protoDescriptor.demo;

const root = protobuf.loadSync(PROTO_PATH);
const DemoRequestType = root.lookupType('demo.DemoRequest');

const DEFAULT_SAMPLE = {
  name: 'Martin',
  text: 'daydreaming',
  count: 3,
  startedAt: 1337,
};

function toHexArray(buffer) {
  return Array.from(buffer).map((value) => value.toString(16).padStart(2, '0'));
}

function buildProtoInspection(sample = DEFAULT_SAMPLE) {
  const encoded = DemoRequestType.encode(DemoRequestType.create(sample)).finish();
  const hex = toHexArray(encoded);
  return {
    proto: `syntax = "proto3";\n\npackage demo;\n\nmessage DemoRequest {\n  string name = 1;\n  string text = 2;\n  int32 count = 3;\n  int64 startedAt = 4;\n}\n\nmessage DemoReply {\n  string protocol = 1;\n  string message = 2;\n  int64 timestamp = 3;\n  int32 bytes = 4;\n}\n\nservice DemoService {\n  rpc UnaryHello (DemoRequest) returns (DemoReply);\n  rpc ServerStream (DemoRequest) returns (stream DemoReply);\n  rpc ClientStream (stream DemoRequest) returns (DemoReply);\n  rpc BidiStream (stream DemoRequest) returns (stream DemoReply);\n}`,
    sample,
    protobufBytes: encoded.length,
    jsonBytes: Buffer.byteLength(JSON.stringify(sample), 'utf8'),
    hex: [
      { hex: hex[0], meaning: 'тег поля 1' },
      { hex: hex[1], meaning: 'длина name' },
      { hex: hex.slice(2, 2 + sample.name.length).join(' '), meaning: `name = "${sample.name}"` },
      { hex: hex[2 + sample.name.length], meaning: 'тег поля 2' },
      { hex: hex[3 + sample.name.length], meaning: 'длина text' },
      { hex: hex.slice(4 + sample.name.length, 4 + sample.name.length + sample.text.length).join(' '), meaning: `text = "${sample.text}"` },
    ],
    breakdown: [
      { hex: '0a', field: 'тег name', explanation: 'Поле №1, wire type 2: строка с указанием длины.' },
      { hex: sample.name.length.toString(16).padStart(2, '0'), field: 'длина name', explanation: `Следующие ${sample.name.length} байт относятся к строке name.` },
      { hex: toHexArray(Buffer.from(sample.name, 'utf8')).join(' '), field: 'значение name', explanation: `UTF-8 байты строки "${sample.name}".` },
      { hex: '12', field: 'тег text', explanation: 'Поле №2, wire type 2: ещё одна строка с длиной.' },
      { hex: sample.text.length.toString(16).padStart(2, '0'), field: 'длина text', explanation: `Следующие ${sample.text.length} байт относятся к полю text.` },
      { hex: toHexArray(Buffer.from(sample.text, 'utf8')).join(' '), field: 'значение text', explanation: `UTF-8 байты строки "${sample.text}".` },
      { hex: '18 03', field: 'count', explanation: 'Поле №3, varint, значение = 3.' },
      { hex: '20 b9 0a', field: 'startedAt', explanation: 'Поле №4, varint, значение = 1337.' },
    ],
  };
}

function unaryHello(call, callback) {
  const request = call.request;
  const bytes = DemoRequestType.encode(DemoRequestType.create(request)).finish().length;
  callback(null, {
    protocol: 'gRPC / Unary',
    message: `Привет, ${request.name || 'студент'}! Сервер получил: "${request.text}"`,
    timestamp: Date.now(),
    bytes,
  });
}

function serverStream(call) {
  const request = call.request;
  const steps = [
    `Сервер принял один запрос от ${request.name || 'студент'}.`,
    'Поток остаётся открытым поверх HTTP/2, поэтому не нужно заново подключаться для каждого ответа.',
    `Сервер может отправлять частичные обновления по задаче: ${request.text || 'demo'}.`,
    'Поток закрывается только после финального сообщения.',
  ];

  let index = 0;
  const interval = setInterval(() => {
    if (index >= steps.length) {
      clearInterval(interval);
      call.end();
      return;
    }
    const message = steps[index];
    call.write({
      protocol: 'gRPC / Server Streaming',
      message,
      timestamp: Date.now(),
      bytes: Buffer.byteLength(message, 'utf8'),
    });
    index += 1;
  }, 650);

  call.on('cancelled', () => clearInterval(interval));
}

function clientStream(call, callback) {
  const chunks = [];
  const chunkBytes = [];
  call.on('data', (item) => {
    const text = item.text || 'empty';
    chunks.push(text);
    chunkBytes.push(DemoRequestType.encode(DemoRequestType.create(item)).finish().length);
  });
  call.on('end', () => {
    const joined = chunks.join(' | ');
    callback(null, {
      protocol: 'gRPC / Client Streaming',
      message: `Сервер получил ${chunks.length} части и собрал их в один итог: ${joined}`,
      timestamp: Date.now(),
      bytes: Buffer.byteLength(joined, 'utf8'),
      meta: JSON.stringify({ chunkBytes }),
    });
  });
}

function bidiStream(call) {
  call.on('data', (item) => {
    const text = item.text || 'empty';
    const message = `Сервер сразу ответил на: ${text}`;
    call.write({
      protocol: 'gRPC / Bidirectional Streaming',
      message,
      timestamp: Date.now(),
      bytes: Buffer.byteLength(message, 'utf8'),
    });
  });
  call.on('end', () => call.end());
}

function startGrpcServer() {
  const server = new grpc.Server();
  server.addService(demo.DemoService.service, {
    UnaryHello: unaryHello,
    ServerStream: serverStream,
    ClientStream: clientStream,
    BidiStream: bidiStream,
  });
  server.bindAsync(`0.0.0.0:${GRPC_PORT}`, grpc.ServerCredentials.createInsecure(), (error) => {
    if (error) throw error;
    server.start();
    console.log(`gRPC сервер запущен на ${GRPC_PORT}`);
  });
}

function createGrpcClient() {
  return new demo.DemoService(`localhost:${GRPC_PORT}`, grpc.credentials.createInsecure());
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/theory', (_req, res) => {
  res.json({
    cards: [
      { title: 'Unary RPC', text: 'Один запрос и один ответ. Самый простой режим и лучший вход в тему.' },
      { title: 'Server Streaming', text: 'Один запрос и несколько ответов. Подходит, когда сервер должен присылать обновления по ходу работы.' },
      { title: 'Client Streaming', text: 'Несколько сообщений от клиента и один итоговый ответ от сервера.' },
      { title: 'Bidirectional Streaming', text: 'Обе стороны активны одновременно и обмениваются сообщениями параллельно.' },
      { title: 'HTTP/2', text: 'Транспортная основа gRPC: потоки, multiplexing и одно долгое соединение.' },
      { title: 'Protocol Buffers', text: 'Строгий контракт сообщений и компактная бинарная сериализация вместо более тяжёлого текстового payload.' },
    ],
  });
});

app.get('/api/proto-inspect', (req, res) => {
  const sample = {
    name: String(req.query.name || DEFAULT_SAMPLE.name),
    text: String(req.query.text || DEFAULT_SAMPLE.text),
    count: Number(req.query.count || DEFAULT_SAMPLE.count),
    startedAt: Number(req.query.startedAt || DEFAULT_SAMPLE.startedAt),
  };
  res.json(buildProtoInspection(sample));
});

app.post('/api/rest/unary', (req, res) => {
  const payload = req.body || {};
  res.json({
    protocol: 'REST / JSON',
    message: `REST получил "${payload.text || ''}" от ${payload.name || 'студент'}`,
    timestamp: Date.now(),
    bytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
  });
});

app.post('/api/compare', async (req, res) => {
  const payload = {
    name: req.body?.name || 'Алексей',
    text: req.body?.text || 'Покажи, как работает gRPC без боли',
    count: Number(req.body?.count || 3),
    startedAt: Date.now(),
  };

  const jsonBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  const protobufBuffer = DemoRequestType.encode(DemoRequestType.create(payload)).finish();
  const protobufBytes = protobufBuffer.length;
  const client = createGrpcClient();

  const grpcStart = process.hrtime.bigint();
  const grpcResult = await new Promise((resolve, reject) => {
    client.UnaryHello(payload, (error, response) => {
      if (error) return reject(error);
      resolve(response);
    });
  });
  const grpcMs = Number(process.hrtime.bigint() - grpcStart) / 1e6;
  const restStart = process.hrtime.bigint();
  const restMs = Number(process.hrtime.bigint() - restStart) / 1e6;

  const streamChart = {
    grpc: Array.from({ length: 5 }, (_, index) => protobufBytes * (index + 1)),
    websocket: Array.from({ length: 5 }, (_, index) => jsonBytes * (index + 1)),
  };

  res.json({
    grpc: {
      latencyMs: grpcMs.toFixed(2),
      bytes: grpcResult.bytes,
      transport: 'HTTP/2',
      contract: '.proto + protobuf',
    },
    rest: {
      latencyMs: restMs.toFixed(2),
      bytes: jsonBytes,
      transport: 'HTTP/1.1 + JSON',
      contract: 'JSON по договорённости',
    },
    websocket: {
      latencyMs: 'постоянное соединение',
      bytes: jsonBytes,
      transport: 'WebSocket',
      contract: 'кастомное JSON-сообщение',
    },
    compactness: {
      protobufBytes,
      jsonBytes,
      savedPercent: (((jsonBytes - protobufBytes) / jsonBytes) * 100).toFixed(1),
    },
    protobufHex: toHexArray(protobufBuffer),
    jsonPayload: payload,
    streamChart,
  });
});

const quizQuestions = [
  { question: 'Какой тип RPC нужен, когда клиент отправляет один запрос и ждёт один ответ?', answer: 'unary' },
  { question: 'Какая транспортная основа лежит под gRPC?', answer: 'http/2' },
  { question: 'Как называется язык описания контрактов сообщений в gRPC?', answer: 'protobuf' },
  { question: 'Какой режим нужен для двустороннего обмена сообщениями в реальном времени?', answer: 'bidirectional streaming' },
];

app.get('/api/quiz', (_req, res) => {
  res.json({ questions: quizQuestions.map((q, index) => ({ id: index + 1, question: q.question })) });
});

app.post('/api/quiz/check', (req, res) => {
  const answers = req.body?.answers || [];
  const results = quizQuestions.map((q, index) => {
    const input = String(answers[index] || '').trim().toLowerCase();
    const expected = q.answer.toLowerCase();
    return { id: index + 1, correct: input === expected, expected: q.answer };
  });
  const score = results.filter((r) => r.correct).length;
  res.json({
    score,
    total: quizQuestions.length,
    results,
    message: `Результат: ${score}/${quizQuestions.length}.`,
  });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (_err) {
      return;
    }

    const client = createGrpcClient();

    if (message.type === 'grpc-server-stream') {
      const stream = client.ServerStream({
        name: message.name || 'Алексей',
        text: message.text || 'streaming demo',
        count: 4,
        startedAt: Date.now(),
      });
      stream.on('data', (item) => ws.send(JSON.stringify({ channel: 'server-stream', item })));
      stream.on('end', () => ws.send(JSON.stringify({ channel: 'server-stream-end' })));
      return;
    }

    if (message.type === 'grpc-client-stream') {
      const stream = client.ClientStream((error, response) => {
        if (error) {
          ws.send(JSON.stringify({ channel: 'client-stream-error', error: error.message }));
          return;
        }
        let chunks = [];
        try {
          chunks = JSON.parse(response.meta || '{}').chunkBytes || [];
        } catch (_err) {
          chunks = [];
        }
        ws.send(JSON.stringify({ channel: 'client-stream-result', item: response, meta: { chunks } }));
      });
      ['часть-1', 'часть-2', 'часть-3'].forEach((chunk, index) => {
        stream.write({
          name: message.name || 'Алексей',
          text: `${chunk}: ${message.text || 'payload'} #${index + 1}`,
          count: index + 1,
          startedAt: Date.now(),
        });
      });
      stream.end();
      return;
    }

    if (message.type === 'grpc-bidi') {
      const stream = client.BidiStream();
      stream.on('data', (item) => ws.send(JSON.stringify({ channel: 'bidi', item })));
      stream.on('end', () => ws.send(JSON.stringify({ channel: 'bidi-end' })));
      ['alpha', 'beta', 'gamma'].forEach((chunk) => {
        stream.write({
          name: message.name || 'Алексей',
          text: `${chunk}: ${message.text || 'duplex'}`,
          count: 1,
          startedAt: Date.now(),
        });
      });
      setTimeout(() => stream.end(), 300);
      return;
    }

    if (message.type === 'ws-demo') {
      [
        'Соединение уже открыто и можно сразу слать новые сообщения.',
        'WebSocket силён в real-time сценариях.',
        'Но формальный контракт сообщений обычно слабее, чем у gRPC.',
      ].forEach((text, index) => {
        setTimeout(() => {
          ws.send(JSON.stringify({
            channel: 'ws-demo',
            item: {
              protocol: 'WebSocket',
              message: text,
              timestamp: Date.now(),
              bytes: Buffer.byteLength(text, 'utf8'),
            },
          }));
        }, index * 500);
      });
    }
  });
});

startGrpcServer();
server.listen(HTTP_PORT, () => {
  console.log(`HTTP сервер запущен на ${HTTP_PORT}`);
});
