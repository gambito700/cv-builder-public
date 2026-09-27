/**
 * LATEX-SERVICE.JS — Conector cv-builder-public -> cv-builder-api
 * =========================================================================
 * Envia el .tex que genera js/generator.js a la API de Render y recibe el PDF
 * ya compilado. Es un CAMINO NUEVO: no reemplaza ni toca el PDF local de jsPDF
 * (js/pdfgen.js, via js/results.js) ni la descarga del .tex. Son tres funciones
 * distintas y conviven.
 *
 * Uso desde js/results.js:
 *   await pingApi();                                    // al mostrar resultados
 *   var blob = await compilarLatex(tex, "creativo");    // devuelve un Blob PDF
 *   descargarBlob(blob, "cv-api-plantilla-2.pdf");
 *
 * CONTRATO DE LA API (leido de cv-builder-api/app.py, no de memoria)
 *   GET  /health   -> 200 JSON. Sirve para despertar el free tier.
 *   POST /compile  -> header X-API-Key, cuerpo {tex, template}
 *                      200  PDF crudo (res.blob(), NO viene envuelto en JSON)
 *                      400  el .tex no sirve ("no parece un documento LaTeX", ...)
 *                      401  X-API-Key invalido
 *                      413  .tex > MAX_TEX_BYTES (200 KB por defecto)
 *                      422  La compilacion fallo (error de LaTeX)
 *                      429  rate limit ("Demasiadas peticiones")
 *                      503  "Servidor ocupado" o "falta API_KEY"
 *                      504  la compilacion se paso de tiempo en el servidor
 *   Todos los errores del servidor vienen como { "error": "...", "id": "..." }.
 * -------------------------------------------------------------------------
 */

/* ==========================================================================
 * 1. CONFIGURACION — ACA SE TOCA UNA VEZ, Y SOLO DESPUES DEL PRIMER DEPLOY
 * ==========================================================================
 *
 * CV_API_URL
 *   Hostname REAL que asigno Render: https://cv-builder-api-lw51.onrender.com
 *   El nombre del repo no sirvio (cv-builder-api ya estaba ocupado en Render y
 *   por ahi sale el sufijo -lw51), asi que el valor se leyo del dashboard, no
 *   se supusio. Si el servicio se renombra, hay que leer el hostname otra vez.
 *
 *   Se puede sobreescribir sin editar este archivo: poner
 *   data-cv-api-url="https://..." en el <body> de index.html (o en el <script>
 *   que carga este archivo). El atributo gana.
 *
 * CV_API_KEY
 *   La API exige el header X-API-Key (app.py:476). Como este frontend es
 *   publico, el valor queda a la vista en el JS de cualquiera que abra la
 *   pagina: NO ES UN SECRETO y no se puede convertir en uno desde aqui.
 *   Es una BARRERA SUAVE contra el uso casual y los bots de a pie, no contra
 *   alguien decidido; la barrera de verdad esta en el rate limit por token
 *   bucket del servidor (app.py:159) y en que el servicio solo compile CVs
 *   ajenos a costa del dueno de la API. Que la clave viva en el repo es un
 *   riesgo aceptado, no un descuido: vaciarla aqui solo haria fallar el boton.
 *
 *   Misma regla que la URL: se puede sobreescribir con data-cv-api-key="..."
 *   en index.html. Al rotarla hay que cambiarla en los dos sitios, Render
 *   (Environment) y aqui, o el servidor respondera 401.
 *
 * CV_URL_PENDIENTE
 *   Bandera de una linea, no un valor. While true el boton se renderiza
 *   deshabilitado y la UI explica que falta configurar. Va en false porque el
 *   servicio esta desplegado y verificado: GET /health responde 200 con
 *   auth=ok y sandbox=ok, y POST /compile devolvio un PDF valido.
 *   Es una bandera y no una comparacion de valores a proposito: si la
 *   comprobacion fuera "el sigue siendo el placeholder?", al pegar la URL real
 *   compararia la URL consigo misma, apiConfigurada() devolveria false para
 *   siempre y el boton quedaria deshabilitado con el hostname perfecto.
 */
const CV_API_URL = 'https://cv-builder-api-lw51.onrender.com';
const CV_URL_PENDIENTE = false;
const CV_API_KEY = 'HzfjFpjJoF5LTZtzSOzR-tysXPJwXTLhd1JRUqL-2D0';

