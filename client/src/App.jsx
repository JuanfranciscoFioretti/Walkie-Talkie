import React, { useEffect, useState, useRef } from 'react'
import { io } from 'socket.io-client'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001'

export default function App() {
  const [socket, setSocket] = useState(null)
  const [joined, setJoined] = useState(false)
  const [users, setUsers] = useState([])
  const [speakingPeers, setSpeakingPeers] = useState(() => new Set())
  const [username, setUsername] = useState(() => localStorage.getItem('wt_username') || 'Guest')
  const [friends, setFriends] = useState(() => {
    try { return JSON.parse(localStorage.getItem('wt_friends') || '[]') } catch (e) { return [] }
  })
  const [friendInput, setFriendInput] = useState('')
  const [currentRoom, setCurrentRoom] = useState('general')
  const [volume, setVolume] = useState(() => Number(localStorage.getItem('wt_volume') || 0.75))
  const [audioEnabled, setAudioEnabled] = useState(false)
  // per-peer prefs are stored per-room in localStorage under `wt_peer_prefs_all`:
  // { [room]: { volumes: {...}, muted: {...} } }
  const [peerVolumes, setPeerVolumes] = useState({})
  const [peerMuted, setPeerMuted] = useState({})
  const allPeerPrefsRef = useRef({})
  useEffect(() => {
    try {
      allPeerPrefsRef.current = JSON.parse(localStorage.getItem('wt_peer_prefs_all') || '{}')
    } catch (e) {
      allPeerPrefsRef.current = {}
    }
    // initialize for default room
    const roomPrefs = allPeerPrefsRef.current[currentRoom] || {}
    setPeerVolumes(roomPrefs.volumes || {})
    setPeerMuted(roomPrefs.muted || {})
  }, [])

  // when room changes, load prefs for that room
  useEffect(() => {
    const roomPrefs = allPeerPrefsRef.current[currentRoom] || {}
    setPeerVolumes(roomPrefs.volumes || {})
    setPeerMuted(roomPrefs.muted || {})
  }, [currentRoom])

  const socketRef = useRef(null)
  const pcsRef = useRef({}) // peerId -> { pc, senders: [], audioEl }
  const localStreamRef = useRef(null)
  const audioContainerRef = useRef(null)
  const volumeBarRef = useRef(null)
  const draggingVolumeRef = useRef(false)
  const audioEnabledRef = useRef(audioEnabled)
  useEffect(()=>{ audioEnabledRef.current = audioEnabled }, [audioEnabled])
  const peerVolumesRef = useRef(peerVolumes)
  const peerMutedRef = useRef(peerMuted)
  useEffect(()=>{ peerVolumesRef.current = peerVolumes }, [peerVolumes])
  useEffect(()=>{ peerMutedRef.current = peerMuted }, [peerMuted])
  
  const [localSpeaking, setLocalSpeaking] = useState(false)

  // persist peer prefs per-room
  function persistPeerPrefs(vols, muts) {
    try {
      allPeerPrefsRef.current[currentRoom] = { volumes: vols, muted: muts }
      localStorage.setItem('wt_peer_prefs_all', JSON.stringify(allPeerPrefsRef.current))
    } catch (e) { console.warn('failed saving peer prefs', e) }
  }
  
  const pendingCandidatesRef = useRef({})

  useEffect(() => {
    const s = io(SERVER_URL)
    socketRef.current = s
    setSocket(s)

    s.on('connect', () => console.log('connected', s.id))
    s.on('room-users', ({ users }) => handleRoomUsers(users))
    s.on('user-joined', (u) => handleUserJoined(u))
    s.on('user-left', ({ id }) => handleUserLeft(id))

    s.on('webrtc-offer', async (data) => {
      const { from, sdp } = data
      console.log('received offer from', from)
      await handleRemoteOffer(from, sdp)
    })
    s.on('webrtc-answer', async (data) => {
      const { from, sdp } = data
      console.log('received answer from', from)
      const ref = pcsRef.current[from]
      if (ref && ref.pc) {
        try { await ref.pc.setRemoteDescription(new RTCSessionDescription(sdp)) } catch(e){ console.warn(e) }
      }
    })
    s.on('webrtc-ice-candidate', async (data) => {
      const { from, candidate } = data
      // If we don't have a pc yet, buffer the candidate
      if (!pcsRef.current[from]) {
        pendingCandidatesRef.current[from] = pendingCandidatesRef.current[from] || []
        pendingCandidatesRef.current[from].push(candidate)
        return
      }
      const ref = pcsRef.current[from]
      if (ref && ref.pc && candidate) {
        try { await ref.pc.addIceCandidate(new RTCIceCandidate(candidate)) } catch (e) { console.warn(e) }
      }
    })
    s.on('user-started-speaking', ({ id }) => {
      setSpeakingPeers((prev) => new Set(prev).add(id))
    })
    s.on('user-stopped-speaking', ({ id }) => {
      setSpeakingPeers((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    })

    return () => {
      s.disconnect()
      cleanupAllPeers()
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t=>t.stop())
        localStreamRef.current = null
      }
    }
  }, [])

  useEffect(()=>{
    localStorage.setItem('wt_volume', String(volume))
    // apply global volume only where no per-peer override exists
    Object.entries(pcsRef.current).forEach(([id, r]) => {
      if (r.audioEl) {
        const pvol = peerVolumesRef.current[id]
        r.audioEl.volume = typeof pvol === 'number' ? pvol : volume
      }
    })
  }, [volume])

  function handleRoomUsers(list) {
    setUsers(list)
    // when joining, create offers to existing users
    list.forEach((u) => {
      if (u.id === socketRef.current.id) return
      if (!pcsRef.current[u.id]) createPeerConnection(u.id, true)
    })
  }
  function handleUserJoined(u) {
    setUsers((prev)=>[...prev, u])
    // existing users will receive 'user-joined'; do nothing (we'll answer offers)
  }
  function handleUserLeft(id) {
    setUsers((prev)=>prev.filter(p=>p.id!==id))
    removePeer(id)
  }

  async function ensureLocalStream() {
    if (!localStreamRef.current) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true })
        localStreamRef.current = s
      } catch (e) {
        console.warn('mic access denied', e)
      }
    }
    return localStreamRef.current
  }

  function createAudioElement(peerId) {
    const audio = document.createElement('audio')
    audio.autoplay = true
    audio.controls = false
    audio.id = `audio-${peerId}`
    // apply per-peer volume if present, otherwise global
    const pvol = peerVolumesRef.current[peerId]
    audio.volume = typeof pvol === 'number' ? pvol : volume
    audio.playsInline = true
    audio.muted = !!peerMutedRef.current[peerId]
    audioContainerRef.current?.appendChild(audio)
    // try to play in case browser requires a user gesture
    const tryPlay = async () => {
      try {
        // only attempt play if user already enabled audio or else it will be blocked
        if (audioEnabledRef.current) await audio.play()
      } catch (e) { /* may be blocked until user gesture */ }
    }
    tryPlay()
    return audio
  }

  function cleanupAllPeers() {
    Object.keys(pcsRef.current).forEach(removePeer)
  }

  function removePeer(peerId) {
    const ref = pcsRef.current[peerId]
    if (!ref) return
    try { ref.pc.close() } catch(e){}
    if (ref.audioEl && ref.audioEl.parentNode) ref.audioEl.parentNode.removeChild(ref.audioEl)
    delete pcsRef.current[peerId]
  }

  async function createPeerConnection(peerId, isOfferer = false) {
    if (pcsRef.current[peerId]) return
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
    const ref = { pc, senders: [], audioEl: createAudioElement(peerId) }
    pcsRef.current[peerId] = ref

    pc.onicecandidate = (e) => {
      if (e.candidate) socketRef.current.emit('webrtc-ice-candidate', { target: peerId, candidate: e.candidate })
    }

    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        socketRef.current.emit('webrtc-offer', { target: peerId, sdp: pc.localDescription })
      } catch (err) {
        console.warn('negotiationneeded failed', err)
      }
    }

    pc.ontrack = (ev) => {
      if (ref.audioEl) {
        ref.audioEl.srcObject = ev.streams[0]
        try { ref.audioEl.play().catch(()=>{}) } catch(e){}
        // ensure volume/mute are applied when track arrives
        const pvol = peerVolumesRef.current[peerId]
        ref.audioEl.volume = typeof pvol === 'number' ? pvol : volume
        ref.audioEl.muted = !!peerMutedRef.current[peerId]
      }
    }

    // If local stream exists and we are currently 'speaking', add tracks
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => {
        const sender = pc.addTrack(t, localStreamRef.current)
        ref.senders.push(sender)
      })
    }

    if (isOfferer) {
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        socketRef.current.emit('webrtc-offer', { target: peerId, sdp: pc.localDescription })
      } catch (e) { console.warn(e) }
    }
    return pc
  }

  async function handleRemoteOffer(from, sdp) {
    // create pc if not exists
    if (!pcsRef.current[from]) await createPeerConnection(from, false)
    const ref = pcsRef.current[from]
    await ref.pc.setRemoteDescription(new RTCSessionDescription(sdp))
    // ensure local stream and add tracks if available
    const stream = await ensureLocalStream()
    if (stream) stream.getAudioTracks().forEach(t => { try { ref.senders.push(ref.pc.addTrack(t, stream)) } catch(e){} })
    const answer = await ref.pc.createAnswer()
    await ref.pc.setLocalDescription(answer)
    socketRef.current.emit('webrtc-answer', { target: from, sdp: ref.pc.localDescription })
    // flush pending ICE candidates
    const pending = pendingCandidatesRef.current[from]
    if (pending && pending.length) {
      for (const c of pending) {
        try { await ref.pc.addIceCandidate(new RTCIceCandidate(c)) } catch(e){ console.warn(e) }
      }
      delete pendingCandidatesRef.current[from]
    }
  }

  // per-peer volume/mute helpers
  function setPeerVolume(peerId, val) {
    setPeerVolumes((prev) => {
      const next = { ...prev, [peerId]: val }
      persistPeerPrefs(next, peerMutedRef.current)
      return next
    })
    const ref = pcsRef.current[peerId]
    if (ref && ref.audioEl) ref.audioEl.volume = val
  }

  function togglePeerMute(peerId) {
    setPeerMuted((prev) => {
      const next = { ...prev, [peerId]: !prev[peerId] }
      persistPeerPrefs(peerVolumesRef.current, next)
      const ref = pcsRef.current[peerId]
      if (ref && ref.audioEl) ref.audioEl.muted = !!next[peerId]
      return next
    })
  }

  // Volume pointer handlers (click or drag on the custom bar)
  function computeVolumeFromClientX(clientX) {
    const el = volumeBarRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width)
    return Number((x / rect.width).toFixed(2))
  }

  function handleVolumePointerDown(e) {
    e.preventDefault()
    draggingVolumeRef.current = true
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    setVolume(computeVolumeFromClientX(clientX))

    function moveHandler(evt) {
      const cx = evt.touches ? evt.touches[0].clientX : evt.clientX
      setVolume(computeVolumeFromClientX(cx))
    }
    function upHandler() {
      draggingVolumeRef.current = false
      window.removeEventListener('mousemove', moveHandler)
      window.removeEventListener('touchmove', moveHandler)
      window.removeEventListener('mouseup', upHandler)
      window.removeEventListener('touchend', upHandler)
    }

    window.addEventListener('mousemove', moveHandler)
    window.addEventListener('touchmove', moveHandler, { passive: false })
    window.addEventListener('mouseup', upHandler)
    window.addEventListener('touchend', upHandler)
  }

  async function joinRoom(room = 'general') {
    if (!socketRef.current) return
    socketRef.current.emit('join-room', { room, username })
    setCurrentRoom(room)
    setJoined(true)
  }
  function leaveRoom() {
    if (!socketRef.current) return
    socketRef.current.emit('leave-room', { room: currentRoom })
    setJoined(false)
    setUsers([])
    setCurrentRoom('general')
    cleanupAllPeers()
  }

  async function handleStartSpeaking() {
    await ensureLocalStream()
    // add tracks to existing peer connections
    Object.values(pcsRef.current).forEach(ref => {
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach(t => {
          const sender = ref.pc.addTrack(t, localStreamRef.current)
          ref.senders.push(sender)
        })
      }
    })
    socketRef.current.emit('start-speaking', { room: currentRoom })
    setLocalSpeaking(true)
  }

  function handleStopSpeaking() {
    // remove local senders
    Object.values(pcsRef.current).forEach(ref => {
      ref.senders.forEach(s => {
        try { ref.pc.removeTrack(s) } catch (e) {}
      })
      ref.senders = []
    })
    socketRef.current.emit('stop-speaking', { room: currentRoom })
    setLocalSpeaking(false)
  }

  // Friend management
  function saveFriends(next) { setFriends(next); localStorage.setItem('wt_friends', JSON.stringify(next)) }
  function addFriend(name) { const trimmed = (name||'').trim(); if(!trimmed) return; if (friends.includes(trimmed)) return; const next=[...friends,trimmed]; saveFriends(next); setFriendInput('') }
  function removeFriend(name) { const next = friends.filter((f)=>f!==name); saveFriends(next) }
  function startDM(friend) { const pair = [username||'Guest', friend].map(s=>s.replace(/\s+/g,'_')); const room = `dm-${pair.sort().join('-')}`; joinRoom(room) }
  useEffect(()=>{ localStorage.setItem('wt_username', username) }, [username])

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden p-4 pb-40">
      <div className="absolute inset-0 z-0">
        <div className="absolute bottom-0 left-[-20%] right-0 top-[-10%] h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle_farthest-side,rgba(37,140,244,0.2),rgba(255,255,255,0))]"></div>
        <div className="absolute bottom-[-10%] right-[-20%] top-0 h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle_farthest-side,rgba(37,140,244,0.15),rgba(255,255,255,0))]"></div>
      </div>

      <div className="relative z-10 mx-auto flex h-full max-h-[800px] w-full max-w-[420px] flex-col rounded-xl">
        <div className="glass-effect flex w-full flex-col rounded-[48px] p-6 shadow-2xl">
          {/* <div className="flex items-center justify-between px-4 pb-4">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-white/80">wifi</span>
              <span className="text-sm font-medium text-white/80">100%</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-white/80">95%</span>
              <span className="material-symbols-outlined text-white/80 -rotate-90">battery_full_alt</span>
            </div>
          </div> */}

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
            <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-white">{currentRoom.startsWith('dm-') ? 'Conversación privada' : 'Canal General'}</h1>
            <p className="font-display text-sm font-normal leading-normal text-green-400">{joined ? 'Conectado' : 'Desconectado'}</p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <input value={username} onChange={(e)=>setUsername(e.target.value)} className="rounded px-2 py-1 text-sm bg-white/5 text-white placeholder-white/50" placeholder="Tu nombre" />
            </div>
          </div>

          <div className="flex flex-col items-center gap-4 py-8">
            <div className="w-full max-w-xs">
              <div className="relative flex w-full flex-col items-start justify-between gap-3 p-4">
                <div className="flex w-full shrink-[3] items-center justify-between">
                  <p className="font-display text-base font-medium leading-normal text-white">Volumen</p>
                  <p className="font-display text-sm font-normal leading-normal text-white">{Math.round(volume*100)}%</p>
                </div>
                <div className="flex h-6 w-full items-center gap-4">
                  <div
                    ref={volumeBarRef}
                    className="relative w-full"
                    onMouseDown={(e)=>handleVolumePointerDown(e)}
                    onTouchStart={(e)=>handleVolumePointerDown(e)}
                  >
                    <div className="flex h-1.5 w-full items-center">
                      <div className="h-1.5 flex-1 rounded-full bg-white/20">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(volume*100)}%` }} />
                      </div>
                    </div>
                    <div
                      className="absolute -top-2 h-4 w-4 rounded-full border-2 border-primary bg-background-dark"
                      style={{ left: `calc(${Math.round(volume*100)}% - 0.5rem)` }}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="w-full max-w-xs pt-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium text-white">Participantes</div>
              </div>
              <div className="mt-1 space-y-2">
                {users.length === 0 && <div className="text-sm opacity-70">No hay participantes</div>}
                {users.map((u) => (
                  <div key={u.id} className="flex items-center justify-between bg-slate-800/30 p-2 rounded">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${speakingPeers.has(u.id) ? 'bg-emerald-400 animate-pulse' : (u.id === socketRef.current?.id ? 'bg-emerald-300' : 'bg-slate-500')}`}></div>
                      <div className="font-medium text-white">{u.username}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={()=>togglePeerMute(u.id)} className="px-2 py-1 rounded bg-white/5 text-white/80 text-sm">{peerMuted[u.id] ? 'Unmute' : 'Mute'}</button>
                      <input type="range" min="0" max="1" step="0.01" value={peerVolumes[u.id] ?? volume} onChange={(e)=>setPeerVolume(u.id, Number(e.target.value))} className="w-24" />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 mb-2 flex items-center justify-between">
                <div className="text-sm font-medium text-white">Amigos</div>
              </div>
              <div className="flex gap-2">
                <input className="flex-1 rounded px-3 py-2 bg-slate-800 text-white" value={friendInput} onChange={(e)=>setFriendInput(e.target.value)} placeholder="Añadir amigo" />
                <button className="bg-primary px-3 rounded text-sm" onClick={()=>addFriend(friendInput)}>Añadir</button>
              </div>
              <div className="mt-3 space-y-2">
                {friends.length === 0 && <div className="text-sm opacity-70">No tienes amigos añadidos</div>}
                {friends.map((f) => (
                  <div key={f} className="flex items-center justify-between bg-slate-800/30 p-2 rounded">
                    <div className="font-medium text-white">{f}</div>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const dm = (['Guest', username].map ? (() => {}) : null) // noop to keep linter happy
                        const pair = [username||'Guest', f].map(s => s.replace(/\s+/g, '_'))
                        const dmRoom = `dm-${pair.sort().join('-')}`
                        const disabled = currentRoom === dmRoom
                        return (
                          <button
                            disabled={disabled}
                            onClick={() => !disabled && startDM(f)}
                            className={`text-sm px-2 py-1 rounded ${disabled ? 'bg-white/10 text-white/50 cursor-not-allowed' : 'bg-emerald-500'}`}
                          >
                            {disabled ? 'Chat abierto' : 'Chat'}
                          </button>
                        )
                      })()}
                      <button className="text-sm px-2 py-1 bg-red-500 rounded" onClick={()=>{ if (confirm(`Eliminar amigo ${f}?`)) removeFriend(f) }}>Eliminar</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center gap-6 px-4 py-3">
            <button
              onMouseDown={() => (joined ? handleStartSpeaking() : joinRoom())}
              onMouseUp={() => joined && handleStopSpeaking()}
              onTouchStart={() => (joined ? handleStartSpeaking() : joinRoom())}
              onTouchEnd={() => joined && handleStopSpeaking()}
              className={
                `flex h-16 w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-xl px-5 text-white shadow-[0_0_20px_rgba(37,140,244,0.5)] transition-transform duration-200 ease-in-out active:scale-95 ` +
                (localSpeaking ? 'bg-emerald-500 ring-4 ring-primary/30 animate-pulse scale-105' : 'bg-primary')
              }
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
              {!audioEnabled ? (
                <button onClick={async ()=>{
                  // user gesture: attempt to play any existing audio elements
                  setAudioEnabled(true)
                  const nodes = audioContainerRef.current?.querySelectorAll('audio') || []
                  for (const a of nodes) {
                    try { a.muted = false; await a.play() } catch(e){}
                  }
                }} className="flex h-12 items-center px-3 rounded bg-emerald-500 text-slate-900 font-medium">Enable Audio</button>
              ) : (
                <button className="flex h-12 items-center px-3 rounded bg-white/10 text-white/70">Audio On</button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div ref={audioContainerRef} style={{ display: 'none' }} />
    </div>
  )
}
