'use strict';
const express = require('express');
const { consultar, transaccion, bitacora } = require('../db');
const { requiereRol, avisar } = require('../auth');
const v = require('../validaciones');
const { mensajeDeError } = require('../errores');
const { idMw, noEncontrado } = require('./util');

const router = express.Router();
const soloCoordinador = requiereRol('coordinador');

async function cargarConvocatoria(id) {
  const r = await consultar(
    `SELECT id, nombre, periodo_nombre, estado FROM v_convocatoria WHERE id = $1`, [id]);
  return r.rows[0];
}

// Vacantes con total, ocupadas (asignaciones vigentes) y disponibles.
async function contexto(convocatoriaId) {
  const lista = (await consultar(
    `SELECT va.id, va.cantidad, e.nombre AS empresa, e.ciudad, e.sector, va.empresa_id,
            (SELECT count(*)::int FROM asignacion a JOIN inscripcion i ON i.id = a.inscripcion_id
              WHERE a.vigente AND a.empresa_id = va.empresa_id AND i.convocatoria_id = va.convocatoria_id) AS ocupadas
       FROM vacante va JOIN empresa e ON e.id = va.empresa_id
      WHERE va.convocatoria_id = $1 ORDER BY e.nombre`, [convocatoriaId])).rows
    .map((f) => ({ ...f, disponibles: f.cantidad - f.ocupadas }));
  const empresas = (await consultar(
    `SELECT id, nombre, ciudad FROM empresa
      WHERE id NOT IN (SELECT empresa_id FROM vacante WHERE convocatoria_id = $1) ORDER BY nombre`, [convocatoriaId])).rows;
  return { lista, empresas };
}

function validarCantidad(valor) {
  const texto = v.textoLimpio(valor);
  if (!/^\d{1,4}$/.test(texto)) return { error: 'La cantidad de vacantes debe ser un número entero de 0 a 9999.' };
  return { cantidad: parseInt(texto, 10) };
}

router.get('/convocatorias/:id/vacantes', soloCoordinador, idMw, async (req, res, next) => {
  try {
    const conv = await cargarConvocatoria(req.params.id);
    if (!conv) return noEncontrado(res);
    res.render('vacantes', { conv, ...(await contexto(conv.id)), datos: {} });
  } catch (e) { next(e); }
});

router.post('/convocatorias/:id/vacantes', soloCoordinador, idMw, async (req, res, next) => {
  try {
    const conv = await cargarConvocatoria(req.params.id);
    if (!conv) return noEncontrado(res);
    const datos = { empresa_id: v.textoLimpio(req.body.empresa_id), cantidad: v.textoLimpio(req.body.cantidad) };
    const errores = [];
    if (conv.estado === 'cerrada') errores.push('La convocatoria está cerrada y no admite cambios en sus vacantes.');
    if (!v.enteroPositivo(datos.empresa_id)) errores.push('Seleccione la empresa.');
    const c = validarCantidad(datos.cantidad);
    if (c.error) errores.push(c.error);
    if (!errores.length) {
      try {
        await transaccion(async (cli) => {
          const r = await cli.query(
            'INSERT INTO vacante (convocatoria_id, empresa_id, cantidad) VALUES ($1, $2, $3) RETURNING id',
            [conv.id, datos.empresa_id, c.cantidad]);
          await bitacora(cli, req.usuario.id, 'crear', 'vacante', r.rows[0].id, `Convocatoria ${conv.id}: ${c.cantidad}`);
        });
        avisar(res, 'ok', 'Vacantes registradas correctamente.');
        return res.redirect(`/convocatorias/${conv.id}/vacantes`);
      } catch (e) {
        const m = mensajeDeError(e);
        if (!m) throw e;
        errores.push(e.code === '23505' ? 'La empresa ya tiene vacantes en esta convocatoria; edite la cantidad.' : m);
      }
    }
    res.status(422).render('vacantes', { conv, ...(await contexto(conv.id)), datos, errores });
  } catch (e) { next(e); }
});

// Cambiar la cantidad: nunca puede quedar por debajo de las vacantes ocupadas.
router.post('/vacantes/:id', soloCoordinador, idMw, async (req, res, next) => {
  try {
    const fila = (await consultar('SELECT convocatoria_id, empresa_id FROM vacante WHERE id = $1', [req.params.id])).rows[0];
    if (!fila) return noEncontrado(res);
    const volver = `/convocatorias/${fila.convocatoria_id}/vacantes`;
    const conv = await cargarConvocatoria(fila.convocatoria_id);
    const c = validarCantidad(req.body.cantidad);
    if (conv.estado === 'cerrada') { avisar(res, 'error', 'La convocatoria está cerrada y no admite cambios en sus vacantes.'); return res.redirect(volver); }
    if (c.error) { avisar(res, 'error', c.error); return res.redirect(volver); }
    const n = await transaccion(async (cli) => {
      const ocupadas = Number((await cli.query(
        `SELECT count(*) AS n FROM asignacion a JOIN inscripcion i ON i.id = a.inscripcion_id
          WHERE a.vigente AND a.empresa_id = $1 AND i.convocatoria_id = $2`, [fila.empresa_id, fila.convocatoria_id])).rows[0].n);
      if (c.cantidad < ocupadas) return -ocupadas;
      await cli.query('UPDATE vacante SET cantidad = $1 WHERE id = $2', [c.cantidad, req.params.id]);
      await bitacora(cli, req.usuario.id, 'actualizar', 'vacante', Number(req.params.id), `Cantidad: ${c.cantidad}`);
      return 1;
    });
    if (n < 0) avisar(res, 'error', `No puede ser menor que las ${-n} vacantes ya ocupadas.`);
    else avisar(res, 'ok', 'Cantidad de vacantes actualizada.');
    res.redirect(volver);
  } catch (e) { next(e); }
});

router.post('/vacantes/:id/eliminar', soloCoordinador, idMw, async (req, res, next) => {
  try {
    const fila = (await consultar('SELECT convocatoria_id FROM vacante WHERE id = $1', [req.params.id])).rows[0];
    if (!fila) return noEncontrado(res);
    const volver = `/convocatorias/${fila.convocatoria_id}/vacantes`;
    const conv = await cargarConvocatoria(fila.convocatoria_id);
    if (conv.estado === 'cerrada') { avisar(res, 'error', 'La convocatoria está cerrada y no admite cambios en sus vacantes.'); return res.redirect(volver); }
    await transaccion(async (cli) => {
      await cli.query('DELETE FROM vacante WHERE id = $1', [req.params.id]);
      await bitacora(cli, req.usuario.id, 'eliminar', 'vacante', Number(req.params.id), null);
    });
    avisar(res, 'ok', 'Vacantes eliminadas.');
    res.redirect(volver);
  } catch (e) { next(e); }
});

module.exports = router;
