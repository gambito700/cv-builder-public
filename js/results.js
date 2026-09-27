/**
 * RESULTS.JS - Funciones de resultados: descarga, copia, modales
 */

let modalTrigger = null;
let _isCompilingAllPdf = false;

function trapFocus(modal) {
  const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  modal.addEventListener('keydown', function handler(e) {
    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    if (e.key === 'Escape') {
      closeModal();
      modal.removeEventListener('keydown', handler);
    }
  });
  first.focus();
}

/**
 * Mostrar codigo LaTeX en modal
 */
function showLatexCode(templateIndex) {
  const templates = window._generatedTemplates;
  if (!templates || !templates[templateIndex]) return;

  const tex = templates[templateIndex].tex;
  const name = templates[templateIndex].name;

  const overlay = document.getElementById('modal-overlay');
  const modal = document.getElementById('modal-content');

  modal.innerHTML = `
    <button class="modal-close" onclick="closeModal()" aria-label="Cerrar">&times;</button>
    <h3 style="margin-bottom: var(--space-4);">${name}</h3>
    <p style="margin-bottom: var(--space-4); color: #666;">
      Código LaTeX completo. Copia este código y pégalo en un editor LaTeX.
    </p>
    <div class="latex-code" id="latex-code-block">${escapeHtml(tex)}</div>
    <div style="margin-top: var(--space-4); display: flex; gap: var(--space-3); flex-wrap: wrap;">
      <button class="btn btn--primary" onclick="copyLatexCode(${templateIndex})">
        Copiar Código
      </button>
      <button class="btn" onclick="downloadTex(${templateIndex})">
        Descargar .tex
      </button>
      <button class="btn" onclick="closeModal()">
        Cerrar
      </button>
    </div>
  `;

  modalTrigger = document.activeElement;
  overlay.classList.add('active');
  trapFocus(modal);

  // Cerrar con Escape
  document.addEventListener('keydown', handleModalEscape);
}

/**
 * Manejar tecla Escape para cerrar modal
 */
function handleModalEscape(e) {
  if (e.key === 'Escape') closeModal();
}

/**
 * Cerrar modal al hacer click fuera del contenido
 */
document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      // Solo cerrar si el click fue en el overlay, no en el modal interno
      if (e.target === overlay) {
        closeModal();
      }
    });
  }
});

/**
 * Cerrar modal
 */
function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('active');
  document.removeEventListener('keydown', handleModalEscape);
  if (modalTrigger) {
    modalTrigger.focus();
    modalTrigger = null;
  }
}

/**
 * Copiar codigo LaTeX al portapapeles
 */
function copyLatexCode(templateIndex) {
  const templates = window._generatedTemplates;
  if (!templates || !templates[templateIndex]) return;

  const tex = templates[templateIndex].tex;

  navigator.clipboard.writeText(tex).then(() => {
    showToast('Código copiado al portapapeles', 'success');
  }).catch(() => {
    // Fallback para navegadores viejos
    const textarea = document.createElement('textarea');
    textarea.value = tex;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      showToast('Código copiado al portapapeles', 'success');
    } catch (err) {
      showToast('Error al copiar. Intenta seleccionar manualmente.', 'error');
    }
    document.body.removeChild(textarea);
  });
}

/**
 * Descargar archivo .tex
 */
