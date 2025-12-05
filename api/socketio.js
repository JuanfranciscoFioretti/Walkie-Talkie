import { Server } from 'socket.io'

const SocketHandler = (req, res) => {
  if (res.socket.server.io) {
    console.log('Socket is already running')
  } else {
    console.log('Socket is initializing')
    const io = new Server(res.socket.server, {
      path: '/api/socketio',
      addTrailingSlash: false,
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      },
      transports: ['polling', 'websocket']
    })
    
    res.socket.server.io = io

    io.on('connection', (socket) => {
      console.log('socket connected', socket.id)

      socket.on('join-room', ({ room, username }) => {
        socket.join(room)
        socket.data.username = username || 'Anonymous'
        console.log(`${socket.id} joined room ${room} as ${socket.data.username}`)
        
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
  }
  res.end()
}

export default SocketHandler