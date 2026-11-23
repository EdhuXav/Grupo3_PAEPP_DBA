'use strict';
// Crea las cuentas iniciales de demostración: npm run db:seed-usuarios
// Las contraseñas de demostración pueden cambiarse con ADMIN_PASSWORD y COORD_PASSWORD.
const { pool } = require('../db');
const { hashPassword } = require('../auth');
const { cedulaValida } = require('../validaciones');

// Completa los 9 primeros dígitos con el dígito verificador de la cédula ecuatoriana.
function completarCedula(base) {
  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let v = parseInt(base[i], 10) * (i % 2 === 0 ? 2 : 1);
    if (v > 9) v -= 9;
    suma += v;
  }
  return base + ((10 - (suma % 10)) % 10);
}

const usuarios = [
  { cedula: completarCedula('120000001'), nombres: 'Ana',    apellidos: 'Administradora', correo: 'admin@practicas.example',      rol: 'administrador', password: process.env.ADMIN_PASSWORD || 'Admin2026*' },
  { cedula: completarCedula('120000002'), nombres: 'Carlos', apellidos: 'Coordinador',    correo: 'coordinador@practicas.example', rol: 'coordinador',   password: process.env.COORD_PASSWORD || 'Coord2026*' },
];

(async () => {
  for (const u of usuarios) {
    if (!cedulaValida(u.cedula)) throw new Error(`Cédula inválida: ${u.cedula}`);
    await pool.query(
      `INSERT INTO usuario (cedula, nombres, apellidos, correo, password_hash, rol)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (cedula) DO NOTHING`,
      [u.cedula, u.nombres, u.apellidos, u.correo, hashPassword(u.password), u.rol]
    );
    console.log(`Usuario ${u.rol}: cédula ${u.cedula} / contraseña ${u.password}`);
  }
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