function downloadTex(templateIndex) {
  const templates = window._generatedTemplates;
  if (!templates || !templates[templateIndex]) return;

  const tpl = templates[templateIndex];
  const userName = (window.wizard && window.wizard.data && window.wizard.data.personal && window.wizard.data.personal.nombre) || 'CV';
  const filename = `CV_${sanitizeFilename(userName)}_${sanitizeFilename(tpl.name)}.tex`;

  const blob = new Blob([tpl.tex], { type: 'application/x-tex;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);

  showToast(`Descargado: ${filename}`, 'success');
}

/**
 * Descargar CV como PDF desde el propio navegador
 * ---------------------------------------------------------------
 * El PDF lo arma js/pdfgen.js (jsPDF) en el cliente. La version anterior de
 * esta funcion pegaba a un backend de compilacion (pdfService.compile contra
 * localhost:3000) que no existe en este repo: fallaba con ReferenceError y el
 * unico rastro era un toast. Ahora el flujo es: motor -> bytes -> Blob ->
 * descarga, con estados honestos y un mensaje accesible si algo falla.
 */

/* Card del wizard (indice de generateAllTemplates, en js/generator.js) -> id de
   plantilla del motor (TEMPLATES, en js/pdfgen.js). Los dos ordenes NO coinciden:

     card 0 "Moderno Limpio"       -> motor '1'  Moderno y Limpio  (banda lateral)
     card 1 "Creativo"             -> motor '3'  Ejecutivo         (cajas de color)
     card 2 "Profesional Clásico"   -> motor '2'  Profesional Clásico (una columna)

   El mapa es explicito: si el motor cambia de ids, hay que tocarlo aca y se ve.
   `atsSeguro` es solo la copia local del metadato del motor para cuando el
   motor no cargo; con el motor presente manda PDFGEN_PLANTILLAS. */
var PDF_PLANTILLAS_POR_CARD = [
  { id: '1', nombre: 'Moderno y Limpio',    atsSeguro: false },
  { id: '3', nombre: 'Ejecutivo',           atsSeguro: false },
  { id: '2', nombre: 'Profesional Clásico', atsSeguro: true }
];

/**
 * Datos del CV para el motor: los del wizard (ya guardados en localStorage al
 * cambiar de paso) y, si todavia no existe, los de localStorage via loadData().
 */
function pdfDatosActuales() {
  if (window.wizard && window.wizard.data) return window.wizard.data;
  return loadData();
}

/**
 * Configuracion de una card: que plantilla del motor le toca y si es ATS-safe.
 * La respuesta de seguridad sale del motor cuando esta disponible, para que
 * la nota de la UI no pueda mentir si el motor cambia.
 */
function pdfConfigDeCard(cardIndex) {
  var cfg = PDF_PLANTILLAS_POR_CARD[cardIndex];
  if (!cfg) return null;
  var motor = window.PDFGEN_PLANTILLAS && window.PDFGEN_PLANTILLAS[cfg.id];
  if (!motor) return cfg;
  return {
    id: cfg.id,
    nombre: motor.nombre || cfg.nombre,
    atsSeguro: !!(motor.ats && motor.ats.seguro)
  };
}

/**
 * El motor de PDF responde? (puede faltar si el script vendorizado no cargo o
 * si el navegador lo bloqueo)
 */
function pdfMotorDisponible() {
  return typeof window.generarPDFCvOutput === 'function'
    || typeof window.generarPDFCv === 'function';
}

/**
 * Nombre del archivo: solo el id de plantilla. Sin nombre, RUT, email ni
 * telefono (el RUT es dato personal bajo la Ley 21.719, y un nombre de archivo
 * viaja en logs, historial y capturas de pantalla).
 */
function pdfNombreArchivo(plantillaId) {
  return 'cv-plantilla-' + plantillaId + '.pdf';
}

/**
 * Nota tecnica honesta de cada plantilla. No bloquea nada: la 1 y la 3 igual
 * generan un PDF real, solo que su diseno no sobrevive a un parser de ATS.
 */
function pdfNotaAts(cfg) {
  return cfg.atsSeguro ? 'Compatible con ATS' : 'Diseño visual, no compatible con ATS';
}

/**
 * Markup de la accion "Descargar PDF" de una card: un <button> de verdad
 * (con type, no un div con onclick), su spinner, la nota y una region
 * aria-live para exito o error. El id btn-pdf-N lo usa la guia (js/tutorial.js).
 */
function pdfAccionesHtml(cardIndex) {
  var cfg = pdfConfigDeCard(cardIndex);
  if (!cfg) return '';
  var hayMotor = pdfMotorDisponible();
  var nota = hayMotor
    ? pdfNotaAts(cfg)
    : 'PDF no disponible en este navegador: recarga la página o usa "Descargar PDF LaTeX".';

  return `
          <button class="btn btn--pdf" type="button" id="btn-pdf-${cardIndex}"
                  onclick="descargarPdfPlantilla(${cardIndex})"
                  aria-describedby="tpl-nombre-${cardIndex} pdf-note-${cardIndex} pdf-msg-${cardIndex}"
                  ${hayMotor ? '' : 'aria-disabled="true"'}
                  title="Se genera en tu navegador, al instante y sin instalar nada">
            <span class="btn-spinner" id="btn-pdf-spinner-${cardIndex}" hidden aria-hidden="true"></span>
            <span class="btn-pdf-label" id="btn-pdf-label-${cardIndex}">Descargar PDF</span>
          </button>
          <p class="pdf-note" id="pdf-note-${cardIndex}"
             data-tone="${hayMotor ? (cfg.atsSeguro ? 'ats' : 'visual') : 'warn'}">${nota}</p>
          <p class="pdf-msg" id="pdf-msg-${cardIndex}" role="status" aria-live="polite"></p>`;
}

/**
 * Estado visual del boton: normal, cargando o de vuelta a normal.
 * El texto cambia y aria-busy avisa; el llamador siempre pasa por el finally.
 */
function pdfEstadoBoton(cardIndex, estado) {
  var btn = document.getElementById('btn-pdf-' + cardIndex);
  var label = document.getElementById('btn-pdf-label-' + cardIndex);
  var spinner = document.getElementById('btn-pdf-spinner-' + cardIndex);
  var cargando = estado === 'loading';

  if (btn) {
    btn.disabled = cargando;
    if (cargando) {
      btn.setAttribute('aria-busy', 'true');
      btn.classList.add('btn--loading');
    } else {
      btn.removeAttribute('aria-busy');
      btn.classList.remove('btn--loading');
    }
  }
  if (label) label.textContent = cargando ? 'Generando PDF...' : 'Descargar PDF';
  if (spinner) spinner.hidden = !cargando;
}

/**
 * Mensaje de exito o error junto al boton (region aria-live). Vacio = nada.
 */
function pdfMensaje(cardIndex, texto, tono) {
  var el = document.getElementById('pdf-msg-' + cardIndex);
  if (!el) return;
  if (!texto) {
    el.textContent = '';
    el.removeAttribute('data-tone');
    return;
  }
  el.textContent = texto;
  el.setAttribute('data-tone', tono || 'ok');
}

/**
 * Error con codigo propio: el mensaje para el usuario se arma desde el
 * codigo, no desde el texto crudo de la libreria.
 */
function pdfError(codigo, mensaje) {
  var e = new Error(mensaje);
  e.codigoPdf = codigo;
  return e;
}

/**
 * Traducir el fallo a algo que el usuario pueda entender y reintentar.
 */
function pdfMensajeError(err) {
  var codigo = err && err.codigoPdf;
  var crudo = String((err && err.message) || err || '');

  if (codigo === 'PDF_MOTOR' || crudo.indexOf('jsPDF no esta disponible') !== -1) {
    return 'No se generó el PDF porque el motor de PDF no cargó (o el navegador lo bloqueó). Recarga la página y reintenta; si sigue igual, usa "Descargar PDF LaTeX".';
  }
  if (codigo === 'PDF_API') {
    return 'Este navegador no deja sacar el PDF (jsPDF no expone output() ni save()). Reintenta en otro navegador o usa "Descargar PDF LaTeX".';
  }
  if (codigo === 'PDF_VACIO') {
    return 'El PDF salió vacío. Revisa que tengas datos cargados y reintenta.';
  }
  if (codigo === 'PDF_FIRMA') {
    return 'El archivo generado no es un PDF válido. Reintenta o usa "Descargar PDF LaTeX".';
  }
  return 'No se generó el PDF: ' + (crudo.substring(0, 180) || 'error desconocido') + ' Reintenta.';
}

/**
 * Normalizar la salida del motor a un Blob de PDF. Acepta Blob, ArrayBuffer y
 * vistas de typed array (jsPDF devuelve ArrayBuffer con 'arraybuffer').
 */
function pdfComoBlob(salida) {
  if (typeof Blob === 'undefined') {
    throw pdfError('PDF_API', 'Blob no existe en este navegador');
  }
  if (typeof salida === 'string') {
    throw pdfError('PDF_FIRMA', 'jsPDF devolvio texto en vez de bytes');
  }
  if (salida instanceof Blob) return salida;
  if (salida instanceof ArrayBuffer) {
    return new Blob([salida], { type: 'application/pdf' });
  }
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(salida)) {
    return new Blob([salida], { type: 'application/pdf' });
  }
  return null;
}

/**
 * Disparar la descarga en el navegador. Se usa un <a download> con object URL
 * y NO doc.save(): asi el archivo se puede inspeccionar antes de bajarse. El
 * revoke va con retardo porque hay navegadores que leen el blob de forma
 * asincrona despues del click y se descarga vacio si se revoca de inmediato.
 */
function pdfDescargar(blob, nombreArchivo) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    if (a.parentNode) a.parentNode.removeChild(a);
    URL.revokeObjectURL(url);
  }, 4000);
}

