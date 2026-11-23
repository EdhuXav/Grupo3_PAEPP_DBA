'use strict';
const express = require('express');
const { consultar, transaccion, bitacora } = require('../db');
const { requiereRol, avisar } = require('../auth');
const v = require('../validaciones');
const { mensajeDeError } = require('../errores');
const { idMw, noEncontrado } = require('./util');

const router = express.Router();
const soloCoordinador = requiereRol('coordinador');

// Búsqueda por nombre o ciudad con parámetros (nunca se concatena la entrada al SQL).
async function listar(q) {
  const texto = v.textoLimpio(q);
  const params = [];
  let where = '';
  if (texto) {
    params.push(`%${texto.replace(/[\\%_]/g, '\\$&')}%`);
    where = 'WHERE nombre ILIKE $1 OR ciudad ILIKE $1';
  }
  const r = await consultar(
    `SELECT id, nombre, ruc, ciudad, sector, telefono, correo_contacto, responsable_laboral
       FROM empresa ${where} ORDER BY nombre`, params);
  return { lista: r.rows, q: texto };
}

function validar(body) {
  const datos = {
    nombre: v.textoLimpio(body.nombre),
    ruc: v.textoLimpio(body.ruc),
    ciudad: v.textoLimpio(body.ciudad),
    sector: v.textoLimpio(body.sector),
    telefono: v.textoLimpio(body.telefono),
    correo_contacto: v.textoLimpio(body.correo_contacto).toLowerCase(),
    responsable_laboral: v.textoLimpio(body.responsable_laboral),
  };
  const errores = [];
  if (datos.nombre.length < 3 || datos.nombre.length > 150) errores.push('El nombre de la empresa es obligatorio (entre 3 y 150 caracteres).');
  if (!v.rucValido(datos.ruc)) errores.push('El RUC debe tener exactamente 13 dígitos.');
  if (datos.ciudad.length < 2 || datos.ciudad.length > 80) errores.push('La ciudad es obligatoria.');
  if (datos.sector.length < 2 || datos.sector.length > 80) errores.push('El sector es obligatorio.');
  if (datos.telefono && !/^[0-9+() -]{7,20}$/.test(datos.telefono)) errores.push('El teléfono solo puede contener números, espacios, + ( ) y guiones (7 a 20 caracteres).');
  if (datos.correo_contacto && !v.correoValido(datos.correo_contacto)) errores.push('El correo de contacto no tiene un formato válido.');
  if (datos.responsable_laboral.length < 3 || datos.responsable_laboral.length > 120) errores.push('El responsable laboral es obligatorio.');
  return { datos, errores };
}

router.get('/empresas', soloCoordinador, async (req, res, next) => {
  try { res.render('empresas', { ...(await listar(req.query.q)), datos: {}, editando: null }); } catch (e) { next(e); }
});

router.post('/empresas', soloCoordinador, async (req, res, next) => {
  try {
    const { datos, errores } = validar(req.body);
    if (!errores.length) {
      try {
        await transaccion(async (c) => {
          const r = await c.query(
            `INSERT INTO empresa (nombre, ruc, ciudad, sector, telefono, correo_contacto, responsable_laboral)
             VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), $7) RETURNING id`,
            [datos.nombre, datos.ruc, datos.ciudad, datos.sector, datos.telefono, datos.correo_contacto, datos.responsable_laboral]);
          await bitacora(c, req.usuario.id, 'crear', 'empresa', r.rows[0].id, datos.nombre);
        });
        avisar(res, 'ok', 'Empresa registrada correctamente.');
        return res.redirect('/empresas');
      } catch (e) { const m = mensajeDeError(e); if (!m) throw e; errores.push(m); }
    }
    res.status(422).render('empresas', { ...(await listar()), datos, errores, editando: null });
  } catch (e) { next(e); }
});

router.get('/empresas/:id/editar', soloCoordinador, idMw, async (req, res, next) => {
  try {
    const r = await consultar(
      `SELECT id, nombre, ruc, ciudad, sector, COALESCE(telefono, '') AS telefono,
              COALESCE(correo_contacto, '') AS correo_contacto, responsable_laboral
         FROM empresa WHERE id = $1`, [req.params.id]);
    if (!r.rowCount) return noEncontrado(res);
    res.render('empresas', { ...(await listar()), datos: r.rows[0], editando: r.rows[0].id });
  } catch (e) { next(e); }
});

router.post('/empresas/:id', soloCoordinador, idMw, async (req, res, next) => {
  try {
    const { datos, errores } = validar(req.body);
    if (!errores.length) {
      try {
        const n = await transaccion(async (c) => {
          const r = await c.query(
            `UPDATE empresa SET nombre = $1, ruc = $2, ciudad = $3, sector = $4, telefono = NULLIF($5, ''),
                    correo_contacto = NULLIF($6, ''), responsable_laboral = $7
              WHERE id = $8`,
            [datos.nombre, datos.ruc, datos.ciudad, datos.sector, datos.telefono, datos.correo_contacto,
              datos.responsable_laboral, req.params.id]);
          if (r.rowCount) await bitacora(c, req.usuario.id, 'actualizar', 'empresa', Number(req.params.id), datos.nombre);
          return r.rowCount;
        });
        if (!n) return noEncontrado(res);
        avisar(res, 'ok', 'Empresa actualizada correctamente.');
        return res.redirect('/empresas');
      } catch (e) { const m = mensajeDeError(e); if (!m) throw e; errores.push(m); }
    }
    res.status(422).render('empresas', { ...(await listar()), datos, errores, editando: Number(req.params.id) });
  } catch (e) { next(e); }
});

router.post('/empresas/:id/eliminar', soloCoordinador, idMw, async (req, res, next) => {
  try {
    try {
      const n = await transaccion(async (c) => {
        const r = await c.query('DELETE FROM empresa WHERE id = $1', [req.params.id]);
        if (r.rowCount) await bitacora(c, req.usuario.id, 'eliminar', 'empresa', Number(req.params.id), null);
        return r.rowCount;
      });
      avisar(res, n ? 'ok' : 'error', n ? 'Empresa eliminada.' : 'La empresa ya no existe.');
    } catch (e) { const m = mensajeDeError(e, 'eliminar'); if (!m) throw e; avisar(res, 'error', m); }
    res.redirect('/empresas');
  } catch (e) { next(e); }
});

module.exports = router;
