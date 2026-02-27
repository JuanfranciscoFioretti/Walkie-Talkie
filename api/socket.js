import fs from 'fs'
import path from 'path'
import { Server } from 'socket.io'

let ioInstance = null

export default function handler(req, res) {
  // Handle Socket.IO
  if (req.url.startsWith('/api/socket.io')) {
    return handleSocketIO(req, res)
  }

  // Serve static files
  try {
    let filePath = req.url === '/' ? 'index.html' : req.url.split('?')[0]
    
    // Remove leading slash for file path
    if (filePath.startsWith('/')) {
      filePath = filePath.slice(1)
    }
    
    // Skip /api requests (except socket.io which is already handled)
    if (filePath.startsWith('api/') && !filePath.startsWith('api/socket.io')) {
      res.writeHead(404)
      return res.end('Not Found')
    }
    
    // Try multiple possible paths for the dist directory
    const possiblePaths = [
      path.join(process.cwd(), 'client', 'dist', filePath),
      path.join(process.cwd(), '.vercel', 'output', 'static', filePath),
      path.join('/var/task', 'client', 'dist', filePath),
      path.join('/var/task', '.vercel', 'output', 'static', filePath)
    ]
    
    let finalPath = null
    for (const p of possiblePaths) {
      console.log('[Static] Checking:', p)
      if (fs.existsSync(p)) {
        finalPath = p
        console.log('[Static] Found at:', p)
        break
      }
    }

    // Check if file exists
    if (finalPath && fs.existsSync(finalPath)) {
      const stats = fs.statSync(finalPath)
      if (stats.isFile()) {
        const ext = path.extname(finalPath).toLowerCase()
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
        const content = fs.readFileSync(finalPath)

        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': ext === '.html' ? 'no-cache, no-store, must-revalidate' : 'public, max-age=31536000'
        })
        return res.end(content)
      }
    }

    // If no file extension, try serving index.html (SPA routing)
    const ext = path.extname(filePath)
    if (!ext) {
      for (const basePath of possiblePaths) {
        const indexPath = basePath.replace(filePath || '', 'index.html')
        console.log('[Static] Trying index at:', indexPath)
        if (fs.existsSync(indexPath)) {
          const content = fs.readFileSync(indexPath)
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          return res.end(content)
        }
      }
    }

    // Not found
    console.log('[Static] File not found:', filePath)
    res.writeHead(404)
    res.end('Not Found')
  } catch (error) {
    console.error('[Static] Error:', error.message, error.stack)
    res.writeHead(500)
    res.end('Internal Server Error: ' + error.message)
  }
}

function handleSocketIO(req, res) {
  try {
    if (!ioInstance) {
      const server = res.socket.server

      if (!server.io) {
        console.log('[Socket.IO] Initializing')

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

    res.socket.server.io.engine.handleRequest(req, res)
  } catch (error) {
    console.error('[Socket.IO] Error:', error.message)
    res.writeHead(500)
    res.end('Socket.IO Error')
  }
}