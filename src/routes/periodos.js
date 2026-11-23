'use strict';
const express = require('express');
const { consultar, transaccion, bitacora } = require('../db');
const { requiereRol, avisar } = require('../auth');
const v = require('../validaciones');
const { mensajeDeError } = require('../errores');
const { idMw, noEncontrado } = require('./util');

const router = express.Router();
const soloCoordinador = requiereRol('coordinador');

async function listar() {
  const r = await consultar(
    `SELECT p.id, p.nombre, p.estado,
            to_char(p.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
            to_char(p.fecha_fin,    'YYYY-MM-DD') AS fecha_fin,
            count(c.id)::int AS convocatorias
       FROM periodo p LEFT JOIN convocatoria c ON c.periodo_id = p.id
      GROUP BY p.id ORDER BY p.fecha_inicio DESC`);
  return r.rows;
}

function validar(body) {
  const datos = {
    nombre: v.textoLimpio(body.nombre),
    fecha_inicio: v.textoLimpio(body.fecha_inicio),
    fecha_fin: v.textoLimpio(body.fecha_fin),
  };
  const errores = [];
  if (datos.nombre.length < 3 || datos.nombre.length > 60) errores.push('El nombre del período es obligatorio (entre 3 y 60 caracteres), por ejemplo 2026-2.');
  if (!v.fechaValida(datos.fecha_inicio)) errores.push('La fecha de inicio no es válida.');
  if (!v.fechaValida(datos.fecha_fin)) errores.push('La fecha de fin no es válida.');
  if (v.fechaValida(datos.fecha_inicio) && v.fechaValida(datos.fecha_fin) && datos.fecha_fin <= datos.fecha_inicio) {
    errores.push('La fecha de fin debe ser posterior a la fecha de inicio.');
  }
  return { datos, errores };
}

router.get('/periodos', soloCoordinador, async (req, res, next) => {
  try { res.render('periodos', { lista: await listar(), datos: {}, editando: null }); } catch (e) { next(e); }
});

router.post('/periodos', soloCoordinador, async (req, res, next) => {
  try {
    const { datos, errores } = validar(req.body);
    if (!errores.length) {
      try {
        await transaccion(async (c) => {
          const r = await c.query(
            `INSERT INTO periodo (nombre, fecha_inicio, fecha_fin) VALUES ($1, $2, $3) RETURNING id`,
            [datos.nombre, datos.fecha_inicio, datos.fecha_fin]);
          await bitacora(c, req.usuario.id, 'crear', 'periodo', r.rows[0].id, datos.nombre);
        });
        avisar(res, 'ok', 'Período registrado correctamente (estado: planificado).');
        return res.redirect('/periodos');
      } catch (e) { const m = mensajeDeError(e); if (!m) throw e; errores.push(m); }
    }
    res.status(422).render('periodos', { lista: await listar(), datos, errores, editando: null });
  } catch (e) { next(e); }
});

router.get('/periodos/:id/editar', soloCoordinador, idMw, async (req, res, next) => {
  try {
    const r = await consultar(
      `SELECT id, nombre, estado, to_char(fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
              to_char(fecha_fin, 'YYYY-MM-DD') AS fecha_fin FROM periodo WHERE id = $1`, [req.params.id]);
    if (!r.rowCount) return noEncontrado(res);
    if (r.rows[0].estado === 'cerrado') {
      avisar(res, 'error', 'Un período cerrado no puede modificarse.');
      return res.redirect('/periodos');
    }
    res.render('periodos', { lista: await listar(), datos: r.rows[0], editando: r.rows[0].id });
  } catch (e) { next(e); }
});

router.post('/periodos/:id', soloCoordinador, idMw, async (req, res, next) => {
  try {
    const { datos, errores } = validar(req.body);
    if (!errores.length) {
      try {
        const n = await transaccion(async (c) => {
          const r = await c.query(
            `UPDATE periodo SET nombre = $1, fecha_inicio = $2, fecha_fin = $3
              WHERE id = $4 AND estado <> 'cerrado'`,
            [datos.nombre, datos.fecha_inicio, datos.fecha_fin, req.params.id]);
          if (r.rowCount) await bitacora(c, req.usuario.id, 'actualizar', 'periodo', Number(req.params.id), datos.nombre);
          return r.rowCount;
        });
        if (!n) { avisar(res, 'error', 'El período no existe o está cerrado y no puede modificarse.'); return res.redirect('/periodos'); }
        avisar(res, 'ok', 'Período actualizado correctamente.');
        return res.redirect('/periodos');
      } catch (e) { const m = mensajeDeError(e); if (!m) throw e; errores.push(m); }
    }
    res.status(422).render('periodos', { lista: await listar(), datos, errores, editando: Number(req.params.id) });
  } catch (e) { next(e); }
});

// Cambios de estado: planificado -> activo -> cerrado.
async function cambiarEstado(req, res, next, desde, hacia, texto) {
  try {
    try {
      const n = await transaccion(async (c) => {
        const r = await c.query('UPDATE periodo SET estado = $1 WHERE id = $2 AND estado = $3', [hacia, req.params.id, desde]);
        if (r.rowCount) await bitacora(c, req.usuario.id, hacia === 'activo' ? 'activar' : 'cerrar', 'periodo', Number(req.params.id), null);
        return r.rowCount;
      });
      avisar(res, n ? 'ok' : 'error', n ? texto : `Solo un período en estado "${desde}" puede pasar a "${hacia}".`);
    } catch (e) { const m = mensajeDeError(e); if (!m) throw e; avisar(res, 'error', m); }
    res.redirect('/periodos');
  } catch (e) { next(e); }
}
router.post('/periodos/:id/activar', soloCoordinador, idMw, (req, res, next) =>
  cambiarEstado(req, res, next, 'planificado', 'activo', 'Período activado.'));
router.post('/periodos/:id/cerrar', soloCoordinador, idMw, (req, res, next) =>
  cambiarEstado(req, res, next, 'activo', 'cerrado', 'Período cerrado.'));

router.post('/periodos/:id/eliminar', soloCoordinador, idMw, async (req, res, next) => {
  try {
    try {
      const n = await transaccion(async (c) => {
        const r = await c.query('DELETE FROM periodo WHERE id = $1', [req.params.id]);
        if (r.rowCount) await bitacora(c, req.usuario.id, 'eliminar', 'periodo', Number(req.params.id), null);
        return r.rowCount;
      });
      avisar(res, n ? 'ok' : 'error', n ? 'Período eliminado.' : 'El período ya no existe.');
    } catch (e) { const m = mensajeDeError(e, 'eliminar'); if (!m) throw e; avisar(res, 'error', m); }
    res.redirect('/periodos');
  } catch (e) { next(e); }
});

module.exports = router;
