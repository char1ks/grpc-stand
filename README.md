# gRPC HyperLab

Интерактивный стенд для студентов:
- теория по gRPC
- демонстрация Unary / Server Streaming / Client Streaming / Bidirectional Streaming
- сравнение gRPC, REST и WebSocket
- объяснение роли HTTP/2 и protobuf
- финальная викторина

## Запуск

```bash
docker compose up --build
```

Открыть:
- http://localhost:8080

## Что внутри

- `server.js` — Express API, WebSocket и gRPC сервер
- `proto/demo.proto` — контракт gRPC
- `public/` — красивый интерактивный интерфейс
- `docker-compose.yml` — запуск в Docker

## Идея подачи

1. Сначала студент читает карточки с основой.
2. Потом запускает 4 типа RPC руками.
3. Затем одним кликом сравнивает gRPC / REST / WebSocket.
4. В конце проходит викторину и отправляет ответы преподавателю.

## Что можно улучшить дальше

- добавить Envoy + grpc-web для прямых браузерных вызовов
- встроить авторизацию и сбор результатов викторины
- добавить режим преподавателя
- сохранить логи прохождения в БД
