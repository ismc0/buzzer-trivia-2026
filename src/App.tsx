import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, ArrowLeft, BellRing, CheckCircle2, CircleHelp, DoorOpen, LockKeyhole, LogOut, Plus, Radio, RotateCcw, ShieldCheck, Trophy, Users, Volume2, Zap } from 'lucide-react'
import { configured, supabase, type RoomState } from './lib/supabase'

type Role = 'home' | 'player' | 'admin'
type AdminRoom = { id: string; code: string; status: string; created_at: string }

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error && 'message' in error) return String(error.message)
  return 'Ocurrió un error inesperado.'
}
function makeCode() { return Math.random().toString(36).slice(2, 8).toUpperCase() }
function makeToken() { return crypto.randomUUID() + crypto.randomUUID().replaceAll('-', '') }
function playBuzzer() {
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    const ctx = new AudioContextClass()
    const now = ctx.currentTime
    const master = ctx.createGain()
    master.gain.setValueAtTime(0.0001, now)
    master.gain.exponentialRampToValueAtTime(0.24, now + 0.02)
    master.gain.setValueAtTime(0.24, now + 0.32)
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.58)
    master.connect(ctx.destination)
    for (const [freq, detune] of [[180, -4], [230, 4]] as number[][]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(freq, now)
      osc.detune.setValueAtTime(detune, now)
      gain.gain.value = 0.5
      osc.connect(gain); gain.connect(master)
      osc.start(now); osc.stop(now + 0.6)
    }
    window.setTimeout(() => { void ctx.close() }, 800)
  } catch { /* Some browsers may block audio until the user interacts. */ }
}

