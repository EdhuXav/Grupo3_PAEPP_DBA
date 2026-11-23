'use strict';
const express = require('express');
const { consultar, transaccion, bitacora } = require('../db');
const { requiereRol, avisar } = require('../auth');
const v = require('../validaciones');
const { mensajeDeError } = require('../errores');
const { idMw, noEncontrado } = require('./util');

const router = express.Router();
const soloCoordinador = requiereRol('coordinador');

async function contexto(filtro) {
  const facultades = (await consultar('SELECT id, nombre FROM facultad ORDER BY nombre')).rows;
  const params = [];
  let where = '';
  if (v.enteroPositivo(filtro)) { params.push(filtro); where = 'WHERE c.facultad_id = $1'; }
  const lista = (await consultar(
    `SELECT c.id, c.nombre, c.min_asignaturas, c.facultad_id, f.nombre AS facultad
       FROM carrera c JOIN facultad f ON f.id = c.facultad_id
       ${where} ORDER BY f.nombre, c.nombre`, params)).rows;
  return { facultades, lista, filtro: v.enteroPositivo(filtro) ? String(filtro) : '' };
}

function validar(body) {
  const datos = {
    facultad_id: v.textoLimpio(body.facultad_id),
    nombre: v.textoLimpio(body.nombre),
    min_asignaturas: v.textoLimpio(body.min_asignaturas),
  };
  const errores = [];
  if (!v.enteroPositivo(datos.facultad_id)) errores.push('Seleccione la facultad a la que pertenece la carrera.');
  if (datos.nombre.length < 3 || datos.nombre.length > 150) errores.push('El nombre de la carrera es obligatorio (entre 3 y 150 caracteres).');
  if (!v.enteroPositivo(datos.min_asignaturas) || parseInt(datos.min_asignaturas, 10) > 200) {
    errores.push('La cantidad mínima de asignaturas aprobadas debe ser un número entero entre 1 y 200.');
  }
  return { datos, errores };
}

router.get('/carreras', soloCoordinador, async (req, res, next) => {
  try { res.render('carreras', { ...(await contexto(req.query.facultad)), datos: {}, editando: null }); } catch (e) { next(e); }
});

router.post('/carreras', soloCoordinador, async (req, res, next) => {
  try {
    const { datos, errores } = validar(req.body);
    if (!errores.length) {
      try {
        await transaccion(async (c) => {
          const r = await c.query(
            'INSERT INTO carrera (facultad_id, nombre, min_asignaturas) VALUES ($1, $2, $3) RETURNING id',
            [datos.facultad_id, datos.nombre, datos.min_asignaturas]);
          await bitacora(c, req.usuario.id, 'crear', 'carrera', r.rows[0].id, datos.nombre);
        });
        avisar(res, 'ok', 'Carrera registrada correctamente.');
        return res.redirect('/carreras');
      } catch (e) { const m = mensajeDeError(e); if (!m) throw e; errores.push(m); }
    }
    res.status(422).render('carreras', { ...(await contexto()), datos, errores, editando: null });
  } catch (e) { next(e); }
});

router.get('/carreras/:id/editar', soloCoordinador, idMw, async (req, res, next) => {
  try {
    const r = await consultar('SELECT id, facultad_id, nombre, min_asignaturas FROM carrera WHERE id = $1', [req.params.id]);
    if (!r.rowCount) return noEncontrado(res);
    res.render('carreras', { ...(await contexto()), datos: r.rows[0], editando: r.rows[0].id });
  } catch (e) { next(e); }
});

router.post('/carreras/:id', soloCoordinador, idMw, async (req, res, next) => {
  try {
    const { datos, errores } = validar(req.body);
    if (!errores.length) {
      try {
        const n = await transaccion(async (c) => {
          const r = await c.query(
            'UPDATE carrera SET facultad_id = $1, nombre = $2, min_asignaturas = $3 WHERE id = $4',
            [datos.facultad_id, datos.nombre, datos.min_asignaturas, req.params.id]);
          if (r.rowCount) await bitacora(c, req.usuario.id, 'actualizar', 'carrera', Number(req.params.id), datos.nombre);
          return r.rowCount;
        });
        if (!n) return noEncontrado(res);
        avisar(res, 'ok', 'Carrera actualizada correctamente.');
        return res.redirect('/carreras');
      } catch (e) { const m = mensajeDeError(e); if (!m) throw e; errores.push(m); }
    }
    res.status(422).render('carreras', { ...(await contexto()), datos, errores, editando: Number(req.params.id) });
  } catch (e) { next(e); }
});

router.post('/carreras/:id/eliminar', soloCoordinador, idMw, async (req, res, next) => {
  try {
    try {
      const n = await transaccion(async (c) => {
        const r = await c.query('DELETE FROM carrera WHERE id = $1', [req.params.id]);
        if (r.rowCount) await bitacora(c, req.usuario.id, 'eliminar', 'carrera', Number(req.params.id), null);
        return r.rowCount;
      });
      avisar(res, n ? 'ok' : 'error', n ? 'Carrera eliminada.' : 'La carrera ya no existe.');
    } catch (e) { const m = mensajeDeError(e, 'eliminar'); if (!m) throw e; avisar(res, 'error', m); }
    res.redirect('/carreras');
  } catch (e) { next(e); }
});

module.exports = router;
