'use strict';
const express = require('express');
const { consultar, transaccion, bitacora } = require('../db');
const { requiereRol, avisar } = require('../auth');
const v = require('../validaciones');
const { mensajeDeError } = require('../errores');
const { idMw, noEncontrado } = require('./util');

const router = express.Router();
const soloCoordinador = requiereRol('coordinador');
const ZONA = 'America/Guayaquil';

async function contexto(filtroPeriodo) {
  const periodos = (await consultar(
    `SELECT id, nombre, estado FROM periodo ORDER BY fecha_inicio DESC`)).rows;
  const carreras = (await consultar(
    `SELECT c.id, c.nombre, f.nombre AS facultad
       FROM carrera c JOIN facultad f ON f.id = c.facultad_id ORDER BY f.nombre, c.nombre`)).rows;
  const params = [];
  let where = '';
  if (v.enteroPositivo(filtroPeriodo)) { params.push(filtroPeriodo); where = 'WHERE v.periodo_id = $1'; }
  const lista = (await consultar(
    `SELECT v.id, v.nombre, v.descripcion, v.periodo_id, v.periodo_nombre, v.estado,
            to_char(v.apertura AT TIME ZONE '${ZONA}', 'DD/MM/YYYY HH24:MI') AS apertura_txt,
            to_char(v.cierre   AT TIME ZONE '${ZONA}', 'DD/MM/YYYY HH24:MI') AS cierre_txt,
            COALESCE((SELECT string_agg(ca.nombre, ', ' ORDER BY ca.nombre)
                        FROM convocatoria_carrera cc JOIN carrera ca ON ca.id = cc.carrera_id
                       WHERE cc.convocatoria_id = v.id), '') AS carreras,
            (SELECT count(*)::int FROM inscripcion i WHERE i.convocatoria_id = v.id) AS inscripciones
       FROM v_convocatoria v ${where}
      ORDER BY v.apertura DESC`, params)).rows;
  return { periodos, carreras, lista, filtro: v.enteroPositivo(filtroPeriodo) ? String(filtroPeriodo) : '' };
}

function validar(body) {
  const sel = [].concat(body.carreras || []).map(String).filter((x) => v.enteroPositivo(x));
  const datos = {
    periodo_id: v.textoLimpio(body.periodo_id),
    nombre: v.textoLimpio(body.nombre),
    descripcion: v.textoLimpio(body.descripcion),
    apertura: v.textoLimpio(body.apertura),
    cierre: v.textoLimpio(body.cierre),
    carreras: [...new Set(sel)],
  };
  const errores = [];
  if (!v.enteroPositivo(datos.periodo_id)) errores.push('Seleccione el período al que pertenece la convocatoria.');
  if (datos.nombre.length < 3 || datos.nombre.length > 150) errores.push('El nombre de la convocatoria es obligatorio (entre 3 y 150 caracteres).');
  if (datos.descripcion.length > 1000) errores.push('La descripción no puede superar 1000 caracteres.');
  if (!v.fechaHoraValida(datos.apertura)) errores.push('La fecha y hora de apertura no son válidas.');
  if (!v.fechaHoraValida(datos.cierre)) errores.push('La fecha y hora de cierre no son válidas.');
  if (v.fechaHoraValida(datos.apertura) && v.fechaHoraValida(datos.cierre) && datos.cierre <= datos.apertura) {
    errores.push('El cierre debe ser posterior a la apertura.');
  }
  if (!datos.carreras.length) errores.push('Seleccione al menos una carrera que pueda participar.');
  return { datos, errores };
}

async function guardarCarreras(c, convocatoriaId, carreras) {
  await c.query('DELETE FROM convocatoria_carrera WHERE convocatoria_id = $1', [convocatoriaId]);
  for (const carreraId of carreras) {
    await c.query('INSERT INTO convocatoria_carrera (convocatoria_id, carrera_id) VALUES ($1, $2)', [convocatoriaId, carreraId]);
  }
}

router.get('/convocatorias', soloCoordinador, async (req, res, next) => {
  try { res.render('convocatorias', { ...(await contexto(req.query.periodo)), datos: { carreras: [] }, editando: null }); } catch (e) { next(e); }
});

