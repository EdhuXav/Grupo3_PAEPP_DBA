'use strict';
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL. Copie .env.example como .env y complete la conexión (ver README).');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

// Consulta parametrizada: los valores siempre viajan separados del SQL ($1, $2, ...).
const consultar = (sql, params = []) => pool.query(sql, params);

// Ejecuta varias operaciones en una transacción.
async function transaccion(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (e) {
    await cliente.query('ROLLBACK');
    throw e;
  } finally {
    cliente.release();
  }
}

// Registro de acciones (bitácora).
async function bitacora(cliente, usuarioId, accion, entidad, entidadId, detalle) {
  await (cliente || pool).query(
    'INSERT INTO bitacora (usuario_id, accion, entidad, entidad_id, detalle) VALUES ($1, $2, $3, $4, $5)',
    [usuarioId, accion, entidad, entidadId, detalle || null]
  );
}

module.exports = { pool, consultar, transaccion, bitacora };
