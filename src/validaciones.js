'use strict';

// Cédula ecuatoriana: 10 dígitos, provincia 01-24 o 30, tercer dígito < 6 y dígito verificador (módulo 10).
function cedulaValida(c) {
  if (!/^\d{10}$/.test(c)) return false;
  const provincia = parseInt(c.slice(0, 2), 10);
  if (!((provincia >= 1 && provincia <= 24) || provincia === 30)) return false;
  if (parseInt(c[2], 10) >= 6) return false;
  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let v = parseInt(c[i], 10) * (i % 2 === 0 ? 2 : 1);
    if (v > 9) v -= 9;
    suma += v;
  }
  const verificador = (10 - (suma % 10)) % 10;
  return verificador === parseInt(c[9], 10);
}

const correoValido = (c) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c) && c.length <= 120;
const nombreValido = (n) => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .-]{1,79}$/.test(n);
const rucValido = (r) => /^\d{13}$/.test(r);
const textoLimpio = (t) => (t == null ? '' : String(t).replace(/\s+/g, ' ').trim());
const enteroPositivo = (v) => /^\d+$/.test(String(v)) && parseInt(v, 10) > 0;
const fechaValida = (f) => /^\d{4}-\d{2}-\d{2}$/.test(f) && !Number.isNaN(Date.parse(f));
const fechaHoraValida = (f) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(f) && !Number.isNaN(Date.parse(f));

module.exports = {
  cedulaValida, correoValido, nombreValido, rucValido, textoLimpio,
  enteroPositivo, fechaValida, fechaHoraValida,
};
