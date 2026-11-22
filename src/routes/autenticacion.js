'use strict';
const express = require('express');
const { consultar, transaccion, bitacora } = require('../db');
const auth = require('../auth');
const v = require('../validaciones');
const { mensajeDeError } = require('../errores');

const router = express.Router();

async function listarCarreras() {
  const r = await consultar(
    `SELECT c.id, c.nombre, f.nombre AS facultad
       FROM carrera c JOIN facultad f ON f.id = c.facultad_id
      ORDER BY f.nombre, c.nombre`
  );
  return r.rows;
}

// Valida los datos del registro (RF-01). Devuelve { datos, errores }.
async function validarRegistro(body) {
  const datos = {
    cedula: v.textoLimpio(body.cedula),
    nombres: v.textoLimpio(body.nombres),
    apellidos: v.textoLimpio(body.apellidos),
    correo: v.textoLimpio(body.correo).toLowerCase(),
    carrera_id: v.textoLimpio(body.carrera_id),
    ciudad: v.textoLimpio(body.ciudad),
    sector: v.textoLimpio(body.sector),
    password: String(body.password || ''),
    password2: String(body.password2 || ''),
  };
  const errores = [];
  if (!v.cedulaValida(datos.cedula)) errores.push('La cédula no es válida: debe tener 10 dígitos y un dígito verificador correcto.');
  else if ((await consultar('SELECT 1 FROM usuario WHERE cedula = $1', [datos.cedula])).rowCount) errores.push('La cédula ya está registrada.');
  if (!v.nombreValido(datos.nombres)) errores.push('Los nombres son obligatorios y solo pueden contener letras.');
  if (!v.nombreValido(datos.apellidos)) errores.push('Los apellidos son obligatorios y solo pueden contener letras.');
  if (!v.correoValido(datos.correo)) errores.push('El correo no tiene un formato válido.');
  else if ((await consultar('SELECT 1 FROM usuario WHERE lower(correo) = $1', [datos.correo])).rowCount) errores.push('El correo ya está registrado.');
  if (!v.enteroPositivo(datos.carrera_id) || !(await consultar('SELECT 1 FROM carrera WHERE id = $1', [datos.carrera_id])).rowCount) errores.push('Seleccione una carrera.');
  if (datos.ciudad.length < 2 || datos.ciudad.length > 80) errores.push('La ciudad es obligatoria (máximo 80 caracteres).');
  if (datos.sector.length < 2 || datos.sector.length > 80) errores.push('El sector es obligatorio (máximo 80 caracteres).');
  if (datos.password.length < 8 || datos.password.length > 72) errores.push('La contraseña debe tener entre 8 y 72 caracteres.');
  else if (datos.password !== datos.password2) errores.push('Las contraseñas no coinciden.');
  return { datos, errores };
}

router.get('/', (req, res) => res.redirect(req.usuario ? '/panel' : '/login'));

// ---------- Inicio y cierre de sesión (RF-02) ----------
router.get('/login', (req, res) => {
  if (req.usuario) return res.redirect('/panel');
  res.render('login', { cedula: '' });
});

router.post('/login', async (req, res, next) => {
  try {
    const cedula = v.textoLimpio(req.body.cedula);
    const password = String(req.body.password || '');
    const r = await consultar('SELECT id, password_hash, activo FROM usuario WHERE cedula = $1', [cedula]);
    const u = r.rows[0];
    const correcto = u && auth.verificarPassword(password, u.password_hash);
    if (!correcto) return res.status(401).render('login', { cedula, errores: ['Cédula o contraseña incorrecta.'] });
    if (!u.activo) return res.status(403).render('login', { cedula, errores: ['La cuenta está desactivada. Contacte al administrador.'] });
    await auth.crearSesion(res, u.id);
    res.redirect('/panel');
  } catch (e) { next(e); }
});

router.post('/logout', async (req, res, next) => {
  try {
    await auth.cerrarSesion(req, res);
    res.redirect('/login');
  } catch (e) { next(e); }
});

// ---------- Registro del estudiante con validación y confirmación (RF-01) ----------
router.get('/registro', async (req, res, next) => {
  try {
    if (req.usuario) return res.redirect('/panel');
    res.render('registro', { carreras: await listarCarreras(), datos: {} });
  } catch (e) { next(e); }
});

// Validación en tiempo real desde el navegador.
router.get('/api/validar', async (req, res, next) => {
  try {
    const campo = String(req.query.campo || '');
    const valor = v.textoLimpio(req.query.valor);
    let mensaje = '';
    if (campo === 'cedula') {
      if (!v.cedulaValida(valor)) mensaje = 'Cédula no válida (10 dígitos con dígito verificador correcto).';
      else if ((await consultar('SELECT 1 FROM usuario WHERE cedula = $1', [valor])).rowCount) mensaje = 'La cédula ya está registrada.';
    } else if (campo === 'correo') {
      if (!v.correoValido(valor.toLowerCase())) mensaje = 'El correo no tiene un formato válido.';
      else if ((await consultar('SELECT 1 FROM usuario WHERE lower(correo) = $1', [valor.toLowerCase()])).rowCount) mensaje = 'El correo ya está registrado.';
    } else {
      return res.status(400).json({ valido: false, mensaje: 'Campo no validable.' });
    }
    res.json({ valido: mensaje === '', mensaje });
  } catch (e) { next(e); }
});

