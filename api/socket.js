import { Server } from 'socket.io'

export default function handler(req, res) {
  // Reuse existing Socket.IO instance or create a new one
  if (!res.socket.server.io) {
    console.log('[Socket.IO] Creating new server instance')
    
    const io = new Server(res.socket.server, {
      path: '/api/socket.io',
      addTrailingSlash: false,
      // Serverless: polling ONLY, no WebSocket (Vercel limitation)
      transports: ['polling'],
      allowUpgrades: false,
      pingTimeout: 60000,
      pingInterval: 25000,
      cors: {
        origin: true,
        methods: ['GET', 'POST', 'OPTIONS'],
        credentials: true,
        allowedHeaders: '*'
      },
      // Serverless optimizations
      connectTimeout: 45000,
      maxHttpBufferSize: 1e6,
      serveClient: false
    })

    io.on('connection', (socket) => {
      console.log('[Socket.IO] Client connected:', socket.id)

      socket.on('join-room', ({ room, username }) => {
        socket.join(room)
        socket.data.username = username || 'Anonymous'
        console.log(`[Socket.IO] ${socket.id} joined room ${room} as ${socket.data.username}`)
        
        socket.to(room).emit('user-joined', { id: socket.id, username: socket.data.username })
        
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
        const rooms = Array.from(socket.rooms).filter((r) => r !== socket.id)
        rooms.forEach((room) => {
          socket.to(room).emit('user-left', { id: socket.id })
        })
      })
    })

    res.socket.server.io = io
  }
  
  // Socket.IO handles the request - don't call res.end() or res.socket.destroy()
  // Let Socket.IO manage the connection lifecycle
  res.socket.server.io.engine.handleUpgrade(req, res.socket, Buffer.alloc(0), (ws) => {
    res.socket.server.io.engine.ws.emit('connection', ws)
  })
}