'use strict';
// Crea el esquema y carga los datos de demostración: npm run db:init
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

(async () => {
  const carpeta = path.join(__dirname, '..', '..', 'db');
  const archivos = fs.readdirSync(carpeta).filter((f) => f.endsWith('.sql')).sort();
  for (const archivo of archivos) {
    const sql = fs.readFileSync(path.join(carpeta, archivo), 'utf8');
    await pool.query(sql);
    console.log(`Ejecutado: db/${archivo}`);
  }
  await pool.end();
})().catch((e) => { console.error('Error al iniciar la base de datos:', e.message); process.exit(1); });