/**
 * Descargar el PDF de una plantilla, en el navegador.
 * @param {number} cardIndex    Indice de la card (0, 1, 2)
 * @param {Object} [opciones]   { silencioso: true } para no duplicar toasts
 *                              (lo usa la descarga de las 3 juntas)
 * @returns {Promise<boolean>}  true si el archivo salio
 */
async function descargarPdfPlantilla(cardIndex, opciones) {
  var opts = opciones || {};
  var cfg = pdfConfigDeCard(cardIndex);
  if (!cfg) return false;

  var btn = document.getElementById('btn-pdf-' + cardIndex);
  if (btn && (btn.disabled || btn.getAttribute('aria-busy') === 'true')) {
    return false; // doble clic: el primero todavia esta generando
  }

  var nombreArchivo = pdfNombreArchivo(cfg.id);

  pdfEstadoBoton(cardIndex, 'loading');
  pdfMensaje(cardIndex, '');
  if (!opts.silencioso) {
    setCompileStatus('compiling', 'Generando el PDF...',
      cfg.nombre + ': se arma en tu navegador, sin servidor.');
  }
  // Al logger solo formas: id de plantilla, indice y bytes. Nunca el CV.
  if (window.LOG) window.LOG.info('pdf: generando', { plantilla: cfg.id, card: cardIndex });

  try {
    if (!pdfMotorDisponible()) {
      throw pdfError('PDF_MOTOR', 'el motor de PDF no esta cargado');
    }

    /* Via principal: el motor devuelve los bytes. No depende de doc.save(),
       que no existe en todas las builds de jsPDF. Si solo estuviera
       generarPDFCv, se cae a doc.output('arraybuffer'). */
    var doc = null;
    var salida;
    if (typeof window.generarPDFCvOutput === 'function') {
      salida = window.generarPDFCvOutput(pdfDatosActuales(), cfg.id, 'arraybuffer');
    } else {
      doc = window.generarPDFCv(pdfDatosActuales(), cfg.id);
      if (doc && typeof doc.output === 'function') {
        salida = doc.output('arraybuffer');
      } else if (doc && typeof doc.save === 'function') {
        // Ultimo recurso: jsPDF se descarga a si mismo.
        doc.save(nombreArchivo);
        pdfMensaje(cardIndex, 'PDF descargado: ' + nombreArchivo, 'ok');
        if (!opts.silencioso) {
          showToast('PDF descargado: ' + nombreArchivo, 'success');
          setCompileStatus('success', 'PDF listo', nombreArchivo);
        }
        if (window.LOG) window.LOG.info('pdf: descargado via save()', { plantilla: cfg.id });
        return true;
      }
    }

    var blob = pdfComoBlob(salida);
    if (!blob || blob.size < 100) {
      throw pdfError('PDF_VACIO', 'salida de ' + (blob ? blob.size : 0) + ' bytes');
    }
    // Firma de PDF: si no empieza con %PDF-, no es un PDF y no se baja.
    var cabecera = await blob.slice(0, 5).text();
    if (cabecera !== '%PDF-') {
      throw pdfError('PDF_FIRMA', 'la salida empieza con ' + JSON.stringify(cabecera));
    }

    pdfDescargar(blob, nombreArchivo);

    var kb = Math.round(blob.size / 1024);
    pdfMensaje(cardIndex, 'PDF descargado: ' + nombreArchivo + ' (' + kb + ' KB)', 'ok');
    if (!opts.silencioso) {
      showToast('PDF descargado: ' + nombreArchivo, 'success');
      setCompileStatus('success', 'PDF listo',
        nombreArchivo + ' (' + kb + ' KB). El nombre del archivo no lleva datos personales.');
    }
    if (window.LOG) {
      window.LOG.info('pdf: descargado', { plantilla: cfg.id, bytes: blob.size });
    }
    return true;

  } catch (err) {
    var mensaje = pdfMensajeError(err);
    pdfMensaje(cardIndex, mensaje, 'error');
    if (!opts.silencioso) {
      showToast('No se generó el PDF: ' + (err && err.codigoPdf ? err.codigoPdf : 'error'), 'error');
      setCompileStatus('error', 'No se generó el PDF', mensaje);
    }
    if (window.LOG) {
      window.LOG.error('pdf: fallo', {
        plantilla: cfg.id,
        codigo: (err && err.codigoPdf) || 'DESCONOCIDO'
      });
    }
    return false;

  } finally {
    // El boton vuelve a su estado pase lo que pase: nunca queda trabado en
    // "Generando PDF..." si la generacion tiro.
    pdfEstadoBoton(cardIndex, 'idle');
  }
}

