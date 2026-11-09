# Plataforma de asignación y evaluación de prácticas preprofesionales

Aplicación web para gestionar las prácticas preprofesionales de todas las carreras de la universidad: inscripción, verificación de requisitos académicos, asignación y reubicación en empresas, documentación y evaluación. Base de datos: **PostgreSQL**.

> Estado: especificación de requisitos. Todavía no hay código de la aplicación.

## Actores

| Actor | Participación |
|---|---|
| Estudiante | Usuario directo: se registra, sube su récord académico en PDF, se inscribe eligiendo una empresa y consulta su asignación y documento. |
| Coordinador de prácticas | Usuario directo: gestiona carreras, empresas, convenios, vacantes y períodos; verifica requisitos; asigna y reubica; registra evaluaciones. |
| Administrador del sistema | Usuario directo: gestiona cuentas y roles y consulta la bitácora. |
| Jefe laboral | Externo, sin cuenta: entrega la evaluación al coordinador. |

## Módulos y funcionalidades previstas

1. **Usuarios y autenticación**: registro con validación en tiempo real y confirmación de datos, inicio de sesión, datos fijos con solicitud de corrección, cuentas y roles.
2. **Gestión académica**: carreras con cantidad mínima de asignaturas aprobadas, carga de récords en PDF e historial.
3. **Empresas y convenios**: empresas, convenios con vigencia automática y vacantes por período.
4. **Inscripciones**: períodos de apertura y cierre, inscripción con una empresa preferida y orden cronológico con hora del servidor.
5. **Verificación académica**: revisión del récord y resultado cumple / no cumple según el mínimo de la carrera.
6. **Asignación y reubicación**: vacantes por empresa, confirmación de asignaciones y reubicación por el coordinador.
7. **Ubicación geográfica**: sugerencia de empresas según la ciudad y el sector del estudiante.
8. **Gestión documental**: generación y descarga del documento de prácticas (Anexo 1).
9. **Evaluaciones**: registro por el coordinador (muy bueno, bueno, regular, malo, muy malo) e historial.

## Reglas de diseño

- Tras el registro no se modifican los datos del estudiante, salvo su ciudad y sector; los errores se corrigen con una solicitud aprobada por el coordinador.
- Récords, inscripciones, verificaciones, asignaciones y evaluaciones se conservan como historial y no se sobrescriben.
- El sistema sugiere y organiza; el coordinador confirma toda asignación y reubicación.

## Limitaciones

Sin conexión con el SGA, sin lectura automática de los PDF, sin cuentas para docentes tutores ni jefes laborales y sin cálculo de rutas o tiempos de traslado.

## Especificación

La matriz de requisitos funcionales (RF-01 a RF-19), no funcionales (RNF-01 a RNF-10) y el orden de desarrollo por fases están en `especificacion_requisitos.pdf`.
