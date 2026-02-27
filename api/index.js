import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Server } from 'socket.io'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const distPath = path.resolve(__dirname, '../client/dist')

console.log('[API] Dist path:', distPath)
console.log('[API] Dist exists:', fs.existsSync(distPath))

// Store the io instance globally
let ioInstance = null

export default function handler(req, res) {
  try {
    // Handle Socket.IO requests
    if (req.url.startsWith('/api/socket.io') || req.url === '/api/') {
      initializeSocketIO(res)
      res.socket.server.io.engine.handleRequest(req, res)
      return
    }

    // Serve static files from client/dist
    try {
      // Parse the requested file path
      let filePath = req.url === '/' ? '/index.html' : req.url
      // Remove query strings
      filePath = filePath.split('?')[0]
      filePath = path.join(distPath, filePath)

      // Security: prevent directory traversal
      const realPath = path.resolve(filePath)
      if (!realPath.startsWith(path.resolve(distPath))) {
        console.warn('[API] Directory traversal attempt:', req.url)
        res.writeHead(403)
        res.end('Forbidden')
        return
      }

      // Check if file exists
      if (fs.existsSync(realPath) && fs.statSync(realPath).isFile()) {
        const ext = path.extname(realPath)
        const mimeTypes = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.ico': 'image/x-icon',
          '.woff': 'font/woff',
          '.woff2': 'font/woff2'
        }

        const contentType = mimeTypes[ext] || 'application/octet-stream'
        const content = fs.readFileSync(realPath)

        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000'
        })
        res.end(content)
        return
      }

      // If file not found and it's not an asset request, serve index.html for SPA routing
      const ext = path.extname(req.url.split('?')[0])
      if (!ext || ext === '') {
        const indexPath = path.join(distPath, 'index.html')
        if (fs.existsSync(indexPath)) {
          const content = fs.readFileSync(indexPath)
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(content)
          return
        }
      }

      // 404
      console.warn('[API] File not found:', req.url, '→', realPath)
      res.writeHead(404)
      res.end('Not Found')
    } catch (fileError) {
      console.error('[API] File serving error:', fileError.message)
      res.writeHead(500)
      res.end('Internal Server Error: ' + fileError.message)
    }
  } catch (error) {
    console.error('[API] Handler error:', error)
    res.writeHead(500)
    res.end('Internal Server Error: ' + (error.message || 'Unknown error'))
  }
}

function initializeSocketIO(res) {
  try {
    if (!ioInstance) {
      const server = res.socket.server

      if (!server.io) {
        console.log('[Socket.IO] Initializing Socket.IO server')

        const io = new Server(server, {
          path: '/api/socket.io',
          addTrailingSlash: false,
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
  } catch (error) {
    console.error('[Socket.IO] Initialization error:', error)
  }
}