/* Tope de espera del cliente. El servidor corta la compilacion a los 30 s x 2
   pasadas = 60 s (COMPILE_TIMEOUT_SECONDS x LATEX_PASSES en app.py:86), mas el
   arranque en frio del free tier, que puede ser otro minuto entero. 90 s deja
   margen; si el servicio va mas lento que eso ya es un fallo, no una espera. */
const CV_API_TIMEOUT_MS = 90000;

/* El ping de /health es mucho mas corto: si en 8 s no respondio nadie, o esta
   dormida o no existe. No hace falta esperar mas para saberlo. */
const CV_PING_TIMEOUT_MS = 8000;

/**
 * Estado del conector, para que la UI pueda ser honesta en vez de adivinar.
 * Se actualiza solo con lo que responden los pings y las compilaciones:
 *   'sin-configurar' -> falta URL real o falta API key: el boton no se ofrece
 *   'dormida'        -> el ultimo intento no pudo ni conectarse
 *   'despertando'     -> un ping esta en vuelo (free tier despertando)
 *   'lista'          -> respondio /health
 */
var LATEX_SERVICE = {
  estado: 'sin-configurar',
  url: '',
  ultimoError: null
};

/* ==========================================================================
 * 2. LECTURA DE LA CONFIGURACION
 * ========================================================================== */

/**
 * Valor de un atributo data- en el DOM, si el documento existe (este archivo
 * tambien se carga en pruebas de Node, donde no hay document).
 * @param {string} nombre  sin el prefijo 'data-'
 * @param {string} [en]    selector donde buscar; por defecto body y el script
 * @returns {string} cadena vacia si no esta
 */
function _datoConfig(nombre, en) {
  if (typeof document === 'undefined') return '';
  var selectores = [en, 'body', 'script[data-cv-api-url], script[data-cv-api-key]'];
  for (var i = 0; i < selectores.length; i++) {
    var sel = selectores[i];
    if (!sel) continue;
    var el;
    try { el = document.querySelector(sel); } catch (_e) { continue; }
    if (el) {
      var v = el.getAttribute('data-' + nombre);
      if (v !== null && v !== undefined && v !== '') return v;
    }
  }
  return '';
}

/**
 * URL base de la API, sin barra final.
 * @returns {string}
 */
function cvApiUrl() {
  var url = _datoConfig('cv-api-url') || CV_API_URL;
  return String(url).replace(/\/+$/, '');
}

/**
 * Clave de la API, leida del atributo data- si esta, si no de la constante.
 * @returns {string}
 */
function cvApiKey() {
  return _datoConfig('cv-api-key') || CV_API_KEY || '';
}

/**
 * El conector esta listo para usarse de verdad. Son dos cosas, y las dos
 * hacen falta:
 *   1) una URL que sea deliberada. O esta CV_URL_PENDIENTE en false, o hay
 *      un data-cv-api-url en index.html (poner el atributo ya ES la decision,
 *      asi que no hace falta tocar el archivo).
 *   2) una API key no vacia.
 * @returns {boolean}
 */
function apiConfigurada() {
  var hayClave = cvApiKey().length > 0;
  if (!hayClave) return false;
  if (_datoConfig('cv-api-url')) return true;
  return CV_URL_PENDIENTE === false;
}

/* ==========================================================================
 * 3. ERRORES CON CODIGO
 *    El mensaje para el usuario se arma desde el codigo, no desde el texto
 *    crudo de fetch o de Flask (ver apiMensajeError, en js/results.js).
 * ========================================================================== */

/**
 * Error de dominio con codigo propio.
 * @param {string} codigo   API_CONFIG | API_DORMIDA | API_TIMEOUT | API_LIMITE
 *                          | API_NO_AUTH | API_OCUPADO | API_COMPILACION
 *                          | API_HTTP | API_RED
 * @param {string} mensaje  detalle tecnico, para el log (NO para el usuario)
 * @param {number} [estado] status HTTP, si lo hubo
 * @returns {Error}
 */
function cvApiError(codigo, mensaje, estado) {
  var e = new Error(mensaje || codigo);
  e.codigoApi = codigo;
  if (typeof estado === 'number') e.estado = estado;
  return e;
}

