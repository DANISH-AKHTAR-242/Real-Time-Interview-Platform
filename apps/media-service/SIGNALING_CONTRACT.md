# Media-Service Signaling Contract

This document defines the WebSocket signaling protocol exposed by media-service for frontend WebRTC integration.

## Endpoints

- WebSocket signaling: `/ws`
- RTP capabilities (HTTP): `GET /rtpCapabilities`
- ICE servers (HTTP): `GET /iceServers`

Default local base URL:

- `http://127.0.0.1:3004`
- `ws://127.0.0.1:3004/ws`

`GET /iceServers` response example:

```json
{
  "iceServers": [
    {
      "urls": ["stun:localhost:3478"]
    },
    {
      "urls": ["turn:localhost:3478?transport=udp", "turn:localhost:3478?transport=tcp"],
      "username": "username",
      "credential": "password"
    }
  ]
}
```

## Message Envelope

All client requests are JSON objects:

```json
{
  "event": "joinRoom",
  "requestId": "optional-correlation-id",
  "data": {}
}
```

Server responses are JSON objects using one of these top-level events:

- `connected`
- `ack`
- `error`
- `peerJoined`
- `peerLeft`
- `newProducer`
- `producerClosed`
- `consumerClosed`

## Event Flow (Recommended)

1. Connect to `/ws` and wait for `connected`.
2. Send `joinRoom` with `sessionId`.
3. Send `createTransport` for a send transport.
4. Send `connectTransport` with client DTLS parameters.
5. Send `produce` for audio/video tracks.
6. On `newProducer` (or existing IDs from `joinRoom`), create a recv transport, connect it, then send `consume`.

Note: `joinRoom` must happen before `createTransport`, `connectTransport`, `produce`, or `consume`.

## Client -> Server Events

### joinRoom

Request:

```json
{
  "event": "joinRoom",
  "requestId": "req-1",
  "data": {
    "sessionId": "session-123"
  }
}
```

Ack (`event: ack`, `action: joinRoom`):

```json
{
  "event": "ack",
  "action": "joinRoom",
  "requestId": "req-1",
  "data": {
    "peerId": "uuid",
    "sessionId": "session-123",
    "existingPeerIds": ["peer-uuid"],
    "existingProducerIds": ["producer-id"],
    "peerCount": 2
  }
}
```

Notes:

- Room capacity is bounded by `MEDIA_ROOM_MAX_PEERS` (default: `5`).
- `existingPeerIds` allows joining clients to build participant presence immediately.

### createTransport

Request:

```json
{
  "event": "createTransport",
  "requestId": "req-2",
  "data": {
    "direction": "send"
  }
}
```

Notes:

- `direction` is optional. If omitted or invalid, server defaults to `send`.

Ack (`event: ack`, `action: createTransport`):

```json
{
  "event": "ack",
  "action": "createTransport",
  "requestId": "req-2",
  "data": {
    "direction": "send",
    "id": "transport-id",
    "transportId": "transport-id",
    "iceParameters": {},
    "iceCandidates": [],
    "dtlsParameters": {}
  }
}
```

Note:

- The `id` field is the canonical WebRTC transport id required by browser-side transport setup.
- `transportId` is also included for compatibility with existing client code.

### connectTransport

Request:

```json
{
  "event": "connectTransport",
  "requestId": "req-3",
  "data": {
    "transportId": "transport-id",
    "dtlsParameters": {}
  }
}
```

Ack (`event: ack`, `action: connectTransport`):

```json
{
  "event": "ack",
  "action": "connectTransport",
  "requestId": "req-3",
  "data": {
    "transportId": "transport-id",
    "connected": true
  }
}
```

### produce

Request:

```json
{
  "event": "produce",
  "requestId": "req-4",
  "data": {
    "transportId": "transport-id",
    "kind": "video",
    "rtpParameters": {},
    "appData": {}
  }
}
```

Rules:

- `kind` must be `audio` or `video`.

Ack (`event: ack`, `action: produce`):

```json
{
  "event": "ack",
  "action": "produce",
  "requestId": "req-4",
  "data": {
    "producerId": "producer-id",
    "kind": "video"
  }
}
```

### consume

Request:

```json
{
  "event": "consume",
  "requestId": "req-5",
  "data": {
    "transportId": "recv-transport-id",
    "producerId": "producer-id",
    "rtpCapabilities": {}
  }
}
```

Rules:

- `producerId` must exist in the same room.
- `router.canConsume` must succeed for provided `rtpCapabilities`.

Ack (`event: ack`, `action: consume`):

```json
{
  "event": "ack",
  "action": "consume",
  "requestId": "req-5",
  "data": {
    "consumerId": "consumer-id",
    "producerId": "producer-id",
    "kind": "video",
    "rtpParameters": {},
    "type": "simple",
    "producerPaused": false,
    "producerPeerId": "peer-uuid"
  }
}
```

## Server -> Client Push Events

### connected

Sent immediately after WebSocket connect.

```json
{
  "event": "connected",
  "data": {
    "peerId": "peer-uuid"
  }
}
```

### newProducer

Broadcast to other peers in the room when a peer produces media.

```json
{
  "event": "newProducer",
  "data": {
    "sessionId": "session-123",
    "peerId": "producer-peer-id",
    "producerId": "producer-id",
    "kind": "audio"
  }
}
```

### peerJoined

Broadcast to other peers in the room when a new peer joins.

```json
{
  "event": "peerJoined",
  "data": {
    "sessionId": "session-123",
    "peerId": "joined-peer-id",
    "peerCount": 3
  }
}
```

### peerLeft

Broadcast to remaining peers when a peer leaves, disconnects, switches room, or the server is closing.

```json
{
  "event": "peerLeft",
  "data": {
    "sessionId": "session-123",
    "peerId": "left-peer-id",
    "peerCount": 2,
    "reason": "disconnect"
  }
}
```

`reason` can be:

- `disconnect`
- `room-switch`
- `server-close`

### producerClosed

Broadcast to other peers when a producer closes or producing peer disconnects.

```json
{
  "event": "producerClosed",
  "data": {
    "sessionId": "session-123",
    "peerId": "producer-peer-id",
    "producerId": "producer-id"
  }
}
```

### consumerClosed

Sent to a peer if its consumer closes because upstream producer closed.

```json
{
  "event": "consumerClosed",
  "data": {
    "consumerId": "consumer-id",
    "producerId": "producer-id"
  }
}
```

### error

Sent when a request is invalid or fails.

```json
{
  "event": "error",
  "action": "consume",
  "requestId": "req-5",
  "message": "Cannot consume this producer with given rtpCapabilities"
}
```

## Room and Peer Semantics

- Multiple peers can join the same `sessionId` room.
- Each peer has isolated collections of transports, producers, and consumers.
- On disconnect, server closes peer media resources, removes peer from room, and deletes empty rooms.
- If a peer joins a different room using the same socket, old room media state is cleaned first.

## Frontend Integration Notes

- Use `requestId` for client-side promise correlation.
- Call `GET /rtpCapabilities` early and pass capabilities during `consume`.
- Load `GET /iceServers` and pass it to `device.createSendTransport()` and `device.createRecvTransport()`.
- Handle `newProducer` and `producerClosed` as dynamic room updates.
