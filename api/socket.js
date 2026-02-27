import { Server } from 'socket.io'

// Store the io instance globally
let ioInstance = null

export default function handler(req, res) {
  // Initialize Socket.IO once per serverless function instance
  if (!ioInstance) {
    // Create a new Server instance attached to the raw socket
    const server = res.socket.server
    
    if (!server.io) {
      console.log('[Socket.IO] Initializing Socket.IO server')
      
      const io = new Server(server, {
        path: '/api/socket.io',
        addTrailingSlash: false,
        // Only HTTP long-polling for serverless
        transports: ['polling'],
        allowUpgrades: false,
        cors: {
          origin: true,
          credentials: true,
          methods: ['GET', 'POST']
        },
        pingTimeout: 60000,
        pingInterval: 25000,
        maxHttpBufferSize: 1e6
      })

      // Socket.IO connection handler
      io.on('connection', (socket) => {
        console.log('[Socket.IO] Connected:', socket.id)

        socket.on('join-room', ({ room, username }) => {
          socket.join(room)
          socket.data.username = username || 'Anonymous'
          console.log(`[Socket.IO] ${socket.id} joined ${room}`)
          socket.to(room).emit('user-joined', { id: socket.id, username: socket.data.username })
          const users = Array.from(io.sockets.adapter.rooms.get(room) || []).map(id => ({
            id,
            username: io.sockets.sockets.get(id)?.data?.username || 'Anonymous'
          }))
          socket.emit('room-users', { room, users })
        })

        socket.on('leave-room', ({ room }) => {
          socket.leave(room)
          socket.to(room).emit('user-left', { id: socket.id })
        })

        socket.on('start-speaking', ({ room }) => {
          socket.to(room).emit('user-started-speaking', { id: socket.id })
        })
        
        socket.on('stop-speaking', ({ room }) => {
          socket.to(room).emit('user-stopped-speaking', { id: socket.id })
        })

        socket.on('webrtc-offer', (data) => {
          io.to(data.target).emit('webrtc-offer', { sdp: data.sdp, from: socket.id })
        })
        
        socket.on('webrtc-answer', (data) => {
          io.to(data.target).emit('webrtc-answer', { sdp: data.sdp, from: socket.id })
        })
        
        socket.on('webrtc-ice-candidate', (data) => {
          io.to(data.target).emit('webrtc-ice-candidate', { candidate: data.candidate, from: socket.id })
        })

        socket.on('disconnecting', () => {
          Array.from(socket.rooms)
            .filter(r => r !== socket.id)
            .forEach(room => socket.to(room).emit('user-left', { id: socket.id }))
        })
      })
      
      server.io = io
      ioInstance = io
    }
  }

  // Let Socket.IO handle the request
  res.socket.server.io.engine.handleRequest(req, res)
}