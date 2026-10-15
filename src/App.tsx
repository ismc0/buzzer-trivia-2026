import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, ArrowLeft, BellRing, CheckCircle2, CircleHelp, DoorOpen, LockKeyhole, LogOut, Plus, Radio, RotateCcw, ShieldCheck, Trophy, Users, Volume2, Zap } from 'lucide-react'
import { configured, supabase, type RoomState } from './lib/supabase'
import buzzerSound from './assets/ding.m4a'

type Role = 'home' | 'player' | 'game' | 'admin' | 'display'
type AdminRoom = { id: string; code: string; status: string; created_at: string }
type RoundHistoryBuzz = { id: string; participant_id: string; participant_name: string; position: number; created_at: string }
type RoundHistory = { id: string; round_number: number; status: 'active' | 'locked' | 'finished'; started_at: string; ended_at: string | null; buzzes: RoundHistoryBuzz[] }

function makeCode() { return Math.random().toString(36).slice(2, 8).toUpperCase() }

function makeToken() { return crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '') }
// Se crea una sola instancia y se precarga al abrir la aplicación para evitar
// esperar a descargar/decodificar el archivo cada vez que alguien pulsa.
const buzzerAudio = new Audio(buzzerSound)
buzzerAudio.preload = 'auto'
buzzerAudio.volume = 1
buzzerAudio.load()

function playBuzzer() {
  // Reproduce el sonido localmente en el dispositivo que pulsa; no se transmite.
  try {
    buzzerAudio.currentTime = 0
    void buzzerAudio.play().catch(() => {
      // Algunos navegadores pueden bloquear el audio según sus permisos.
    })
  } catch {
    // Si el navegador no admite la reproducción, la partida sigue funcionando.
  }
}

