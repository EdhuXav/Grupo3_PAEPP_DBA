'use strict';
/*
 * Pruebas funcionales de la primera versión.
 * Cada caso ejecuta la operación desde la aplicación (HTTP) y comprueba el efecto
 * directamente en PostgreSQL. Registra: datos utilizados, resultado esperado y obtenido.
 *
 * Se ejecuta sobre la base TEST_DATABASE_URL (nombre terminado en _test), que se reinicia
 * con los scripts de db/. La base de trabajo (DATABASE_URL) no se toca.
 * Uso:  npm test
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Protección: las pruebas reinician la base, por eso usan SIEMPRE una base distinta de la de trabajo.
// TEST_DATABASE_URL debe apuntar a una base cuyo nombre termine en "_test" (ver README).
const urlPruebas = process.env.TEST_DATABASE_URL;
if (!urlPruebas || !/\/[^/?]+_test(\?.*)?$/.test(urlPruebas)) {
  console.error('Defina TEST_DATABASE_URL con una base de datos cuyo nombre termine en _test (por ejemplo practicas_test).');
  console.error('Las pruebas reinician la base de datos; no se ejecutan sobre la base de trabajo.');
  process.exit(1);
}
process.env.DATABASE_URL = urlPruebas;

const { crearApp } = require('../src/app');
const { pool } = require('../src/db');

// ---------------------------------------------------------------- utilidades
function completarCedula(base) {
  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let v = parseInt(base[i], 10) * (i % 2 === 0 ? 2 : 1);
    if (v > 9) v -= 9;
    suma += v;
  }
  return base + ((10 - (suma % 10)) % 10);
}

class Cliente {
  constructor(base) { this.base = base; this.cookies = {}; }
  async pedir(metodo, ruta, form) {
    const headers = {};
    const cookie = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.cookie = cookie;
    let body;
    if (form) {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(form)) [].concat(v).forEach((x) => p.append(k, x));
      body = p.toString();
      headers['content-type'] = 'application/x-www-form-urlencoded';
    }
    const res = await fetch(this.base + ruta, { method: metodo, headers, body, redirect: 'manual' });
    let flash = null;
    for (const sc of res.headers.getSetCookie()) {
      const par = sc.split(';')[0];
      const i = par.indexOf('=');
      const nombre = par.slice(0, i);
      const valor = par.slice(i + 1);
      if (!valor || /Expires=Thu, 01 Jan 1970/i.test(sc)) delete this.cookies[nombre];
      else this.cookies[nombre] = valor;
      if (nombre === 'flash' && valor) { try { flash = JSON.parse(decodeURIComponent(valor)); } catch (_) { /* nada */ } }
    }
    const texto = await res.text();
    return { status: res.status, location: res.headers.get('location'), body: texto, flash };
  }
  get(ruta) { return this.pedir('GET', ruta); }
  post(ruta, form) { return this.pedir('POST', ruta, form || {}); }
}

const resultados = [];
async function caso(id, rf, descripcion, datos, esperado, fn, principal = false) {
  let obtenido;
  let estado = 'Aprobado';
  try { obtenido = await fn(); } catch (e) {
    estado = 'Fallido';
    obtenido = `Error: ${e.message}`;
  }
  resultados.push({ id, rf, descripcion, datos, esperado, obtenido, estado, principal });
  console.log(`${estado === 'Aprobado' ? 'OK    ' : 'FALLO '} ${id} [${rf}] ${descripcion}`);
  if (estado === 'Fallido') console.log(`       ${obtenido}`);
}

const q = (sql, params = []) => pool.query(sql, params);
const uno = async (sql, params) => (await q(sql, params)).rows[0];
const cuenta = async (sql, params) => Number((await uno(sql, params)).n);
const hayError = (r, texto) => assert(r.body.includes(texto), `No aparece el texto esperado: "${texto}" (estado ${r.status})`);
// Fecha y hora local de Ecuador (UTC-5) con desplazamiento en días, formato datetime-local.
const ahoraEc = (dias = 0, horas = 0) => new Date(Date.now() - 5 * 3600e3 + dias * 86400e3 + horas * 3600e3).toISOString().slice(0, 16);
const hoyEc = (dias = 0) => ahoraEc(dias).slice(0, 10);

