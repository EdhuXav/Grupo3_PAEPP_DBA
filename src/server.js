'use strict';
const { crearApp } = require('./app');
const { pool } = require('./db');

const puerto = parseInt(process.env.PORT || '3000', 10);
const servidor = crearApp().listen(puerto, () => {
  console.log(`Plataforma de prácticas en http://localhost:${puerto}`);
});

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => servidor.close(() => pool.end().then(() => process.exit(0))));
}
