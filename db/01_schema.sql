-- =====================================================================
-- Plataforma de asignación y evaluación de prácticas preprofesionales
-- Esquema de la base de datos (PostgreSQL 14 o superior)
-- Ejecutar con:  npm run db:init
-- Este script es repetible: elimina y vuelve a crear todas las tablas.
-- =====================================================================

DROP VIEW  IF EXISTS v_convocatoria CASCADE;
DROP TABLE IF EXISTS bitacora CASCADE;
DROP TABLE IF EXISTS solicitud_correccion CASCADE;
DROP TABLE IF EXISTS evaluacion CASCADE;
DROP TABLE IF EXISTS asignacion CASCADE;
DROP TABLE IF EXISTS verificacion CASCADE;
DROP TABLE IF EXISTS record_academico CASCADE;
DROP TABLE IF EXISTS inscripcion CASCADE;
DROP TABLE IF EXISTS vacante CASCADE;
DROP TABLE IF EXISTS convenio CASCADE;
DROP TABLE IF EXISTS empresa CASCADE;
DROP TABLE IF EXISTS convocatoria_carrera CASCADE;
DROP TABLE IF EXISTS convocatoria CASCADE;
DROP TABLE IF EXISTS periodo CASCADE;
DROP TABLE IF EXISTS sesion CASCADE;
DROP TABLE IF EXISTS usuario CASCADE;
DROP TABLE IF EXISTS carrera CASCADE;
DROP TABLE IF EXISTS facultad CASCADE;

-- ---------------------------------------------------------------------
-- M02. Estructura institucional: facultades y carreras
-- ---------------------------------------------------------------------
CREATE TABLE facultad (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre      VARCHAR(150) NOT NULL,
    creada_en   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT facultad_nombre_vacio CHECK (length(btrim(nombre)) > 0)
);
CREATE UNIQUE INDEX facultad_nombre_uq ON facultad (lower(nombre));

CREATE TABLE carrera (
    id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    facultad_id        INTEGER      NOT NULL REFERENCES facultad(id) ON DELETE RESTRICT,
    nombre             VARCHAR(150) NOT NULL,
    min_asignaturas    SMALLINT     NOT NULL CHECK (min_asignaturas > 0 AND min_asignaturas <= 200),
    creada_en          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT carrera_nombre_vacio CHECK (length(btrim(nombre)) > 0)
);
CREATE UNIQUE INDEX carrera_facultad_nombre_uq ON carrera (facultad_id, lower(nombre));