/**
 * Descargar los 3 PDFs, uno por uno (sin ZIP, para no meter dependencias).
 * Reusa el mismo camino que los botones de cada card, asi que los estados y
 * los errores se ven igual.
 */
async function descargarTodosLosPdf() {
  if (_isCompilingAllPdf) return;
  _isCompilingAllPdf = true;

  var bulkBtn = document.getElementById('btn-bulk-pdf');
  var bulkLabel = document.getElementById('btn-bulk-pdf-label');
  var bulkSpinner = document.getElementById('btn-bulk-pdf-spinner');
  var total = PDF_PLANTILLAS_POR_CARD.length;
  var ok = 0;

  if (bulkBtn) {
    bulkBtn.disabled = true;
    bulkBtn.setAttribute('aria-busy', 'true');
    bulkBtn.classList.add('btn--loading');
  }
  if (bulkLabel) bulkLabel.textContent = 'Generando PDFs...';
  if (bulkSpinner) bulkSpinner.hidden = false;

  setCompileStatus('compiling', 'Generando ' + total + ' PDFs...',
    'Se arman uno por uno en tu navegador.');

  try {
    for (var i = 0; i < total; i++) {
      if (await descargarPdfPlantilla(i, { silencioso: true })) ok++;
      // Pausa entre descargas: algunos navegadoresIgnoran la segunda si
      // llegan pegadas.
      if (i < total - 1) await new Promise(function (r) { setTimeout(r, 500); });
    }
  } finally {
    _isCompilingAllPdf = false;
    if (bulkBtn) {
      bulkBtn.disabled = false;
      bulkBtn.removeAttribute('aria-busy');
      bulkBtn.classList.remove('btn--loading');
    }
    if (bulkLabel) bulkLabel.textContent = 'Descargar Todos (PDF)';
    if (bulkSpinner) bulkSpinner.hidden = true;
  }

  if (ok === total) {
    setCompileStatus('success', 'PDFs listos', ok + '/' + total + ' descargados.');
    showToast(ok + '/' + total + ' PDFs descargados', 'success');
  } else {
    setCompileStatus('error', 'Algunos PDFs no se generaron',
      ok + '/' + total + '. Revisa el mensaje en cada opción o usa "Descargar PDF LaTeX".');
    showToast(ok + '/' + total + ' PDFs descargados', 'error');
  }
}