/* ==========================================================================
 * 4. TIMEOUT SIN AbortSignal.timeout
 *    AbortSignal.timeout() no existe en Safari anterior a 16.4, y la app tiene
 *    que andar en un navegador mainstream comun. Se hace a mano con
 * AbortController + setTimeout, que existen mucho antes. El timer se limpia
 * SIEMPRE, en el finally: si no queda pendiente, el unload se retrasa y en
 * algunos navegadores ademas se acumula un timer por cada peticion.
 * ========================================================================== */

/**
 * Hacer un fetch con tope de tiempo, sin depender de AbortSignal.timeout.
 * @param {string}   url
 * @param {Object}   [opciones]  opciones de fetch; no puede traer 'signal'
 * @param {number}   ms          tope en milisegundos
 * @returns {Promise<Response>}  rejects con codigoApi API_TIMEOUT si se agota
 */
async function fetchConTimeout(url, opciones, ms) {
  var ctrl = new AbortController();
  var expirado = false;
  var temporizador = setTimeout(function () {
    expirado = true;
    ctrl.abort();
  }, ms);

  try {
    return await fetch(url, Object.assign({}, opciones || {}, { signal: ctrl.signal }));
  } catch (err) {
    if (expirado) {
      throw cvApiError('API_TIMEOUT', 'timeout de ' + ms + ' ms contra ' + url);
    }
    /* AbortError sin que sea nuestro temporizador: cancelacion externa. */
    if (err && err.name === 'AbortError') throw err;
    /* TypeError aqui es lo que tira el navegador cuando no hay red, el host no
       existe, el DNS falla, o la conexion TLS se corta. En un servicio de
       Render en free tier lo mas probable es que este DORMIDO todavia. */
    throw cvApiError('API_DORMIDA',
      'fetch fallo contra ' + url + ': ' + String((err && err.message) || err));
  } finally {
    clearTimeout(temporizador);
  }
}

/* ==========================================================================
 * 5. PING: despertar el free tier
 * ========================================================================== */

/**
 * Ping silencioso a /health. Se llama al MOSTRAR la pantalla de resultados,
 * antes de que el usuario haga clic, porque el free tier de Render duerme a
 * los ~15 min y puede tardar medio minuto en volver.
 *
 * No lanza: un fallo aqui es informacion, no un error. Actualiza
 * LATEX_SERVICE.estado para que la UI pueda avisar.
 * @returns {Promise<boolean>} true si respondio
 */
async function pingApi() {
  if (!apiConfigurada()) {
    LATEX_SERVICE.estado = 'sin-configurar';
    return false;
  }

  var url = cvApiUrl() + '/health';
  LATEX_SERVICE.estado = 'despertando';
  LATEX_SERVICE.url = url;

  try {
    var res = await fetchConTimeout(url, { method: 'GET', cache: 'no-store' }, CV_PING_TIMEOUT_MS);
    /* Un 503 de /health tambien es "hay alguien ahi" (la API vive pero sin
       API_KEY). Lo que importa para despertar es que hubo respuesta. */
    if (res.status === 200 || res.status === 503) {
      LATEX_SERVICE.estado = 'lista';
      return true;
    }
    LATEX_SERVICE.estado = 'dormida';
    return false;
  } catch (err) {
    LATEX_SERVICE.ultimoError = err && err.codigoApi ? err.codigoApi : 'PING';
    LATEX_SERVICE.estado = 'dormida';
    return false;
  }
}

/* ==========================================================================
 * 6. COMPILAR
 * ========================================================================== */

/**
 * Traducir un status + cuerpo de error a un codigo de dominio.
 *
 * La distincion importante es JSON vs no-JSON: la API responde JSON
 * {error, id} (app.py:468 y siguientes), mientras que el gateway de Render
 * responde texto plano o HTML cuando el servicio no esta despierto. Si el
 * cuerpo no es JSON de nuestra API, no es un error de compilacion: es la
 * instancia dormida.
 *
 * @param {number} estado
 * @param {string|null} cuerpoMsg  mensaje del campo 'error', si vino
 * @param {boolean} esJson         el cuerpo se pudo parsear como JSON nuestro
 * @returns {string} codigo de dominio
 */
