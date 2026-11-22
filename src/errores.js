'use strict';

const UNICOS = {
  facultad_nombre_uq: 'Ya existe una facultad con ese nombre.',
  carrera_facultad_nombre_uq: 'Ya existe una carrera con ese nombre en la facultad.',
  usuario_cedula_uq: 'La cédula ya está registrada.',
  usuario_correo_uq: 'El correo ya está registrado.',
  periodo_nombre_uq: 'Ya existe un período con ese nombre.',
  periodo_un_activo_uq: 'Ya existe un período activo. Ciérrelo antes de activar otro.',
  convocatoria_periodo_nombre_uq: 'Ya existe una convocatoria con ese nombre en el período.',
  empresa_ruc_uq: 'El RUC ya está registrado.',
};

// Traduce un error de PostgreSQL a un mensaje para el usuario.
// Devuelve null si el error no es de integridad (se trata como error del servidor).
function mensajeDeError(e, contexto = 'guardar') {
  if (!e || !e.code) return null;
  if (e.code === '23505') return UNICOS[e.constraint] || 'Ya existe un registro con esos datos.';
  if (e.code === '23503') {
    return contexto === 'eliminar'
      ? 'No se puede eliminar porque tiene registros asociados.'
      : 'Alguno de los datos seleccionados ya no existe.';
  }
  if (e.code === 'P0001') return e.message;
  if (e.code === '23514' || e.code === '23502' || e.code === '22007' || e.code === '22008') {
    return 'Alguno de los valores ingresados no es válido.';
  }
  return null;
}

module.exports = { mensajeDeError };
