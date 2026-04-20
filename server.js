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
      { hex: hex[0], meaning: 'field 1 tag' },
      { hex: hex[1], meaning: 'name length' },
      { hex: hex.slice(2, 2 + sample.name.length).join(' '), meaning: `name = "${sample.name}"` },
      { hex: hex[2 + sample.name.length], meaning: 'field 2 tag' },
      { hex: hex[3 + sample.name.length], meaning: 'text length' },
      { hex: hex.slice(4 + sample.name.length, 4 + sample.name.length + sample.text.length).join(' '), meaning: `text = "${sample.text}"` },
    ],
    breakdown: [
      { hex: '0a', field: 'name tag', explanation: 'Field #1 with wire type 2 = length-delimited string.' },
      { hex: sample.name.length.toString(16).padStart(2, '0'), field: 'name length', explanation: `Next ${sample.name.length} bytes belong to the string value.` },
      { hex: toHexArray(Buffer.from(sample.name, 'utf8')).join(' '), field: 'name value', explanation: `UTF-8 bytes of the string "${sample.name}".` },
      { hex: '12', field: 'text tag', explanation: 'Field #2 with wire type 2 = another length-delimited string.' },
      { hex: sample.text.length.toString(16).padStart(2, '0'), field: 'text length', explanation: `Next ${sample.text.length} bytes belong to the text payload.` },
      { hex: toHexArray(Buffer.from(sample.text, 'utf8')).join(' '), field: 'text value', explanation: `UTF-8 bytes of the string "${sample.text}".` },
      { hex: '18 03', field: 'count', explanation: 'Field #3, varint value = 3.' },
      { hex: '20 b9 0a', field: 'startedAt', explanation: 'Field #4, varint value = 1337.' },
    ],
  };
}

function unaryHello(call, callback) {
  const request = call.request;
  const bytes = DemoRequestType.encode(DemoRequestType.create(request)).finish().length;
  callback(null, {
    protocol: 'gRPC / Unary',
    message: `Hello, ${request.name || 'student'}! Server received: "${request.text}"`,
    timestamp: Date.now(),
    bytes,
  });
}

function serverStream(call) {
  const request = call.request;
  const steps = [
    `Server accepted one request from ${request.name || 'student'}.`,
    'The stream stays open over HTTP/2 instead of reconnecting for every update.',
    `The server can push partial progress for: ${request.text || 'streaming demo'}.`,
    'The stream closes only after the final update is sent.',
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
      message: `Server received ${chunks.length} chunks and merged them into: ${joined}`,
      timestamp: Date.now(),
      bytes: Buffer.byteLength(joined, 'utf8'),
      meta: JSON.stringify({ chunkBytes }),
    });
  });
}

function bidiStream(call) {
  call.on('data', (item) => {
    const text = item.text || 'empty';
    const message = `Server answered immediately to: ${text}`;
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
      { title: 'Unary RPC', text: 'One request and one response. The simplest RPC pattern and the best first step.' },
      { title: 'Server Streaming', text: 'One request and many responses. Perfect when updates should keep arriving from the server.' },
      { title: 'Client Streaming', text: 'Many incoming client messages and one final server result.' },
      { title: 'Bidirectional Streaming', text: 'Both sides stay active at once and exchange messages in parallel.' },
      { title: 'HTTP/2', text: 'The transport base for gRPC: streams, multiplexing, headers, and one long-lived connection.' },
      { title: 'Protocol Buffers', text: 'A strict message contract and compact binary serialization instead of a heavier text payload.' },
    ],
  });
});

app.get('/api/proto-inspect', (_req, res) => {
  res.json(buildProtoInspection());
});

app.post('/api/rest/unary', (req, res) => {
  const payload = req.body || {};
  res.json({
    protocol: 'REST / JSON',
    message: `REST received "${payload.text || ''}" from ${payload.name || 'student'}`,
    timestamp: Date.now(),
    bytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
  });
});

app.post('/api/compare', async (req, res) => {
  const payload = {
    name: req.body?.name || 'Alex',
    text: req.body?.text || 'Show how gRPC works without pain',
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
      contract: 'JSON schema by convention',
    },
    websocket: {
      latencyMs: 'persistent',
      bytes: jsonBytes,
      transport: 'WebSocket',
      contract: 'custom JSON message',
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
  { question: 'Which RPC type is used when the client sends one request and expects one response?', answer: 'unary' },
  { question: 'Which transport layer is used under gRPC?', answer: 'http/2' },
  { question: 'What is the contract language used to describe messages in gRPC?', answer: 'protobuf' },
  { question: 'Which mode is used for two-way realtime message exchange?', answer: 'bidirectional streaming' },
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
    message: `Score: ${score}/${quizQuestions.length}.`,
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
        name: message.name || 'Alex',
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
        ws.send(JSON.stringify({
          channel: 'client-stream-result',
          item: response,
          meta: { chunks },
        }));
      });
      ['chunk-1', 'chunk-2', 'chunk-3'].forEach((chunk, index) => {
        stream.write({
          name: message.name || 'Alex',
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
          name: message.name || 'Alex',
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
        'The connection is already open.',
        'WebSocket is strong for realtime delivery.',
        'But message contracts are usually looser than in gRPC.',
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
  console.log(`HTTP server started on ${HTTP_PORT}`);
});