/* ============================================================
   PDF VIA LA API (cv-builder-api en Render)
   ------------------------------------------------------------
   ESTE ES UN CAMINO NUEVO, NO UN REEMPLAZO. La tarjeta de cada
   plantilla tiene hoy dos formas de obtener un PDF y siguen
   intactas:

     1. "Descargar PDF"  -> jsPDF en el navegador (js/pdfgen.js),
                            instantaneo, sin servidor.
     2. este bloque      -> LaTeX compilado por pdflatex en Render,
                            con el diseno exacto del .tex.

   Se agrego, no se modifico. Cual de los dos queda como principal es
   decision del owner, no de este archivo. Lo que si hace este bloque es
   ser HONESTO con los tres fallos que de verdad importan, porque en un
   free tier los tres pasan seguido:

     - la API esta DORMIDA (Render apaga el free tier a los ~15 min),
     - la API tarda DEMASIADO (cold start + compilacion, 90 s de tope),
     - el LaTeX NO COMPILA (el .tex tiene algo que pdflatex no acepta).

   Confundirlos seria mentir: el primero se arregla esperando, el segundo
   reintentando y el tercero cambiando el CV.
   ============================================================ */

/* Card (indice de generateAllTemplates) -> etiqueta que viaja en el campo
   'template' del POST. Se manda para que el servidor pueda loguear; no
   cambia el resultado. El PDF sale con el nombre de la plantilla, no con
   el indice, para que el log del servidor no dependa de este archivo. */
var API_PLANTILLAS = ['moderno', 'creativo', 'clasico'];

/* Segundos que se le conceden al arranque en frio antes de cambiar el
   cartel del boton. El ping de /health ya dio el aviso: si la API no
   respondio, el primer compile paga el despertar. Pasado este umbral ya
   no hay nada mas que informar: la peticion esta en cola o no va a
   volver nunca. */
var API_MS_AVISO_DESPERTAR = 8000;

/**
 * Config lista para la card: nombre de plantilla, si la API esta
 * configurada de verdad y el estado que quedo del ultimo ping.
 */
function apiConfigDeCard(cardIndex) {
  var etiqueta = API_PLANTILLAS[cardIndex] || 'desconocido';
  var configurada = (typeof apiConfigurada === 'function') ? apiConfigurada() : false;
  return {
    etiqueta: etiqueta,
    configurada: configurada,
    estado: (window.LATEX_SERVICE && window.LATEX_SERVICE.estado) || 'sin-configurar'
  };
}

/**
 * Nombre del archivo. Sin nombre, RUT, email ni telefono: el nombre de un
 * archivo viaja en logs, historial y capturas de pantalla.
 */
function apiNombreArchivo(cardIndex) {
  return 'cv-api-plantilla-' + (cardIndex + 1) + '.pdf';
}

/**
 * Traducir un fallo de la API a algo que la persona pueda entender y
 * reintentar. El mensaje sale del CODIGO (err.codigoApi), no del texto
 * crudo de fetch ni del JSON de Flask: esos se van al log.
 * @param {Error} err
 * @returns {string}
 */