// Paso 1: validar y mostrar el resumen con la advertencia.
router.post('/registro/revisar', async (req, res, next) => {
  try {
    const { datos, errores } = await validarRegistro(req.body);
    const carreras = await listarCarreras();
    if (errores.length) return res.status(422).render('registro', { carreras, datos, errores });
    const carrera = carreras.find((c) => String(c.id) === datos.carrera_id);
    res.render('registro_confirmar', { datos, carrera });
  } catch (e) { next(e); }
});

// Volver a corregir los datos desde el resumen.
router.post('/registro/formulario', async (req, res, next) => {
  try {
    res.render('registro', { carreras: await listarCarreras(), datos: req.body });
  } catch (e) { next(e); }
});

// Paso 2: crear la cuenta solo si el estudiante confirmó los datos.
router.post('/registro', async (req, res, next) => {
  try {
    const { datos, errores } = await validarRegistro(req.body);
    const carreras = await listarCarreras();
    if (req.body.confirmo !== 'si') errores.push('Debe confirmar que los datos son correctos para crear la cuenta.');
    if (errores.length) {
      if (req.body.confirmo !== 'si' && errores.length === 1) {
        const carrera = carreras.find((c) => String(c.id) === datos.carrera_id);
        return res.status(422).render('registro_confirmar', { datos, carrera, errores });
      }
      return res.status(422).render('registro', { carreras, datos, errores });
    }
    try {
      await transaccion(async (cliente) => {
        const r = await cliente.query(
          `INSERT INTO usuario (cedula, nombres, apellidos, correo, password_hash, rol, carrera_id, ciudad, sector)
           VALUES ($1, $2, $3, $4, $5, 'estudiante', $6, $7, $8) RETURNING id`,
          [datos.cedula, datos.nombres, datos.apellidos, datos.correo, auth.hashPassword(datos.password),
            datos.carrera_id, datos.ciudad, datos.sector]
        );
        await bitacora(cliente, r.rows[0].id, 'registro', 'usuario', r.rows[0].id, 'Registro de estudiante');
      });
    } catch (e) {
      const m = mensajeDeError(e);
      if (!m) throw e;
      return res.status(422).render('registro', { carreras, datos, errores: [m] });
    }
    auth.avisar(res, 'ok', 'Cuenta creada correctamente. Ya puede iniciar sesión.');
    res.redirect('/login');
  } catch (e) { next(e); }
});

// ---------- Panel ----------
router.get('/panel', auth.requiereLogin, async (req, res, next) => {
  try {
    const u = req.usuario;
    if (u.rol === 'estudiante') {
      const perfil = await consultar(
        `SELECT u.cedula, u.nombres, u.apellidos, u.correo, u.ciudad, u.sector,
                c.nombre AS carrera, f.nombre AS facultad
           FROM usuario u JOIN carrera c ON c.id = u.carrera_id JOIN facultad f ON f.id = c.facultad_id
          WHERE u.id = $1`, [u.id]);
      const conv = await consultar(
        `SELECT v.id, v.nombre, v.periodo_nombre, v.estado,
                to_char(v.apertura AT TIME ZONE 'America/Guayaquil', 'DD/MM/YYYY HH24:MI') AS apertura_txt,
                to_char(v.cierre   AT TIME ZONE 'America/Guayaquil', 'DD/MM/YYYY HH24:MI') AS cierre_txt
           FROM v_convocatoria v
           JOIN convocatoria_carrera cc ON cc.convocatoria_id = v.id
          WHERE cc.carrera_id = $1 AND v.estado <> 'cerrada' AND v.periodo_estado <> 'cerrado'
          ORDER BY v.apertura`, [u.carrera_id]);
      return res.render('panel_estudiante', { perfil: perfil.rows[0], convocatorias: conv.rows });
    }
    const conteos = await consultar(
      `SELECT (SELECT count(*) FROM facultad)     AS facultades,
              (SELECT count(*) FROM carrera)      AS carreras,
              (SELECT count(*) FROM periodo)      AS periodos,
              (SELECT count(*) FROM convocatoria) AS convocatorias,
              (SELECT count(*) FROM empresa)      AS empresas,
              (SELECT count(*) FROM usuario WHERE rol = 'estudiante') AS estudiantes`);
    res.render('panel_personal', { conteos: conteos.rows[0] });
  } catch (e) { next(e); }
});

// ---------- El estudiante solo puede cambiar ciudad y sector (RF-03) ----------
router.post('/perfil/localidad', auth.requiereRol('estudiante'), async (req, res, next) => {
  try {
    const ciudad = v.textoLimpio(req.body.ciudad);
    const sector = v.textoLimpio(req.body.sector);
    if (ciudad.length < 2 || ciudad.length > 80 || sector.length < 2 || sector.length > 80) {
      auth.avisar(res, 'error', 'La ciudad y el sector son obligatorios (máximo 80 caracteres).');
      return res.redirect('/panel');
    }
    // Solo se actualizan estas dos columnas; cualquier otro campo enviado se ignora.
    await transaccion(async (cliente) => {
      await cliente.query('UPDATE usuario SET ciudad = $1, sector = $2 WHERE id = $3', [ciudad, sector, req.usuario.id]);
      await bitacora(cliente, req.usuario.id, 'actualizar', 'usuario', req.usuario.id, `Localidad: ${ciudad} / ${sector}`);
    });
    auth.avisar(res, 'ok', 'Ciudad y sector actualizados.');
    res.redirect('/panel');
  } catch (e) { next(e); }
});

module.exports = router;
