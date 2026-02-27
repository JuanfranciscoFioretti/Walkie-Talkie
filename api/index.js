import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Server } from 'socket.io'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let ioInstance = null

// Possible locations where Vercel might put the compiled client files
function getDistPath() {
  const candidates = [
    path.join(__dirname, '../client/dist'),
    path.join(process.cwd(), 'client/dist'),
    path.join('/var/task', 'client/dist'),
    path.join(__dirname, '../.vercel/output/static'),
  ]

  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.existsSync(path.join(dir, 'index.html'))) {
      console.log('[Init] Found dist at:', dir)
      return dir
    }
  }

  console.warn('[Init] No dist directory found, candidates:', candidates)
  return candidates[0] // Return first as default
}

const DIST_PATH = getDistPath()

export default function handler(req, res) {
  const url = req.url
  const isSocketIO = url.includes('socket.io') || url.startsWith('/api/socket.io')
  
  console.log('[Handler]', req.method, url, '| Socket.IO?', isSocketIO)
  
  // Initialize Socket.IO for any socket.io-related request
  if (isSocketIO) {
    console.log('[Handler] Processing Socket.IO request')
    initSocketIO(res)
    
    if (!res.socket.server.io) {
      console.error('[Handler] Socket.IO not initialized!')
      res.writeHead(500)
      return res.end('Socket.IO initialization failed')
    }
    
    try {
      res.socket.server.io.engine.handleRequest(req, res)
      console.log('[Handler] Socket.IO request handled')
    } catch (err) {
      console.error('[Handler] Socket.IO error:', err.message)
      if (!res.headersSent) {
        res.writeHead(500)
        res.end('Socket.IO error: ' + err.message)
      }
    }
    return
  }

  // All other requests: serve static files
  serveStatic(req, res)
}

function initSocketIO(res) {
  const server = res.socket.server
  
  // If Socket.IO is already attached to the server, reuse it
  if (server.io) {
    console.log('[Socket.IO] Reusing existing instance')
    ioInstance = server.io
    return
  }

  if (ioInstance) {
    console.log('[Socket.IO] Attaching existing instance to server')
    server.io = ioInstance
    return
  }

  console.log('[Socket.IO] Creating new instance')

  const io = new Server(server, {
    path: '/api/socket.io',
    addTrailingSlash: false,
    transports: ['polling'],
    allowUpgrades: false,
    cors: { 
      origin: true, 
      credentials: true, 
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['*']
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e6,
    serveClient: false,
    connectTimeout: 45000
  })

  console.log('[Socket.IO] Server configured, waiting for connections...')

  io.on('connection', (socket) => {
    console.log('[Socket.IO] ✅ Client connected:', socket.id)

    socket.on('join-room', ({ room, username }) => {
      socket.join(room)
      socket.data.username = username || 'Anonymous'
      console.log(`[Socket.IO] ✅ ${socket.id} joined ${room} as ${username}`)
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

    socket.on('disconnect', (reason) => {
      console.log('[Socket.IO] ❌ Disconnected:', socket.id, 'Reason:', reason)
      Array.from(socket.rooms)
        .filter(r => r !== socket.id)
        .forEach(room => socket.to(room).emit('user-left', { id: socket.id }))
    })

    socket.on('error', (err) => {
      console.error('[Socket.IO] ⚠️  Socket error:', socket.id, err)
    })
  })

  server.io = io
  ioInstance = io
  
  console.log('[Socket.IO] ✅ Instance created and stored')
}

function serveStatic(req, res) {
  try {
    let urlPath = req.url.split('?')[0]
    if (urlPath === '/') {
      urlPath = '/index.html'
    }

    const filePath = path.join(DIST_PATH, urlPath)
    const normalized = path.normalize(filePath)

    // Security: prevent directory traversal
    if (!normalized.startsWith(path.normalize(DIST_PATH))) {
      res.writeHead(403, { 'Content-Type': 'text/plain' })
      return res.end('Forbidden')
    }

    // Check if file exists
    if (fs.existsSync(normalized) && fs.statSync(normalized).isFile()) {
      const ext = path.extname(normalized).toLowerCase()
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
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf'
      }

      const contentType = mimeTypes[ext] || 'application/octet-stream'
      const file = fs.readFileSync(normalized)

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000'
      })
      return res.end(file)
    }

    // SPA fallback: if no file extension, serve index.html
    if (!path.extname(urlPath)) {
      const indexPath = path.join(DIST_PATH, 'index.html')
      if (fs.existsSync(indexPath)) {
        const file = fs.readFileSync(indexPath)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        return res.end(file)
      }
    }

    // 404
    console.log('[Static] Not found:', urlPath)
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('404 Not Found')
  } catch (error) {
    console.error('[Static] Error:', error.message)
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('500 Internal Server Error: ' + error.message)
  }
}
