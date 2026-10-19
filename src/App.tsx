import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { CalendarDays, Check, ChevronRight, CircleUserRound, Gamepad2, LogOut, Menu, Plus, Shield, Users, X } from 'lucide-react';
import type { Game, Loan, Profile, Reservation, Tournament } from './lib/supabase';
import { isConfigured, supabase } from './lib/supabase';
import { GAME_IMAGE_BUCKET, getGameImageUrl, uploadGameImage, validateGameImage } from './lib/game-images';
import { humanizeAuthError, validateMemberRegistration } from './lib/validation';

type SessionUser = { id: string; email?: string };
type Tab = 'games' | 'tournaments' | 'members' | 'reservations' | 'loans' | 'summary';
const friendlyError = humanizeAuthError;

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [role, setRole] = useState<'admin' | 'member' | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<Tab>('games');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [adminLogin, setAdminLogin] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [games, setGames] = useState<Game[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [myTournaments, setMyTournaments] = useState<Tournament[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ? { id: data.session.user.id, email: data.session.user.email } : null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ? { id: session.user.id, email: session.user.email } : null));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) { setRole(null); setProfile(null); return; }
    let alive = true;
    (async () => {
      const [{ data: roleRow }, { data: profileRow }] = await Promise.all([
        supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle(),
        supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle(),
      ]);
      if (alive) { setRole(roleRow?.role === 'admin' ? 'admin' : 'member'); setProfile(profileRow); }
    })();
    return () => { alive = false; };
  }, [user]);

  const refresh = async () => {
    if (!user || !role) return;
    setLoading(true);
    const [g, t, r, l, m] = await Promise.all([
      supabase.from('game_availability').select('*').order('name'),
      supabase.from('tournaments').select('*, games(name)').order('starts_at'),
      supabase.from('reservations').select('*, games(name)').order('starts_at', { ascending: false }),
      supabase.from('loans').select('*, games(name)').order('borrowed_at', { ascending: false }),
      role === 'admin' ? supabase.from('profiles').select('*').order('full_name') : Promise.resolve({ data: [], error: null }),
    ]);
    setGames((g.data || []) as Game[]); setTournaments((t.data || []) as Tournament[]); setReservations((r.data || []) as Reservation[]); setLoans((l.data || []) as Loan[]); setMembers((m.data || []) as Profile[]);
    if (role === 'member') {
      const { data: joined } = await supabase.from('tournament_registrations').select('tournament_id').eq('user_id', user.id);
      const ids = (joined || []).map((row) => row.tournament_id);
      if (!ids.length) setMyTournaments([]);
      else { const { data: mine } = await supabase.from('tournaments').select('*, games(name)').in('id', ids); setMyTournaments((mine || []) as Tournament[]); }
    }
    const failed = [g, t, r, l, m].find((item) => item.error);
    if (failed?.error) setError(friendlyError(failed.error.message));
    setLoading(false);
  };
  useEffect(() => { void refresh(); }, [user, role]);

  const flash = (text: string, bad = false) => { setMessage(bad ? '' : text); setError(bad ? text : ''); window.setTimeout(() => { setMessage(''); setError(''); }, 5000); };
  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const email = String(form.get('email')).trim().toLowerCase(); const password = String(form.get('password'));
    setError(''); setMessage('');
    if (authMode === 'register') {
      const full_name = String(form.get('name')).trim(); const dni = String(form.get('dni')).trim();
      const problem = validateMemberRegistration({ name: full_name, dni, email, password, confirmation: String(form.get('confirm') || ''), terms: form.get('terms') === 'on' });
      if (problem) return setError(problem);
      const { error: signUpError } = await supabase.auth.signUp({ email, password, options: { data: { full_name, dni } } });
      if (signUpError) return setError(friendlyError(signUpError.message));
      setMessage('Registro enviado. Revisá tu correo para confirmar la cuenta y después iniciá sesión.'); setAuthMode('login');
    } else {
      const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
      if (loginError) return setError(humanizeAuthError(loginError.message));
      setMessage('¡Bienvenido/a al club!');
    }
  };
  const resendConfirmation = async (email: string): Promise<string | null> => {
    const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: email.trim().toLowerCase() });
    return resendError ? humanizeAuthError(resendError.message) : null;
  };
  const signOut = async () => { await supabase.auth.signOut(); setTab('games'); setMessage(''); };

  if (!isConfigured) return <SetupScreen />;
  if (!user) return <AuthScreen mode={authMode} setMode={setAuthMode} admin={adminLogin} setAdmin={setAdminLogin} onSubmit={handleAuth} onResend={resendConfirmation} error={error} message={message} />;
  if (!role) return <div className="loading-page"><span className="spinner" />Preparando tu espacio…</div>;

  const allNav: { id: Tab; label: string; icon: typeof Gamepad2; admin?: boolean; member?: boolean }[] = [
    { id: 'games', label: role === 'admin' ? 'Juegos' : 'Reservar juego', icon: Gamepad2 },
    { id: 'tournaments', label: 'Torneos', icon: CalendarDays },
    { id: 'reservations', label: role === 'admin' ? 'Reservas' : 'Mis reservas', icon: Check },
    { id: 'loans', label: role === 'admin' ? 'Préstamos' : 'Mis préstamos', icon: Gamepad2 },
    { id: 'members', label: 'Socios', icon: Users, admin: true },
    { id: 'summary', label: 'Mi resumen', icon: CircleUserRound, member: true },
  ];
  const nav = allNav.filter((item) => !(item.admin && role === 'member') && !(item.member && role === 'admin'));

  const createGame = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const d = new FormData(form);
    const file = d.get('image') as File;
    const imageProblem = validateGameImage(file);
    if (imageProblem) return flash(imageProblem, true);
    const { data: game, error: e } = await supabase.from('games').insert({ name: d.get('name'), category: d.get('category'), description: d.get('description'), quantity: Number(d.get('quantity')), status: d.get('status') }).select('id').single();
    if (e) return flash(e.message, true);
    if (file?.size) {
      const uploaded = await uploadGameImage(game.id, file);
      if (uploaded.error) { flash(`El juego se creó, pero no se pudo subir la imagen: ${uploaded.error}`, true); await refresh(); return; }
      const { error: imageError } = await supabase.from('games').update({ image_path: uploaded.path }).eq('id', game.id);
      if (imageError) { await supabase.storage.from(GAME_IMAGE_BUCKET).remove([uploaded.path!]); flash(`El juego se creó, pero no se pudo guardar la imagen: ${imageError.message}`, true); await refresh(); return; }
    }
    flash('Juego agregado.'); form.reset(); await refresh();
  };
  const createTournament = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const d = new FormData(form);
    const { error: e } = await supabase.from('tournaments').insert({ name: d.get('name'), game_id: d.get('game_id'), starts_at: new Date(String(d.get('starts_at'))).toISOString(), description: d.get('description'), max_participants: Number(d.get('capacity')), status: 'open' });
    if (e) return flash(e.message, true); flash('Torneo creado.'); form.reset(); await refresh();
  };
  const reserve = async (gameId: string, startsAt: string) => {
    if (!user) return flash('Iniciá sesión para reservar un juego.', true);
    const starts = new Date(startsAt);
    if (Number.isNaN(starts.getTime()) || starts.getTime() <= Date.now()) return flash('Elegí una fecha y hora futura.', true);
    const { error: e } = await supabase.from('reservations').insert({ game_id: gameId, user_id: user.id, starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + 7200000).toISOString() });
    if (e) return flash(e.message.includes('duplicate') ? 'Ya tenés una reserva para ese horario.' : e.message, true); flash('Reserva confirmada para las próximas dos horas.'); await refresh();
  };
  const requestLoan = async (gameId: string) => {
    if (!user) return flash('Iniciá sesión para pedir un préstamo.', true);
    const borrowed = new Date(); const due = new Date(Date.now() + 7 * 86400000);
    const { error: e } = await supabase.from('loans').insert({ game_id: gameId, user_id: user.id, borrowed_at: borrowed.toISOString(), due_at: due.toISOString() });
    if (e) return flash(e.message, true); flash('Préstamo registrado por 7 días.'); await refresh();
  };
  const joinTournament = async (tournamentId: string) => {
    if (!user) return flash('Iniciá sesión para inscribirte.', true);
    const { error: e } = await supabase.from('tournament_registrations').insert({ tournament_id: tournamentId, user_id: user.id });
    if (e) return flash(e.message.includes('duplicate') ? 'Ya estás inscripto/a en este torneo.' : e.message, true); flash('¡Inscripción confirmada!'); await refresh();
  };
  const updateStatus = async (table: 'games' | 'tournaments' | 'profiles' | 'loans', id: string, status: string) => {
    const column = table === 'profiles' ? 'active' : 'status'; const value = table === 'profiles' ? status === 'active' : status;
      const { error: e } = table === 'profiles'
        ? await supabase.rpc('set_member_active', { member_id: id, is_active: status === 'active' })
        : await supabase.from(table).update({ [column]: value }).eq('id', id);
    if (e) return flash(e.message, true); flash('Cambios guardados.'); await refresh();
  };
  const removeGame = async (id: string) => { if (!window.confirm('¿Eliminar este juego?')) return; const { error: e } = await supabase.from('games').delete().eq('id', id); if (e) return flash(e.message, true); flash('Juego eliminado.'); await refresh(); };
  const editGame = async (id: string, game: Pick<Game, 'name' | 'category' | 'description' | 'quantity' | 'status'>, imageFile?: File | null): Promise<string | null> => {
    const imageProblem = validateGameImage(imageFile || null);
    if (imageProblem) return imageProblem;
    let imagePath: string | null | undefined;
    if (imageFile?.size) {
      const uploaded = await uploadGameImage(id, imageFile);
      if (uploaded.error) return `No se pudo subir la imagen: ${uploaded.error}`;
      imagePath = uploaded.path;
    }
    const update = imagePath ? { ...game, image_path: imagePath } : game;
    const { data: previous } = imagePath ? await supabase.from('games').select('image_path').eq('id', id).maybeSingle() : { data: null };
    const { error: e } = await supabase.from('games').update(update).eq('id', id);
    if (e) { if (imagePath) await supabase.storage.from(GAME_IMAGE_BUCKET).remove([imagePath]); return e.message; }
    if (imagePath && previous?.image_path) await supabase.storage.from(GAME_IMAGE_BUCKET).remove([previous.image_path]);
    await refresh();
    return null;
  };

  return <div className="app-shell">
    <aside className={`sidebar ${mobileMenu ? 'open' : ''}`}>
      <a className="brand" href="#inicio" aria-label="Club Geek, inicio"><span className="brand-mark"><Gamepad2 size={22} /></span><span>CLUB <b>GEEK</b><small>JUGAR ES MEJOR EN COMUNIDAD</small></span></a>
      <div className="side-label">MENÚ PRINCIPAL</div>
      <nav aria-label="Menú principal">{nav.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${tab === id ? 'active' : ''}`} onClick={() => { setTab(id); setMobileMenu(false); }}><Icon size={19} />{label}<ChevronRight className="nav-chevron" size={16} /></button>)}</nav>
      <div className="sidebar-bottom"><div className="user-mini"><span className="avatar">{(profile?.full_name || user.email || 'G')[0].toUpperCase()}</span><span><b>{profile?.full_name || user.email}</b><small>{role === 'admin' ? 'Administrador' : 'Socio/a'}</small></span></div><button className="logout" onClick={() => void signOut()}><LogOut size={17} />Cerrar sesión</button></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><button className="mobile-toggle" aria-label="Abrir menú" onClick={() => setMobileMenu(!mobileMenu)}><Menu /></button><span className="breadcrumb">{role === 'admin' ? 'ADMINISTRACIÓN' : 'ÁREA DE SOCIOS'} <b>/</b> {nav.find((item) => item.id === tab)?.label.toUpperCase()}</span><span className="top-user"><span className="status-dot" />Conectado</span></header>
      <div className="page-wrap">
        {message && <div className="alert success" role="status"><Check size={18} />{message}<button onClick={() => setMessage('')} aria-label="Cerrar"><X size={16} /></button></div>}
        {error && <div className="alert failure" role="alert">{error}<button onClick={() => setError('')} aria-label="Cerrar"><X size={16} /></button></div>}
        {role === 'member' && <div className="welcome"><div><p className="eyebrow">TU ESPACIO EN EL CLUB</p><h1>¡Hola, {profile?.full_name?.split(' ')[0] || 'geek'}! <span>👋</span></h1><p>¿Qué vamos a jugar hoy?</p></div><div className="welcome-symbol"><Gamepad2 size={48} /></div></div>}
        {loading && <div className="loading-inline"><span className="spinner" />Actualizando datos…</div>}
        {tab === 'games' && <GamesView admin={role === 'admin'} games={games} onCreate={createGame} onEdit={editGame} onDelete={removeGame} onReserve={reserve} onLoan={requestLoan} />}
        {tab === 'tournaments' && <TournamentsView admin={role === 'admin'} tournaments={tournaments} games={games} onCreate={createTournament} onJoin={joinTournament} onStatus={(id, status) => updateStatus('tournaments', id, status)} />}
        {tab === 'members' && role === 'admin' && <MembersView members={members} onToggle={(m) => void updateStatus('profiles', m.user_id, m.active ? 'inactive' : 'active')} />}
        {tab === 'reservations' && <ReservationsView reservations={reservations} admin={role === 'admin'} />}
        {tab === 'loans' && <LoansView loans={loans} admin={role === 'admin'} onReturn={(id) => void updateStatus('loans', id, 'returned')} />}
        {tab === 'summary' && role === 'member' && <SummaryView profile={profile} reservations={reservations} loans={loans} tournaments={myTournaments} />}
      </div>
      <footer>Club Geek <span>·</span> Una comunidad para jugar y compartir</footer>
    </main>
  </div>;
}

function SetupScreen() { return <div className="auth-screen"><div className="setup-card"><div className="brand center"><span className="brand-mark"><Gamepad2 size={22} /></span><span>CLUB <b>GEEK</b></span></div><h1>Configurá tu club</h1><p>Para iniciar, copiá <code>.env.example</code> como <code>.env</code> y completá la URL y la clave pública de tu proyecto Supabase. Luego ejecutá el script SQL documentado en el README.</p></div></div>; }

function AuthScreen({ mode, setMode, admin, setAdmin, onSubmit, onResend, error, message }: { mode: 'login' | 'register'; setMode: (mode: 'login' | 'register') => void; admin: boolean; setAdmin: (value: boolean) => void; onSubmit: (e: FormEvent<HTMLFormElement>) => void; onResend: (email: string) => Promise<string | null>; error: string; message: string }) {
  const emailRef = useRef<HTMLInputElement>(null);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [resendError, setResendError] = useState('');
  const handleResend = async () => {
    const email = emailRef.current?.value.trim() || '';
    if (!email) { setResendError('Escribí tu correo en el campo de arriba y volvé a intentarlo.'); setResendMessage(''); return; }
    if (!emailRef.current?.checkValidity()) { setResendError('Revisá que el correo tenga un formato válido.'); setResendMessage(''); return; }
    setResending(true); setResendError(''); setResendMessage('');
    const problem = await onResend(email);
    if (problem) setResendError(problem);
    else setResendMessage('Si la cuenta está pendiente de confirmación, enviamos un nuevo correo. Revisá tu bandeja de entrada y Spam.');
    setResending(false);
  };
  return <div className="auth-screen"><div className="auth-glow glow-one" /><div className="auth-glow glow-two" /><div className="auth-layout">
    <div className="auth-intro"><a className="brand" href="#inicio"><span className="brand-mark"><Gamepad2 size={23} /></span><span>CLUB <b>GEEK</b><small>JUGAR ES MEJOR EN COMUNIDAD</small></span></a><p className="eyebrow">VIDEOJUEGOS · JUEGOS DE MESA · AMIGOS</p><h1>Tu próxima<br /><span>gran partida</span><br />empieza acá.</h1><p className="intro-copy">Un espacio para compartir partidas, descubrir juegos y competir en comunidad.</p><div className="intro-chips"><span><Gamepad2 size={16} /> JUEGOS</span><span><Users size={16} /> COMUNIDAD</span><span><CalendarDays size={16} /> TORNEOS</span></div></div>
    <div className="auth-card"><div className="auth-card-head"><div className="auth-icon"><Shield size={21} /></div><span>ACCESO SEGURO</span></div><h2>{mode === 'register' ? 'Sumate al club' : admin ? 'Acceso administrador' : '¡Qué bueno verte!'}</h2><p className="muted">{mode === 'register' ? 'Creá tu cuenta de socio/a para empezar a jugar.' : admin ? 'Ingresá con tu cuenta autorizada de administrador.' : 'Iniciá sesión para continuar.'}</p>
      {error && <div className="alert failure" role="alert">{error}</div>}{message && <div className="alert success" role="status">{message}</div>}
      {mode === 'login' && <div className="auth-tabs"><button className={!admin ? 'selected' : ''} onClick={() => setAdmin(false)}>Socio/a</button><button className={admin ? 'selected' : ''} onClick={() => setAdmin(true)}>Administrador</button></div>}
      <form onSubmit={onSubmit} className="form-stack">
        {mode === 'register' && <><label>Nombre y apellido<input name="name" autoComplete="name" placeholder="Ej. Alex García" required /></label><label>DNI<input name="dni" inputMode="numeric" autoComplete="off" placeholder="Solo números" minLength={7} maxLength={9} required /></label></>}
        <label>Correo electrónico<input ref={emailRef} name="email" type="email" autoComplete="email" placeholder="nombre@correo.com" required /></label>
        <label>Contraseña<input name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} placeholder={mode === 'register' ? 'Mínimo 8 caracteres' : 'Tu contraseña'} minLength={mode === 'register' ? 8 : undefined} required /></label>
        {mode === 'register' && <><label>Confirmar contraseña<input name="confirm" type="password" autoComplete="new-password" placeholder="Repetí tu contraseña" required /></label><label className="terms"><input name="terms" type="checkbox" required /><span>Acepto los <a href="#terminos">términos y condiciones</a> del club.</span></label></>}
        <button className="button primary full" type="submit">{mode === 'register' ? 'Crear cuenta de socio' : 'Iniciar sesión'}<ChevronRight size={18} /></button>
      </form>
      {mode === 'login' && <div className="resend-area"><button className="resend-link" type="button" disabled={resending} onClick={() => void handleResend()}>{resending ? 'Enviando…' : 'Reenviar correo de confirmación'}</button>{resendMessage && <p className="resend-feedback" role="status">{resendMessage}</p>}{resendError && <p className="resend-feedback resend-error" role="alert">{resendError}</p>}</div>}
      <div className="auth-switch">{mode === 'register' ? <>¿Ya tenés cuenta? <button onClick={() => setMode('login')}>Iniciá sesión</button></> : <>¿Todavía no sos socio/a? <button onClick={() => { setAdmin(false); setMode('register'); }}>Crear cuenta</button></>}</div>
      <p className="admin-note"><Shield size={14} /> El registro público crea exclusivamente cuentas de socio.</p>
    </div>
  </div><div className="auth-footer">© {new Date().getFullYear()} Club Geek <span>·</span> Hecho para jugar en comunidad</div></div>;
}

function SectionHeader({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: React.ReactNode }) { return <div className="section-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="muted">{subtitle}</p></div>{action}</div>; }
function GamesView({ admin, games, onCreate, onEdit, onDelete, onReserve, onLoan }: { admin: boolean; games: Game[]; onCreate: (e: FormEvent<HTMLFormElement>) => void; onEdit: (id: string, game: Pick<Game, 'name' | 'category' | 'description' | 'quantity' | 'status'>, imageFile?: File | null) => Promise<string | null>; onDelete: (id: string) => void; onReserve: (id: string, startsAt: string) => void; onLoan: (id: string) => void }) {
  return <><SectionHeader eyebrow={admin ? 'CATÁLOGO DEL CLUB' : 'ENCONTRÁ TU PRÓXIMA PARTIDA'} title={admin ? 'Juegos' : 'Reservar un juego'} subtitle={admin ? 'Administrá los juegos y su disponibilidad.' : 'Elegí un juego disponible y prepará la próxima partida.'} />
    {admin && <details className="form-card"><summary><Plus size={18} /> Agregar juego</summary><form className="editor-grid" onSubmit={onCreate}><label>Nombre<input name="name" required maxLength={100} /></label><label>Categoría<input name="category" required placeholder="Estrategia, party…" /></label><label>Cantidad disponible<input name="quantity" type="number" min="1" defaultValue="1" required /></label><label>Estado<select name="status"><option value="available">Disponible</option><option value="maintenance">En mantenimiento</option></select></label><label>Imagen del juego<input name="image" type="file" accept="image/png,image/jpeg,image/webp" /><small>JPG, PNG o WebP · máximo 5 MB</small></label><label className="span-two">Descripción<textarea name="description" rows={2} /></label><button className="button primary" type="submit">Guardar juego</button></form></details>}
    <div className="game-grid">{games.map((g) => <GameCard key={g.id} game={g} admin={admin} onEdit={onEdit} onDelete={onDelete} onReserve={onReserve} onLoan={onLoan} />)}{!games.length && <EmptyState title="Todavía no hay juegos" text={admin ? 'Agregá el primer juego del catálogo.' : 'El catálogo se está preparando. Volvé pronto.'} />}</div>
  </>;
}
function GameCard({ game: g, admin, onEdit, onDelete, onReserve, onLoan }: { game: Game; admin: boolean; onEdit: (id: string, game: Pick<Game, 'name' | 'category' | 'description' | 'quantity' | 'status'>, imageFile?: File | null) => Promise<string | null>; onDelete: (id: string) => void; onReserve: (id: string, startsAt: string) => void; onLoan: (id: string) => void }) {
  const defaultStart = () => { const d = new Date(Date.now() + 3600000); d.setMinutes(0, 0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const [start, setStart] = useState(defaultStart);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editMessage, setEditMessage] = useState('');
  const [editError, setEditError] = useState('');
  const editGame = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const d = new FormData(form);
    const imageInput = form.elements.namedItem('image') as HTMLInputElement | null;
    const imageFile = imageInput?.files?.[0] || null;
    setEditMessage(''); setEditError(''); setSavingEdit(true);
    try {
      const problem = await onEdit(g.id, { name: String(d.get('name')), category: String(d.get('category')), description: String(d.get('description')), quantity: Number(d.get('quantity')), status: String(d.get('status')) }, imageFile);
      if (problem) setEditError(problem);
      else { setEditMessage('Cambios guardados correctamente.'); if (imageInput) imageInput.value = ''; }
    } catch (cause) {
      setEditError(cause instanceof Error ? cause.message : 'No se pudieron guardar los cambios.');
    } finally { setSavingEdit(false); }
  };
  const image = getGameImageUrl(g.image_path);
  return <article className="game-card"><div className="game-art">{image ? <img src={image} alt={`Imagen de ${g.name}`} loading="lazy" /> : <Gamepad2 size={34} />}<span className={`badge ${g.status === 'available' ? 'green' : 'amber'}`}>{g.status === 'available' ? 'Disponible' : 'Mantenimiento'}</span></div><div className="game-info"><p className="eyebrow">{g.category}</p><h3>{g.name}</h3><p className="muted">{g.description || 'Un juego para compartir una gran partida.'}</p><div className="game-bottom"><span>{g.available ?? g.quantity} disponibles</span>{admin && <button className="text-danger" onClick={() => onDelete(g.id)}>Eliminar</button>}</div>{admin && <details className="inline-editor"><summary>Editar datos</summary><form onSubmit={editGame}><label>Nombre<input name="name" defaultValue={g.name} required /></label><label>Categoría<input name="category" defaultValue={g.category} required /></label><label>Unidades<input name="quantity" type="number" min="1" defaultValue={g.quantity} required /></label><label>Estado<select name="status" defaultValue={g.status}><option value="available">Disponible</option><option value="maintenance">En mantenimiento</option></select></label><label>Descripción<textarea name="description" rows={2} defaultValue={g.description} /></label><label>Cambiar imagen<input name="image" type="file" accept="image/png,image/jpeg,image/webp" /><small>Opcional · JPG, PNG o WebP · máximo 5 MB</small></label>{editError && <p className="inline-feedback is-error" role="alert">{editError}</p>}{editMessage && <p className="inline-feedback is-success" role="status">{editMessage}</p>}<button className="button small primary" type="submit" disabled={savingEdit}>{savingEdit ? 'Guardando…' : 'Guardar cambios'}</button></form></details>}{!admin && <div className="member-game-actions"><label>Fecha y hora<input aria-label={`Fecha y hora para ${g.name}`} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label><div className="button-row"><button className="button small secondary" disabled={g.status !== 'available' || (g.available ?? g.quantity) < 1} onClick={() => onReserve(g.id, start)}>Reservar 2 h</button><button className="button small primary" disabled={g.status !== 'available' || (g.available ?? g.quantity) < 1} onClick={() => onLoan(g.id)}>Pedir prestado</button></div></div>}</div></article>;
}
function TournamentsView({ admin, tournaments, games, onCreate, onJoin, onStatus }: { admin: boolean; tournaments: Tournament[]; games: Game[]; onCreate: (e: FormEvent<HTMLFormElement>) => void; onJoin: (id: string) => void; onStatus: (id: string, status: string) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [attendees, setAttendees] = useState<Record<string, { id: string; profiles: { full_name: string; email: string } }[]>>({});
  const inspect = async (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (attendees[id]) return;
    const { data, error: queryError } = await supabase.from('tournament_registrations').select('id, profiles!tournament_registrations_user_id_fkey(full_name,email)').eq('tournament_id', id);
    if (queryError) return;
    setAttendees((current) => ({ ...current, [id]: data as unknown as { id: string; profiles: { full_name: string; email: string } }[] }));
  };
  return <><SectionHeader eyebrow="COMPETÍ Y COMPARTÍ" title="Torneos" subtitle={admin ? 'Organizá competencias y consultá las inscripciones.' : 'Encontrá una competencia y sumate a la próxima partida.'} />{admin && <details className="form-card"><summary><Plus size={18} /> Crear torneo</summary><form className="editor-grid" onSubmit={onCreate}><label>Nombre<input name="name" required /></label><label>Juego<select name="game_id" required><option value="">Elegí un juego</option>{games.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label><label>Fecha y hora<input name="starts_at" type="datetime-local" required /></label><label>Cupo máximo<input name="capacity" type="number" min="2" required /></label><label className="span-two">Descripción<textarea name="description" rows={2} /></label><button className="button primary">Crear torneo</button></form></details>}<div className="table-card"><div className="table-scroll"><table><thead><tr><th>Torneo</th><th>Juego</th><th>Fecha</th><th>Cupo</th><th>Estado</th><th /></tr></thead><tbody>{tournaments.map((t) => <React.Fragment key={t.id}><tr><td><b>{t.name}</b><small>{t.description}</small></td><td>{t.games?.name || games.find((g) => g.id === t.game_id)?.name || '—'}</td><td>{new Date(t.starts_at).toLocaleString('es-AR')}</td><td>{t.max_participants} jugadores</td><td><span className={`badge ${t.status === 'open' ? 'green' : 'slate'}`}>{t.status === 'open' ? 'Inscripción abierta' : 'Cerrado'}</span></td><td className="table-actions">{admin ? <><button className="button small secondary" onClick={() => void inspect(t.id)}>Inscripciones</button><button className="button small secondary" onClick={() => onStatus(t.id, t.status === 'open' ? 'closed' : 'open')}>{t.status === 'open' ? 'Cerrar' : 'Abrir'}</button></> : <button className="button small primary" disabled={t.status !== 'open'} onClick={() => onJoin(t.id)}>Inscribirme</button>}</td></tr>{expanded === t.id && <tr><td colSpan={6}><b>Participantes ({attendees[t.id]?.length ?? '…'})</b>{attendees[t.id]?.length ? attendees[t.id].map((a) => <p className="attendee-line" key={a.id}>{a.profiles.full_name}<span>{a.profiles.email}</span></p>) : <p className="muted">Todavía no hay inscripciones.</p>}</td></tr>}</React.Fragment>)}</tbody></table>{!tournaments.length && <EmptyState title="No hay torneos todavía" text="Cuando se organice el próximo torneo, lo vas a encontrar acá." />}</div></div></>;
}
function MembersView({ members, onToggle }: { members: Profile[]; onToggle: (m: Profile) => void }) { return <><SectionHeader eyebrow="COMUNIDAD" title="Socios" subtitle={`${members.length} socios registrados en el club.`} /><div className="table-card"><div className="table-scroll"><table><thead><tr><th>Socio/a</th><th>DNI</th><th>Correo electrónico</th><th>Estado</th><th /></tr></thead><tbody>{members.map((m) => <tr key={m.user_id}><td><b>{m.full_name}</b></td><td>{m.dni}</td><td>{m.email}</td><td><span className={`badge ${m.active ? 'green' : 'slate'}`}>{m.active ? 'Activo' : 'Inactivo'}</span></td><td><button className="button small secondary" onClick={() => onToggle(m)}>{m.active ? 'Desactivar' : 'Activar'}</button></td></tr>)}</tbody></table>{!members.length && <EmptyState title="Todavía no hay socios" text="Los nuevos registros van a aparecer acá." />}</div></div></>; }
function ReservationsView({ reservations, admin }: { reservations: Reservation[]; admin: boolean }) { return <><SectionHeader eyebrow="AGENDA DE JUEGO" title={admin ? 'Reservas' : 'Mis reservas'} subtitle={admin ? 'Consultá las reservas registradas por los socios.' : 'Revisá las próximas partidas que reservaste.'} /><div className="table-card"><div className="table-scroll"><table><thead><tr><th>Juego</th><th>Fecha y hora</th><th>Duración</th><th>Estado</th></tr></thead><tbody>{reservations.map((r) => <tr key={r.id}><td><b>{r.games?.name || 'Juego'}</b></td><td>{new Date(r.starts_at).toLocaleString('es-AR')}</td><td>2 horas</td><td><span className={`badge ${r.status === 'confirmed' ? 'green' : 'slate'}`}>{r.status === 'confirmed' ? 'Confirmada' : r.status}</span></td></tr>)}</tbody></table>{!reservations.length && <EmptyState title="No hay reservas" text={admin ? 'Las reservas aparecerán en esta lista.' : 'Reservá un juego para verlo en esta lista.'} />}</div></div></>; }
function LoansView({ loans, admin, onReturn }: { loans: Loan[]; admin: boolean; onReturn: (id: string) => void }) { return <><SectionHeader eyebrow="PRÉSTAMOS DEL CLUB" title={admin ? 'Préstamos' : 'Mis préstamos'} subtitle={admin ? 'Consultá préstamos activos y registrá devoluciones.' : 'Seguí las fechas de devolución de tus juegos.'} /><div className="table-card"><div className="table-scroll"><table><thead><tr><th>Juego</th><th>Retirado</th><th>Devolución prevista</th><th>Estado</th>{admin && <th />}</tr></thead><tbody>{loans.map((l) => <tr key={l.id}><td><b>{l.games?.name || 'Juego'}</b></td><td>{new Date(l.borrowed_at).toLocaleDateString('es-AR')}</td><td>{new Date(l.due_at).toLocaleDateString('es-AR')}</td><td><span className={`badge ${l.status === 'active' ? 'amber' : 'green'}`}>{l.status === 'active' ? 'Activo' : 'Devuelto'}</span></td>{admin && <td>{l.status === 'active' && <button className="button small secondary" onClick={() => onReturn(l.id)}>Registrar devolución</button>}</td>}</tr>)}</tbody></table>{!loans.length && <EmptyState title="No hay préstamos" text="Los préstamos y sus devoluciones aparecerán en esta lista." />}</div></div></>; }
function SummaryView({ profile, reservations, loans, tournaments }: { profile: Profile | null; reservations: Reservation[]; loans: Loan[]; tournaments: Tournament[] }) { return <><SectionHeader eyebrow="TU ACTIVIDAD" title="Mi resumen" subtitle="Tu información personal y actividad en el club." /><div className="summary-grid"><article className="summary-card profile-card"><div className="avatar large">{profile?.full_name?.[0] || '?'}</div><div><p className="eyebrow">SOCIO/A</p><h2>{profile?.full_name || 'Socio/a'}</h2><p>{profile?.email}</p></div><div className="profile-details"><span><small>DNI</small>{profile?.dni}</span><span><small>Estado</small>{profile?.active ? 'Activo' : 'Inactivo'}</span></div></article><StatCard count={reservations.length} label="Reservas" icon={<CalendarDays />} /><StatCard count={loans.filter((l) => l.status === 'active').length} label="Préstamos activos" icon={<Gamepad2 />} /><StatCard count={tournaments.length} label="Torneos disponibles" icon={<Users />} /></div><div className="summary-lists"><div className="table-card"><h3>Próximas reservas</h3>{reservations.slice(0, 4).map((r) => <p className="list-line" key={r.id}><b>{r.games?.name}</b><span>{new Date(r.starts_at).toLocaleDateString('es-AR')}</span></p>)}{!reservations.length && <p className="muted">Todavía no tenés reservas.</p>}</div><div className="table-card"><h3>Historial de préstamos</h3>{loans.slice(0, 4).map((l) => <p className="list-line" key={l.id}><b>{l.games?.name}</b><span>{l.status === 'active' ? `Devolver ${new Date(l.due_at).toLocaleDateString('es-AR')}` : 'Devuelto'}</span></p>)}{!loans.length && <p className="muted">Todavía no tenés préstamos.</p>}</div></div></>; }
function StatCard({ count, label, icon }: { count: number; label: string; icon: React.ReactNode }) { return <article className="summary-card stat-card"><span className="stat-icon">{icon}</span><b>{count}</b><span>{label}</span></article>; }
function EmptyState({ title, text }: { title: string; text: string }) { return <div className="empty-state"><span><Gamepad2 size={23} /></span><b>{title}</b><p>{text}</p></div>; }