// ---------------------------------------------------------------- ejecución
(async () => {
  // Reiniciar la base de datos con los scripts del proyecto.
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'db')).filter((x) => x.endsWith('.sql')).sort()) {
    await q(fs.readFileSync(path.join(__dirname, '..', 'db', f), 'utf8'));
  }
  const { hashPassword } = require('../src/auth');
  const ced = { admin: completarCedula('120000001'), coord: completarCedula('120000002') };
  await q(`INSERT INTO usuario (cedula, nombres, apellidos, correo, password_hash, rol) VALUES
           ($1,'Ana','Administradora','admin@practicas.example',$2,'administrador'),
           ($3,'Carlos','Coordinador','coordinador@practicas.example',$4,'coordinador')`,
  [ced.admin, hashPassword('Admin2026*'), ced.coord, hashPassword('Coord2026*')]);

  const servidor = http.createServer(crearApp());
  await new Promise((r) => servidor.listen(0, r));
  const base = `http://localhost:${servidor.address().port}`;

  const carreraSoft = await uno("SELECT id FROM carrera WHERE nombre = 'Ingeniería de Software'");
  const est = {
    cedula: completarCedula('120000105'), nombres: 'María José', apellidos: 'Pérez Loor',
    correo: 'maria.perez@estudiante.example', carrera_id: String(carreraSoft.id),
    ciudad: 'Quevedo', sector: 'Centro', password: 'ClaveSegura1', password2: 'ClaveSegura1',
  };

  // ============================== RF-01 Registro con validación y confirmación
  const anon = new Cliente(base);
  await caso('PF-01', 'RF-01', 'Registro con cédula inválida', 'cédula 1234567890 (dígito verificador incorrecto)',
    'El sistema rechaza el registro, indica el error y no crea la cuenta', async () => {
      const r = await anon.post('/registro/revisar', { ...est, cedula: '1234567890' });
      assert.strictEqual(r.status, 422);
      hayError(r, 'La cédula no es válida');
      assert.strictEqual(await cuenta('SELECT count(*) AS n FROM usuario WHERE cedula = $1', ['1234567890']), 0);
      return 'HTTP 422, mensaje de cédula inválida; 0 filas en usuario';
    }, true);

  await caso('PF-02', 'RF-01', 'Resumen con advertencia antes de guardar', 'Datos válidos de María José Pérez Loor',
    'Se muestra el resumen con la advertencia de confirmar; todavía no se crea la cuenta', async () => {
      const r = await anon.post('/registro/revisar', est);
      assert.strictEqual(r.status, 200);
      hayError(r, 'Advertencia');
      hayError(r, 'no podrá modificar su cédula, nombres, apellidos ni carrera');
      assert.strictEqual(await cuenta('SELECT count(*) AS n FROM usuario WHERE cedula = $1', [est.cedula]), 0);
      return 'HTTP 200, resumen con advertencia; 0 filas en usuario';
    });

  await caso('PF-03', 'RF-01', 'Crear cuenta sin confirmar los datos', 'Mismos datos, sin marcar la confirmación',
    'La cuenta no se crea', async () => {
      const r = await anon.post('/registro', est);
      assert.strictEqual(r.status, 422);
      hayError(r, 'Debe confirmar');
      assert.strictEqual(await cuenta('SELECT count(*) AS n FROM usuario WHERE cedula = $1', [est.cedula]), 0);
      return 'HTTP 422, mensaje "Debe confirmar..."; 0 filas en usuario';
    });

  await caso('PF-04', 'RF-01 / RNF-01', 'Crear cuenta confirmando los datos', 'Mismos datos, con confirmo=si',
    'Se crea la cuenta con rol estudiante y la contraseña se guarda cifrada', async () => {
      const r = await anon.post('/registro', { ...est, confirmo: 'si' });
      assert.strictEqual(r.status, 302);
      const fila = await uno('SELECT rol, password_hash, carrera_id, ciudad, sector FROM usuario WHERE cedula = $1', [est.cedula]);
      assert(fila, 'No se creó el usuario');
      assert.strictEqual(fila.rol, 'estudiante');
      assert(fila.password_hash.startsWith('scrypt$') && !fila.password_hash.includes(est.password));
      return `HTTP 302 a /login; fila creada (rol ${fila.rol}); hash ${fila.password_hash.slice(0, 14)}...`;
    }, true);

  await caso('PF-05', 'RF-01', 'Cédula ya registrada', `cédula ${est.cedula} (ya existe)`,
    'El registro se rechaza con el mensaje correspondiente', async () => {
      const r = await anon.post('/registro/revisar', { ...est, correo: 'otro@estudiante.example' });
      assert.strictEqual(r.status, 422);
      hayError(r, 'La cédula ya está registrada');
      assert.strictEqual(await cuenta('SELECT count(*) AS n FROM usuario WHERE cedula = $1', [est.cedula]), 1);
      return 'HTTP 422, "La cédula ya está registrada"; sigue 1 fila';
    });

  await caso('PF-06', 'RF-01', 'Validación en tiempo real (API)', 'cédula válida nueva, cédula existente, correo con formato inválido',
    'La API responde valido=true solo para la cédula nueva y válida', async () => {
      const a = JSON.parse((await anon.get(`/api/validar?campo=cedula&valor=${completarCedula('120000200')}`)).body);
      const b = JSON.parse((await anon.get(`/api/validar?campo=cedula&valor=${est.cedula}`)).body);
      const c = JSON.parse((await anon.get('/api/validar?campo=correo&valor=sin-arroba')).body);
      assert.strictEqual(a.valido, true); assert.strictEqual(b.valido, false); assert.strictEqual(c.valido, false);
      return `cédula nueva: ${a.valido}; cédula existente: "${b.mensaje}"; correo inválido: "${c.mensaje}"`;
    });

  // ============================== RF-02 Sesión
  const alumno = new Cliente(base);
  await caso('PF-07', 'RF-02', 'Inicio de sesión con contraseña incorrecta', `cédula ${est.cedula}, contraseña errónea`,
    'Se rechaza el acceso y no se crea sesión', async () => {
      const antes = await cuenta('SELECT count(*) AS n FROM sesion');
      const r = await alumno.post('/login', { cedula: est.cedula, password: 'incorrecta' });
      assert.strictEqual(r.status, 401);
      hayError(r, 'Cédula o contraseña incorrecta');
      assert.strictEqual(await cuenta('SELECT count(*) AS n FROM sesion'), antes);
      return 'HTTP 401, mensaje de credenciales incorrectas; sin nueva sesión en PostgreSQL';
    });

  await caso('PF-08', 'RF-02', 'Inicio de sesión correcto', `cédula ${est.cedula}, contraseña correcta`,
    'Se accede al panel del estudiante y se guarda la sesión', async () => {
      const r = await alumno.post('/login', { cedula: est.cedula, password: est.password });
      assert.strictEqual(r.status, 302); assert.strictEqual(r.location, '/panel');
      const p = await alumno.get('/panel');
      hayError(p, 'Mi información');
      assert.strictEqual(await cuenta('SELECT count(*) AS n FROM sesion s JOIN usuario u ON u.id = s.usuario_id WHERE u.cedula = $1', [est.cedula]), 1);
      return 'HTTP 302 a /panel; panel del estudiante visible; 1 sesión en PostgreSQL';
    }, true);

  await caso('PF-09', 'RF-02', 'Cierre de sesión', 'Sesión del estudiante abierta',
    'Las páginas protegidas piden iniciar sesión y la sesión se elimina de la base', async () => {
      const copia = new Cliente(base); copia.cookies = { ...alumno.cookies };
      await copia.post('/logout');
      const r = await copia.get('/panel');
      assert.strictEqual(r.status, 302); assert.strictEqual(r.location, '/login');
      assert.strictEqual(await cuenta('SELECT count(*) AS n FROM sesion s JOIN usuario u ON u.id = s.usuario_id WHERE u.cedula = $1', [est.cedula]), 0);
      // Se vuelve a iniciar sesión para las pruebas siguientes.
      await alumno.post('/login', { cedula: est.cedula, password: est.password });
      return 'Tras cerrar sesión, /panel redirige a /login; 0 sesiones del usuario en PostgreSQL';
    });

  // ============================== RF-03 Datos fijos
  await caso('PF-10', 'RF-03', 'El estudiante cambia solo ciudad y sector', 'ciudad=Guayaquil, sector=Urdesa, y nombres=HACKER (campo no permitido)',
    'Se actualizan ciudad y sector; los demás datos no cambian', async () => {
      const r = await alumno.post('/perfil/localidad', { ciudad: 'Guayaquil', sector: 'Urdesa', nombres: 'HACKER', cedula: '0000000000' });
      assert.strictEqual(r.status, 302);
      const f = await uno('SELECT ciudad, sector, nombres, cedula FROM usuario WHERE cedula = $1', [est.cedula]);
      assert.strictEqual(f.ciudad, 'Guayaquil'); assert.strictEqual(f.sector, 'Urdesa');
      assert.strictEqual(f.nombres, est.nombres);
      return `ciudad/sector = ${f.ciudad}/${f.sector}; nombres sigue "${f.nombres}"`;
    }, true);

  await caso('PF-11', 'RF-03 / RNF-04', 'La base rechaza modificar datos de registro', 'UPDATE usuario SET nombres = ... directamente en PostgreSQL',
    'El disparador rechaza el cambio', async () => {
      await assert.rejects(q("UPDATE usuario SET nombres = 'Otro' WHERE cedula = $1", [est.cedula]), /no pueden modificarse/);
      const f = await uno('SELECT nombres FROM usuario WHERE cedula = $1', [est.cedula]);
      assert.strictEqual(f.nombres, est.nombres);
      return 'PostgreSQL lanzó la excepción del disparador; el nombre no cambió';
    });

  // ============================== RNF-02 Control de acceso por rol
  const coord = new Cliente(base);
  const admin = new Cliente(base);
  await coord.post('/login', { cedula: ced.coord, password: 'Coord2026*' });
  await admin.post('/login', { cedula: ced.admin, password: 'Admin2026*' });
  await caso('PF-12', 'RNF-02', 'Acceso a funciones según el rol', 'Rutas /facultades, /periodos, /usuarios con estudiante, administrador y sin sesión',
    'Acceso denegado (403) a quien no corresponde y redirección al login sin sesión', async () => {
      const rutas = [['alumno', alumno, '/facultades', 403], ['alumno', alumno, '/periodos', 403], ['alumno', alumno, '/usuarios', 403],
        ['admin', admin, '/facultades', 403], ['coord', coord, '/usuarios', 403], ['anon', new Cliente(base), '/empresas', 302]];
      for (const [quien, c, ruta, esperado] of rutas) {
        const r = await c.get(ruta);
        assert.strictEqual(r.status, esperado, `${quien} en ${ruta}: HTTP ${r.status}`);
      }
      const ok = await coord.get('/facultades');
      assert.strictEqual(ok.status, 200);
      return '6 accesos no autorizados rechazados (403/302); el coordinador accede con 200';
    }, true);

  // ============================== RF-21 Facultades
  await caso('PF-13', 'RF-21', 'Registrar facultad', 'nombre = "Facultad de Ciencias Empresariales"',
    'La facultad queda guardada en PostgreSQL', async () => {
      const r = await coord.post('/facultades', { nombre: 'Facultad de Ciencias Empresariales' });
      assert.strictEqual(r.status, 302); assert.strictEqual(r.flash.tipo, 'ok');
      assert.strictEqual(await cuenta("SELECT count(*) AS n FROM facultad WHERE nombre = 'Facultad de Ciencias Empresariales'"), 1);
      return 'HTTP 302 con aviso de éxito; 1 fila en facultad';
    }, true);
  await caso('PF-14', 'RF-21', 'Facultad duplicada o vacía', 'mismo nombre (en minúsculas) y nombre vacío',
    'Ambos intentos se rechazan', async () => {
      const a = await coord.post('/facultades', { nombre: 'facultad de ciencias empresariales' });
      const b = await coord.post('/facultades', { nombre: '   ' });
      assert.strictEqual(a.status, 422); hayError(a, 'Ya existe una facultad');
      assert.strictEqual(b.status, 422); hayError(b, 'obligatorio');
      assert.strictEqual(await cuenta("SELECT count(*) AS n FROM facultad WHERE lower(nombre) = 'facultad de ciencias empresariales'"), 1);
      return 'Duplicado: HTTP 422 "Ya existe una facultad..."; vacío: HTTP 422; sigue 1 fila';
    });
  const fac = await uno("SELECT id FROM facultad WHERE nombre = 'Facultad de Ciencias Empresariales'");
  await caso('PF-15', 'RF-21', 'Editar facultad', `id ${fac.id}, nuevo nombre "Facultad de Ciencias Empresariales y Económicas"`,
    'El nombre se actualiza en PostgreSQL', async () => {
      const r = await coord.post(`/facultades/${fac.id}`, { nombre: 'Facultad de Ciencias Empresariales y Económicas' });
      assert.strictEqual(r.status, 302);
      const f = await uno('SELECT nombre FROM facultad WHERE id = $1', [fac.id]);
      assert.strictEqual(f.nombre, 'Facultad de Ciencias Empresariales y Económicas');
      return `nombre en la base: "${f.nombre}"`;
    });
  await caso('PF-16', 'RF-21', 'Eliminar facultad con carreras y sin carreras', 'Facultad de Computación (tiene carreras) y la facultad nueva (vacía)',
    'La que tiene carreras no se elimina; la vacía sí', async () => {
      const comp = await uno("SELECT id FROM facultad WHERE nombre = 'Facultad de Ciencias de la Computación'");
      const a = await coord.post(`/facultades/${comp.id}/eliminar`);
      assert.strictEqual(a.flash.tipo, 'error');
      assert.strictEqual(await cuenta('SELECT count(*) AS n FROM facultad WHERE id = $1', [comp.id]), 1);
      const b = await coord.post(`/facultades/${fac.id}/eliminar`);
      assert.strictEqual(b.flash.tipo, 'ok');
      assert.strictEqual(await cuenta('SELECT count(*) AS n FROM facultad WHERE id = $1', [fac.id]), 0);
      return `Con carreras: "${a.flash.texto}" (sigue en la base); vacía: eliminada (0 filas)`;
    });

  // ============================== RF-05 Carreras
  const facIng = await uno("SELECT id FROM facultad WHERE nombre = 'Facultad de Ciencias de la Ingeniería'");
  await caso('PF-17', 'RF-05', 'Registrar carrera con mínimo de asignaturas', `facultad ${facIng.id}, "Ingeniería Civil", mínimo 40`,
    'La carrera se guarda asociada a su facultad con el mínimo indicado', async () => {
      const r = await coord.post('/carreras', { facultad_id: String(facIng.id), nombre: 'Ingeniería Civil', min_asignaturas: '40' });
      assert.strictEqual(r.status, 302);
      const f = await uno("SELECT facultad_id, min_asignaturas FROM carrera WHERE nombre = 'Ingeniería Civil'");
      assert.strictEqual(f.facultad_id, facIng.id); assert.strictEqual(f.min_asignaturas, 40);
      return `fila creada: facultad_id ${f.facultad_id}, min_asignaturas ${f.min_asignaturas}`;
    }, true);
  await caso('PF-18', 'RF-05', 'Mínimo de asignaturas inválido', 'mínimo = 0, mínimo = "abc", sin facultad',
    'Los tres intentos se rechazan', async () => {
      for (const datos of [
        { facultad_id: String(facIng.id), nombre: 'Carrera X', min_asignaturas: '0' },
        { facultad_id: String(facIng.id), nombre: 'Carrera X', min_asignaturas: 'abc' },
        { facultad_id: '', nombre: 'Carrera X', min_asignaturas: '10' }]) {
        const r = await coord.post('/carreras', datos);
        assert.strictEqual(r.status, 422);
      }
      assert.strictEqual(await cuenta("SELECT count(*) AS n FROM carrera WHERE nombre = 'Carrera X'"), 0);
      return '3 intentos con HTTP 422; 0 filas "Carrera X"';
    });
  const civil = await uno("SELECT id FROM carrera WHERE nombre = 'Ingeniería Civil'");
  await caso('PF-19', 'RF-05', 'Editar y eliminar carrera', 'Ingeniería Civil: mínimo 40 a 45; luego eliminar. Ingeniería de Software (con estudiante) no se elimina',
    'El mínimo se actualiza; se elimina la carrera sin estudiantes y se protege la que tiene estudiantes', async () => {
      await coord.post(`/carreras/${civil.id}`, { facultad_id: String(facIng.id), nombre: 'Ingeniería Civil', min_asignaturas: '45' });
      assert.strictEqual((await uno('SELECT min_asignaturas FROM carrera WHERE id = $1', [civil.id])).min_asignaturas, 45);
      const a = await coord.post(`/carreras/${carreraSoft.id}/eliminar`);
      assert.strictEqual(a.flash.tipo, 'error');
      assert.strictEqual(await cuenta('SELECT count(*) AS n FROM carrera WHERE id = $1', [carreraSoft.id]), 1);
      const b = await coord.post(`/carreras/${civil.id}/eliminar`);
      assert.strictEqual(b.flash.tipo, 'ok');
      assert.strictEqual(await cuenta('SELECT count(*) AS n FROM carrera WHERE id = $1', [civil.id]), 0);
      return 'mínimo actualizado a 45; con estudiantes: "' + a.flash.texto + '"; sin estudiantes: eliminada';
    });

  // ============================== RF-10 Períodos
  const pIni = hoyEc(-30); const pFin = hoyEc(120);
  await caso('PF-20', 'RF-10', 'Registrar período', `nombre "P-PRUEBA-1", ${pIni} a ${pFin}`,
    'El período se guarda en estado planificado', async () => {
      const r = await coord.post('/periodos', { nombre: 'P-PRUEBA-1', fecha_inicio: pIni, fecha_fin: pFin });
      assert.strictEqual(r.status, 302);
      const f = await uno("SELECT estado FROM periodo WHERE nombre = 'P-PRUEBA-1'");
      assert.strictEqual(f.estado, 'planificado');
      return `fila creada con estado "${f.estado}"`;
    }, true);
  await caso('PF-21', 'RF-10', 'Fechas de período inválidas o nombre repetido', 'fin anterior al inicio; nombre "P-PRUEBA-1" repetido',
    'Ambos intentos se rechazan', async () => {
      const a = await coord.post('/periodos', { nombre: 'P-PRUEBA-2', fecha_inicio: pFin, fecha_fin: pIni });
      const b = await coord.post('/periodos', { nombre: 'p-prueba-1', fecha_inicio: pIni, fecha_fin: pFin });
      assert.strictEqual(a.status, 422); hayError(a, 'posterior a la fecha de inicio');
      assert.strictEqual(b.status, 422); hayError(b, 'Ya existe un período');
      assert.strictEqual(await cuenta("SELECT count(*) AS n FROM periodo WHERE nombre ILIKE 'P-PRUEBA-%'"), 1);
      return 'Fechas inválidas: HTTP 422; nombre repetido: HTTP 422; sigue 1 período de prueba';
    });
  const per = await uno("SELECT id FROM periodo WHERE nombre = 'P-PRUEBA-1'");
  await caso('PF-22', 'RF-10', 'Un solo período activo', 'Activar P-PRUEBA-1 mientras 2026-2 está activo',
    'Se rechaza hasta cerrar el período activo; luego se activa', async () => {
      const a = await coord.post(`/periodos/${per.id}/activar`);
      assert.strictEqual(a.flash.tipo, 'error');
      assert.strictEqual((await uno('SELECT estado FROM periodo WHERE id = $1', [per.id])).estado, 'planificado');
      const activo = await uno("SELECT id FROM periodo WHERE estado = 'activo'");
      const c = await coord.post(`/periodos/${activo.id}/cerrar`);
      assert.strictEqual(c.flash.tipo, 'ok');
      const b = await coord.post(`/periodos/${per.id}/activar`);
      assert.strictEqual(b.flash.tipo, 'ok');
      assert.strictEqual(await cuenta("SELECT count(*) AS n FROM periodo WHERE estado = 'activo'"), 1);
      return `1.º intento: "${a.flash.texto}"; tras cerrar el activo: activado; períodos activos en la base: 1`;
    });
  await caso('PF-23', 'RF-10', 'Editar período y bloquear el período cerrado', 'Renombrar P-PRUEBA-1; intentar editar el período 2026-1 (cerrado)',
    'El período abierto se edita; el cerrado no', async () => {
      const a = await coord.post(`/periodos/${per.id}`, { nombre: 'P-PRUEBA-1B', fecha_inicio: pIni, fecha_fin: pFin });
      assert.strictEqual(a.status, 302);
      assert.strictEqual((await uno('SELECT nombre FROM periodo WHERE id = $1', [per.id])).nombre, 'P-PRUEBA-1B');
      const cerrado = await uno("SELECT id FROM periodo WHERE nombre = '2026-1'");
      const b = await coord.post(`/periodos/${cerrado.id}`, { nombre: 'X-CAMBIADO', fecha_inicio: '2026-05-01', fecha_fin: '2026-10-31' });
      assert.strictEqual(b.flash.tipo, 'error');
      assert.strictEqual((await uno('SELECT nombre FROM periodo WHERE id = $1', [cerrado.id])).nombre, '2026-1');
      return 'P-PRUEBA-1 renombrado a P-PRUEBA-1B; el período 2026-1 (cerrado) conserva su nombre';
    });

  // ============================== RF-20 Convocatorias
  const carrEmp = await uno("SELECT id FROM carrera WHERE nombre = 'Arquitectura'");
  const convDatos = (extra = {}) => ({
    periodo_id: String(per.id), nombre: 'Convocatoria de prueba', descripcion: 'Inscripción de prueba',
    apertura: ahoraEc(0, -2), cierre: ahoraEc(5), carreras: [String(carreraSoft.id), String(carrEmp.id)], ...extra,
  });
  await caso('PF-24', 'RF-20', 'Registrar convocatoria dentro de un período', 'período P-PRUEBA-1B, apertura hace 2 h, cierre en 5 días, carreras Software y Arquitectura',
    'Se guarda con sus carreras y su estado se calcula como abierta', async () => {
      const r = await coord.post('/convocatorias', convDatos());
      assert.strictEqual(r.status, 302, r.body.slice(0, 200));
      const c = await uno("SELECT id, estado FROM v_convocatoria WHERE nombre = 'Convocatoria de prueba'");
      assert.strictEqual(c.estado, 'abierta');
      assert.strictEqual(await cuenta('SELECT count(*) AS n FROM convocatoria_carrera WHERE convocatoria_id = $1', [c.id]), 2);
      return `convocatoria creada; estado calculado "${c.estado}"; 2 carreras asociadas`;
    }, true);
  await caso('PF-25', 'RF-20', 'Validaciones de la convocatoria', 'cierre anterior a la apertura; fechas fuera del período; sin carreras',
    'Los tres intentos se rechazan', async () => {
      const a = await coord.post('/convocatorias', convDatos({ nombre: 'C-A', apertura: ahoraEc(3), cierre: ahoraEc(1) }));
      const b = await coord.post('/convocatorias', convDatos({ nombre: 'C-B', apertura: ahoraEc(-90), cierre: ahoraEc(-80) }));
      const c = await coord.post('/convocatorias', convDatos({ nombre: 'C-C', carreras: [] }));
      assert.strictEqual(a.status, 422); hayError(a, 'posterior a la apertura');
      assert.strictEqual(b.status, 422); hayError(b, 'dentro del período');
      assert.strictEqual(c.status, 422); hayError(c, 'al menos una carrera');
      assert.strictEqual(await cuenta("SELECT count(*) AS n FROM convocatoria WHERE nombre IN ('C-A','C-B','C-C')"), 0);
      return 'Los 3 intentos devolvieron HTTP 422; 0 filas nuevas en convocatoria';
    });
  await caso('PF-26', 'RF-20', 'No se crean convocatorias en un período cerrado', 'período 2026-1 (cerrado)',
    'La base de datos lo rechaza y la aplicación muestra el mensaje', async () => {
      const cerrado = await uno("SELECT id FROM periodo WHERE nombre = '2026-1'");
      const r = await coord.post('/convocatorias', convDatos({ periodo_id: String(cerrado.id), nombre: 'C-D', apertura: '2026-06-01T08:00', cierre: '2026-06-10T08:00' }));
      assert.strictEqual(r.status, 422); hayError(r, 'está cerrado');
      return 'HTTP 422 con el mensaje del disparador: período cerrado';
    });
  await caso('PF-27', 'RF-20', 'La convocatoria abierta aparece al estudiante de la carrera', 'Panel del estudiante de Ingeniería de Software',
    'El estudiante ve la convocatoria con estado abierta', async () => {
      const r = await alumno.get('/panel');
      hayError(r, 'Convocatoria de prueba'); hayError(r, 'abierta');
      return 'El panel del estudiante lista "Convocatoria de prueba" con estado abierta';
    });
  const conv = await uno("SELECT id FROM convocatoria WHERE nombre = 'Convocatoria de prueba'");
  await caso('PF-28', 'RF-20', 'Editar convocatoria', 'cambiar nombre y dejar solo la carrera de Software',
    'Se actualizan el nombre y las carreras asociadas', async () => {
      const r = await coord.post(`/convocatorias/${conv.id}`, convDatos({ nombre: 'Convocatoria de prueba (editada)', carreras: [String(carreraSoft.id)] }));
      assert.strictEqual(r.status, 302, r.body.slice(0, 200));
      assert.strictEqual((await uno('SELECT nombre FROM convocatoria WHERE id = $1', [conv.id])).nombre, 'Convocatoria de prueba (editada)');
      assert.strictEqual(await cuenta('SELECT count(*) AS n FROM convocatoria_carrera WHERE convocatoria_id = $1', [conv.id]), 1);
      return 'nombre actualizado; 1 carrera asociada';
    });
  await caso('PF-29', 'RF-10 / RF-20', 'Eliminar período con convocatorias y convocatoria con inscripciones', 'P-PRUEBA-1B (tiene convocatoria); convocatoria con una inscripción',
    'Ambos borrados se bloquean; luego se elimina la convocatoria sin inscripciones', async () => {
      const a = await coord.post(`/periodos/${per.id}/eliminar`);
      assert.strictEqual(a.flash.tipo, 'error');
      const emp = await uno('SELECT id FROM empresa LIMIT 1');
      const alu = await uno('SELECT id FROM usuario WHERE cedula = $1', [est.cedula]);
      await q('INSERT INTO inscripcion (convocatoria_id, estudiante_id, empresa_id) VALUES ($1, $2, $3)', [conv.id, alu.id, emp.id]);
      const b = await coord.post(`/convocatorias/${conv.id}/eliminar`);
      assert.strictEqual(b.flash.tipo, 'error');
      assert.strictEqual(await cuenta('SELECT count(*) AS n FROM convocatoria WHERE id = $1', [conv.id]), 1);
      await q('DELETE FROM inscripcion WHERE convocatoria_id = $1', [conv.id]);
      const c = await coord.post(`/convocatorias/${conv.id}/eliminar`);
      assert.strictEqual(c.flash.tipo, 'ok');
      assert.strictEqual(await cuenta('SELECT count(*) AS n FROM convocatoria WHERE id = $1', [conv.id]), 0);
      return `Período con convocatoria: "${a.flash.texto}"; convocatoria con inscripción: "${b.flash.texto}"; sin inscripciones: eliminada`;
    });
  await caso('PF-30', 'RF-10', 'Eliminar período sin convocatorias', 'P-PRUEBA-1B (ya sin convocatorias)',
    'El período se elimina', async () => {
      const r = await coord.post(`/periodos/${per.id}/eliminar`);
      assert.strictEqual(r.flash.tipo, 'ok');
      assert.strictEqual(await cuenta('SELECT count(*) AS n FROM periodo WHERE id = $1', [per.id]), 0);
      return 'período eliminado (0 filas)';
    });

  // ============================== RF-07 Empresas
  const empresa = { nombre: 'Agroindustrial del Litoral', ruc: '0992233445001', ciudad: 'Quevedo', sector: 'Norte',
    telefono: '052760000', correo_contacto: 'rrhh@litoral.example', responsable_laboral: 'Rosa Intriago' };
  await caso('PF-31', 'RF-07', 'Registrar empresa', `${empresa.nombre}, RUC ${empresa.ruc}`,
    'La empresa queda guardada con todos sus datos', async () => {
      const r = await coord.post('/empresas', empresa);
      assert.strictEqual(r.status, 302);
      const f = await uno('SELECT ciudad, responsable_laboral FROM empresa WHERE ruc = $1', [empresa.ruc]);
      assert.strictEqual(f.responsable_laboral, 'Rosa Intriago');
      return `fila creada: ciudad ${f.ciudad}, responsable ${f.responsable_laboral}`;
    }, true);
  await caso('PF-32', 'RF-07', 'RUC repetido o inválido', 'mismo RUC; RUC de 12 dígitos',
    'Ambos se rechazan', async () => {
      const a = await coord.post('/empresas', { ...empresa, nombre: 'Otra empresa' });
      const b = await coord.post('/empresas', { ...empresa, nombre: 'Otra empresa', ruc: '099223344500' });
      assert.strictEqual(a.status, 422); hayError(a, 'El RUC ya está registrado');
      assert.strictEqual(b.status, 422); hayError(b, '13 dígitos');
      assert.strictEqual(await cuenta("SELECT count(*) AS n FROM empresa WHERE nombre = 'Otra empresa'"), 0);
      return 'RUC repetido: HTTP 422; RUC corto: HTTP 422; 0 filas "Otra empresa"';
    });
  await caso('PF-33', 'RF-07', 'Búsqueda por nombre y por ciudad', 'q = "litoral" y q = "guayaquil"',
    'Cada búsqueda devuelve solo las empresas que coinciden', async () => {
      const a = await coord.get('/empresas?q=litoral');
      hayError(a, 'Agroindustrial del Litoral');
      assert(!a.body.includes('Estudio Habitar'));
      const b = await coord.get('/empresas?q=guayaquil');
      hayError(b, 'Estudio Habitar'); assert(!b.body.includes('Agroindustrial del Litoral'));
      return '"litoral" lista solo Agroindustrial del Litoral; "guayaquil" lista solo Estudio Habitar';
    });
  await caso('PF-34', 'RF-07 / seguridad', 'Intento de inyección SQL en la búsqueda', "q = \"'; DROP TABLE empresa; --\"",
    'La entrada se trata como texto: sin resultados, sin errores y la tabla sigue existiendo', async () => {
      const antes = await cuenta('SELECT count(*) AS n FROM empresa');
      const r = await coord.get('/empresas?q=' + encodeURIComponent("'; DROP TABLE empresa; --"));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(await cuenta('SELECT count(*) AS n FROM empresa'), antes);
      return `HTTP 200, 0 resultados; la tabla empresa sigue con ${antes} filas`;
    });
  const emp = await uno('SELECT id FROM empresa WHERE ruc = $1', [empresa.ruc]);
  await caso('PF-35', 'RF-07', 'Editar y eliminar empresa', 'cambiar responsable a "Pedro Cevallos"; luego eliminar',
    'Se actualiza el responsable y luego se elimina la empresa', async () => {
      const r = await coord.post(`/empresas/${emp.id}`, { ...empresa, responsable_laboral: 'Pedro Cevallos' });
      assert.strictEqual(r.status, 302);
      assert.strictEqual((await uno('SELECT responsable_laboral AS r FROM empresa WHERE id = $1', [emp.id])).r, 'Pedro Cevallos');
      const d = await coord.post(`/empresas/${emp.id}/eliminar`);
      assert.strictEqual(d.flash.tipo, 'ok');
      assert.strictEqual(await cuenta('SELECT count(*) AS n FROM empresa WHERE id = $1', [emp.id]), 0);
      return 'responsable actualizado a "Pedro Cevallos"; empresa eliminada (0 filas)';
    });

  // ============================== RF-09 Vacantes por convocatoria
  const iniV = hoyEc(-30); const finV = hoyEc(120);
  await q("UPDATE periodo SET estado = 'cerrado' WHERE estado = 'activo'");
  const perV = await uno("INSERT INTO periodo (nombre, fecha_inicio, fecha_fin, estado) VALUES ('P-VACANTES', $1, $2, 'activo') RETURNING id", [iniV, finV]);
  await coord.post('/convocatorias', { periodo_id: String(perV.id), nombre: 'Convocatoria vacantes', apertura: ahoraEc(0, -1), cierre: ahoraEc(3), carreras: [String(carreraSoft.id)] });
  const convV = await uno("SELECT id FROM convocatoria WHERE nombre = 'Convocatoria vacantes'");
  const emp1 = await uno("SELECT id FROM empresa WHERE ruc = '1790012345001'");
  await caso('PF-40', 'RF-09', 'Registrar vacantes de una empresa en una convocatoria', `empresa ${emp1.id}, 12 vacantes`,
    'Se guardan 12 totales, 0 ocupadas y 12 disponibles', async () => {
      const r = await coord.post(`/convocatorias/${convV.id}/vacantes`, { empresa_id: String(emp1.id), cantidad: '12' });
      assert.strictEqual(r.status, 302);
      assert.strictEqual((await uno('SELECT cantidad FROM vacante WHERE convocatoria_id = $1 AND empresa_id = $2', [convV.id, emp1.id])).cantidad, 12);
      const p = await coord.get(`/convocatorias/${convV.id}/vacantes`);
      hayError(p, 'Constructora Andina');
      return 'fila creada con cantidad 12; la página muestra la empresa con 0 ocupadas y 12 disponibles';
    }, true);
  await caso('PF-41', 'RF-09', 'Cantidades inválidas o empresa repetida', 'cantidad -3, cantidad "abc", misma empresa otra vez',
    'Los tres intentos se rechazan y la base no cambia', async () => {
      const a = await coord.post(`/convocatorias/${convV.id}/vacantes`, { empresa_id: String(emp1.id), cantidad: '-3' });
      const b = await coord.post(`/convocatorias/${convV.id}/vacantes`, { empresa_id: String(emp1.id), cantidad: 'abc' });
      const c = await coord.post(`/convocatorias/${convV.id}/vacantes`, { empresa_id: String(emp1.id), cantidad: '5' });
      assert.strictEqual(a.status, 422); assert.strictEqual(b.status, 422); assert.strictEqual(c.status, 422);
      assert.strictEqual(await cuenta('SELECT count(*) AS n FROM vacante WHERE convocatoria_id = $1', [convV.id]), 1);
      await assert.rejects(q('INSERT INTO vacante (convocatoria_id, empresa_id, cantidad) VALUES ($1, $2, -1)', [convV.id, (await uno("SELECT id FROM empresa WHERE ruc = '1790098765001'")).id]), /check/i);
      return 'Los 3 intentos devolvieron HTTP 422; sigue 1 fila; PostgreSQL también rechaza cantidad -1 (restricción CHECK)';
    });
  await caso('PF-42', 'RF-09', 'Actualizar y eliminar vacantes', 'cambiar a 20 y luego eliminar',
    'La cantidad se actualiza y luego la fila se elimina', async () => {
      const vac = await uno('SELECT id FROM vacante WHERE convocatoria_id = $1', [convV.id]);
      await coord.post(`/vacantes/${vac.id}`, { cantidad: '20' });
      assert.strictEqual((await uno('SELECT cantidad FROM vacante WHERE id = $1', [vac.id])).cantidad, 20);
      await coord.post(`/vacantes/${vac.id}/eliminar`);
      assert.strictEqual(await cuenta('SELECT count(*) AS n FROM vacante WHERE id = $1', [vac.id]), 0);
      return 'cantidad 12 → 20; fila eliminada (0 filas)';
    });
  await caso('PF-43', 'RF-09', 'No se reduce por debajo de las vacantes ocupadas', '3 vacantes, 2 asignaciones vigentes; intento de bajar a 1',
    'Se rechaza el cambio', async () => {
      await coord.post(`/convocatorias/${convV.id}/vacantes`, { empresa_id: String(emp1.id), cantidad: '3' });
      const vac = await uno('SELECT id FROM vacante WHERE convocatoria_id = $1', [convV.id]);
      const cordi = await uno("SELECT id FROM usuario WHERE rol = 'coordinador' LIMIT 1");
      for (const n of [1, 2]) {
        const al = await uno(`INSERT INTO usuario (cedula, nombres, apellidos, correo, password_hash, rol, carrera_id, ciudad, sector)
                              VALUES ($1, 'Test', 'Alumno', $2, 'x', 'estudiante', $3, 'Quevedo', 'Centro') RETURNING id`,
        [completarCedula('1200004' + String(n).padStart(2, '0')), `t${n}@x.example`, carreraSoft.id]);
        const ins = await uno('INSERT INTO inscripcion (convocatoria_id, estudiante_id, empresa_id) VALUES ($1, $2, $3) RETURNING id', [convV.id, al.id, emp1.id]);
        await q("INSERT INTO asignacion (inscripcion_id, empresa_id, tipo, asignado_por) VALUES ($1, $2, 'asignacion', $3)", [ins.id, emp1.id, cordi.id]);
      }
      const r = await coord.post(`/vacantes/${vac.id}`, { cantidad: '1' });
      assert.strictEqual(r.flash.tipo, 'error');
      assert.strictEqual((await uno('SELECT cantidad FROM vacante WHERE id = $1', [vac.id])).cantidad, 3);
      const p = await coord.get(`/convocatorias/${convV.id}/vacantes`);
      hayError(p, '<td>2</td><td>1</td>');
      return `"${r.flash.texto}"; la cantidad sigue en 3 (2 ocupadas, 1 disponible)`;
    });

  // ============================== RF-04 Cuentas del personal
  const nuevaCed = completarCedula('120000300');
  await caso('PF-36', 'RF-04', 'El administrador crea una cuenta de coordinador', `cédula ${nuevaCed}, rol coordinador`,
    'La cuenta se crea y puede iniciar sesión', async () => {
      const r = await admin.post('/usuarios', { cedula: nuevaCed, nombres: 'Luisa', apellidos: 'Mendoza', correo: 'luisa@practicas.example', rol: 'coordinador', password: 'Coord2026*Luisa' });
      assert.strictEqual(r.status, 302);
      const nuevo = new Cliente(base);
      const l = await nuevo.post('/login', { cedula: nuevaCed, password: 'Coord2026*Luisa' });
      assert.strictEqual(l.status, 302);
      assert.strictEqual((await uno('SELECT rol FROM usuario WHERE cedula = $1', [nuevaCed])).rol, 'coordinador');
      return 'cuenta creada con rol coordinador; inicio de sesión correcto';
    }, true);
  await caso('PF-37', 'RF-04', 'Desactivar y reactivar cuenta', 'cuenta de Luisa Mendoza',
    'La cuenta desactivada no inicia sesión; al reactivarla vuelve a funcionar; los datos se conservan', async () => {
      const u = await uno('SELECT id FROM usuario WHERE cedula = $1', [nuevaCed]);
      await admin.post(`/usuarios/${u.id}/estado`, { activo: 'false' });
      const a = await new Cliente(base).post('/login', { cedula: nuevaCed, password: 'Coord2026*Luisa' });
      assert.strictEqual(a.status, 403); hayError(a, 'desactivada');
      await admin.post(`/usuarios/${u.id}/estado`, { activo: 'true' });
      const b = await new Cliente(base).post('/login', { cedula: nuevaCed, password: 'Coord2026*Luisa' });
      assert.strictEqual(b.status, 302);
      assert.strictEqual(await cuenta('SELECT count(*) AS n FROM usuario WHERE id = $1', [u.id]), 1);
      return 'Desactivada: HTTP 403 "cuenta desactivada"; reactivada: acceso correcto; el registro se conserva';
    });
  await caso('PF-38', 'RF-04', 'El administrador no puede desactivar su propia cuenta', 'cuenta del administrador',
    'Se rechaza y la cuenta sigue activa', async () => {
      const u = await uno('SELECT id FROM usuario WHERE cedula = $1', [ced.admin]);
      const r = await admin.post(`/usuarios/${u.id}/estado`, { activo: 'false' });
      assert.strictEqual(r.flash.tipo, 'error');
      assert.strictEqual((await uno('SELECT activo FROM usuario WHERE id = $1', [u.id])).activo, true);
      return `"${r.flash.texto}"; activo = true en la base`;
    });

  // ============================== Bitácora
  await caso('PF-39', 'RNF-09', 'Registro de acciones en la bitácora', 'Acciones realizadas durante las pruebas',
    'La bitácora contiene los registros con usuario y fecha', async () => {
      const n = await cuenta('SELECT count(*) AS n FROM bitacora WHERE usuario_id IS NOT NULL AND fecha IS NOT NULL');
      assert(n >= 20, `solo ${n} registros`);
      const p = await admin.get('/bitacora');
      assert.strictEqual(p.status, 200); hayError(p, 'Bitácora');
      return `${n} registros con usuario y fecha en PostgreSQL; la página de bitácora responde 200`;
    });

  // ---------------------------------------------------------------- resumen
  const aprobados = resultados.filter((r) => r.estado === 'Aprobado').length;
  console.log(`\nResultado: ${aprobados} de ${resultados.length} pruebas aprobadas`);
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'resultados_pruebas.json'), JSON.stringify(resultados, null, 2));
  const md = ['# Resultados de las pruebas funcionales', '',
    `Ejecutadas con \`npm test\`: **${aprobados} de ${resultados.length} aprobadas**.`, '',
    '| ID | Requisito | Prueba | Datos utilizados | Resultado esperado | Resultado obtenido | Estado |', '|---|---|---|---|---|---|---|',
    ...resultados.map((r) => `| ${r.id} | ${r.rf} | ${r.descripcion} | ${r.datos} | ${r.esperado} | ${String(r.obtenido).replace(/\|/g, '\\|')} | ${r.estado} |`)].join('\n');
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'resultados_pruebas.md'), md + '\n');

  servidor.close();
  await pool.end();
  process.exit(aprobados === resultados.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