export default function App() {
  const [displayCode] = useState(() => new URLSearchParams(window.location.search).get('display')?.trim().toUpperCase() || '')
  const [role, setRole] = useState<Role>(() => displayCode ? 'display' : 'home')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [roomCode, setRoomCode] = useState(() => localStorage.getItem('buzzer:roomCode') || '')
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('buzzer:playerName') || '')
  const [participantId, setParticipantId] = useState(() => localStorage.getItem('buzzer:participantId') || '')
  const [participantToken, setParticipantToken] = useState(() => localStorage.getItem('buzzer:participantToken') || '')
  const [room, setRoom] = useState<RoomState | null>(null)
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminLoggedIn, setAdminLoggedIn] = useState(false)
  const [adminRooms, setAdminRooms] = useState<AdminRoom[]>([])
  const [activeAdminCode, setActiveAdminCode] = useState('')
  const [buzzedPosition, setBuzzedPosition] = useState<number | null>(null)
  const [joining, setJoining] = useState(false)
  const [seenRound, setSeenRound] = useState<number | null>(null)

  // Conserva el nombre y la identidad del participante entre recargas.
  useEffect(() => {
    localStorage.setItem('buzzer:playerName', playerName)
  }, [playerName])

  useEffect(() => {
    if (role === 'player') localStorage.setItem('buzzer:lastRole', 'player')
  }, [role])

  useEffect(() => {
    if (roomCode) localStorage.setItem('buzzer:roomCode', roomCode)
    else localStorage.removeItem('buzzer:roomCode')
  }, [roomCode])

  useEffect(() => {
    if (participantId) localStorage.setItem('buzzer:participantId', participantId)
    else localStorage.removeItem('buzzer:participantId')
    if (participantToken) localStorage.setItem('buzzer:participantToken', participantToken)
    else localStorage.removeItem('buzzer:participantToken')
  }, [participantId, participantToken])

  const reloadRoom = useCallback(async (code: string) => {
    const { data, error } = await supabase.rpc('get_room_state', { p_code: code.toUpperCase() })
    if (!error && data) setRoom(data as RoomState)
  }, [])

  // La pantalla pública de clasificación se abre en otra pestaña mediante ?display=CÓDIGO.
  useEffect(() => {
    if (role !== 'display' || !displayCode) return
    void reloadRoom(displayCode)
  }, [role, displayCode, reloadRoom])
  
  useEffect(() => {
  if (role !== 'game' || !room) return

  const ownBuzz = room.buzzes?.find(
    (b) => b.participant_id === participantId
  )

  if (ownBuzz?.position != null) {
    setBuzzedPosition(Number(ownBuzz.position))
  } else if (seenRound !== null && seenRound !== room.round_number) {
    setBuzzedPosition(null)
  }

  setSeenRound(room.round_number)
}, [room, role, participantId])

  useEffect(() => {
    if (!room?.code) return
    const channel = supabase.channel(`room:${room.code}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: '*' }, () => { void reloadRoom(room.code) })
      .subscribe()
    const fallback = window.setInterval(() => { void reloadRoom(room.code) }, 5000)
    return () => { window.clearInterval(fallback); void supabase.removeChannel(channel) }
  }, [room?.code, reloadRoom])

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const authenticated = Boolean(session?.user)
      setAdminLoggedIn(authenticated)
      if (authenticated) {
        // La sesión de Supabase también existe en la pestaña de clasificación.
        // No permitimos que esa sesión reemplace la pantalla pública por el panel admin.
        if (!displayCode) {
          setRole('admin')
          window.setTimeout(() => { void loadAdminRooms() }, 0)
        }
      } else {
        setRole(current => current === 'admin' ? 'home' : current)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  // Al recargar, recupera la partida del participante si el código sigue siendo válido.
  useEffect(() => {
    let cancelled = false
    async function restoreParticipant() {
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled || session?.user) return

      const savedName = localStorage.getItem('buzzer:playerName') || ''
      const savedCode = localStorage.getItem('buzzer:roomCode') || ''
      const savedId = localStorage.getItem('buzzer:participantId') || ''
      const savedToken = localStorage.getItem('buzzer:participantToken') || ''
      const lastRole = localStorage.getItem('buzzer:lastRole')

      if (savedName && lastRole === 'player') setRole('player')
      if (!savedCode || !savedId || !savedToken) return

      const { data, error } = await supabase.rpc('get_room_state', { p_code: savedCode.toUpperCase() })
      if (cancelled) return

      if (error || !data) {
        // La partida ya no existe: conserva el nombre, pero pide un nuevo código.
        setRoom(null)
        setRoomCode('')
        setParticipantId('')
        setParticipantToken('')
        setBuzzedPosition(null)
        setRole('player')
        localStorage.setItem('buzzer:lastRole', 'player')
        return
      }

      const restoredRoom = data as RoomState
      setRoomCode(savedCode.toUpperCase())
      setPlayerName(savedName)
      setParticipantId(savedId)
      setParticipantToken(savedToken)
      setRoom(restoredRoom)
      const ownBuzz = restoredRoom.buzzes?.find(
  (b) => b.participant_id === savedId
)

setBuzzedPosition(
  ownBuzz?.position != null ? Number(ownBuzz.position) : null
)
      setRole('game')
    }

    void restoreParticipant()
    return () => { cancelled = true }
  }, [])

  async function loadAdminRooms() {
    const { data, error } = await supabase.rpc('list_admin_rooms')
    if (error) { setNotice(error.message); return }
    setAdminRooms((data || []) as AdminRoom[])
  }

  
async function joinRoom(e: React.FormEvent) {
  e.preventDefault()
  setNotice('')

  const code = roomCode.trim().toUpperCase()
  const name = playerName.trim()

  if (!code || !name) {
    setNotice('Escribe el código de partida y tu nombre.')
    return
  }

  setJoining(true)

  // Cada combinación de sala + nombre tiene su propia identidad.
  // Repetir el mismo nombre recupera al participante; cambiarlo crea otro.
  const normalizedName = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  const identityKey = `${code}:${normalizedName}`
  const idKey = `buzzer:participantId:${identityKey}`
  const tokenKey = `buzzer:participantToken:${identityKey}`
  
  const savedId = localStorage.getItem(idKey)
  const savedToken = localStorage.getItem(tokenKey)

  const hasSavedIdentity = Boolean(savedId && savedToken)

  const id = hasSavedIdentity ? savedId! : crypto.randomUUID()
  const token = hasSavedIdentity ? savedToken! : makeToken()


  const { error } = await supabase.rpc('join_room', {
    p_code: code,
    p_name: name,
    p_participant_id: id,
    p_token: token
  })

  setJoining(false)

  if (error) {
    setNotice(error.message)
    return
  }

  localStorage.setItem(idKey, id)
  localStorage.setItem(tokenKey, token)
  localStorage.setItem('buzzer:playerName', name)
  localStorage.setItem('buzzer:roomCode', code)
  localStorage.setItem('buzzer:participantId', id)
  localStorage.setItem('buzzer:participantToken', token)
  localStorage.setItem('buzzer:lastRole', 'game')


  setParticipantId(id)
  setParticipantToken(token)
  setPlayerName(name)
  setRoomCode(code)

  // No dependemos de que join_room devuelva la clasificación completa.
  // Consultamos el estado canónico de la sala después de validar la identidad.
  const { data: freshData, error: freshError } = await supabase.rpc('get_room_state', {
    p_code: code
  })

  if (freshError || !freshData) {
    setNotice(freshError?.message || 'No se pudo recuperar el estado actual de la partida.')
    setJoining(false)
    return
  }

  const joinedRoom = freshData as RoomState
  setRoom(joinedRoom)

  const ownBuzz = joinedRoom.buzzes?.find(
    b => b.participant_id === id
  )

  const buzzStorageKey = `buzzer:buzzed:${code}:${id}:${joinedRoom.round_number}`
  const savedPosition = localStorage.getItem(buzzStorageKey)
  const recoveredPosition = ownBuzz?.position != null
    ? Number(ownBuzz.position)
    : savedPosition != null
      ? Number(savedPosition)
      : null

  setBuzzedPosition(recoveredPosition)
  if (recoveredPosition != null) {
    localStorage.setItem(buzzStorageKey, String(recoveredPosition))
  }
  setSeenRound(joinedRoom.round_number ?? null)

  setRole('game')
  setNotice('')

}

  // Cuando el administrador finaliza la partida, devuelve al participante al formulario
  // y conserva su nombre para que pueda entrar a otra partida.
  useEffect(() => {
    if (role !== 'game' || room?.status !== 'finished') return

    const savedName = playerName || localStorage.getItem('buzzer:playerName') || ''
    if (savedName) {
      setPlayerName(savedName)
      localStorage.setItem('buzzer:playerName', savedName)
    }

    setRoom(null)
    setRoomCode('')
    setParticipantId('')
    setParticipantToken('')
    setBuzzedPosition(null)
    setRole('player')
    setNotice('La partida terminó. Ingresa el código de una nueva partida.')
    localStorage.setItem('buzzer:lastRole', 'player')
  }, [room?.status, role])

  
async function pressBuzzer() {
  if (!room || room.status !== 'active' || busy || !participantId) return

  setBusy(true)
  setNotice('')

  playBuzzer()

  try {
    const { data, error } = await supabase.rpc('submit_buzz', {
      p_code: room.code,
      p_participant_id: participantId,
      p_token: participantToken
    })

    if (error) {
      setNotice(error.message)
      return
    }

    // submit_buzz puede responder duplicate=true si ya existía una pulsación.
    // En ambos casos, cualquier posición devuelta significa que ya está registrado.
    if (data?.position != null) {
      const position = Number(data.position)
      setBuzzedPosition(position)
      localStorage.setItem(
        `buzzer:buzzed:${room.code}:${participantId}:${room.round_number}`,
        String(position)
      )
    } else if (data?.duplicate === true) {
      // La posición puede no venir en algunas versiones de la función RPC;
      // se recupera desde el estado persistido del servidor.
      const { data: stateData } = await supabase.rpc('get_room_state', {
        p_code: room.code
      })
      if (stateData) {
        const freshRoom = stateData as RoomState
        setRoom(freshRoom)
        const ownBuzz = freshRoom.buzzes?.find(
          b => b.participant_id === participantId
        )
        if (ownBuzz?.position != null) {
          const position = Number(ownBuzz.position)
          setBuzzedPosition(position)
          localStorage.setItem(
            `buzzer:buzzed:${room.code}:${participantId}:${room.round_number}`,
            String(position)
          )
        }
      }
    }

    await reloadRoom(room.code)
  } catch (err) {
    setNotice(
      err instanceof Error
        ? err.message
        : 'No fue posible registrar la pulsación.'
    )
  } finally {
    setBusy(false)
  }
}

  async function adminLogin(e: React.FormEvent) {
    e.preventDefault(); setNotice(''); setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: adminEmail.trim(), password: adminPassword })
    setBusy(false)
    if (error) setNotice(error.message)
    else { setAdminLoggedIn(true); setRole('admin'); await loadAdminRooms() }
  }

  async function createRoom() {
    setNotice(''); setBusy(true)
    const code = makeCode()
    const { data, error } = await supabase.rpc('create_room', { p_code: code })
    setBusy(false)
    if (error) { setNotice(error.message); return }
    const created = data as AdminRoom
    setAdminRooms(old => [created, ...old.filter(r => r.code !== created.code)])
    setActiveAdminCode(created.code)
    await reloadRoom(created.code)
    setNotice(`Partida ${created.code} creada.`)
  }

  async function adminAction(action: 'start_round' | 'lock_round' | 'finish_current_round' | 'finish_round') {
    if (!activeAdminCode) return
    setNotice(''); setBusy(true)
    const { data, error } = await supabase.rpc(action, { p_code: activeAdminCode })
    setBusy(false)
    if (error) { setNotice(error.message); return }
    if (data) setRoom(data as RoomState)
    await reloadRoom(activeAdminCode); await loadAdminRooms()
  }

  async function openAdminRoom(code: string) {
    setActiveAdminCode(code); setRoom(null); setNotice(''); await reloadRoom(code)
  }

  async function signOut() {
    await supabase.auth.signOut(); setAdminLoggedIn(false); setAdminRooms([]); setRoom(null); setActiveAdminCode(''); setRole('home'); setNotice('')
  }

  const shareUrl = useMemo(() => `${window.location.origin}${window.location.pathname}`, [])
  const displayUrl = room ? `${shareUrl}?display=${encodeURIComponent(room.code)}` : ''
  // La lista de pulsaciones del servidor es la fuente de verdad para saber
  // si este participante ya pulsó en la ronda actual.
  const hasBuzzed = room?.buzzes?.some(
    (b) => b.participant_id === participantId
  ) ?? false
  const displayHistory = (room as (RoomState & { round_history?: RoundHistory[] }) | null)?.round_history || []
  const displayRound = room ? displayHistory.find(r => r.round_number === room.round_number) : undefined
  const roundStartedAt = displayRound?.started_at ? new Date(displayRound.started_at).getTime() : null
  const elapsedSeconds = (createdAt: string) => roundStartedAt === null ? null : Math.max(0, (new Date(createdAt).getTime() - roundStartedAt) / 1000)
  const formatElapsed = (createdAt: string) => { const elapsed = elapsedSeconds(createdAt); return elapsed === null || !Number.isFinite(elapsed) ? '—' : `${elapsed.toFixed(2)} s` }

  if (role === 'display') {
    const statusLabel = room ? ({ waiting: 'PREPARADOS', active: 'RONDA EN JUEGO', locked: 'RONDA FINALIZADA', finished: 'PARTIDA FINALIZADA' } as Record<string, string>)[room.status] || room.status : 'CARGANDO PARTIDA'
    return <main style={{ minHeight: '100vh', background: '#101116', color: '#f8fafc', padding: 'clamp(20px, 4vw, 56px)', boxSizing: 'border-box', fontFamily: 'inherit' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, flexWrap: 'wrap', borderBottom: '1px solid #30313a', paddingBottom: 22 }}>
          <div><p style={{ color: '#fb6468', letterSpacing: 3, fontWeight: 800, margin: '0 0 8px' }}>BUZZER LIVE · CLASIFICACIÓN</p><h1 style={{ fontSize: 'clamp(30px, 5vw, 58px)', lineHeight: 1, margin: 0 }}>{room?.status === 'finished' ? 'Clasificación final' : 'Puestos en tiempo real'}</h1></div>
          <div style={{ textAlign: 'right' }}><div style={{ color: '#a7a9b5', fontSize: 13, letterSpacing: 2 }}>SALA</div><strong style={{ fontSize: 32 }}>{displayCode || '—'}</strong><div style={{ color: room?.status === 'active' ? '#58d6a0' : '#fb6468', fontWeight: 800, letterSpacing: 1 }}>{statusLabel}</div></div>
        </div>
        {!room ? <p style={{ textAlign: 'center', marginTop: 80, color: '#b7b8c2' }}>Cargando la clasificación… Verifica que el código de la partida sea correcto.</p> : <>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '24px 0' }}>
            <div style={{ background: '#1b1c24', border: '1px solid #30313a', borderRadius: 16, padding: '16px 22px' }}><span style={{ color: '#a7a9b5' }}>RONDA</span><div style={{ fontSize: 30, fontWeight: 800 }}>{room.round_number || 0}</div></div>
            <div style={{ background: '#1b1c24', border: '1px solid #30313a', borderRadius: 16, padding: '16px 22px' }}><span style={{ color: '#a7a9b5' }}>PARTICIPANTES</span><div style={{ fontSize: 30, fontWeight: 800 }}>{room.participant_count}</div></div>
            <div style={{ background: '#1b1c24', border: '1px solid #30313a', borderRadius: 16, padding: '16px 22px' }}><span style={{ color: '#a7a9b5' }}>RESPUESTAS REGISTRADAS</span><div style={{ fontSize: 30, fontWeight: 800 }}>{room.buzzes.length}</div></div>
          </div>
<div style={{ background: '#1b1c24', border: '1px solid #30313a', borderRadius: 20, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '100px minmax(160px, 1fr) minmax(130px, 220px)', gap: 16, padding: '18px clamp(16px, 3vw, 32px)', background: '#252630', color: '#a7a9b5', fontWeight: 800, letterSpacing: 1 }}><span>PUESTO</span><span>PARTICIPANTE</span><span style={{ textAlign: 'right' }}>TIEMPO</span></div>
            {room.buzzes.length === 0 ? <div style={{ textAlign: 'center', padding: '70px 20px', color: '#a7a9b5' }}><div style={{ fontSize: 28, fontWeight: 800, color: '#fff', marginBottom: 8 }}>Esperando la primera pulsación</div><div>Los puestos aparecerán aquí automáticamente.</div></div> : room.buzzes.slice().sort((a, b) => Number(a.position) - Number(b.position)).map((buzz) => <div key={buzz.id} style={{ display: 'grid', gridTemplateColumns: '100px minmax(160px, 1fr) minmax(130px, 220px)', gap: 16, alignItems: 'center', padding: '20px clamp(16px, 3vw, 32px)', borderTop: '1px solid #30313a', background: Number(buzz.position) === 1 ? 'linear-gradient(90deg, #352b19, #1b1c24 65%)' : Number(buzz.position) === 2 ? 'linear-gradient(90deg, #292b30, #1b1c24 65%)' : Number(buzz.position) === 3 ? 'linear-gradient(90deg, #35251e, #1b1c24 65%)' : 'transparent' }}><strong style={{ fontSize: 'clamp(24px, 3vw, 38px)', color: Number(buzz.position) === 1 ? '#efc66b' : Number(buzz.position) === 2 ? '#C0C0C0' : Number(buzz.position) === 3 ? '#B87333' : '#fb6468' }}>{Number(buzz.position) === 1 ? '1º' : `${buzz.position}º`}</strong><strong style={{ fontSize: 'clamp(20px, 3vw, 34px)', overflowWrap: 'anywhere' }}>{buzz.participant_name}</strong><span style={{ textAlign: 'right', fontSize: 'clamp(20px, 3vw, 32px)', fontVariantNumeric: 'tabular-nums', fontWeight: 800 }}>{formatElapsed(buzz.created_at)}</span></div>)}
          </div>
          <p style={{ color: '#777985', textAlign: 'center', marginTop: 24, fontSize: 13 }}>{room.status === 'finished' ? 'Clasificación definitiva de la partida.' : 'La pantalla se actualiza automáticamente. El tiempo se calcula desde el inicio de la ronda hasta cada pulsación registrada.'}</p>
        </>}
      </div>
    </main>
  }

  if (!configured) return <main className="setup-screen"><div className="setup-card"><div className="brand-mark"><Zap /></div><p className="eyebrow">BUZZER LIVE · CONFIGURACIÓN</p><h1>Conecta tu proyecto de Supabase</h1><p>La interfaz ya está creada. Para activar autenticación, base de datos y tiempo real, configura las variables de entorno y ejecuta el SQL incluido en el proyecto.</p><ol><li>Crea un proyecto en Supabase.</li><li>Ejecuta <code>supabase/schema.sql</code> en SQL Editor.</li><li>Copia la URL y la clave publicable/anon en un archivo <code>.env</code>.</li><li>Reinicia el servidor de desarrollo.</li></ol><p className="muted">Consulta README.md para la guía completa.</p></div></main>

  return <main className="app-shell">
    <header className="topbar"><button className="brand" onClick={() => { setRole('home'); setNotice('') }}><span className="brand-mark small"><Zap size={18}/></span><span>BUZZER<span className="brand-light">LIVE</span></span></button><div className="topbar-right"><span className="live-dot"/> <span className="topbar-label">TIEMPO REAL</span>{role === 'admin' && adminLoggedIn && <button className="icon-button" title="Cerrar sesión" onClick={() => void signOut()}><LogOut size={17}/></button>}</div></header>
   
    {notice && <div className="notice" role="status"><CircleHelp size={17}/><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Cerrar aviso">×</button></div>}

    {role === 'home' && <section className="hero"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"/> EL PRIMERO EN RESPONDER, GANA</div><h1>¿Quién será<br/>el más <span>rápido?</span></h1><p className="hero-sub">Un toque. Un sonido. Un ganador. Entra a una partida y prepárate para pulsar.</p><div className="home-actions"><button className="primary-button" onClick={() => { setRole('player'); setNotice('') }}>Entrar a una partida <ArrowLeft className="arrow-right" size={18}/></button><button className="secondary-button" onClick={() => { setRole('admin'); setNotice('') }}><ShieldCheck size={17}/> Acceso administrador</button></div><div className="trust-line"><Radio size={16}/> Clasificación sincronizada en tiempo real</div></div><div className="hero-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="buzzer-halo"><div className="buzzer-rim"><div className="buzzer-face"><BellRing size={46}/><span>BUZZ!</span></div></div></div><div className="art-tag tag-top"><span className="tag-dot"/> LISTO PARA JUGAR</div><div className="art-tag tag-bottom"><Trophy size={17}/><span>El orden sí importa.</span></div><div className="spark spark-one">+</div><div className="spark spark-two">✳</div></div><div className="feature-strip"><div><span className="feature-icon"><Users size={19}/></span><span><b>Una sala compartida</b><small>Entra con código y nombre</small></span></div><div><span className="feature-icon"><Activity size={19}/></span><span><b>Orden de llegada</b><small>Posiciones asignadas en servidor</small></span></div><div><span className="feature-icon"><Volume2 size={19}/></span><span><b>Sonido instantáneo</b><small>Solo suena en quien pulsa</small></span></div></div></section>}

    {role === 'player' && <section className="form-layout"><button className="back-link" onClick={() => { setRole('home'); setNotice('') }}><ArrowLeft size={16}/> Volver al inicio</button><div className="form-card player-entry"><div className="form-icon red-icon"><BellRing size={25}/></div><p className="eyebrow">MODO PARTICIPANTE</p><h1>Entra a la partida</h1><p className="form-sub">Pide el código al administrador, escribe tu nombre y ten el dedo listo.</p><form onSubmit={joinRoom} className="stack-form"><label>Código de partida<input value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))} placeholder="EJ. A7K2QX" autoComplete="off" required maxLength={10}/></label><label>Tu nombre<input value={playerName} onChange={e => setPlayerName(e.target.value)} placeholder="¿Cómo te llamas?" autoComplete="nickname" required maxLength={40}/></label><button className="primary-button full-button" disabled={joining}>{joining ? 'Conectando…' : 'Entrar a la partida'} <ArrowLeft className="arrow-right" size={18}/></button></form><p className="fine-print"><LockKeyhole size={13}/> No necesitas crear una cuenta.</p></div></section>}

    {role === 'admin' && !adminLoggedIn && <section className="form-layout"><button className="back-link" onClick={() => { setRole('home'); setNotice('') }}><ArrowLeft size={16}/> Volver al inicio</button><div className="form-card"><div className="form-icon"><ShieldCheck size={25}/></div><p className="eyebrow">ZONA RESTRINGIDA</p><h1>Panel de control</h1><p className="form-sub">Inicia sesión con la cuenta de administrador autorizada.</p><form onSubmit={adminLogin} className="stack-form"><label>Correo electrónico<input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} placeholder="admin@ejemplo.com" autoComplete="username" required/></label><label>Contraseña<input type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} placeholder="Tu contraseña" autoComplete="current-password" required/></label><button className="primary-button full-button" disabled={busy}>{busy ? 'Ingresando…' : 'Iniciar sesión'} <ArrowLeft className="arrow-right" size={18}/></button></form><p className="fine-print"><LockKeyhole size={13}/> El administrador debe estar autorizado en la base de datos.</p></div></section>}

    {role === 'game' && room && <section className="game-layout"><div className="game-head"><div><p className="eyebrow">SALA {room.code}</p><h1>¡Es tu momento, <span>{playerName}</span>!</h1></div><span className={`status-pill ${room.status}`}><span/>{{waiting:'Esperando',active:'Ronda activa',locked:'Bloqueada',finished:'Finalizada'}[room.status]}</span></div><div className="game-stage"><div className="game-side-info"><div className="mini-stat"><Users size={17}/><span>{room.participant_count} participantes</span></div><div className="mini-stat"><Activity size={17}/><span>{room.buzzes.length} pulsaciones</span></div></div><button className={`big-buzzer ${room.status !== 'active' || hasBuzzed || buzzedPosition !== null ? 'disabled' : ''} ${hasBuzzed || buzzedPosition !== null ? 'pressed' : ''} ${room.status !== 'active' ? 'waiting-state' : ''}`} disabled={room.status !== 'active' || hasBuzzed || buzzedPosition !== null || busy} onClick={() => void pressBuzzer()} aria-label="Presionar buzzer"><span className="buzzer-inner" style={room.status !== 'active' ? { background: '#c92f35', color: '#fff', padding: '20px 12px', boxSizing: 'border-box', overflow: 'hidden' } : undefined}><BellRing size={42} style={{ position: 'relative', top: '-4px' }}/><strong style={room.status !== 'active' ? { fontSize: 'clamp(14px, 2.4vw, 20px)', lineHeight: 1.15, maxWidth: '100%', overflowWrap: 'anywhere', textAlign: 'center', position: 'relative', top: '-4px' } : { position: 'relative', top: '-4px' }}>{room.status === 'finished' ? 'PARTIDA FINALIZADA' : room.status !== 'active' ? 'ESPERA AL PRESENTADOR' : (hasBuzzed || buzzedPosition !== null) ? 'REGISTRADO' : busy ? 'ENVIANDO…' : 'BUZZ!'}</strong><small style={room.status !== 'active' ? { fontSize: 'clamp(9px, 1.5vw, 11px)', lineHeight: 1.2, maxWidth: '100%', textAlign: 'center', whiteSpace: 'normal', position: 'relative', top: '-4px' } : { position: 'relative', top: '-4px' }}>{room.status === 'finished' ? 'LA PARTIDA HA TERMINADO' : room.status !== 'active' ? 'ESPERA LA SIGUIENTE RONDA' : (hasBuzzed || buzzedPosition !== null) ? `PUESTO #${buzzedPosition ?? room.buzzes.find(b => b.participant_id === participantId)?.position}` : busy ? 'REGISTRANDO PULSACIÓN…' : 'PRESIONA AHORA'}</small></span></button><div className="game-message">{room.status === 'finished' ? 'Esta partida ha finalizado.' : room.status === 'locked' ? 'Ronda finalizada. Espera al presentador para la siguiente.' : (hasBuzzed || buzzedPosition !== null) ? <><CheckCircle2 size={18}/> ¡Pulsación registrada! Quedaste en el puesto #{buzzedPosition ?? room.buzzes.find(b => b.participant_id === participantId)?.position}.</> : room.status === 'waiting' ? 'El presentador aún no inicia la ronda.' : ''}</div></div><div className="ranking-card"><div className="section-heading"><div><p className="eyebrow">EN ESTA RONDA</p><h2>Orden de pulsación</h2></div><span className="live-chip"><span/> EN VIVO</span></div>{room.buzzes.length === 0 ? <div className="empty-state"><div className="empty-icon"><Radio size={22}/></div><b>Aún no hay pulsaciones</b><span>Cuando alguien presione el buzzer, aparecerá aquí.</span></div> : <div className="ranking-list">{room.buzzes.map(b => <div className={`ranking-row ${b.participant_id === participantId ? 'my-rank' : ''}`} key={b.id}><span className={`rank-number ${b.position === 1 ? 'first' : ''}`}>{b.position === 1 ? <Trophy size={17}/> : b.position}</span><span className="rank-name">{b.participant_name}{b.participant_id === participantId && <small> · Tú</small>}</span><time>{new Date(b.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></div>)}</div>}</div><button className="back-link centered" onClick={() => { setRoom(null); setParticipantId(''); setParticipantToken(''); setRoomCode(''); setRole('home'); setBuzzedPosition(null); setNotice('') }}><DoorOpen size={16}/> Salir de la partida</button></section>}

    {role === 'admin' && adminLoggedIn && <section className="admin-layout"><div className="admin-heading"><div><p className="eyebrow">CENTRO DE CONTROL</p><h1>Administra tus partidas</h1><p className="form-sub">Crea una sala y comparte el código con los participantes.</p></div><button className="primary-button create-button" onClick={() => void createRoom()} disabled={busy}><Plus size={18}/> Crear partida</button></div><div className="admin-columns"><aside className="rooms-panel"><div className="section-heading"><h2>Tus partidas</h2><button className="icon-button" title="Actualizar" onClick={() => void loadAdminRooms()}><RotateCcw size={16}/></button></div>{adminRooms.length === 0 ? <div className="empty-state compact"><div className="empty-icon"><Radio size={20}/></div><b>Aún no tienes partidas</b><span>Crea una para empezar.</span></div> : <div className="room-list">{adminRooms.map(r => <button key={r.id} className={`room-item ${activeAdminCode === r.code ? 'selected' : ''}`} onClick={() => void openAdminRoom(r.code)}><span className="room-code">{r.code}</span><span className={`status-pill small ${r.status}`}><span/>{{waiting:'Esperando',active:'Activa',locked:'Bloqueada',finished:'Finalizada'}[r.status] || r.status}</span></button>)}</div>}</aside><div className="control-panel">{room && activeAdminCode === room.code ? <><div className="control-top"><div><p className="eyebrow">CÓDIGO DE PARTIDA</p><div className="room-code-large">{room.code}</div><p className="form-sub">Comparte este código con los participantes.</p></div><button className="secondary-button display-screen-button" onClick={() => window.open(displayUrl, '_blank', 'noopener,noreferrer')}>Abrir pantalla de puestos</button><button className="secondary-button copy-button" onClick={() => { void navigator.clipboard.writeText(`${shareUrl} · Código: ${room.code}`); setNotice('Código y enlace copiados.') }}>Copiar código</button></div><div className="admin-stats"><div className="stat-card"><Users size={18}/><span>Participantes</span><b>{room.participant_count}</b></div><div className="stat-card"><Activity size={18}/><span>Pulsaciones</span><b>{room.buzzes.length}</b></div><div className="stat-card"><Radio size={18}/><span>Estado</span><b className="stat-state">{{waiting:'Esperando',active:'Activa',locked:'Bloqueada',finished:'Finalizada'}[room.status]}</b></div></div><div className="round-controls"><div><p className="eyebrow">CONTROLES DE RONDA</p><h2>Ronda {room.round_number || 0}</h2></div><div className="control-buttons"><button className="primary-button" disabled={busy || room.status === 'active'} onClick={() => void adminAction('start_round')}><Zap size={16}/>{room.status === 'waiting' || room.status === 'finished' ? 'Iniciar ronda' : 'Nueva ronda'}</button><button className="secondary-button" disabled={busy || (room.status !== 'active' && room.status !== 'locked')} onClick={() => void adminAction('finish_current_round')}>Finalizar ronda</button><button className="secondary-button" disabled={busy || room.status !== 'active'} onClick={() => void adminAction('lock_round')}><LockKeyhole size={16}/> Bloquear</button>
    <button className="secondary-button" disabled={busy || room.status === 'finished'} onClick={() => void adminAction('finish_round')}> Finalizar partida </button></div></div><div className="ranking-card admin-ranking"><div className="section-heading"><h2>Orden de pulsación</h2><span className="live-chip"><span/> ACTUALIZADO EN VIVO</span></div>{room.buzzes.length === 0 ? <div className="empty-state"><div className="empty-icon"><Radio size={22}/></div><b>Esperando al primer participante</b><span>Las pulsaciones aparecerán ordenadas aquí.</span></div> : <div className="ranking-list">{room.buzzes.map(b => <div className="ranking-row" key={b.id}><span className={`rank-number ${b.position === 1 ? 'first' : ''}`}>{b.position === 1 ? <Trophy size={17}/> : b.position}</span><span className="rank-name">{b.participant_name}</span><time>{new Date(b.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></div>)}</div>}</div><div className="ranking-card admin-ranking"><div className="section-heading"><div><p className="eyebrow">RESUMEN DE LA PARTIDA</p><h2>Historial de rondas</h2></div><span className="live-chip">{((room as RoomState & { round_history?: RoundHistory[] }).round_history || []).length} RONDAS</span></div>{((room as RoomState & { round_history?: RoundHistory[] }).round_history || []).length === 0 ? <div className="empty-state"><div className="empty-icon"><Radio size={22}/></div><b>Aún no hay rondas registradas</b><span>Cuando inicies una ronda, aparecerá aquí.</span></div> : <div className="round-history-list">{((room as RoomState & { round_history?: RoundHistory[] }).round_history || []).slice().reverse().map(round => <div className="round-history-item" key={round.id}><div className="round-history-heading"><div><b>Ronda {round.round_number}</b><span className={`status-pill small ${round.status}`}><span/>{({ active: 'Activa', locked: 'Bloqueada', finished: 'Finalizada' } as Record<string, string>)[round.status]}</span></div><small>{new Date(round.started_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</small></div>{round.buzzes.length === 0 ? <p className="round-history-empty">Sin pulsaciones registradas.</p> : <div className="ranking-list">{round.buzzes.map(b => <div className="ranking-row" key={b.id}><span className={`rank-number ${b.position === 1 ? 'first' : ''}`}>{b.position === 1 ? <Trophy size={17}/> : b.position}</span><span className="rank-name">{b.participant_name}</span><time>{new Date(b.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></div>)}</div>}</div>)}</div>}</div></> : <div className="admin-placeholder"><div className="empty-icon"><Radio size={25}/></div><h2>Selecciona una partida</h2><p>Elige una sala de la lista o crea una nueva para ver el tablero de control.</p></div>}</div></div></section>}
   
    <footer className="footer"><span>BUZZER LIVE</span></footer>
    </main>
    }