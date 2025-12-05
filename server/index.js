const express = require('express')
const http = require('http')
const cors = require('cors')
const { Server } = require('socket.io')

const app = express()
app.use(cors({
  origin: true,
  credentials: true
}))

const server = http.createServer(app)

const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true
})

// Basic health route
app.get('/', (req, res) => res.send({ status: 'ok', service: 'walkietalkie-server' }))

// Socket.IO: rooms = channels
io.on('connection', (socket) => {
  console.log('socket connected', socket.id)

  socket.on('join-room', ({ room, username }) => {
    socket.join(room)
    socket.data.username = username || 'Anonymous'
    console.log(`${socket.id} joined room ${room} as ${socket.data.username}`)
    // notify others
    socket.to(room).emit('user-joined', { id: socket.id, username: socket.data.username })
    // send current presence to the joining socket
    const clients = Array.from(io.sockets.adapter.rooms.get(room) || [])
    const users = clients.map((id) => {
      const s = io.sockets.sockets.get(id)
      return { id, username: s?.data?.username || 'Anonymous' }
    })
    socket.emit('room-users', { room, users })
  })

  socket.on('leave-room', ({ room }) => {
    socket.leave(room)
    socket.to(room).emit('user-left', { id: socket.id })
  })

  // speaking indicators for press-to-talk
  socket.on('start-speaking', ({ room }) => {
    socket.to(room).emit('user-started-speaking', { id: socket.id })
  })
  socket.on('stop-speaking', ({ room }) => {
    socket.to(room).emit('user-stopped-speaking', { id: socket.id })
  })

  // Simple passthrough for WebRTC signaling (SDP / ICE) when we implement audio
  socket.on('webrtc-offer', (data) => {
    // send directly to target socket id
    io.to(data.target).emit('webrtc-offer', { sdp: data.sdp, from: socket.id })
  })
  socket.on('webrtc-answer', (data) => {
    io.to(data.target).emit('webrtc-answer', { sdp: data.sdp, from: socket.id })
  })
  socket.on('webrtc-ice-candidate', (data) => {
    io.to(data.target).emit('webrtc-ice-candidate', { candidate: data.candidate, from: socket.id })
  })

  socket.on('disconnecting', () => {
    const rooms = Array.from(socket.rooms).filter((r) => r !== socket.id)
    rooms.forEach((room) => {
      socket.to(room).emit('user-left', { id: socket.id })
    })
  })
})

const PORT = process.env.PORT || 3001

if (process.env.NODE_ENV !== 'production') {
  server.listen(PORT, () => {
    console.log(`Walkie-Talkie server listening on ${PORT}`)
  })
} else {
  // Para Vercel, necesitamos exportar el servidor HTTP
  module.exports = server
}

// También exportamos la app de Express para compatibilidad
module.exports.default = server