router.post('/convocatorias', soloCoordinador, async (req, res, next) => {
  try {
    const { datos, errores } = validar(req.body);
    if (!errores.length) {
      try {
        await transaccion(async (c) => {
          const r = await c.query(
            `INSERT INTO convocatoria (periodo_id, nombre, descripcion, apertura, cierre)
             VALUES ($1, $2, NULLIF($3, ''), $4::timestamp AT TIME ZONE '${ZONA}', $5::timestamp AT TIME ZONE '${ZONA}')
             RETURNING id`,
            [datos.periodo_id, datos.nombre, datos.descripcion, datos.apertura, datos.cierre]);
          await guardarCarreras(c, r.rows[0].id, datos.carreras);
          await bitacora(c, req.usuario.id, 'crear', 'convocatoria', r.rows[0].id, datos.nombre);
        });
        avisar(res, 'ok', 'Convocatoria registrada correctamente.');
        return res.redirect('/convocatorias');
      } catch (e) { const m = mensajeDeError(e); if (!m) throw e; errores.push(m); }
    }
    res.status(422).render('convocatorias', { ...(await contexto()), datos, errores, editando: null });
  } catch (e) { next(e); }
});

router.get('/convocatorias/:id/editar', soloCoordinador, idMw, async (req, res, next) => {
  try {
    const r = await consultar(
      `SELECT v.id, v.periodo_id, v.nombre, COALESCE(v.descripcion, '') AS descripcion, v.estado,
              to_char(v.apertura AT TIME ZONE '${ZONA}', 'YYYY-MM-DD"T"HH24:MI') AS apertura,
              to_char(v.cierre   AT TIME ZONE '${ZONA}', 'YYYY-MM-DD"T"HH24:MI') AS cierre
         FROM v_convocatoria v WHERE v.id = $1`, [req.params.id]);
    if (!r.rowCount) return noEncontrado(res);
    if (r.rows[0].estado === 'cerrada') {
      avisar(res, 'error', 'Una convocatoria cerrada no puede modificarse.');
      return res.redirect('/convocatorias');
    }
    const sel = await consultar('SELECT carrera_id FROM convocatoria_carrera WHERE convocatoria_id = $1', [req.params.id]);
    const datos = { ...r.rows[0], carreras: sel.rows.map((x) => String(x.carrera_id)) };
    res.render('convocatorias', { ...(await contexto()), datos, editando: datos.id });
  } catch (e) { next(e); }
});

router.post('/convocatorias/:id', soloCoordinador, idMw, async (req, res, next) => {
  try {
    const { datos, errores } = validar(req.body);
    if (!errores.length) {
      try {
        const estado = await transaccion(async (c) => {
          const actual = await c.query('SELECT estado FROM v_convocatoria WHERE id = $1', [req.params.id]);
          if (!actual.rowCount) return 'inexistente';
          if (actual.rows[0].estado === 'cerrada') return 'cerrada';
          await c.query(
            `UPDATE convocatoria SET periodo_id = $1, nombre = $2, descripcion = NULLIF($3, ''),
                    apertura = $4::timestamp AT TIME ZONE '${ZONA}', cierre = $5::timestamp AT TIME ZONE '${ZONA}'
              WHERE id = $6`,
            [datos.periodo_id, datos.nombre, datos.descripcion, datos.apertura, datos.cierre, req.params.id]);
          await guardarCarreras(c, req.params.id, datos.carreras);
          await bitacora(c, req.usuario.id, 'actualizar', 'convocatoria', Number(req.params.id), datos.nombre);
          return 'ok';
        });
        if (estado === 'inexistente') return noEncontrado(res);
        if (estado === 'cerrada') { avisar(res, 'error', 'Una convocatoria cerrada no puede modificarse.'); return res.redirect('/convocatorias'); }
        avisar(res, 'ok', 'Convocatoria actualizada correctamente.');
        return res.redirect('/convocatorias');
      } catch (e) { const m = mensajeDeError(e); if (!m) throw e; errores.push(m); }
    }
    res.status(422).render('convocatorias', { ...(await contexto()), datos, errores, editando: Number(req.params.id) });
  } catch (e) { next(e); }
});

router.post('/convocatorias/:id/eliminar', soloCoordinador, idMw, async (req, res, next) => {
  try {
    try {
      const n = await transaccion(async (c) => {
        const r = await c.query('DELETE FROM convocatoria WHERE id = $1', [req.params.id]);
        if (r.rowCount) await bitacora(c, req.usuario.id, 'eliminar', 'convocatoria', Number(req.params.id), null);
        return r.rowCount;
      });
      avisar(res, n ? 'ok' : 'error', n ? 'Convocatoria eliminada.' : 'La convocatoria ya no existe.');
    } catch (e) {
      const m = mensajeDeError(e, 'eliminar');
      if (!m) throw e;
      avisar(res, 'error', e.code === '23503' ? 'No se puede eliminar: la convocatoria ya tiene inscripciones.' : m);
    }
    res.redirect('/convocatorias');
  } catch (e) { next(e); }
});

module.exports = router;