function apiMensajeError(err) {
  var codigo = err && err.codigoApi;
  var crudo = String((err && err.message) || err || '');
  var local = 'Usa "Descargar PDF": arma el mismo CV en tu navegador, al instante.';

  if (codigo === 'API_CONFIG') {
    return 'El servicio de compilación no está configurado todavía. ' + local;
  }
  if (codigo === 'API_DORMIDA') {
    return 'El servidor estaba dormido y no respondió. Se está despertando: espera unos segundos y reintenta. ' + local;
  }
  if (codigo === 'API_TIMEOUT') {
    return 'El servidor tardó más de 90 segundos y se cortó la espera. Pasa cuando el primer intento carga el servidor frío: reintenta una vez. ' + local;
  }
  /* La API incluye en `latex_error` el motivo real del fallo (resumen sano de
     la linea `! ...` del log de LaTeX). Si vino, se muestra: es accionable y
     evita el "suele ser un caracter" que no dice nada. La rama original queda
     como respaldo para cuando la API no antique ese campo. */
  var latex = String((err && err.latexError) || '').trim();
  if (codigo === 'API_COMPILACION' && latex) {
    return 'El servidor no pudo compilar este LaTeX. Detalle de LaTeX: '
      + latex + ' ' + local;
  }
  if (codigo === 'API_COMPILACION') {
    return 'El servidor no pudo compilar este LaTeX pero no dijo por qué. Usa "Ver Código LaTeX" para revisar el código. ' + local;
  }
  if (codigo === 'API_OCUPADO') {
    return 'El servidor está ocupado con otra compilación. Reintenta en unos segundos. ' + local;
  }
  if (codigo === 'API_LIMITE') {
    return 'Demasiadas peticiones seguidas desde esta red. Espera un poco antes de reintentar. ' + local;
  }
  if (codigo === 'API_NO_AUTH') {
    return 'El servidor rechazó la clave de la app. Es un problema de configuración, no tuyo: ' + local;
  }
  return 'No se pudo generar el PDF en el servidor: '
    + (crudo.substring(0, 160) || 'error desconocido') + '. ' + local;
}

/**
 * Estado visual del boton de la API. 'idle' | 'despertando' |
 * 'compilando'. El texto cambia en vez de dejar el boton mudo, que es
 * justo lo que hace que un cold start de 40 s parezca colgado.
 */
function apiEstadoBoton(cardIndex, estado) {
  var btn = document.getElementById('api-btn-pdf-' + cardIndex);
  var label = document.getElementById('api-btn-pdf-label-' + cardIndex);
  var spinner = document.getElementById('api-btn-pdf-spinner-' + cardIndex);
  var cargando = estado !== 'idle';

  if (btn) {
    btn.disabled = cargando;
    if (cargando) {
      btn.setAttribute('aria-busy', 'true');
      btn.classList.add('btn--loading');
    } else {
      btn.removeAttribute('aria-busy');
      btn.classList.remove('btn--loading');
    }
  }
  if (label) {
    label.textContent = estado === 'despertando' ? 'Despertando el servidor...'
      : estado === 'compilando' ? 'Compilando en el servidor...'
        : 'Descargar PDF LaTeX';
  }
  if (spinner) spinner.hidden = !cargando;
}

/**
 * Mensaje de exito o error junto al boton (region aria-live). Vacio = nada.
 */
function apiMensaje(cardIndex, texto, tono) {
  var el = document.getElementById('api-pdf-msg-' + cardIndex);
  if (!el) return;
  if (!texto) {
    el.textContent = '';
    el.removeAttribute('data-tone');
    return;
  }
  el.textContent = texto;
  el.setAttribute('data-tone', tono || 'ok');
}

/**
 * Markup de la accion "Descargar PDF LaTeX" de una card. Se renderiza
 * deshabilitada y con un aviso cuando la API todavia no esta configurada:
 * un boton que va a fallar siempre es peor que un boton que explica por
 * que no se puede usar.
 */
