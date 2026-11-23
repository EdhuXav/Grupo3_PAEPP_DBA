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
    `SELECT f.id, f.nombre, count(c.id)::int AS carreras
       FROM facultad f LEFT JOIN carrera c ON c.facultad_id = f.id
      GROUP BY f.id ORDER BY f.nombre`);
  return r.rows;
}

function validar(body) {
  const datos = { nombre: v.textoLimpio(body.nombre) };
  const errores = [];
  if (datos.nombre.length < 3 || datos.nombre.length > 150) errores.push('El nombre de la facultad es obligatorio (entre 3 y 150 caracteres).');
  return { datos, errores };
}

router.get('/facultades', soloCoordinador, async (req, res, next) => {
  try { res.render('facultades', { lista: await listar(), datos: {}, editando: null }); } catch (e) { next(e); }
});

router.post('/facultades', soloCoordinador, async (req, res, next) => {
  try {
    const { datos, errores } = validar(req.body);
    if (!errores.length) {
      try {
        await transaccion(async (c) => {
          const r = await c.query('INSERT INTO facultad (nombre) VALUES ($1) RETURNING id', [datos.nombre]);
          await bitacora(c, req.usuario.id, 'crear', 'facultad', r.rows[0].id, datos.nombre);
        });
        avisar(res, 'ok', 'Facultad registrada correctamente.');
        return res.redirect('/facultades');
      } catch (e) { const m = mensajeDeError(e); if (!m) throw e; errores.push(m); }
    }
    res.status(422).render('facultades', { lista: await listar(), datos, errores, editando: null });
  } catch (e) { next(e); }
});

router.get('/facultades/:id/editar', soloCoordinador, idMw, async (req, res, next) => {
  try {
    const r = await consultar('SELECT id, nombre FROM facultad WHERE id = $1', [req.params.id]);
    if (!r.rowCount) return noEncontrado(res);
    res.render('facultades', { lista: await listar(), datos: r.rows[0], editando: r.rows[0].id });
  } catch (e) { next(e); }
});

router.post('/facultades/:id', soloCoordinador, idMw, async (req, res, next) => {
  try {
    const { datos, errores } = validar(req.body);
    if (!errores.length) {
      try {
        const n = await transaccion(async (c) => {
          const r = await c.query('UPDATE facultad SET nombre = $1 WHERE id = $2', [datos.nombre, req.params.id]);
          if (r.rowCount) await bitacora(c, req.usuario.id, 'actualizar', 'facultad', Number(req.params.id), datos.nombre);
          return r.rowCount;
        });
        if (!n) return noEncontrado(res);
        avisar(res, 'ok', 'Facultad actualizada correctamente.');
        return res.redirect('/facultades');
      } catch (e) { const m = mensajeDeError(e); if (!m) throw e; errores.push(m); }
    }
    res.status(422).render('facultades', { lista: await listar(), datos, errores, editando: Number(req.params.id) });
  } catch (e) { next(e); }
});

router.post('/facultades/:id/eliminar', soloCoordinador, idMw, async (req, res, next) => {
  try {
    try {
      const n = await transaccion(async (c) => {
        const r = await c.query('DELETE FROM facultad WHERE id = $1', [req.params.id]);
        if (r.rowCount) await bitacora(c, req.usuario.id, 'eliminar', 'facultad', Number(req.params.id), null);
        return r.rowCount;
      });
      avisar(res, n ? 'ok' : 'error', n ? 'Facultad eliminada.' : 'La facultad ya no existe.');
    } catch (e) { const m = mensajeDeError(e, 'eliminar'); if (!m) throw e; avisar(res, 'error', m); }
    res.redirect('/facultades');
  } catch (e) { next(e); }
});

module.exports = router;
