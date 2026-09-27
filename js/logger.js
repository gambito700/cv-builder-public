/**
 * LOGGER.JS - Sistema de diagnostico del cliente
 * Reemplaza el api-test.log del backend: ahora ves que pasa EN el navegador.
 *
 * REGLA CRITICA: este logger NUNCA escribe datos personales.
 * Solo formas (cantidades, indices, flags, bytes), nunca contenidos.
 * Ver PRUEBA DE PRIVACIDAD al final del archivo.
 */
(function () {
  'use strict';

  const NIVELES = { debug: 10, info: 20, warn: 30, error: 40 };
  const MAX_BUFFER = 300;
  const buffer = [];
  let nivelActual = 'info';

  // ?debug=1 activa todo. ?log=warn deja solo avisos y errores.
  const q = new URLSearchParams(location.search);
  if (q.get('debug')) nivelActual = 'debug';
  else if (q.has('log') && NIVELES[q.get('log')]) nivelActual = q.get('log');

  function ts() {
    const d = new Date();
    const p = (n, w) => String(n).padStart(w || 2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
  }

  function safeJson(o) {
    if (o === undefined) return '';
    try { return JSON.stringify(o); } catch (_) { return '[unserializable]'; }
  }

  function emitir(nivel, msg, ctx) {
    try {
      if (NIVELES[nivel] < NIVELES[nivelActual]) return;
      const linea = '[' + ts() + '] ' + nivel.toUpperCase().padEnd(5) + ' ' + msg + (ctx ? ' ' + safeJson(ctx) : '');
      buffer.push(linea);
      if (buffer.length > MAX_BUFFER) buffer.shift();
      const color = { debug: '#888', info: '#3a7', warn: '#c90', error: '#d33' }[nivel];
      console.log('%c[CV]%c ' + msg, 'color:' + color + ';font-weight:bold', '', ctx === undefined ? '' : ctx);
    } catch (_) {
      // Un logger nunca debe romper la app.
    }
  }

  window.LOG = {
    setLevel: function (n) { if (NIVELES[n]) { nivelActual = n; this.info('nivel de log cambiado', { nivel: n }); } },
    getLevel: function () { return nivelActual; },
    debug: function (m, c) { emitir('debug', m, c); },
    info:  function (m, c) { emitir('info',  m, c); },
    warn:  function (m, c) { emitir('warn',  m, c); },
    error: function (m, e) { emitir('error', m, e && e.message ? { error: e.message } : e); },
    history: function () { return buffer.slice(); },
    clear: function () { buffer.length = 0; },

    /** Descarga cv-builder-log.txt para reportar un bug. */
    exportar: function () {
      const cab = [
        'cv-builder diagnostico',
        'nivel=' + nivelActual,
        'generado=' + new Date().toISOString(),
        'userAgent=' + navigator.userAgent,
        'pantalla=' + window.innerWidth + 'x' + window.innerHeight,
        '-'.repeat(60),
      ];
      const txt = cab.concat(buffer).join('\n');
      const url = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cv-builder-log.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return buffer.length;
    },
  };

  // --- PRUEBA DE PRIVACIDAD -------------------------------------------------
  // Esta lista es de CAMPOS, no de una persona: son nombres de clave que
  // identifican a alguien por forma (nombre, documento, contacto, domicilio,
  // fecha). Si logueaste un campo de esta lista, esto te avisa en la consola.
  // Se compara contra k.toLowerCase(), o sea contra la CLAVE del objeto que le
  // pasaste a LOG.debug, no contra el valor: por eso todo va en minusculas y sin
  // camelCase (estadoCivil llega como "estadocivil", fechaNacimiento como
  // "fechanacimiento").
  // Lo que NO va aqui, y por diseno: valores que dependen de la persona
  // (nombres propios, correos, dominios, '@gmail', rut concreto). Eso no se puede
  // matchear por clave, haria falta cambiar el mecanismo, y el mecanismo es
  // correcto: el logger no deberia recibir esos valores nunca.
  // Cuando cambie el modelo de datos de DEFAULT_DATA y aparezca un campo nuevo
  // identificable (telefonoAlternativo, rutEmpresa, domicilioLegal, ...),
  // agregalo aqui en minusculas y sin camel.
  const PII = [
    // identidad
    'nombre', 'nombres', 'apellido', 'apellidos', 'nombrecompleto',
    // identificadores
    'rut', 'run',
    // contacto
    'email', 'correo', 'telefono', 'celular', 'fono', 'movil',
    // domicilio
    'direccion', 'domicilio', 'comuna',
    // fechas y estado civil
    'nacimiento', 'fechanacimiento', 'edad', 'estadocivil'
  ];
  const _debug = window.LOG.debug;
  window.LOG.debug = function (m, c) {
    if (c && typeof c === 'object') {
      Object.keys(c).forEach(function (k) {
        if (PII.indexOf(k.toLowerCase()) !== -1) {
          console.warn('[CV][PII] El logger no debe registrar el campo "' + k + '". Usa la forma, no el valor.');
        }
      });
    }
    return _debug.call(this, m, c);
  };
  // -------------------------------------------------------------------------

  emitir('info', 'logger listo', { nivel: nivelActual });
})();