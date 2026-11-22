'use strict';
const express = require('express');
const path = require('path');
const { cargarContexto } = require('./auth');

function crearApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.disable('x-powered-by');

  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use('/static', express.static(path.join(__dirname, 'public')));
  app.use(cargarContexto);

  app.use(require('./routes/autenticacion'));
  app.use(require('./routes/facultades'));
  app.use(require('./routes/carreras'));
  app.use(require('./routes/periodos'));
  app.use(require('./routes/convocatorias'));
  app.use(require('./routes/vacantes'));
  app.use(require('./routes/empresas'));
  app.use(require('./routes/usuarios'));

  app.use((req, res) => {
    res.status(404).render('error', { titulo: 'Página no encontrada', detalle: 'La dirección solicitada no existe.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).render('error', { titulo: 'Error del servidor', detalle: 'Ocurrió un error inesperado. Intente de nuevo.' });
  });
  return app;
}

module.exports = { crearApp };