function apiPdfAccionesHtml(cardIndex) {
  var cfg = apiConfigDeCard(cardIndex);
  var conectorCargado = typeof compilarLatex === 'function';

  var nota, tono;
  if (!conectorCargado) {
    nota = 'PDF LaTeX no disponible: falta js/latex-service.js';
    tono = 'warn';
  } else if (!cfg.configurada) {
    /* Se dice QUE falta, no solo que falta algo: el dueño tiene dos lineas
       exactas que tocar y asi no tiene que leer el archivo para saberlo. */
    nota = 'PDF LaTeX sin configurar: falta CV_URL_PENDIENTE=false y CV_API_KEY en js/latex-service.js (o los atributos data-cv-api-url y data-cv-api-key en index.html)';
    tono = 'warn';
  } else {
    nota = 'LaTeX compilado por el servidor, con el diseño exacto del .tex';
    tono = cfg.estado === 'lista' ? 'ats' : 'visual';
  }

  var deshabilitado = (!conectorCargado || !cfg.configurada) ? 'aria-disabled="true"' : '';

  return `
          <button class="btn btn--pdf" type="button" id="api-btn-pdf-${cardIndex}"
                  onclick="descargarPdfViaApi(${cardIndex})"
                  aria-describedby="tpl-nombre-${cardIndex} api-pdf-note-${cardIndex} api-pdf-msg-${cardIndex}"
                  ${deshabilitado}
                  title="Envía tu .tex al servidor y recibes el PDF compilado">
            <span class="btn-spinner" id="api-btn-pdf-spinner-${cardIndex}" hidden aria-hidden="true"></span>
            <span id="api-btn-pdf-label-${cardIndex}">Descargar PDF LaTeX</span>
          </button>
          <p class="pdf-note" id="api-pdf-note-${cardIndex}" data-tone="${tono}">${nota}</p>
          <p class="pdf-msg" id="api-pdf-msg-${cardIndex}" role="status" aria-live="polite"></p>`;
}

/**
 * Descargar el PDF de una plantilla COMPILANDO EL .tex EN EL SERVIDOR.
 *
 * No compite con el PDF local de jsPDF: este es el unico camino que pasa
 * por pdflatex, asi que es el que reproduce el diseno del .tex y el que
 * va a servir cuando la compilacion la haga la API de verdad.
 *
 * @param {number} cardIndex  Indice de la card (0, 1, 2)
 * @returns {Promise<boolean>} true si el archivo salio
 */
async function descargarPdfViaApi(cardIndex) {
  var cfg = apiConfigDeCard(cardIndex);
  var templates = window._generatedTemplates;

  if (typeof compilarLatex !== 'function') {
    showToast('El conector con el servidor no está cargado.', 'error');
    return false;
  }
  if (!cfg.configurada) {
    apiMensaje(cardIndex, apiMensajeError({ codigoApi: 'API_CONFIG' }), 'error');
    showToast('El servidor de compilación no está configurado.', 'error');
    return false;
  }
  if (!templates || !templates[cardIndex]) {
    apiMensaje(cardIndex, 'No hay un .tex generado para esta plantilla.', 'error');
    showToast('No hay un .tex generado para esta plantilla.', 'error');
    return false;
  }

  var btn = document.getElementById('api-btn-pdf-' + cardIndex);
  if (btn && (btn.disabled || btn.getAttribute('aria-busy') === 'true')) {
    return false; // doble clic: el primero sigue en vuelo
  }

  /* Aviso honesto ANTES de esperar. Si el ping no habia despertado el servicio, lo que
     esta pasando es el arranque en frio del free tier, y decirlo es la
     diferencia entre 40 s utiles y 40 s de "esta roto". */
  var despertando = cfg.estado !== 'lista';
  apiEstadoBoton(cardIndex, despertando ? 'despertando' : 'compilando');
  apiMensaje(cardIndex, despertando
    ? 'El servidor puede estar despertando. Esto puede tardar hasta un minuto la primera vez.'
    : 'Compilando tu LaTeX en el servidor...', 'ok');
  setCompileStatus('compiling', despertando ? 'Despertando el servidor...' : 'Compilando en el servidor...',
    templates[cardIndex].name + ': se compila en el servidor, no en tu navegador.');
  // Al logger solo la etiqueta de plantilla y el indice. Nunca el CV.
  if (window.LOG) window.LOG.info('pdf-api: compilando', { plantilla: cfg.etiqueta, card: cardIndex });

  /* El cartel pasa de "despertando" a "compilando" si el arranque en frio
     sigue vivo a los 8 s: la parte lenta ya paso y ahora hay trabajo real. */
  var cambiarCartel = despertando
    ? setTimeout(function () {
      if (btn && btn.getAttribute('aria-busy') === 'true') {
        apiEstadoBoton(cardIndex, 'compilando');
        setCompileStatus('compiling', 'Compilando en el servidor...',
          'El servidor ya despertó; ahora compila el LaTeX.');
      }
    }, API_MS_AVISO_DESPERTAR)
    : null;

  try {
    var blob = await compilarLatex(templates[cardIndex].tex, cfg.etiqueta);

    if (!blob || blob.size < 100) {
      var e1 = new Error('la API devolvio ' + (blob ? blob.size : 0) + ' bytes');
      e1.codigoApi = 'API_COMPILACION';
      throw e1;
    }

    descargarBlob(blob, apiNombreArchivo(cardIndex));

    var kb = Math.round(blob.size / 1024);
    apiMensaje(cardIndex, 'PDF descargado: ' + apiNombreArchivo(cardIndex) + ' (' + kb + ' KB)', 'ok');
    showToast('PDF LaTeX descargado (' + kb + ' KB)', 'success');
    setCompileStatus('success', 'PDF LaTeX listo',
      apiNombreArchivo(cardIndex) + ' (' + kb + ' KB), compilado con pdflatex.');
    if (window.LOG) {
      window.LOG.info('pdf-api: descargado', { plantilla: cfg.etiqueta, bytes: blob.size });
    }
    return true;

  } catch (err) {
    var mensaje = apiMensajeError(err);
    apiMensaje(cardIndex, mensaje, 'error');
    showToast('No se pudo generar el PDF en el servidor', 'error');
    setCompileStatus('error', 'No se generó el PDF en el servidor', mensaje);
    if (window.LOG) {
      window.LOG.error('pdf-api: fallo', {
        plantilla: cfg.etiqueta,
        codigo: (err && err.codigoApi) || 'DESCONOCIDO'
      });
    }
    return false;

  } finally {
    if (cambiarCartel) clearTimeout(cambiarCartel);
    apiEstadoBoton(cardIndex, 'idle');
  }
}

