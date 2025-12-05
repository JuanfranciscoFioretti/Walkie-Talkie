import React, { useEffect, useState, useRef } from 'react'
import { io } from 'socket.io-client'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001'

export default function App() {
  const [socket, setSocket] = useState(null)
  const [room, setRoom] = useState('general')
  const [username, setUsername] = useState('Guest')
  const [connectedUsers, setConnectedUsers] = useState([])
  const [joined, setJoined] = useState(false)
  const [speaking, setSpeaking] = useState(new Set())
  const socketRef = useRef(null)

  useEffect(() => {
    const s = io(SERVER_URL)
    socketRef.current = s
    setSocket(s)

    s.on('connect', () => console.log('connected to server', s.id))
    s.on('room-users', ({ users }) => setConnectedUsers(users))
    s.on('user-joined', (u) => setConnectedUsers((prev) => [...prev, u]))
    s.on('user-left', ({ id }) => setConnectedUsers((prev) => prev.filter((p) => p.id !== id)))
    s.on('user-started-speaking', ({ id }) => setSpeaking((prev) => new Set(prev).add(id)))
    s.on('user-stopped-speaking', ({ id }) => setSpeaking((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    }))

    return () => s.disconnect()
  }, [])

  function joinRoom() {
    if (!socketRef.current) return
    socketRef.current.emit('join-room', { room, username })
    setJoined(true)
  }
  function leaveRoom() {
    if (!socketRef.current) return
    socketRef.current.emit('leave-room', { room })
    setJoined(false)
    setConnectedUsers([])
  }

  // Press-to-talk handlers
  function handleStartSpeaking() {
    if (!socketRef.current) return
    socketRef.current.emit('start-speaking', { room })
    // local visual
    setSpeaking((prev) => new Set(prev).add(socketRef.current.id))
  }
  function handleStopSpeaking() {
    if (!socketRef.current) return
    socketRef.current.emit('stop-speaking', { room })
    setSpeaking((prev) => {
      const next = new Set(prev)
      next.delete(socketRef.current.id)
      return next
    })
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 text-white">
      <div className="max-w-3xl mx-auto p-5">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">WalkieTalkie Live</h1>
          <div className="text-sm opacity-80">Server: {SERVER_URL}</div>
        </header>

        <section className="bg-slate-700/20 rounded-lg p-4 mb-6">
          <div className="flex gap-2">
            <input className="flex-1 rounded px-3 py-2 bg-slate-800" value={username} onChange={(e)=>setUsername(e.target.value)}/>
            <input className="w-40 rounded px-3 py-2 bg-slate-800" value={room} onChange={(e)=>setRoom(e.target.value)} />
            {!joined ? (
              <button className="bg-emerald-500 text-slate-900 px-3 rounded" onClick={joinRoom}>Join</button>
            ) : (
              <button className="bg-red-500 text-white px-3 rounded" onClick={leaveRoom}>Leave</button>
            )}
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 bg-slate-700/10 rounded-lg p-4">
            <h2 className="font-semibold mb-2">Channel: {room}</h2>
            <div className="space-y-2">
              {connectedUsers.length === 0 && <div className="text-sm opacity-70">No users in channel</div>}
              {connectedUsers.map((u) => (
                <div key={u.id} className="flex items-center justify-between bg-slate-800/40 p-2 rounded">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${speaking.has(u.id) ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`}></div>
                    <div className="font-medium">{u.username}</div>
                  </div>
                  <div className="text-xs opacity-60">{u.id === socketRef.current?.id ? 'You' : u.id.slice(0,6)}</div>
                </div>
              ))}
            </div>

            <div className="mt-6 text-sm opacity-80">Note: Audio & WebRTC coming next. Press and hold the big button to talk.</div>
          </div>

          <div className="bg-slate-700/10 rounded-lg p-4 flex flex-col items-center justify-center">
            <div className="mb-3 text-sm opacity-80">Press & Hold to Talk</div>
            <button
              onMouseDown={handleStartSpeaking}
              onMouseUp={handleStopSpeaking}
              onTouchStart={handleStartSpeaking}
              onTouchEnd={handleStopSpeaking}
              disabled={!joined}
              className="w-44 h-44 rounded-full bg-rose-500 flex items-center justify-center text-xl font-bold shadow-lg disabled:opacity-60"
            >
              {joined ? 'HOLD' : 'JOIN'}
            </button>
            <div className="mt-3 text-xs opacity-70">Visual indicator shows who is speaking in the channel.</div>
          </div>
        </section>

        <footer className="mt-8 text-xs opacity-70">Prototype: UI + real-time channel signaling powered by Socket.IO.</footer>
      </div>
    </div>
  )
}
