import React, { useEffect, useState, useRef } from 'react'
import { io } from 'socket.io-client'
import en from './locales/en'
import es from './locales/es'
import da from './locales/da'

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
  const [localMuted, setLocalMuted] = useState(false)
  const [playbackMuted, setPlaybackMuted] = useState(false)
  const [localeKey, setLocaleKey] = useState(() => localStorage.getItem('wt_locale') || 'es')
  const locales = { en, es, da }
  const t = (k) => (locales[localeKey] && locales[localeKey][k]) || locales.en[k] || k

  const clearLocalData = () => {
    const keys = ['wt_username','wt_friends','wt_volume','wt_peer_prefs_all','wt_locale','wt_theme','wt_peer_prefs']
    keys.forEach(k=>localStorage.removeItem(k))
    Object.keys(localStorage).forEach(k=>{ if (k && k.startsWith('wt_')) localStorage.removeItem(k) })
    setFriends([])
    setUsername('')
    setPeerVolumes({})
    setPeerMuted({})
    setLocaleKey('en')
    setTheme('dark')
    document.documentElement.classList.remove('light')
    document.documentElement.classList.add('dark')
    setSettingsOpen(false)
    showNotice(t('clearSuccess'))
  }
  useEffect(()=>{ localStorage.setItem('wt_locale', localeKey) }, [localeKey])

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem('wt_theme') || 'dark')
  useEffect(()=>{ document.documentElement.classList.toggle('dark', theme === 'dark'); localStorage.setItem('wt_theme', theme) }, [theme])

  const [notice, setNotice] = useState(null)
  function showNotice(msg){ setNotice(msg); setTimeout(()=>setNotice(null), 3000) }

  const [peerVolumes, setPeerVolumes] = useState({})
  const [peerMuted, setPeerMuted] = useState({})
  const allPeerPrefsRef = useRef({})
  useEffect(() => {
    try {
      allPeerPrefsRef.current = JSON.parse(localStorage.getItem('wt_peer_prefs_all') || '{}')
    } catch (e) {
      allPeerPrefsRef.current = {}
    }
    const roomPrefs = allPeerPrefsRef.current[currentRoom] || {}
    setPeerVolumes(roomPrefs.volumes || {})
    setPeerMuted(roomPrefs.muted || {})
  }, [])

  useEffect(() => {
    const roomPrefs = allPeerPrefsRef.current[currentRoom] || {}
    setPeerVolumes(roomPrefs.volumes || {})
    setPeerMuted(roomPrefs.muted || {})
  }, [currentRoom])

  const socketRef = useRef(null)
  const pcsRef = useRef({})
  const localStreamRef = useRef(null)
  const audioContainerRef = useRef(null)
  const volumeBarRef = useRef(null)
  const draggingVolumeRef = useRef(false)
  const audioEnabledRef = useRef(audioEnabled)
  useEffect(()=>{ audioEnabledRef.current = audioEnabled }, [audioEnabled])
  const localMutedRef = useRef(localMuted)
  useEffect(()=>{ localMutedRef.current = localMuted }, [localMuted])
  const playbackMutedRef = useRef(playbackMuted)
  useEffect(()=>{ playbackMutedRef.current = playbackMuted }, [playbackMuted])
  const peerVolumesRef = useRef(peerVolumes)
  const peerMutedRef = useRef(peerMuted)
  useEffect(()=>{ peerVolumesRef.current = peerVolumes }, [peerVolumes])
  useEffect(()=>{ peerMutedRef.current = peerMuted }, [peerMuted])
  
  const [localSpeaking, setLocalSpeaking] = useState(false)

  function persistPeerPrefs(vols, muts) {
    try {
      allPeerPrefsRef.current[currentRoom] = { volumes: vols, muted: muts }
      localStorage.setItem('wt_peer_prefs_all', JSON.stringify(allPeerPrefsRef.current))
    } catch (e) { console.warn('failed saving peer prefs', e) }
  }
  
  const pendingCandidatesRef = useRef({})

  useEffect(() => {
    const isProduction = import.meta.env.PROD
    console.log('🚀 Socket Init:', { 
      PROD: isProduction,
      VITE_SERVER_URL: import.meta.env.VITE_SERVER_URL,
      origin: typeof window !== 'undefined' ? window.location.origin : 'N/A'
    })
    
    // In production (Vercel), connect to same origin with /api/socket.io path
    // In development, connect to localhost:3001
    const socketConfig = {
      path: isProduction ? '/api/socket.io' : '/socket.io',
      transports: isProduction ? ['polling'] : ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      timeout: 20000,
      upgrade: !isProduction
    }
    
    // Server URL: in production use same origin, in development use localhost:3001
    const url = isProduction ? undefined : 'http://localhost:3001'
    
    console.log('📡 Socket Config:', { 
      url: url || 'same origin',
      path: socketConfig.path, 
      transports: socketConfig.transports
    })
    
    const s = io(url, socketConfig)
    socketRef.current = s
    setSocket(s)

    s.on('connect', () => {
      console.log('✅ Connected:', s.id)
      showNotice('Connected to server')
    })
    
    s.on('connect_error', (error) => {
      console.error('❌ Connection error:', error)
      showNotice('Connecting to server...')
    })
    
    s.on('disconnect', (reason) => {
      console.log('❌ Disconnected:', reason)
      if (reason === 'io server disconnect') {
        showNotice('Server disconnected')
      } else if (reason !== 'io client namespace disconnect') {
        showNotice('Connection lost, reconnecting...')
      }
    })

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
    Object.entries(pcsRef.current).forEach(([id, r]) => {
      if (r.audioEl) {
        const pvol = peerVolumesRef.current[id]
        r.audioEl.volume = typeof pvol === 'number' ? pvol : volume
      }
    })
  }, [volume])

  function handleRoomUsers(list) {
    setUsers(list)
    list.forEach((u) => {
      if (u.id === socketRef.current.id) return
      if (!pcsRef.current[u.id]) createPeerConnection(u.id, true)
    })
  }
  function handleUserJoined(u) {
    setUsers((prev)=>[...prev, u])
  }
  function handleUserLeft(id) {
    setUsers((prev)=>prev.filter(p=>p.id!==id))
    removePeer(id)
  }

  async function ensureLocalStream() {
    if (!localStreamRef.current) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ 
          audio: { 
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 44100
          } 
        })
        localStreamRef.current = s
        console.log('Stream de audio obtenido correctamente')
        
        const audioContext = new AudioContext()
        const analyser = audioContext.createAnalyser()
        const microphone = audioContext.createMediaStreamSource(s)
        microphone.connect(analyser)
        analyser.fftSize = 256
        const bufferLength = analyser.frequencyBinCount
        const dataArray = new Uint8Array(bufferLength)
        
        const checkAudioLevel = () => {
          analyser.getByteFrequencyData(dataArray)
          const average = dataArray.reduce((a, b) => a + b) / bufferLength
          const isSpeaking = average > 10
          if (isSpeaking !== localSpeaking) {
            setLocalSpeaking(isSpeaking)
          }
          if (audioEnabledRef.current) {
            requestAnimationFrame(checkAudioLevel)
          }
        }
        
        if (audioEnabledRef.current) {
          checkAudioLevel()
        }
        
      } catch (e) {
        console.warn('Acceso al micrófono denegado:', e)
        let errorMsg = t('micAccessDenied') || 'No se pudo acceder al micrófono'
        if (e.message.includes('HTTPS')) {
          errorMsg = 'Se requiere HTTPS para acceder al micrófono'
        }
        showNotice(errorMsg)
      }
    }
    return localStreamRef.current
  }

  function createAudioElement(peerId) {
    const audio = document.createElement('audio')
    audio.autoplay = true
    audio.controls = false
    audio.id = `audio-${peerId}`
    const pvol = peerVolumesRef.current[peerId]
    audio.volume = typeof pvol === 'number' ? pvol : volume
    audio.playsInline = true
    audio.muted = !!peerMutedRef.current[peerId]
    audioContainerRef.current?.appendChild(audio)
    const tryPlay = async () => {
      try {
        if (audioEnabledRef.current) await audio.play()
      } catch (e) {}
    }
    tryPlay()
    return audio
  }

  function cleanupAllPeers() {
    Object.keys(pcsRef.current).forEach(removePeer)
  }

  function forceReconnectPeers() {
    const currentUsers = [...users]
    cleanupAllPeers()
    setTimeout(() => {
      currentUsers.forEach((u) => {
        if (u.id !== socketRef.current?.id) {
          createPeerConnection(u.id, true)
        }
      })
    }, 100)
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
    
    const iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
    
    const pc = new RTCPeerConnection({ 
      iceServers,
      iceCandidatePoolSize: 10
    })
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
        const pvol = peerVolumesRef.current[peerId]
        ref.audioEl.volume = typeof pvol === 'number' ? pvol : volume
        ref.audioEl.muted = !!peerMutedRef.current[peerId]
      }
    }

    if (localStreamRef.current && localSpeaking) {
      localStreamRef.current.getAudioTracks().forEach((t) => {
        try {
          const sender = pc.addTrack(t, localStreamRef.current)
          ref.senders.push(sender)
        } catch (e) {
          console.warn('Error agregando track inicial:', e)
        }
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
    if (!pcsRef.current[from]) await createPeerConnection(from, false)
    const ref = pcsRef.current[from]
    await ref.pc.setRemoteDescription(new RTCSessionDescription(sdp))
    const stream = await ensureLocalStream()
    if (stream && localSpeaking && ref.senders.length === 0) {
      stream.getAudioTracks().forEach(t => {
        try {
          const sender = ref.pc.addTrack(t, stream)
          ref.senders.push(sender)
        } catch(e) {
          console.warn('Error agregando track en remote offer:', e)
        }
      })
    }
    const answer = await ref.pc.createAnswer()
    await ref.pc.setLocalDescription(answer)
    socketRef.current.emit('webrtc-answer', { target: from, sdp: ref.pc.localDescription })
    const pending = pendingCandidatesRef.current[from]
    if (pending && pending.length) {
      for (const c of pending) {
        try { await ref.pc.addIceCandidate(new RTCIceCandidate(c)) } catch(e){ console.warn(e) }
      }
      delete pendingCandidatesRef.current[from]
    }
  }

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

  function toggleLocalMute() {
    setLocalMuted((prev) => {
      const next = !prev
      try {
        if (localStreamRef.current) {
          localStreamRef.current.getAudioTracks().forEach(t => {
            if (!localSpeaking) {
              t.enabled = !next
            }
          })
        }
      } catch (e) { console.warn('toggleLocalMute failed', e) }
      return next
    })
  }

  function togglePlaybackMute() {
    setPlaybackMuted((prev) => {
      const next = !prev
      try {
        const nodes = audioContainerRef.current?.querySelectorAll('audio') || []
        for (const a of nodes) { a.muted = next }
      } catch (e) { console.warn('togglePlaybackMute failed', e) }
      return next
    })
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
    if (localSpeaking) return 
    
    console.log('Iniciando transmisión de audio...')
    await ensureLocalStream()
    if (!localStreamRef.current) {
      console.warn('No se pudo obtener el stream de audio')
      showNotice('Error: No se puede acceder al micrófono')
      return
    }
    
    localStreamRef.current.getAudioTracks().forEach(t => { 
      t.enabled = true 
      console.log('Track habilitado:', t.label)
    })
    
    Object.entries(pcsRef.current).forEach(([peerId, ref]) => {
      if (localStreamRef.current && ref.senders.length === 0) {
        localStreamRef.current.getAudioTracks().forEach(t => {
          try {
            const sender = ref.pc.addTrack(t, localStreamRef.current)
            ref.senders.push(sender)
            console.log('Track agregado a peer:', peerId)
          } catch (e) {
            console.warn('Error agregando track a peer', peerId, ':', e)
          }
        })
      }
    })
    
    socketRef.current?.emit('start-speaking', { room: currentRoom })
    setLocalSpeaking(true)
    console.log('Transmisión de audio iniciada')
  }

  function handleStopSpeaking() {
    if (!localSpeaking) return
    
    console.log('Deteniendo transmisión de audio...')
    
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(t => {
        t.enabled = false
        console.log('Track deshabilitado:', t.label)
      })
    }
    
    socketRef.current?.emit('stop-speaking', { room: currentRoom })
    setLocalSpeaking(false)
    console.log('Transmisión de audio detenida')
  }

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
        
        <button
          onClick={()=>setSettingsOpen(s=>!s)}
          aria-label={settingsOpen ? 'Close settings' : 'Open settings'}
          className={`absolute top-4 right-5 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-panel/80 text-var ${theme === 'light' ? 'shadow-none' : 'shadow-md'} transition-colors duration-150 ease-in-out hover:brightness-105 ${settingsOpen ? 'sm:flex hidden' : ''}`}
        >
          <span className="material-symbols-outlined">{settingsOpen ? 'arrow_back' : 'settings'}</span>
        </button>
        <div className="glass-effect flex w-full flex-col rounded-[48px] p-6 shadow-2xl">
          <div className="flex flex-col items-center justify-center py-8">
            <div className="relative flex h-32 w-32 items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-primary/20"></div>
              <div className="absolute inset-2 rounded-full bg-primary/30"></div>
                <div className="absolute inset-4 rounded-full bg-icon flex items-center justify-center">
                  <span className="material-symbols-outlined icon-top text-6xl">cell_tower</span>
                </div>
            </div>
          </div>

            <div className="text-center">
            <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-var">{currentRoom.startsWith('dm-') ? t('chat') : t('channelTitle')}</h1>
            <p className="font-display text-sm font-normal leading-normal text-green-400">{joined ? t('connected') : t('disconnected')}</p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <input value={username} onChange={(e)=>setUsername(e.target.value)} className="rounded px-2 py-1 text-sm bg-input-darker text-var placeholder:text-secondary" placeholder={t('placeholderName')} />
            </div>
          </div>

          <div className="flex flex-col items-center gap-4 py-8">
            <div className="w-full max-w-xs">
              <div className="relative flex w-full flex-col items-start justify-between gap-3 p-4">
                <div className="flex w-full shrink-[3] items-center justify-between">
                  <p className="font-display text-base font-medium leading-normal text-var">{t('volume')}</p>
                  <p className="font-display text-sm font-normal leading-normal text-secondary">{Math.round(volume*100)}%</p>
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
                        className="absolute h-4 w-4 rounded-full border-2 border-primary knob-bg"
                        style={{ left: `${Math.round(volume*100)}%`, top: '50%', transform: 'translate(-50%, -50%)' }}
                      />
                  </div>
                </div>
              </div>
            </div>
            <div className="w-full max-w-xs pt-4">
                <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium text-var">{t('participants')}</div>
              </div>
              <div className="mt-1 space-y-2">
                {users.length === 0 && <div className="text-sm opacity-70 text-secondary">{t('noParticipants')}</div>}
                {users.map((u) => (
                  <div key={u.id} className="flex items-center justify-between bg-slate-800/30 p-2 rounded">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${speakingPeers.has(u.id) ? 'bg-emerald-400 animate-pulse' : (u.id === socketRef.current?.id ? 'bg-emerald-300' : 'bg-slate-500')}`}></div>
                      <div className="font-medium text-var">{u.username}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={()=>togglePeerMute(u.id)} className="px-2 py-1 rounded bg-input text-secondary text-sm">{peerMuted[u.id] ? t('unmute') : t('mute')}</button>
                      <input type="range" min="0" max="1" step="0.01" value={peerVolumes[u.id] ?? volume} onChange={(e)=>setPeerVolume(u.id, Number(e.target.value))} className="w-24" />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 mb-2 flex items-center justify-between">
                <div className="text-sm font-medium text-var">{t('friends')}</div>
              </div>
              <div className="flex gap-2">
                <input className="flex-1 rounded px-3 py-2 bg-input-darker text-var" value={friendInput} onChange={(e)=>setFriendInput(e.target.value)} placeholder={t('addFriend')} />
                <button className="bg-primary px-3 rounded text-sm whitespace-nowrap text-add-friend" onClick={()=>addFriend(friendInput)}>{t('addFriend')}</button>
              </div>
              <div className="mt-3 space-y-2">
                {friends.length === 0 && <div className="text-sm opacity-70">{t('noFriends')}</div>}
                {friends.map((f) => (
                  <div key={f} className="flex items-center justify-between bg-input-darker p-2 rounded">
                    <div className="font-medium text-var">{f}</div>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const pair = [username||'Guest', f].map(s => s.replace(/\s+/g, '_'))
                        const dmRoom = `dm-${pair.sort().join('-')}`
                        const disabled = currentRoom === dmRoom
                        return (
                          <button
                            disabled={disabled}
                            onClick={() => !disabled && startDM(f)}
                            className={`text-sm px-2 py-1 rounded ${disabled ? 'bg-white/10 text-secondary cursor-not-allowed' : 'bg-emerald-500 text-chat'}`}
                          >
                              {disabled ? t('chatOpen') : t('chat')}
                          </button>
                        )
                      })()}
                      <button className="text-sm px-2 py-1 bg-red-500 rounded text-delete" onClick={()=>{ if (confirm(`${t('deleteFriendConfirm')} ${f}?`)) removeFriend(f) }}>{t('delete')}</button>
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
                `flex h-16 w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-xl px-5 text-var transition-transform duration-200 ease-in-out active:scale-95 ` +
                (localSpeaking ? 'bg-emerald-500 ring-4 ring-primary/30 animate-pulse scale-105 shadow-[0_0_20px_rgba(16,185,129,0.6)]' : 'bg-primary shadow-[0_0_20px_rgba(37,140,244,0.5)] animate-[pulse_3s_ease-in-out_infinite]')
              }
              style={!localSpeaking ? {
                animation: 'pulse 3s ease-in-out infinite',
                '@keyframes pulse': {
                  '0%, 100%': { opacity: 1 },
                  '50%': { opacity: 0.85 }
                }
              } : {}}
            >
              <span className="material-symbols-outlined text-join text-2xl">mic</span>
              <span className="font-display truncate text-lg font-bold leading-normal tracking-[0.015em] text-join">{joined ? t('pressToTalk') : t('join')}</span>
            </button>

            <div className="flex w-full justify-around gap-2 py-2">
              <button onClick={toggleLocalMute} className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${localMuted ? 'bg-red-500 text-delete' : 'bg-white/10 text-secondary'} hover:brightness-105` }>
                <span className="material-symbols-outlined">mic_off</span>
              </button>
              <button onClick={togglePlaybackMute} className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${playbackMuted ? 'bg-red-500 text-delete' : 'bg-white/10 text-secondary'} hover:brightness-105` }>
                <span className="material-symbols-outlined">volume_off</span>
              </button>
              <button onClick={leaveRoom} className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-secondary transition-colors hover:bg-white/20">
                <span className="material-symbols-outlined">logout</span>
              </button>
              {!audioEnabled ? (
                <button onClick={async ()=>{
                  
                  setAudioEnabled(true)
                  const nodes = audioContainerRef.current?.querySelectorAll('audio') || []
                  for (const a of nodes) {
                    try { a.muted = false; await a.play() } catch(e){}
                  }
                  setPlaybackMuted(false)
                }} className="flex h-12 items-center px-3 rounded bg-emerald-500 text-enable-audio font-medium">{t('enableAudio')}</button>
                ) : (
                <button onClick={async ()=>{
                  
                  setAudioEnabled(false)
                  const nodes = audioContainerRef.current?.querySelectorAll('audio') || []
                  for (const a of nodes) {
                    try { a.muted = true } catch(e){}
                  }
                  setPlaybackMuted(true)
                }} className="flex h-12 items-center px-3 rounded bg-disable-audio text-enable-audio">{t('disableAudio')}</button>
              )}
            </div>
          </div>
        </div>
      </div>

      
      {/* Panel de configuración - Desktop (top-right) */}
      <div className="fixed top-4 right-2 z-50 hidden sm:block">
        <div
          className={`mt-2 bg-panel glass-effect rounded-lg p-3 w-[14rem] text-var transition-transform transition-opacity duration-200 ease-in-out ${settingsOpen ? 'opacity-100 translate-x-0 pointer-events-auto' : 'opacity-0 translate-x-6 pointer-events-none'}`}
          style={{ transformOrigin: 'top right' }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium text-var">{t('settings')}</div>
          </div>
          <div className="mb-2">
            <label className="text-xs text-secondary">{t('language')}</label>
            <select value={localeKey} onChange={(e)=>setLocaleKey(e.target.value)} className="w-full mt-1 rounded px-2 py-1 bg-input-select text-var">
              <option value="en">English</option>
              <option value="da">Dansk</option>
              <option value="es">Español</option>
            </select>
          </div>
          <div className="mb-2">
            <label className="text-xs text-secondary">{t('theme')}</label>
            <div className="mt-1 flex items-center gap-2">
              <button onClick={()=>setTheme('light')} className={`px-2 py-1 rounded ${theme==='light' ? 'bg-white/10' : 'bg-transparent'} text-var`}>{t('light')}</button>
              <button onClick={()=>setTheme('dark')} className={`px-2 py-1 rounded ${theme==='dark' ? 'bg-white/10' : 'bg-transparent'} text-var`}>{t('dark')}</button>
            </div>
          </div>
          <div className="mt-2">
            <button onClick={()=>{ clearLocalData(); }} className="w-full px-3 py-2 rounded bg-red-600 text-white text-sm">{t('clearStorage')}</button>
          </div>
        </div>
      </div>

      {/* Panel de configuración - Mobile (centrado con efecto focus) */}
      {settingsOpen && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center sm:hidden">
          <div
            className="absolute inset-0"
            style={{
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              background: theme === 'dark' ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.55)'
            }}
            onClick={() => setSettingsOpen(false)}
            aria-hidden="true"
          />
          <div className="relative glass-effect bg-panel px-6 py-4 rounded-lg text-var shadow-xl pointer-events-auto max-w-[90%] w-[min(340px,90%)]">
            <button
              onClick={() => setSettingsOpen(false)}
              aria-label="Close settings"
              className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-var hover:bg-white/20 transition-colors"
            >
              <span className="material-symbols-outlined text-xl">close</span>
            </button>
            <div className="flex items-center justify-between mb-4 pr-6">
              <div className="text-lg font-medium text-var">{t('settings')}</div>
            </div>
            <div className="mb-3">
              <label className="text-sm text-secondary">{t('language')}</label>
              <select value={localeKey} onChange={(e)=>setLocaleKey(e.target.value)} className="w-full mt-2 rounded px-3 py-2 bg-input-select text-var">
                <option value="en">English</option>
                <option value="da">Dansk</option>
                <option value="es">Español</option>
              </select>
            </div>
            <div className="mb-3">
              <label className="text-sm text-secondary">{t('theme')}</label>
              <div className="mt-2 flex items-center gap-2">
                <button onClick={()=>setTheme('light')} className={`flex-1 px-3 py-2 rounded ${theme==='light' ? 'bg-white/20' : 'bg-white/5'} text-var`}>{t('light')}</button>
                <button onClick={()=>setTheme('dark')} className={`flex-1 px-3 py-2 rounded ${theme==='dark' ? 'bg-white/20' : 'bg-white/5'} text-var`}>{t('dark')}</button>
              </div>
            </div>
            <div className="mt-4">
              <button onClick={()=>{ clearLocalData(); }} className="w-full px-4 py-2 rounded bg-red-600 text-white text-sm font-medium">{t('clearStorage')}</button>
            </div>
          </div>
        </div>
      )}

      <div ref={audioContainerRef} style={{ display: 'none' }} />
      {notice && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center">
          <div
            className="absolute inset-0"
            style={{
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              background: theme === 'dark' ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.55)'
            }}
            aria-hidden="true"
          />
          <div className="relative glass-effect bg-panel px-6 py-4 rounded-lg text-var shadow-xl pointer-events-auto max-w-[90%] w-[min(560px,90%)]" role="status" aria-live="polite">
            <div className="text-lg font-medium">{notice}</div>
          </div>
        </div>
      )}
    </div>
  )
}
