// Validación en tiempo real del formulario de registro (RF-01).
(function () {
  var form = document.getElementById('form-registro');
  if (!form) return;

  function mostrar(campo, mensaje) {
    var salida = form.querySelector('[data-error-para="' + campo.name + '"]');
    if (salida) salida.textContent = mensaje || '';
    campo.classList.toggle('invalido', !!mensaje);
    campo.classList.toggle('valido', !mensaje && campo.value !== '');
  }

  function validarLocal(campo) {
    if (campo.dataset.requerido && campo.value.trim() === '') return campo.dataset.requerido;
    if (campo.name === 'password' && campo.value.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
    if (campo.name === 'password2' && campo.value !== form.elements.password.value) return 'Las contraseñas no coinciden.';
    return '';
  }

  function validarRemoto(campo) {
    var url = '/api/validar?campo=' + encodeURIComponent(campo.dataset.validar) + '&valor=' + encodeURIComponent(campo.value.trim());
    return fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (d) { mostrar(campo, d.valido ? '' : d.mensaje); return d.valido; })
      .catch(function () { mostrar(campo, ''); return true; });
  }

  Array.prototype.forEach.call(form.elements, function (campo) {
    if (!campo.name) return;
    campo.addEventListener('blur', function () {
      if (campo.dataset.validar) return validarRemoto(campo);
      mostrar(campo, validarLocal(campo));
    });
  });

  form.addEventListener('submit', function (ev) {
    var hayError = false;
    Array.prototype.forEach.call(form.elements, function (campo) {
      if (!campo.name || campo.dataset.validar) return;
      var m = validarLocal(campo);
      mostrar(campo, m);
      if (m) hayError = true;
    });
    if (hayError) ev.preventDefault();
    // La cédula y el correo también se validan en el servidor al enviar.
  });
})();
