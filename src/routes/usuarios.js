'use strict';
const express = require('express');
const { consultar, transaccion, bitacora } = require('../db');
const { requiereRol, avisar, hashPassword } = require('../auth');
const v = require('../validaciones');
const { mensajeDeError } = require('../errores');
const { idMw } = require('./util');

const router = express.Router();
const soloAdmin = requiereRol('administrador');

async function contexto(rol) {
  const filtro = ['estudiante', 'coordinador', 'administrador'].includes(rol) ? rol : '';
  const params = filtro ? [filtro] : [];
  const lista = (await consultar(
    `SELECT id, cedula, nombres, apellidos, correo, rol, activo FROM usuario
      ${filtro ? 'WHERE rol = $1' : ''} ORDER BY rol, apellidos, nombres`, params)).rows;
  return { lista, filtro };
}

router.get('/usuarios', soloAdmin, async (req, res, next) => {
  try { res.render('usuarios', { ...(await contexto(req.query.rol)), datos: {} }); } catch (e) { next(e); }
});

// El administrador crea cuentas del personal (RF-04).
router.post('/usuarios', soloAdmin, async (req, res, next) => {
  try {
    const datos = {
      cedula: v.textoLimpio(req.body.cedula),
      nombres: v.textoLimpio(req.body.nombres),
      apellidos: v.textoLimpio(req.body.apellidos),
      correo: v.textoLimpio(req.body.correo).toLowerCase(),
      rol: v.textoLimpio(req.body.rol),
    };
    const password = String(req.body.password || '');
    const errores = [];
    if (!v.cedulaValida(datos.cedula)) errores.push('La cédula no es válida.');
    if (!v.nombreValido(datos.nombres)) errores.push('Los nombres son obligatorios y solo pueden contener letras.');
    if (!v.nombreValido(datos.apellidos)) errores.push('Los apellidos son obligatorios y solo pueden contener letras.');
    if (!v.correoValido(datos.correo)) errores.push('El correo no tiene un formato válido.');
    if (!['coordinador', 'administrador'].includes(datos.rol)) errores.push('Seleccione un rol válido (coordinador o administrador).');
    if (password.length < 8 || password.length > 72) errores.push('La contraseña inicial debe tener entre 8 y 72 caracteres.');
    if (!errores.length) {
      try {
        await transaccion(async (c) => {
          const r = await c.query(
            `INSERT INTO usuario (cedula, nombres, apellidos, correo, password_hash, rol)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [datos.cedula, datos.nombres, datos.apellidos, datos.correo, hashPassword(password), datos.rol]);
          await bitacora(c, req.usuario.id, 'crear', 'usuario', r.rows[0].id, `Cuenta ${datos.rol}`);
        });
        avisar(res, 'ok', 'Cuenta creada correctamente.');
        return res.redirect('/usuarios');
      } catch (e) { const m = mensajeDeError(e); if (!m) throw e; errores.push(m); }
    }
    res.status(422).render('usuarios', { ...(await contexto()), datos, errores });
  } catch (e) { next(e); }
});

// Activar o desactivar una cuenta. Los registros previos se conservan.
router.post('/usuarios/:id/estado', soloAdmin, idMw, async (req, res, next) => {
  try {
    if (Number(req.params.id) === req.usuario.id) {
      avisar(res, 'error', 'No puede desactivar su propia cuenta.');
      return res.redirect('/usuarios');
    }
    const activo = req.body.activo === 'true';
    const n = await transaccion(async (c) => {
      const r = await c.query('UPDATE usuario SET activo = $1 WHERE id = $2', [activo, req.params.id]);
      if (r.rowCount) {
        if (!activo) await c.query('DELETE FROM sesion WHERE usuario_id = $1', [req.params.id]);
        await bitacora(c, req.usuario.id, activo ? 'activar' : 'desactivar', 'usuario', Number(req.params.id), null);
      }
      return r.rowCount;
    });
    avisar(res, n ? 'ok' : 'error', n ? (activo ? 'Cuenta activada.' : 'Cuenta desactivada.') : 'La cuenta no existe.');
    res.redirect('/usuarios');
  } catch (e) { next(e); }
});

router.get('/bitacora', soloAdmin, async (req, res, next) => {
  try {
    const r = await consultar(
      `SELECT b.id, b.accion, b.entidad, b.entidad_id, b.detalle,
              to_char(b.fecha AT TIME ZONE 'America/Guayaquil', 'DD/MM/YYYY HH24:MI:SS') AS fecha,
              COALESCE(u.nombres || ' ' || u.apellidos, '-') AS usuario
         FROM bitacora b LEFT JOIN usuario u ON u.id = b.usuario_id
        ORDER BY b.id DESC LIMIT 100`);
    res.render('bitacora', { lista: r.rows });
  } catch (e) { next(e); }
});

module.exports = router;