-- ---------------------------------------------------------------------
-- M01. Usuarios y sesiones
-- ---------------------------------------------------------------------
CREATE TABLE usuario (
    id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cedula         CHAR(10)     NOT NULL CHECK (cedula ~ '^[0-9]{10}$'),
    nombres        VARCHAR(80)  NOT NULL,
    apellidos      VARCHAR(80)  NOT NULL,
    correo         VARCHAR(120) NOT NULL CHECK (correo ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    password_hash  TEXT         NOT NULL,
    rol            VARCHAR(15)  NOT NULL CHECK (rol IN ('estudiante', 'coordinador', 'administrador')),
    carrera_id     INTEGER REFERENCES carrera(id) ON DELETE RESTRICT,
    ciudad         VARCHAR(80),
    sector         VARCHAR(80),
    activo         BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT usuario_cedula_uq UNIQUE (cedula),
    -- Un estudiante siempre tiene carrera y localidad.
    CONSTRAINT usuario_estudiante_datos CHECK (
        rol <> 'estudiante' OR (carrera_id IS NOT NULL AND ciudad IS NOT NULL AND sector IS NOT NULL)
    )
);
CREATE UNIQUE INDEX usuario_correo_uq ON usuario (lower(correo));

-- Regla de datos fijos: tras el registro no se modifican cédula, nombres,
-- apellidos ni carrera. Solo una corrección aprobada puede cambiarlos
-- (la aplicación activa app.permitir_correccion dentro de su transacción).
CREATE OR REPLACE FUNCTION usuario_datos_fijos() RETURNS trigger AS $$
BEGIN
    IF current_setting('app.permitir_correccion', true) IS DISTINCT FROM 'on' THEN
        IF NEW.cedula    IS DISTINCT FROM OLD.cedula
        OR NEW.nombres   IS DISTINCT FROM OLD.nombres
        OR NEW.apellidos IS DISTINCT FROM OLD.apellidos
        OR NEW.carrera_id IS DISTINCT FROM OLD.carrera_id THEN
            RAISE EXCEPTION 'Los datos de registro (cédula, nombres, apellidos y carrera) no pueden modificarse; solicite una corrección.'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER usuario_datos_fijos_trg
    BEFORE UPDATE ON usuario
    FOR EACH ROW EXECUTE FUNCTION usuario_datos_fijos();

CREATE TABLE sesion (
    token       CHAR(64)    PRIMARY KEY,
    usuario_id  INTEGER     NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
    creada_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expira_en   TIMESTAMPTZ NOT NULL
);
CREATE INDEX sesion_usuario_idx ON sesion (usuario_id);

-- ---------------------------------------------------------------------
-- M04. Períodos y convocatorias
--   Período: ciclo académico (p. ej. 2026-1). Un solo período activo.
--   Convocatoria: apertura de inscripciones dentro de un período, con
--   fechas de apertura y cierre y las carreras que pueden participar.
-- ---------------------------------------------------------------------
CREATE TABLE periodo (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre        VARCHAR(60) NOT NULL,
    fecha_inicio  DATE        NOT NULL,
    fecha_fin     DATE        NOT NULL,
    estado        VARCHAR(12) NOT NULL DEFAULT 'planificado'
                  CHECK (estado IN ('planificado', 'activo', 'cerrado')),
    creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT periodo_fechas CHECK (fecha_fin > fecha_inicio),
    CONSTRAINT periodo_nombre_vacio CHECK (length(btrim(nombre)) > 0)
);
CREATE UNIQUE INDEX periodo_nombre_uq ON periodo (lower(nombre));
-- A lo sumo un período activo a la vez.
CREATE UNIQUE INDEX periodo_un_activo_uq ON periodo ((TRUE)) WHERE estado = 'activo';

CREATE TABLE convocatoria (
    id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    periodo_id   INTEGER      NOT NULL REFERENCES periodo(id) ON DELETE RESTRICT,
    nombre       VARCHAR(150) NOT NULL,
    descripcion  TEXT,
    apertura     TIMESTAMPTZ  NOT NULL,
    cierre       TIMESTAMPTZ  NOT NULL,
    creada_en    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT convocatoria_fechas CHECK (cierre > apertura),
    CONSTRAINT convocatoria_nombre_vacio CHECK (length(btrim(nombre)) > 0)
);
CREATE UNIQUE INDEX convocatoria_periodo_nombre_uq ON convocatoria (periodo_id, lower(nombre));

CREATE TABLE convocatoria_carrera (
    convocatoria_id INTEGER NOT NULL REFERENCES convocatoria(id) ON DELETE CASCADE,
    carrera_id      INTEGER NOT NULL REFERENCES carrera(id)      ON DELETE RESTRICT,
    PRIMARY KEY (convocatoria_id, carrera_id)
);

-- La convocatoria debe quedar dentro de las fechas de su período y el
-- período no debe estar cerrado.
CREATE OR REPLACE FUNCTION convocatoria_valida() RETURNS trigger AS $$
DECLARE
    p periodo%ROWTYPE;
    zona CONSTANT TEXT := 'America/Guayaquil';
BEGIN
    SELECT * INTO p FROM periodo WHERE id = NEW.periodo_id;
    IF p.estado = 'cerrado' THEN
        RAISE EXCEPTION 'El período "%" está cerrado y no admite convocatorias.', p.nombre
            USING ERRCODE = 'P0001';
    END IF;
    IF NEW.apertura < (p.fecha_inicio::timestamp AT TIME ZONE zona)
       OR NEW.cierre >= ((p.fecha_fin + 1)::timestamp AT TIME ZONE zona) THEN
        RAISE EXCEPTION 'Las fechas de la convocatoria deben estar dentro del período "%" (% a %).',
            p.nombre, to_char(p.fecha_inicio, 'DD/MM/YYYY'), to_char(p.fecha_fin, 'DD/MM/YYYY')
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER convocatoria_valida_trg
    BEFORE INSERT OR UPDATE ON convocatoria
    FOR EACH ROW EXECUTE FUNCTION convocatoria_valida();

-- Al modificar las fechas de un período no pueden quedar convocatorias fuera de él.
CREATE OR REPLACE FUNCTION periodo_fechas_validas() RETURNS trigger AS $$
DECLARE
    zona CONSTANT TEXT := 'America/Guayaquil';
BEGIN
    IF EXISTS (
        SELECT 1 FROM convocatoria c
        WHERE c.periodo_id = NEW.id
          AND (c.apertura < (NEW.fecha_inicio::timestamp AT TIME ZONE zona)
               OR c.cierre >= ((NEW.fecha_fin + 1)::timestamp AT TIME ZONE zona))
    ) THEN
        RAISE EXCEPTION 'Existen convocatorias de este período fuera de las nuevas fechas.'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER periodo_fechas_validas_trg
    BEFORE UPDATE OF fecha_inicio, fecha_fin ON periodo
    FOR EACH ROW EXECUTE FUNCTION periodo_fechas_validas();

-- Estado de la convocatoria calculado con la hora del servidor.
CREATE VIEW v_convocatoria AS
SELECT c.*,
       p.nombre AS periodo_nombre,
       p.estado AS periodo_estado,
       CASE
           WHEN now() < c.apertura  THEN 'programada'
           WHEN now() <= c.cierre   THEN 'abierta'
           ELSE 'cerrada'
       END AS estado
FROM convocatoria c
JOIN periodo p ON p.id = c.periodo_id;

-- ---------------------------------------------------------------------
-- M03. Empresas, convenios y vacantes
-- ---------------------------------------------------------------------
CREATE TABLE empresa (
    id                   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre               VARCHAR(150) NOT NULL,
    ruc                  CHAR(13)     NOT NULL CHECK (ruc ~ '^[0-9]{13}$'),
    ciudad               VARCHAR(80)  NOT NULL,
    sector               VARCHAR(80)  NOT NULL,
    telefono             VARCHAR(20),
    correo_contacto      VARCHAR(120) CHECK (correo_contacto IS NULL
                                             OR correo_contacto ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    responsable_laboral  VARCHAR(120) NOT NULL,
    creada_en            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT empresa_ruc_uq UNIQUE (ruc),
    CONSTRAINT empresa_nombre_vacio CHECK (length(btrim(nombre)) > 0)
);

CREATE TABLE convenio (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    empresa_id    INTEGER NOT NULL REFERENCES empresa(id) ON DELETE RESTRICT,
    fecha_inicio  DATE    NOT NULL,
    fecha_fin     DATE    NOT NULL,
    creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT convenio_fechas CHECK (fecha_fin >= fecha_inicio)
);

CREATE TABLE vacante (
    id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    convocatoria_id  INTEGER NOT NULL REFERENCES convocatoria(id) ON DELETE CASCADE,
    empresa_id       INTEGER NOT NULL REFERENCES empresa(id)      ON DELETE RESTRICT,
    cantidad         INTEGER NOT NULL CHECK (cantidad >= 0),
    CONSTRAINT vacante_uq UNIQUE (convocatoria_id, empresa_id)
);

-- ---------------------------------------------------------------------
-- M04. Inscripciones y M02. récords académicos
-- ---------------------------------------------------------------------
CREATE TABLE inscripcion (
    id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    convocatoria_id  INTEGER     NOT NULL REFERENCES convocatoria(id) ON DELETE RESTRICT,
    estudiante_id    INTEGER     NOT NULL REFERENCES usuario(id)      ON DELETE RESTRICT,
    empresa_id       INTEGER     NOT NULL REFERENCES empresa(id)      ON DELETE RESTRICT,
    fecha_hora       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT inscripcion_uq UNIQUE (convocatoria_id, estudiante_id)
);
CREATE INDEX inscripcion_orden_idx ON inscripcion (convocatoria_id, empresa_id, fecha_hora);

CREATE OR REPLACE FUNCTION inscripcion_fecha_fija() RETURNS trigger AS $$
BEGIN
    IF NEW.fecha_hora IS DISTINCT FROM OLD.fecha_hora THEN
        RAISE EXCEPTION 'La fecha y hora de inscripción no pueden modificarse.' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inscripcion_fecha_fija_trg
    BEFORE UPDATE ON inscripcion
    FOR EACH ROW EXECUTE FUNCTION inscripcion_fecha_fija();

CREATE TABLE record_academico (
    id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    estudiante_id    INTEGER NOT NULL REFERENCES usuario(id)      ON DELETE RESTRICT,
    periodo_id       INTEGER NOT NULL REFERENCES periodo(id)      ON DELETE RESTRICT,
    nombre_archivo   VARCHAR(200) NOT NULL,
    contenido        BYTEA   NOT NULL,
    tamano_bytes     INTEGER NOT NULL CHECK (tamano_bytes > 0 AND tamano_bytes <= 5242880),
    subido_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- M05, M06, M09. Verificación, asignación y evaluación
-- ---------------------------------------------------------------------
CREATE TABLE verificacion (
    id                     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inscripcion_id         INTEGER  NOT NULL REFERENCES inscripcion(id) ON DELETE RESTRICT,
    asignaturas_aprobadas  SMALLINT NOT NULL CHECK (asignaturas_aprobadas >= 0),
    minimo_requerido       SMALLINT NOT NULL CHECK (minimo_requerido > 0),
    cumple                 BOOLEAN  NOT NULL,
    observaciones          TEXT,
    verificado_por         INTEGER  NOT NULL REFERENCES usuario(id),
    verificado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE asignacion (
    id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inscripcion_id  INTEGER NOT NULL REFERENCES inscripcion(id) ON DELETE RESTRICT,
    empresa_id      INTEGER NOT NULL REFERENCES empresa(id)     ON DELETE RESTRICT,
    tipo            VARCHAR(12) NOT NULL CHECK (tipo IN ('asignacion', 'reubicacion')),
    motivo          TEXT,
    vigente         BOOLEAN NOT NULL DEFAULT TRUE,
    asignado_por    INTEGER NOT NULL REFERENCES usuario(id),
    asignado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT asignacion_reubicacion_motivo CHECK (tipo = 'asignacion' OR length(btrim(coalesce(motivo, ''))) > 0)
);
CREATE UNIQUE INDEX asignacion_una_vigente_uq ON asignacion (inscripcion_id) WHERE vigente;

CREATE TABLE evaluacion (
    id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asignacion_id   INTEGER NOT NULL REFERENCES asignacion(id) ON DELETE RESTRICT,
    valoracion      VARCHAR(10) NOT NULL CHECK (valoracion IN ('muy bueno', 'bueno', 'regular', 'malo', 'muy malo')),
    fecha           DATE    NOT NULL,
    observaciones   TEXT,
    registrada_por  INTEGER NOT NULL REFERENCES usuario(id),
    registrada_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- M01. Correcciones de datos y bitácora
-- ---------------------------------------------------------------------
CREATE TABLE solicitud_correccion (
    id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    estudiante_id    INTEGER NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
    campo            VARCHAR(12) NOT NULL CHECK (campo IN ('cedula', 'nombres', 'apellidos', 'carrera')),
    valor_anterior   TEXT NOT NULL,
    valor_nuevo      TEXT NOT NULL,
    estado           VARCHAR(10) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
    resuelta_por     INTEGER REFERENCES usuario(id),
    creada_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
    resuelta_en      TIMESTAMPTZ
);

CREATE TABLE bitacora (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id  INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
    accion      VARCHAR(30) NOT NULL,
    entidad     VARCHAR(40) NOT NULL,
    entidad_id  INTEGER,
    detalle     TEXT,
    fecha       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bitacora_fecha_idx ON bitacora (fecha DESC);
