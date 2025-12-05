# WalkieTalkie Live

![Project: WalkieTalkie Live](https://img.shields.io/badge/project-walkietalkie--live-blue)

WalkieTalkie Live is a prototype web application that provides a Push-to-Talk (PTT) experience similar to a walkie-talkie. It is implemented as a small monorepo with a React + Vite frontend and a Node.js + Express + Socket.IO backend. The project includes signaling scaffolding for WebRTC to enable peer-to-peer audio streaming between participants.

**Tech Stack**
- **Client:** React, Vite, Tailwind CSS
- **Server:** Node.js, Express, Socket.IO
- **Real-time:** Socket.IO for presence and signaling; WebRTC for peer audio (scaffolded)

**Repository layout**
- `client/` — Vite + React app (`src/` contains `App.jsx`, locales, styles)
- `server/` — Express server with Socket.IO handling rooms, presence, and signaling

**High-level behavior**
- Users open the client and pick a username.
- The client connects to the server via Socket.IO and joins a room (default `general`).
- Presence updates are broadcast so clients can show participant lists and speaking indicators.
- The UI provides a press-and-hold button: when held, the client captures the local microphone (if permitted) and signals the server that the user started speaking. When released, the client stops sending audio.
- Socket.IO is used both for presence messages and for relaying WebRTC offer/answer/ICE candidates between peers (signaling). The app contains client-side WebRTC logic to create RTCPeerConnections and attach remote audio elements.

## Getting started

Prerequisites: Node.js 18+ and npm (or a compatible package manager).

1. Install dependencies

```bash
cd walkietalkie-live/server
npm install
cd ../client
npm install
```

2. Run server and client (in separate terminals)

```bash
# terminal 1 — start server
cd walkietalkie-live/server
npm start

# terminal 2 — start client dev server
cd walkietalkie-live/client
npm run dev
```

3. Open the client in your browser

- Development Vite server usually listens on `http://localhost:5173` (check terminal output).

## Configuration and environment

- `client` reads `VITE_SERVER_URL` from env (e.g. in a `.env` file) to determine the Socket.IO server address. Defaults to `http://localhost:3001`.
- `server` may also use environment variables (see `server/index.js` for details).

## Core files to inspect
- `client/src/App.jsx` — main UI and WebRTC/Socket.IO logic (peer connection management, audio elements, per-peer volumes).
- `server/index.js` — Express + Socket.IO server handling rooms, presence, and signaling events (`webrtc-offer`, `webrtc-answer`, `webrtc-ice-candidate`, `start-speaking`, `stop-speaking`).

## How the audio flow works (summary)
1. When a user presses the PTT button, the client requests microphone access (`getUserMedia`) and adds the audio track(s) to each RTCPeerConnection `pc.addTrack()` where applicable.
2. The client uses Socket.IO to send WebRTC signaling messages (offer/answer/candidates) to peers through the server so peers can establish direct peer connections.
3. Remote peers receive `ontrack` events and attach incoming MediaStreams to hidden `<audio>` elements; playback is controlled by user settings (global volume, per-peer volume, mute/unmute).

## Notes, limitations and next steps
- This project is a prototype. In its current state it provides the UI and full client-side WebRTC handling, but depending on runtime configuration you may need to allow microphone access and ensure the server is reachable from the clients (CORS / host/port considerations).
- Security and production hardening are not included: add authentication, origin checks, rate limiting, HTTPS, and TURN servers for reliable NAT traversal in production.
- Suggested improvements: persistent rooms, user accounts, TLS and TURN (coturn) for WebRTC, and automated tests/CI.

## Troubleshooting
- If you see no audio or get blocked playback, make sure the browser allows microphone and that you clicked the `Enable Audio` (or pressed the PTT button) to provide a user gesture for autoplay.
- If peers cannot connect, confirm the `VITE_SERVER_URL` matches the server address and that ports are reachable.

## License & acknowledgements
This repository is a small prototype. Attribution and license are not set in this file — add a `LICENSE` if you plan to open-source.

---

If you want, I can also:
- Remove remaining `console.log`/`console.warn` calls for a quieter runtime.
- Apply similar comment cleanup across other files.
- Add a minimal `.env.example` and a short `Makefile` or npm scripts to run both parts together.
