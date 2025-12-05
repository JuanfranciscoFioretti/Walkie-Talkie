# WalkieTalkie Live

[![Project: WalkieTalkie Live](https://img.shields.io/badge/project-walkietalkie--live-blue)](https://github.com)

A fast prototype for a realtime Push-to-Talk (walkie-talkie) web app built as a take-home challenge.

**Tech**: React + Vite + Tailwind CSS (client) • Node.js + Express + Socket.IO (server) • WebRTC planned for real-time audio.

## Quick Start

Requirements: Node.js 18+ and npm

1. Clone the repo

2. From repo root install server and client dependencies:

```bash
cd walkietalkie-live/server
npm install
cd ../client
npm install
```

3. Run server and client (in separate terminals):

```bash
# server
cd walkietalkie-live/server
npm start

# client
cd walkietalkie-live/client
npm run dev
```

Open http://localhost:5173 and enjoy the prototype.

## Features

- Monorepo with `/server` and `/client`
- Real-time channel (room) support using Socket.IO
- Presence and speaking indicators
- Press-and-hold UI for talk (client-side handler wired)
- Scaffolding for WebRTC signaling (Socket events for offer/answer/candidates)

## Next steps (planned)

- Implement WebRTC peer connections and microphone streaming
- Add authentication and persistent channels
- Add tests and CI, deploy to Vercel/Heroku

---

This is an initial commit to be extended with real-time audio streaming in the next step.
