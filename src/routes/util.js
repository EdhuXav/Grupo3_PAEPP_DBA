'use strict';
// Verifica que el parámetro :id sea un entero positivo.
function idMw(req, res, next) {
  if (!/^\d{1,9}$/.test(req.params.id) || parseInt(req.params.id, 10) < 1) {
    return res.status(404).render('error', { titulo: 'No encontrado', detalle: 'El registro solicitado no existe.' });
  }
  next();
}
const noEncontrado = (res) =>
  res.status(404).render('error', { titulo: 'No encontrado', detalle: 'El registro solicitado no existe.' });

module.exports = { idMw, noEncontrado };