export default function App() {
  const [role, setRole] = useState<Role>('home')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [roomCode, setRoomCode] = useState('')
  const [playerName, setPlayerName] = useState('')
  const [participantId, setParticipantId] = useState('')
  const [participantToken, setParticipantToken] = useState('')
  const [room, setRoom] = useState<RoomState | null>(null)
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminLoggedIn, setAdminLoggedIn] = useState(false)
  const [adminRooms, setAdminRooms] = useState<AdminRoom[]>([])
  const [activeAdminCode, setActiveAdminCode] = useState('')
  const [buzzedPosition, setBuzzedPosition] = useState<number | null>(null)
  const [joining, setJoining] = useState(false)
  const [seenRound, setSeenRound] = useState<number | null>(null)

  const reloadRoom = useCallback(async (code: string) => {
    const { data, error } = await supabase.rpc('get_room_state', { p_code: code.toUpperCase() })
    if (!error && data) setRoom(data as RoomState)
  }, [])

  useEffect(() => {
    if (role !== 'player' || !room) return
    if (seenRound !== null && seenRound !== room.round_number) setBuzzedPosition(null)
    setSeenRound(room.round_number)
  }, [room?.round_number, role])

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
      setAdminLoggedIn(Boolean(session?.user))
      if (session?.user) window.setTimeout(() => { void loadAdminRooms() }, 0)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function loadAdminRooms() {
    const { data, error } = await supabase.rpc('list_admin_rooms')
    if (error) { setNotice(error.message); return }
    setAdminRooms((data || []) as AdminRoom[])
  }

  async function joinRoom(e: React.FormEvent) {
    e.preventDefault(); setNotice('')
    const code = roomCode.trim().toUpperCase()
    const name = playerName.trim()
    if (!code || !name) { setNotice('Escribe el código de partida y tu nombre.'); return }
    setJoining(true)
    const token = makeToken()
    const id = crypto.randomUUID()
    const { data, error } = await supabase.rpc('join_room', { p_code: code, p_name: name, p_participant_id: id, p_token: token })
    setJoining(false)
    if (error) { setNotice(error.message); return }
    setParticipantId(id); setParticipantToken(token); setPlayerName(name); setRoomCode(code)
    setBuzzedPosition(null); setRoom(data as RoomState); setRole('player'); setNotice('')
  }

  async function pressBuzzer() {
    if (!room || room.status !== 'active' || busy || !participantId) return
    setBusy(true); setNotice('')
    // The sound is local to the participant's device, never broadcast to the room.
    playBuzzer()
    const { data, error } = await supabase.rpc('submit_buzz', {
      p_code: room.code, p_participant_id: participantId, p_token: participantToken
    })
    setBusy(false)
    if (error) { setNotice(error.message); return }
    if (data?.position) setBuzzedPosition(Number(data.position))
    await reloadRoom(room.code)
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

  async function adminAction(action: 'start_round' | 'lock_round' | 'finish_round') {
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

  if (!configured) return <main className="setup-screen"><div className="setup-card"><div className="brand-mark"><Zap /></div><p className="eyebrow">BUZZER LIVE · CONFIGURACIÓN</p><h1>Conecta tu proyecto de Supabase</h1><p>La interfaz ya está creada. Para activar autenticación, base de datos y tiempo real, configura las variables de entorno y ejecuta el SQL incluido en el proyecto.</p><ol><li>Crea un proyecto en Supabase.</li><li>Ejecuta <code>supabase/schema.sql</code> en SQL Editor.</li><li>Copia la URL y la clave publicable/anon en un archivo <code>.env</code>.</li><li>Reinicia el servidor de desarrollo.</li></ol><p className="muted">Consulta README.md para la guía completa.</p></div></main>

  return <main className="app-shell">
    <header className="topbar"><button className="brand" onClick={() => { setRole('home'); setNotice('') }}><span className="brand-mark small"><Zap size={18}/></span><span>BUZZER<span className="brand-light">LIVE</span></span></button><div className="topbar-right"><span className="live-dot"/> <span className="topbar-label">TIEMPO REAL</span>{role === 'admin' && adminLoggedIn && <button className="icon-button" title="Cerrar sesión" onClick={() => void signOut()}><LogOut size={17}/></button>}</div></header>
    {notice && <div className="notice" role="status"><CircleHelp size={17}/><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Cerrar aviso">×</button></div>}

    {role === 'home' && <section className="hero"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"/> EL PRIMERO EN RESPONDER, GANA</div><h1>¿Quién será<br/>el más <span>rápido?</span></h1><p className="hero-sub">Un toque. Un sonido. Un ganador. Entra a una partida y prepárate para pulsar.</p><div className="home-actions"><button className="primary-button" onClick={() => { setRole('player'); setNotice('') }}>Entrar a una partida <ArrowLeft className="arrow-right" size={18}/></button><button className="secondary-button" onClick={() => { setRole('admin'); setNotice('') }}><ShieldCheck size={17}/> Acceso administrador</button></div><div className="trust-line"><Radio size={16}/> Clasificación sincronizada en tiempo real</div></div><div className="hero-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="buzzer-halo"><div className="buzzer-rim"><div className="buzzer-face"><BellRing size={46}/><span>BUZZ!</span></div></div></div><div className="art-tag tag-top"><span className="tag-dot"/> LISTO PARA JUGAR</div><div className="art-tag tag-bottom"><Trophy size={17}/><span>El orden sí importa.</span></div><div className="spark spark-one">+</div><div className="spark spark-two">✳</div></div><div className="feature-strip"><div><span className="feature-icon"><Users size={19}/></span><span><b>Una sala compartida</b><small>Entra con código y nombre</small></span></div><div><span className="feature-icon"><Activity size={19}/></span><span><b>Orden de llegada</b><small>Posiciones asignadas en servidor</small></span></div><div><span className="feature-icon"><Volume2 size={19}/></span><span><b>Sonido instantáneo</b><small>Solo suena en quien pulsa</small></span></div></div></section>}

    {role === 'player' && <section className="form-layout"><button className="back-link" onClick={() => { setRole('home'); setNotice('') }}><ArrowLeft size={16}/> Volver al inicio</button><div className="form-card player-entry"><div className="form-icon red-icon"><BellRing size={25}/></div><p className="eyebrow">MODO PARTICIPANTE</p><h1>Entra a la partida</h1><p className="form-sub">Pide el código al administrador, escribe tu nombre y ten el dedo listo.</p><form onSubmit={joinRoom} className="stack-form"><label>Código de partida<input value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))} placeholder="EJ. A7K2QX" autoComplete="off" required maxLength={10}/></label><label>Tu nombre<input value={playerName} onChange={e => setPlayerName(e.target.value)} placeholder="¿Cómo te llamas?" autoComplete="nickname" required maxLength={40}/></label><button className="primary-button full-button" disabled={joining}>{joining ? 'Conectando…' : 'Entrar a la partida'} <ArrowLeft className="arrow-right" size={18}/></button></form><p className="fine-print"><LockKeyhole size={13}/> No necesitas crear una cuenta.</p></div></section>}

    {role === 'admin' && !adminLoggedIn && <section className="form-layout"><button className="back-link" onClick={() => { setRole('home'); setNotice('') }}><ArrowLeft size={16}/> Volver al inicio</button><div className="form-card"><div className="form-icon"><ShieldCheck size={25}/></div><p className="eyebrow">ZONA RESTRINGIDA</p><h1>Panel de control</h1><p className="form-sub">Inicia sesión con la cuenta de administrador autorizada.</p><form onSubmit={adminLogin} className="stack-form"><label>Correo electrónico<input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} placeholder="admin@ejemplo.com" autoComplete="username" required/></label><label>Contraseña<input type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} placeholder="Tu contraseña" autoComplete="current-password" required/></label><button className="primary-button full-button" disabled={busy}>{busy ? 'Ingresando…' : 'Iniciar sesión'} <ArrowLeft className="arrow-right" size={18}/></button></form><p className="fine-print"><LockKeyhole size={13}/> El administrador debe estar autorizado en la base de datos.</p></div></section>}

    {role === 'player' && room && <section className="game-layout"><div className="game-head"><div><p className="eyebrow">SALA {room.code}</p><h1>¡Es tu momento, <span>{playerName}</span>!</h1></div><span className={`status-pill ${room.status}`}><span/>{{waiting:'Esperando',active:'Ronda activa',locked:'Bloqueada',finished:'Finalizada'}[room.status]}</span></div><div className="game-stage"><div className="game-side-info"><div className="mini-stat"><Users size={17}/><span>{room.participant_count} participantes</span></div><div className="mini-stat"><Activity size={17}/><span>{room.buzzes.length} pulsaciones</span></div></div><button className={`big-buzzer ${room.status !== 'active' || buzzedPosition !== null ? 'disabled' : ''} ${buzzedPosition !== null ? 'pressed' : ''}`} disabled={room.status !== 'active' || buzzedPosition !== null || busy} onClick={() => void pressBuzzer()} aria-label="Presionar buzzer"><span className="buzzer-inner"><BellRing size={46}/><strong>{buzzedPosition !== null ? 'REGISTRADO' : busy ? 'ENVIANDO…' : 'BUZZ!'}</strong><small>{buzzedPosition !== null ? `PUESTO #${buzzedPosition}` : room.status === 'active' ? 'PRESIONA AHORA' : 'ESPERA AL ADMIN'}</small></span></button><div className="game-message">{buzzedPosition !== null ? <><CheckCircle2 size={18}/> ¡Pulsación registrada! Quedaste en el puesto #{buzzedPosition}.</> : room.status === 'waiting' ? 'El administrador aún no inicia la ronda.' : room.status === 'locked' ? 'La ronda está bloqueada. Espera la siguiente.' : room.status === 'finished' ? 'Esta partida ha finalizado.' : 'El buzzer sonará únicamente en tu dispositivo.'}</div></div><div className="ranking-card"><div className="section-heading"><div><p className="eyebrow">EN ESTA RONDA</p><h2>Orden de pulsación</h2></div><span className="live-chip"><span/> EN VIVO</span></div>{room.buzzes.length === 0 ? <div className="empty-state"><div className="empty-icon"><Radio size={22}/></div><b>Aún no hay pulsaciones</b><span>Cuando alguien presione el buzzer, aparecerá aquí.</span></div> : <div className="ranking-list">{room.buzzes.map(b => <div className={`ranking-row ${b.participant_id === participantId ? 'my-rank' : ''}`} key={b.id}><span className={`rank-number ${b.position === 1 ? 'first' : ''}`}>{b.position === 1 ? <Trophy size={17}/> : b.position}</span><span className="rank-name">{b.participant_name}{b.participant_id === participantId && <small> · Tú</small>}</span><time>{new Date(b.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></div>)}</div>}</div><button className="back-link centered" onClick={() => { setRoom(null); setRole('home'); setBuzzedPosition(null); setNotice('') }}><DoorOpen size={16}/> Salir de la partida</button></section>}

    {role === 'admin' && adminLoggedIn && <section className="admin-layout"><div className="admin-heading"><div><p className="eyebrow">CENTRO DE CONTROL</p><h1>Administra tus partidas</h1><p className="form-sub">Crea una sala, comparte el código y controla cada ronda.</p></div><button className="primary-button create-button" onClick={() => void createRoom()} disabled={busy}><Plus size={18}/> Crear partida</button></div><div className="admin-columns"><aside className="rooms-panel"><div className="section-heading"><h2>Tus partidas</h2><button className="icon-button" title="Actualizar" onClick={() => void loadAdminRooms()}><RotateCcw size={16}/></button></div>{adminRooms.length === 0 ? <div className="empty-state compact"><div className="empty-icon"><Radio size={20}/></div><b>Aún no tienes partidas</b><span>Crea una para empezar.</span></div> : <div className="room-list">{adminRooms.map(r => <button key={r.id} className={`room-item ${activeAdminCode === r.code ? 'selected' : ''}`} onClick={() => void openAdminRoom(r.code)}><span className="room-code">{r.code}</span><span className={`status-pill small ${r.status}`}><span/>{{waiting:'Esperando',active:'Activa',locked:'Bloqueada',finished:'Finalizada'}[r.status] || r.status}</span></button>)}</div>}</aside><div className="control-panel">{room && activeAdminCode === room.code ? <><div className="control-top"><div><p className="eyebrow">CÓDIGO DE PARTIDA</p><div className="room-code-large">{room.code}</div><p className="form-sub">Comparte este código con los participantes.</p></div><button className="secondary-button copy-button" onClick={() => { void navigator.clipboard.writeText(`${shareUrl} · Código: ${room.code}`); setNotice('Código y enlace copiados.') }}>Copiar código</button></div><div className="admin-stats"><div className="stat-card"><Users size={18}/><span>Participantes</span><b>{room.participant_count}</b></div><div className="stat-card"><Activity size={18}/><span>Pulsaciones</span><b>{room.buzzes.length}</b></div><div className="stat-card"><Radio size={18}/><span>Estado</span><b className="stat-state">{{waiting:'Esperando',active:'Activa',locked:'Bloqueada',finished:'Finalizada'}[room.status]}</b></div></div><div className="round-controls"><div><p className="eyebrow">CONTROLES DE RONDA</p><h2>Ronda {room.round_number || 0}</h2></div><div className="control-buttons"><button className="primary-button" disabled={busy || room.status === 'active'} onClick={() => void adminAction('start_round')}><Zap size={16}/>{room.status === 'waiting' || room.status === 'finished' ? 'Iniciar ronda' : 'Nueva ronda'}</button><button className="secondary-button" disabled={busy || room.status !== 'active'} onClick={() => void adminAction('lock_round')}><LockKeyhole size={16}/> Bloquear</button><button className="secondary-button" disabled={busy || (room.status !== 'active' && room.status !== 'locked')} onClick={() => void adminAction('finish_round')}>Finalizar</button></div></div><div className="ranking-card admin-ranking"><div className="section-heading"><h2>Orden de pulsación</h2><span className="live-chip"><span/> ACTUALIZADO EN VIVO</span></div>{room.buzzes.length === 0 ? <div className="empty-state"><div className="empty-icon"><Radio size={22}/></div><b>Esperando al primer participante</b><span>Las pulsaciones aparecerán ordenadas aquí.</span></div> : <div className="ranking-list">{room.buzzes.map(b => <div className="ranking-row" key={b.id}><span className={`rank-number ${b.position === 1 ? 'first' : ''}`}>{b.position === 1 ? <Trophy size={17}/> : b.position}</span><span className="rank-name">{b.participant_name}</span><time>{new Date(b.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></div>)}</div>}</div></> : <div className="admin-placeholder"><div className="empty-icon"><Radio size={25}/></div><h2>Selecciona una partida</h2><p>Elige una sala de la lista o crea una nueva para ver el tablero de control.</p></div>}</div></div></section>}
    <footer className="footer"><span>BUZZER LIVE</span><span>Hecho para decidir quién responde primero.</span><span>V1.0</span></footer>
  </main>
}
