'use strict';
const crypto = require('crypto');
const { consultar } = require('./db');

const HORAS_SESION = 8;

// ---- Contraseñas: scrypt con sal aleatoria (RNF-01) ----
function hashPassword(password) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, sal, 64);
  return `scrypt$${sal.toString('hex')}$${hash.toString('hex')}`;
}

function verificarPassword(password, almacenado) {
  const [alg, salHex, hashHex] = String(almacenado).split('$');
  if (alg !== 'scrypt' || !salHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const calculado = crypto.scryptSync(password, Buffer.from(salHex, 'hex'), esperado.length);
  return crypto.timingSafeEqual(esperado, calculado);
}

// ---- Cookies ----
function leerCookies(req) {
  const salida = {};
  (req.headers.cookie || '').split(';').forEach((par) => {
    const i = par.indexOf('=');
    if (i > 0) salida[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
  });
  return salida;
}

const OPCIONES_COOKIE = { httpOnly: true, sameSite: 'lax', path: '/' };

// ---- Sesiones guardadas en PostgreSQL ----
async function crearSesion(res, usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  await consultar(
    `INSERT INTO sesion (token, usuario_id, expira_en) VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [token, usuarioId, HORAS_SESION]
  );
  res.cookie('sid', token, { ...OPCIONES_COOKIE, maxAge: HORAS_SESION * 3600 * 1000 });
}

async function cerrarSesion(req, res) {
  const token = leerCookies(req).sid;
  if (token) await consultar('DELETE FROM sesion WHERE token = $1', [token]);
  res.clearCookie('sid', OPCIONES_COOKIE);
}

// Carga el usuario de la sesión y los mensajes pendientes (flash).
async function cargarContexto(req, res, next) {
  try {
    const cookies = leerCookies(req);
    req.usuario = null;
    if (/^[0-9a-f]{64}$/.test(cookies.sid || '')) {
      const r = await consultar(
        `SELECT u.id, u.cedula, u.nombres, u.apellidos, u.correo, u.rol, u.activo, u.carrera_id, u.ciudad, u.sector
           FROM sesion s JOIN usuario u ON u.id = s.usuario_id
          WHERE s.token = $1 AND s.expira_en > now() AND u.activo`,
        [cookies.sid]
      );
      req.usuario = r.rows[0] || null;
    }
    res.locals.usuario = req.usuario;
    res.locals.mensaje = null;
    if (cookies.flash) {
      try { res.locals.mensaje = JSON.parse(cookies.flash); } catch (_) { /* ignorar */ }
      res.clearCookie('flash', OPCIONES_COOKIE);
    }
    res.locals.errores = [];
    next();
  } catch (e) { next(e); }
}

// Guarda un mensaje para mostrarlo tras la redirección.
function avisar(res, tipo, texto) {
  res.cookie('flash', JSON.stringify({ tipo, texto }), { ...OPCIONES_COOKIE, maxAge: 60 * 1000 });
}

function requiereLogin(req, res, next) {
  if (!req.usuario) return res.redirect('/login');
  next();
}

// Control de acceso por rol (RNF-02).
const requiereRol = (...roles) => (req, res, next) => {
  if (!req.usuario) return res.redirect('/login');
  if (!roles.includes(req.usuario.rol)) {
    return res.status(403).render('error', { titulo: 'Acceso denegado', detalle: 'No tiene permiso para usar esta función.' });
  }
  next();
};

module.exports = {
  hashPassword, verificarPassword, crearSesion, cerrarSesion, cargarContexto,
  avisar, requiereLogin, requiereRol, leerCookies,
};