function cvApiCodigoDesdeEstado(estado, cuerpoMsg, esJson) {
  if (!esJson) {
    /* 502/503/504 de una capa que no es la API = Render despertando. */
    return 'API_DORMIDA';
  }
  var msg = String(cuerpoMsg || '');

  if (estado === 429) return 'API_LIMITE';
  if (estado === 401) return 'API_NO_AUTH';
  /* 503 con dos significados distintos en app.py: "falta API_KEY" (el servidor
     esta mal configurado, no es culpa de quien usa la pagina) y "Servidor ocupado"
     (hay que reintentar). Se separan por el texto porque el status es el mismo. */
  if (estado === 503) return /API_KEY/i.test(msg) ? 'API_CONFIG' : 'API_OCUPADO';
  /* El .tex que no sirve (400/413) y el que LaTeX no pudo compilar (422/504)
     son el mismo problema desde el punto de vista de quien lo pide: su CV. */
  if (estado === 400 || estado === 413 || estado === 422 || estado === 504) {
    return 'API_COMPILACION';
  }
  return 'API_HTTP';
}

/**
 * Compila un .tex en la API y devuelve un Blob con el PDF.
 *
 * @param {string} texString   contenido completo del .tex
 * @param {string} [template]  'moderno' | 'creativo' | 'clasico' (solo logs)
 * @returns {Promise<Blob>}
 * @throws {Error} con codigoApi: API_CONFIG | API_DORMIDA | API_TIMEOUT |
 *                 API_LIMITE | API_NO_AUTH | API_OCUPADO | API_COMPILACION |
 *                 API_HTTP | API_RED
 */
async function compilarLatex(texString, template) {
  if (!apiConfigurada()) {
    throw cvApiError('API_CONFIG',
      'la API no esta configurada (falta URL real o API key)');
  }
  if (typeof texString !== 'string' || texString.trim() === '') {
    /* Falla acá y no en la API: un .tex vacio no es un fallo del servidor y
       la API lo rebotaria con 400 sin explicar nada. */
    throw cvApiError('API_COMPILACION', 'el .tex esta vacio');
  }

  var url = cvApiUrl() + '/compile';
  var cabeceras = {
    'Content-Type': 'application/json',
    'X-API-Key': cvApiKey()
  };

  var res;
  try {
    res = await fetchConTimeout(url, {
      method: 'POST',
      headers: cabeceras,
      body: JSON.stringify({ tex: texString, template: template || 'desconocido' })
    }, CV_API_TIMEOUT_MS);
  } catch (err) {
    if (err && err.codigoApi) throw err;
    throw cvApiError('API_RED', String((err && err.message) || err));
  }

  if (!res.ok) {
    var cuerpoMsg = null;
    var esJson = false;
    try {
      var cuerpo = await res.json();
      if (cuerpo && typeof cuerpo.error === 'string') {
        cuerpoMsg = cuerpo.error;
        esJson = true;
      }
    } catch (_e) {
      /* No es JSON. Casi siempre es la pagina de error del gateway. */
      esJson = false;
    }
    var codigo = cvApiCodigoDesdeEstado(res.status, cuerpoMsg, esJson);
    throw cvApiError(codigo,
      'HTTP ' + res.status + (cuerpoMsg ? ': ' + cuerpoMsg : ''), res.status);
  }

  /* Firma de PDF: si lo que volvio no empieza con %PDF-, no es un PDF. Pasa
     cuando un proxy devuelve HTML con status 200. */
  var blob = await res.blob();
  var cabecera = await blob.slice(0, 5).text();
  if (cabecera !== '%PDF-') {
    throw cvApiError('API_COMPILACION',
      'la respuesta 200 no es un PDF (empieza con ' + JSON.stringify(cabecera) + ')',
      res.status);
  }
  return blob;
}

/* ==========================================================================
 * 7. DESCARGA
 * ========================================================================== */

/**
 * Descarga un Blob como archivo.
 *
 * El revoke va con retardo a proposito: si se llama a URL.revokeObjectURL(url)
 * justo despues de a.click(), hay navegadores que interpretan la descarga
 * como cancelada y no escriben nada. Un timeout largo deja terminar la lectura
 * del blob con holgura.
 *
 * @param {Blob}   blob
 * @param {string} nombre  nombre del archivo, ej. 'cv-api-plantilla-2.pdf'
 */
function descargarBlob(blob, nombre) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    if (a.parentNode) a.parentNode.removeChild(a);
    URL.revokeObjectURL(url);
  }, 4000);
}
