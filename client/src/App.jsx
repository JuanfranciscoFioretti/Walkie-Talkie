import React, { useEffect, useState, useRef } from 'react'
import { io } from 'socket.io-client'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001'

export default function App() {
  const [socket, setSocket] = useState(null)
  const [joined, setJoined] = useState(false)
  const [users, setUsers] = useState([])
  const socketRef = useRef(null)

  useEffect(() => {
    const s = io(SERVER_URL)
    socketRef.current = s
    setSocket(s)

    s.on('connect', () => console.log('connected', s.id))
    s.on('room-users', ({ users }) => setUsers(users))
    s.on('user-joined', (u) => setUsers((prev) => [...prev, u]))
    s.on('user-left', ({ id }) => setUsers((prev) => prev.filter((p) => p.id !== id)))
    s.on('disconnect', () => {
      setJoined(false)
      setUsers([])
    })

    return () => s.disconnect()
  }, [])

  function joinRoom() {
    if (!socketRef.current) return
    socketRef.current.emit('join-room', { room: 'general', username: 'Guest' })
    setJoined(true)
  }
  function leaveRoom() {
    if (!socketRef.current) return
    socketRef.current.emit('leave-room', { room: 'general' })
    setJoined(false)
    setUsers([])
  }

  function handleStartSpeaking() {
    if (!socketRef.current) return
    socketRef.current.emit('start-speaking', { room: 'general' })
  }
  function handleStopSpeaking() {
    if (!socketRef.current) return
    socketRef.current.emit('stop-speaking', { room: 'general' })
  }

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden p-4">
      <div className="absolute inset-0 z-0">
        <div className="absolute bottom-0 left-[-20%] right-0 top-[-10%] h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle_farthest-side,rgba(37,140,244,0.2),rgba(255,255,255,0))]"></div>
        <div className="absolute bottom-[-10%] right-[-20%] top-0 h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle_farthest-side,rgba(37,140,244,0.15),rgba(255,255,255,0))]"></div>
      </div>

      <div className="relative z-10 mx-auto flex h-full max-h-[800px] w-full max-w-[420px] flex-col rounded-xl">
        <div className="glass-effect flex w-full flex-col rounded-[48px] p-6 shadow-2xl">
          <div className="flex items-center justify-between px-4 pb-4">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-white/80">wifi</span>
              <span className="text-sm font-medium text-white/80">100%</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-white/80">95%</span>
              <span className="material-symbols-outlined text-white/80 -rotate-90">battery_full_alt</span>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center py-8">
            <div className="relative flex h-32 w-32 items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-primary/20"></div>
              <div className="absolute inset-2 rounded-full bg-primary/30"></div>
              <div className="absolute inset-4 rounded-full bg-primary/50 flex items-center justify-center">
                <span className="material-symbols-outlined text-white text-6xl">cell_tower</span>
              </div>
            </div>
          </div>

          <div className="text-center">
            <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-white">Canal General</h1>
            <p className="font-display text-sm font-normal leading-normal text-green-400">{joined ? 'Conectado' : 'Desconectado'}</p>
          </div>

          <div className="flex flex-col items-center gap-4 py-8">
            <div className="w-full max-w-xs">
              <div className="relative flex w-full flex-col items-start justify-between gap-3 p-4">
                <div className="flex w-full shrink-[3] items-center justify-between">
                  <p className="font-display text-base font-medium leading-normal text-white">Volumen</p>
                  <p className="font-display hidden text-sm font-normal leading-normal text-white @[480px]:block">75%</p>
                </div>
                <div className="flex h-4 w-full items-center gap-4">
                  <div className="flex h-1.5 flex-1 rounded-full bg-white/20">
                    <div className="h-full w-[75%] rounded-full bg-primary"></div>
                    <div className="relative">
                      <div className="absolute -left-2 -top-[5px] h-4 w-4 rounded-full border-2 border-primary bg-background-dark"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center gap-6 px-4 py-3">
            <button
              onMouseDown={() => (joined ? handleStartSpeaking() : joinRoom())}
              onMouseUp={() => joined && handleStopSpeaking()}
              onTouchStart={() => (joined ? handleStartSpeaking() : joinRoom())}
              onTouchEnd={() => joined && handleStopSpeaking()}
              className="flex h-16 w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-xl bg-primary px-5 text-white shadow-[0_0_20px_rgba(37,140,244,0.5)] transition-transform duration-200 ease-in-out active:scale-95"
            >
              <span className="material-symbols-outlined text-white text-2xl">mic</span>
              <span className="font-display truncate text-lg font-bold leading-normal tracking-[0.015em]">{joined ? 'Pulsar para Hablar' : 'Unirse'}</span>
            </button>

            <div className="flex w-full justify-around gap-2 py-2">
              <button className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white/70 transition-colors hover:bg-white/20">
                <span className="material-symbols-outlined">mic_off</span>
              </button>
              <button className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white/70 transition-colors hover:bg-white/20">
                <span className="material-symbols-outlined">volume_off</span>
              </button>
              <button onClick={leaveRoom} className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white/70 transition-colors hover:bg-white/20">
                <span className="material-symbols-outlined">logout</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