/**
 * Mostrar toast de notificacion
 */
function showToast(message, type) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast--${type || 'success'}`;
  toast.textContent = message;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  container.appendChild(toast);

  // Eliminar despues de 3 segundos
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 3000);
}

/**
 * Estado de compilacion en la UI de resultados.
 * Muestra una barra/indicador global con spinner mientras compila,
 * estado de exito cuando el PDF esta listo, y error claro en caso contrario.
 * @param {string} state - 'compiling' | 'success' | 'error' | 'idle'
 * @param {string} title - Texto principal del estado
 * @param {string} [detail] - Texto secundario con mas contexto (opcional)
 */
function setCompileStatus(state, title, detail) {
  const status = document.getElementById('compile-status');
  if (!status) return;

  if (state === 'idle') {
    status.hidden = true;
    status.removeAttribute('data-state');
    return;
  }

  status.hidden = false;
  status.setAttribute('data-state', state);

  const titleEl = document.getElementById('compile-status-title');
  const detailEl = document.getElementById('compile-status-detail');
  if (titleEl) titleEl.textContent = title || '';
  if (detailEl) {
    detailEl.textContent = detail || '';
    detailEl.hidden = !detail;
  }
}

/* ============================================================
   UTILIDADES
   ============================================================ */

/**
 * Escapar HTML para insercion segura
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Escapar para atributos HTML
 */
function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Sanitizar nombre para filename
 */
function sanitizeFilename(str) {
  if (!str) return 'cv';
  return str
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar acentos
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 50);
}

/**
 * Detectar si el error viene de un fallo de conexion con el backend.
 * @param {Error} err
 * @returns {boolean}
 */
function isConnectionError(err) {
  if (!err) return false;
  var msg = String(err.message || err).toLowerCase();
  // El pdf-service ya traduce errores de fetch a "No se pudo conectar al servidor"
  return msg.indexOf('conectar') !== -1 ||
    msg.indexOf('network') !== -1 ||
    msg.indexOf('fetch') !== -1 ||
    msg.indexOf('failed to fetch') !== -1 ||
    msg.indexOf('backend') !== -1 ||
    msg.indexOf('servidor de compilacion') !== -1 ||
    err.name === 'TypeError';
}

/**
 * Traducir un error de compilacion a un mensaje amigable para el usuario.
 * @param {Error} err
 * @returns {string}
 */
function friendlyCompileError(err) {
  if (!err) return 'Error desconocido al compilar.';
  var msg = String(err.message || err);

  // Evitar mensajes tecnicos largos y crudos; presentar algo claro y accionable.
  msg = msg
    .replace(/^Error de compilacion:\s*/i, '')
    .replace(/^No se pudo conectar al servidor de compilacion \(backend en http:\/\/localhost:3000\)\.\s*/i, '');

  if (isConnectionError(err)) {
    return 'No se pudo conectar al servidor de compilación.';
  }
  if (msg.indexOf('tardo demasiado') !== -1) {
    return msg;
  }
  // Comprimir logs largos de pdflatex: quedarnos con una parte legible
  if (msg.length > 220) {
    msg = msg.substring(0, 220) + '...';
  }
  return msg || 'Error desconocido al compilar.';
}

/**
 * Rotacion aleatoria para cards (decoracion)
 */
function getRandomRotation() {
  const rotations = [-2, -1, 0, 0, 0, 1, 2];
  return rotations[Math.floor(Math.random() * rotations.length)];
}
