# Plataforma de asignación y evaluación de prácticas preprofesionales

Proyecto integrador — UTEQ, Facultad de Ciencias de la Computación, Ingeniería de Software.
Primera versión funcional: aplicación web con **Node.js + Express**, vistas **EJS** y **PostgreSQL 16**.

## Qué incluye
- Registro de estudiantes con validación de cédula en tiempo real y confirmación de datos; inicio y cierre de sesión; roles de estudiante, coordinador y administrador.
- Administración (registrar, consultar, actualizar, eliminar) de **facultades**, **carreras**, **períodos** (un solo período activo), **convocatorias** (dentro de un período, con carreras participantes), **vacantes** por convocatoria y **empresas**.
- Cuentas del personal y bitácora de acciones (administrador).
- Scripts SQL en `db/` y 43 pruebas funcionales en `test/`.

Estado de requisitos: 9 completados (RF-01, 02, 04, 05, 07, 09, 10, 20, 21), 2 en desarrollo (RF-03, RF-11) y 10 pendientes. El detalle está en el informe técnico (entregado aparte).

## Tecnologías
Node.js ≥ 20.6 (probado con 22), Express 4, EJS 3, `pg` 8 (node-postgres), PostgreSQL 16. Contraseñas con `scrypt` (módulo `crypto` de Node). Sin otras dependencias.

## 1. Requisitos previos
- Node.js 20.6 o superior y npm.
- PostgreSQL 16 en ejecución y acceso con un usuario administrador (por ejemplo `postgres`).

## 2. Configurar PostgreSQL
Cree un rol y **dos** bases de datos: la de trabajo y una exclusiva para las pruebas (las pruebas la reinician).
Sustituya `SU_CLAVE` por una contraseña propia.

```bash
psql -U postgres -c "CREATE ROLE practicas_app LOGIN PASSWORD 'SU_CLAVE'"
psql -U postgres -c "CREATE DATABASE practicas OWNER practicas_app"
psql -U postgres -c "CREATE DATABASE practicas_test OWNER practicas_app"
```

## 3. Variables de entorno y dependencias
```bash
cp .env.example .env      # en Windows: copy .env.example .env
npm install
```
Edite `.env` y reemplace `CAMBIAR_CLAVE` por su contraseña en `DATABASE_URL` y `TEST_DATABASE_URL`. El archivo `.env` no se publica en Git.
La base indicada en `TEST_DATABASE_URL` debe terminar en `_test`; si no, las pruebas se niegan a ejecutarse.

## 4. Inicializar la base de datos
```bash
npm run db:init            # ejecuta db/01_schema.sql y db/02_datos_demo.sql
```
**Atención:** este comando borra y recrea las tablas de la base de trabajo. Úselo solo la primera vez o cuando quiera volver al estado inicial.

## 5. Crear las cuentas de demostración
```bash
npm run db:seed-usuarios
```
Crea un administrador y un coordinador (no sobrescribe los que ya existan). Las contraseñas de demostración pueden cambiarse al crearlas:
```bash
ADMIN_PASSWORD='otra-clave' COORD_PASSWORD='otra-clave' npm run db:seed-usuarios   # Linux/macOS
```
| Rol | Cédula | Contraseña por defecto (solo demostración) |
|---|---|---|
| Administrador | 1200000014 | Admin2026* |
| Coordinador | 1200000022 | Coord2026* |

Los estudiantes se registran desde `/registro` con una cédula ecuatoriana válida (10 dígitos y dígito verificador correcto).
Los datos de facultades, carreras (incluido el mínimo de asignaturas), empresas y períodos de `db/02_datos_demo.sql` son de **demostración**, no datos institucionales confirmados.

## 6. Ejecutar la aplicación
```bash
npm start                  # http://localhost:3000   (puerto configurable con PORT en .env)
npm run dev                # modo desarrollo con recarga automática
```

## 7. Ejecutar las pruebas
```bash
npm test
```
Ejecuta 43 pruebas funcionales (PF-01 a PF-43). Cada una realiza la operación desde la aplicación y la comprueba directamente en PostgreSQL;
escribe `docs/resultados_pruebas.md` y `.json` con los datos usados, el resultado esperado y el obtenido.
Trabaja sobre `TEST_DATABASE_URL` (reiniciándola con los scripts de `db/`); **no modifica** la base de trabajo.

## Estructura
```
db/            01_schema.sql, 02_datos_demo.sql
src/           app.js, server.js, db.js, auth.js, validaciones.js, errores.js
src/routes/    autenticacion, facultades, carreras, periodos, convocatorias, vacantes, empresas, usuarios
src/views/     plantillas EJS      src/public/   estilos y script de registro
src/scripts/   iniciar_bd.js, crear_usuarios_iniciales.js
test/          pruebas.js          docs/         resultados de pruebas y distribución del trabajo
```

## Seguridad y limitaciones
- Contraseñas con `scrypt` y sal; consultas parametrizadas (`$1, $2, …`); control de acceso por rol; sesiones con cookie `httpOnly` y `SameSite=Lax`.
- No hay tokens CSRF ni HTTPS: la versión está pensada para ejecución local. Cambie las contraseñas de demostración antes de cualquier otro uso.
- No hay conexión con el SGA ni con el Registro Civil: la cédula se valida por formato y dígito verificador.
