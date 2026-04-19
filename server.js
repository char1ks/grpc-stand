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

function unaryHello(call, callback) {
  const request = call.request;
  const bytes = DemoRequestType.encode(DemoRequestType.create(request)).finish().length;
  callback(null, {
    protocol: 'gRPC / Unary',
    message: `Привет, ${request.name || 'student'}! Сервер получил: "${request.text}"`,
    timestamp: Date.now(),
    bytes,
  });
}

function serverStream(call) {
  const request = call.request;
  const steps = [
    `Получен запрос от ${request.name || 'student'}`,
    'Сервер открыл поток ответов',
    'HTTP/2 удерживает одно соединение и отдаёт несколько сообщений',
    `Итог: ${request.text || 'демонстрация server streaming'}`,
  ];

  let index = 0;
  const interval = setInterval(() => {
    if (index >= steps.length) {
      clearInterval(interval);
      call.end();
      return;
    }
    call.write({
      protocol: 'gRPC / Server Streaming',
      message: steps[index],
      timestamp: Date.now(),
      bytes: Buffer.byteLength(steps[index], 'utf8'),
    });
    index += 1;
  }, 700);

  call.on('cancelled', () => clearInterval(interval));
}

function clientStream(call, callback) {
  const chunks = [];
  call.on('data', (item) => {
    chunks.push(item.text || 'empty');
  });
  call.on('end', () => {
    const joined = chunks.join(' | ');
    callback(null, {
      protocol: 'gRPC / Client Streaming',
      message: `Сервер принял ${chunks.length} сообщений и собрал: ${joined}`,
      timestamp: Date.now(),
      bytes: Buffer.byteLength(joined, 'utf8'),
    });
  });
}

function bidiStream(call) {
  call.on('data', (item) => {
    const text = item.text || 'empty';
    call.write({
      protocol: 'gRPC / Bidirectional Streaming',
      message: `Сервер сразу ответил на: ${text}`,
      timestamp: Date.now(),
      bytes: Buffer.byteLength(text, 'utf8'),
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
    if (error) {
      throw error;
    }
    server.start();
    console.log(`gRPC server started on ${GRPC_PORT}`);
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
      {
        title: 'Unary RPC',
        text: 'Один запрос -> один ответ. Самый простой сценарий, близок к обычному HTTP API.',
      },
      {
        title: 'Server Streaming',
        text: 'Один запрос -> поток ответов. Удобно для логов, обновлений, событий, частичных результатов.',
      },
      {
        title: 'Client Streaming',
        text: 'Поток запросов -> один ответ. Хорошо подходит для батчей, телеметрии и загрузки чанков.',
      },
      {
        title: 'Bidirectional Streaming',
        text: 'Обе стороны обмениваются сообщениями параллельно. Полезно для real-time сценариев.',
      },
      {
        title: 'HTTP/2',
        text: 'Основа gRPC: мультиплексирование, стримы, заголовки и постоянное соединение.',
      },
      {
        title: 'Protocol Buffers',
        text: 'Строгий контракт + компактная бинарная сериализация вместо более тяжёлого JSON.',
      }
    ]
  });
});

app.post('/api/rest/unary', (req, res) => {
  const payload = req.body || {};
  res.json({
    protocol: 'REST / JSON',
    message: `REST получил "${payload.text || ''}" от ${payload.name || 'student'}`,
    timestamp: Date.now(),
    bytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
  });
});

app.post('/api/compare', async (req, res) => {
  const payload = {
    name: req.body?.name || 'student',
    text: req.body?.text || 'hello grpc',
    count: Number(req.body?.count || 3),
    startedAt: Date.now(),
  };

  const jsonBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  const protobufBytes = DemoRequestType.encode(DemoRequestType.create(payload)).finish().length;
  const client = createGrpcClient();

  const grpcStart = process.hrtime.bigint();
  const grpcResult = await new Promise((resolve, reject) => {
    client.UnaryHello(payload, (error, response) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(response);
    });
  });
  const grpcMs = Number(process.hrtime.bigint() - grpcStart) / 1e6;

  const restStart = process.hrtime.bigint();
  const restPayload = {
    protocol: 'REST / JSON',
    message: `REST получил "${payload.text}" от ${payload.name}`,
    timestamp: Date.now(),
    bytes: jsonBytes,
  };
  const restMs = Number(process.hrtime.bigint() - restStart) / 1e6;

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
      transport: 'HTTP/1.1 / JSON',
      contract: 'JSON schema by convention',
    },
    websocket: {
      latencyMs: 'persistent',
      bytes: jsonBytes,
      transport: 'WebSocket',
      contract: 'custom / informal',
    },
    compactness: {
      protobufBytes,
      jsonBytes,
      savedPercent: (((jsonBytes - protobufBytes) / jsonBytes) * 100).toFixed(1),
    },
  });
});

const quizQuestions = [
  {
    question: 'Какой тип RPC нужен, когда клиент отправляет один запрос и ждёт один ответ?',
    answer: 'unary',
  },
  {
    question: 'Какая транспортная основа лежит под gRPC?',
    answer: 'http/2',
  },
  {
    question: 'Как называется язык описания контракта сообщений в gRPC?',
    answer: 'protobuf',
  },
  {
    question: 'Какой режим нужен для двустороннего обмена сообщениями в real-time?',
    answer: 'bidirectional streaming',
  },
];

app.get('/api/quiz', (_req, res) => {
  res.json({ questions: quizQuestions.map((q, index) => ({ id: index + 1, question: q.question })) });
});

app.post('/api/quiz/check', (req, res) => {
  const answers = req.body?.answers || [];
  const results = quizQuestions.map((q, index) => {
    const input = String(answers[index] || '').trim().toLowerCase();
    const expected = q.answer.toLowerCase();
    return {
      id: index + 1,
      correct: input === expected,
      expected: q.answer,
    };
  });
  const score = results.filter((r) => r.correct).length;
  res.json({
    score,
    total: quizQuestions.length,
    results,
    message: `Набрано ${score}/${quizQuestions.length}.`,
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
        name: message.name || 'student',
        text: message.text || 'server stream demo',
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
        ws.send(JSON.stringify({ channel: 'client-stream-result', item: response }));
      });
      ['chunk-1', 'chunk-2', 'chunk-3'].forEach((chunk, index) => {
        stream.write({
          name: message.name || 'student',
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
          name: message.name || 'student',
          text: `${chunk}: ${message.text || 'duplex'}`,
          count: 1,
          startedAt: Date.now(),
        });
      });
      setTimeout(() => stream.end(), 300);
      return;
    }

    if (message.type === 'ws-demo') {
      ['Соединение уже открыто', 'WebSocket подходит для realtime', 'Но контракт сообщений обычно слабее, чем в gRPC'].forEach((text, index) => {
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
  console.log(`HTTP server started on ${HTTP_PORT}`);
});
