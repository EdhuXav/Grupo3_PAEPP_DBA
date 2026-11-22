-- =====================================================================
-- Datos de demostración (catálogos). Reemplazar por los datos reales de
-- la universidad cuando estén disponibles.
-- Los usuarios iniciales se crean con:  npm run db:seed-usuarios
-- (la contraseña se almacena cifrada, por eso no se inserta desde SQL).
-- =====================================================================

INSERT INTO facultad (nombre) VALUES
    ('Facultad de Ciencias de la Computación'),
    ('Facultad de Ciencias de la Ingeniería');

INSERT INTO carrera (facultad_id, nombre, min_asignaturas)
SELECT f.id, c.nombre, c.minimo
FROM (VALUES
    ('Facultad de Ciencias de la Computación', 'Ingeniería de Software', 30),
    ('Facultad de Ciencias de la Ingeniería',  'Arquitectura',            35)
) AS c(facultad, nombre, minimo)
JOIN facultad f ON f.nombre = c.facultad;

INSERT INTO periodo (nombre, fecha_inicio, fecha_fin, estado) VALUES
    ('2026-1', '2026-05-01', '2026-10-31', 'cerrado'),
    ('2026-2', '2026-11-01', '2027-04-30', 'activo');

INSERT INTO empresa (nombre, ruc, ciudad, sector, telefono, correo_contacto, responsable_laboral) VALUES
    ('Constructora Andina S.A.',   '1790012345001', 'Quevedo',  'Centro',     '052750000', 'rrhh@andina.example',  'Marta Zambrano'),
    ('Soluciones Digitales Cía.',  '1790098765001', 'Quevedo',  'La Primavera','052751111', 'talento@sdigital.example', 'Luis Mora'),
    ('Estudio Habitar Arquitectos','0991234567001', 'Guayaquil','Urdesa',     '042300000', 'info@habitar.example',   'Paola Vera');
