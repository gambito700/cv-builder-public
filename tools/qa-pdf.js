#!/usr/bin/env node
/**
 * QA-PDF.JS - Banco de pruebas automatico del motor PDF (js/pdfgen.js)
 * =========================================================================
 *
 * QUE ES
 *   Un harness sin dependencias que genera los PDF de prueba de las tres
 *   plantillas con jsPDF real (vendor/jspdf.umd.min.js), los SOMETE a Poppler
 *   (pdftotext / pdftoppm) y comprueba un catalogo explicito de invariantes.
 *   Es una herramienta de VERIFICACION: no arregla nada de js/pdfgen.js.
 *
 *   Mismo esprit que tools/generar-previews.js (que compila LaTeX), pero para
 *   la rama publica: aqui el PDF lo produce jsPDF en memoria.
 *
 * USO
 *   node tools/qa-pdf.js                     # todo, artefactos en temporal
 *   node tools/qa-pdf.js --list              # lista fixtures
 *   node tools/qa-pdf.js --fixtures real,vacio
 *   node tools/qa-pdf.js --templates 2
 *   node tools/qa-pdf.js --outdir C:\Temp\qa --dpi 140 --png real
 *   node tools/qa-pdf.js --json C:\Temp\qa.json
 *
 *   Codigo de salida: 0 si todos los checks automaticos pasan, 1 si alguno
 *   falla, 2 si el harness no pudo ejecutarse (falta Poppler, etc.).
 *
 * REGLAS
 *   - No modifica nada del repo. Solo escribe en --outdir, que por defecto es
 *     un directorio temporal FUERA del arbol.
 *   - Sin dependencias: solo modulos nativos de Node.
 *   - Sin estado: borra y regenera sus artefactos en cada corrida.
 *   - Consola ASCII-safe (la consola de Windows es cp1252).
 *
 * POR QUE DOS MEDIDAS DISTINTAS
 *   pdftotext -bbox da la CAJA DE TINTA real de cada palabra (lo que se ve).
 *   El content stream del PDF da la LINEA BASE y el TAMANO DE FUENTE exactos
 *   de cada operacion de texto (lo que el motor decidio). Ninguna de las dos
 *   sirve para lo que hace la otra, y usarlas por separado permite localizar
 *   un fallo: si la caja de tinta se sale pero la linea base no, el problema es
 *   de la fuente o del sangrado; si la linea base esta mal, el problema es de
 *   unidades (ver CHEQUEO densidad.interlineado).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const WEB = path.resolve(__dirname, '..');

/* ==========================================================================
 * 1. UMBRALES Y GEOMETRIA
 *    Ningun numero magico suelto: todo umbral tiene nombre y su porque. Los
 *    que vienen del motor se LEEN de el (js/pdfgen.js exporta PAGINA, MARGENES,
 *    ANCHO_UTIL, LIMITE_INFERIOR y TIPO), asi que si el motor cambia su
 *    geometria el harness sigue siendo correcto sin tocarlo.
 * ========================================================================== */

const MM_POR_PT = 25.4 / 72;
const PT_POR_MM = 72 / 25.4;

/* Tolerancias geometricas. La caja de tinta que da pdftotext sale del bbox de
   la fuente (ascendente/descendente), no del avance de cada glifo, asi que
   lleva un margen natural. 0.75 mm es mayor que ese margen y muchisimo menor
   que cualquier error real de layout: el gutter de la banda son 10 mm. */
const TOL_X_MM = 0.75;
const TOL_Y_MM = 0.75;

/* Banda de interlineado admisible, en multiplos del em (em = tamano de fuente
   expresado en mm). 1.15 es el factor mas cerrado que usa el motor (el nombre)
   y 1.6 es holgura sobre el mas abierto (pastilla, 1.30). El bug de unidades
   pt/mm (interlineado calculado con puntos en vez de mm) daba 2.83 em: muy por
   encima de la banda, y ademas NO coincidiria con el interlineado que publica
   el motor, asi que este es el chequeo que lo atrapa. */
const INTERLINEADO_MIN_EM = 1.15;
const INTERLINEADO_MAX_EM = 1.6;

/* Pagina huerfana: la ultima pagina del CV tiene menos de este porcentaje de la
   mediana de su propio caso. 20% esta en el hueco entre lo que el corpus produce
   (huerfanas 1-13%, ultimas paginas legitimas 33-133%). Ver pag.sin-huerfana. */
const ULTIMA_PAGINA_MIN_PCT = 0.2;
/* Mediana de caracteres minima para que el porcentaje sea interpretable. */
const MEDIANA_MIN_PARA_HUERFANA = 300;

/* El nombre debe medir al menos esto en multiplos del cuerpo (9.5pt -> 13.3pt)
   y ser el texto mas grande del PDF. Ver leg.nombre-destacado. */
const JERARQUIA_NOMBRE_MIN_FACTOR = 1.4;

/* Un PDF de CV sano pesa muy poco: las fuentes base de PDF (Helvetica) no se
   incrustan. 1 KB es el suelo de un documento que solo lleva un pie de pagina;
   8 MB es el techo de un caso patologico que delataria un bucle infinito. */
const PDF_BYTES_MIN = 1024;
const PDF_BYTES_MAX = 8 * 1024 * 1024;

/* Rango de paginas con el fixture `real` (DATOS_QA, de este archivo).
   Calculo del valor esperado (medido, luego acotado por el calculo):
     - fixture real = 13 exp + 14 educ + 13 cert + 7 proy = 47 items.
     - Plantilla 2: una columna de 178 mm. Cada item de experiencia ocupa de 5
       a 11 lineas de cuerpo (9.5 pt) mas titulo/subtitulo/meta, asi que entran
       ~8 items por pagina a plena caja, mas la cabecera (nombre + contacto +
       perfil) que se come un tercio de la primera -> 47/8 ~ 5.9, MEDIDO: 5.
     - Plantilla 1: la banda lateral reparte nombre, contacto, 5 categorias de
       pildoras e idiomas; la columna de 112 mm tarda mas por item (menos ancho)
       pero la banda absorbe secciones enteras -> MEDIDO: 5.
     - Plantilla 3: cada item es una caja con relleno y borde; el interlineado
       de las cajas suma ~0.7 mm por grupo y el relleno ~4.8 mm por caja, cerca
       de un 22% mas de alto que la misma informacion en la plantilla 2, de ahi
       la pagina extra -> MEDIDO: 6.
   Banda de sanity = [2, 8]: deja margen a la densidad sin permitir que el
   documento se derrame. 2 paginas significaria que el motor perdio mas de la
   mitad del contenido; 9, que la densidad cayo. */
const PAGINAS_RANGO_SANITY = { min: 2, max: 8 };
/* Valor medido con el fixture `real`, +-1 pagina. Es el detector fino de
   regresiones de densidad: una linea que se alarga 1 mm por item empuja el
   conteo. El +1 absorbe el cambio de un solo item de los 47. */
const PAGINAS_ESPERADAS = { 1: 5, 2: 5, 3: 6 };
const PAGINAS_TOLERANCIA = 1;

/* Cobertura minima del chequeo de interlineado: cuantos estilos distintos
   deben haber mostrado al menos una LINEA PARTIDA en la corrida entera. Sin
   este minimo, un parser roto pasaria el chequeo de interlineado por no tener
   nada que medir. MEDIDO con los fixtures de este archivo: 6 o mas. */
const INTERLINEADO_ESTILOS_MINIMOS = 4;

/* Cadenas que delatan un dato no saneado que llego al PDF. */
const CADENAS_BASURA = ['undefined', 'null', 'NaN', '[object Object]', 'TODO'];

/* MediaBox de A4 en mm, para la comprobacion cruzada. */
const A4 = { ancho: 210, alto: 297 };

/* La banda de la plantilla 1 la dibuja pdfgen con BANDA_CFG.ancho = 72 mm y
   PRINCIPAL_X = 82 mm. Ninguno de los dos es publico, asi que se declaran aqui
   como constantes del harness; el chequeo `geo.banda` los VERIFICA contra el
   PDF generado, de modo que si el motor los cambiara el harness lo delata en
   vez de dar un falso OK. */
const BANDA_ANCHO_MM = 72;
const PRINCIPAL_X_MM = 82;

/* Poppler: se busca en el PATH y, si no esta, en las rutas de MiKTeX. */
const RUTAS_POPPLER = [
  process.env.POPPLER_BIN,
  'C:/Program Files/MiKTeX/miktex/bin/x64',
  'C:/Program Files (x86)/MiKTeX/miktex/bin/x64',
  '/usr/bin',
  '/usr/local/bin'
].filter(Boolean);

/* ==========================================================================
 * 2. UTILIDADES DE CONSOLA (ASCII-safe: la consola de Windows es cp1252)
 * ========================================================================== */

const OK = 'OK';
const FALLA = 'FALLA';
const AVISO = 'AVISO';
const NA = 'N/A';
/* Los cuatro estados, en el orden en que se muestran. El resumen se indexa por
   el NOMBRE del estado ('N/A' lleva barra), asi que se recorre esta lista en
   vez de escribir las claves a mano: asi una vez se escribio "NA" como clave y
   los N/A quedaron en 0 en todos los informes. */
const ESTADOS = [OK, FALLA, AVISO, NA];
function resumenVacio() {
  const r = { total: 0 };
  for (const e of ESTADOS) r[e] = 0;
  return r;
}

function log(s) { process.stdout.write(asciiSeguro(s) + '\n'); }
function logErr(s) { process.stderr.write(asciiSeguro(s) + '\n'); }
function esNumero(v) { return typeof v === 'number' && isFinite(v); }
function redondear(v, dec) {
  const f = Math.pow(10, dec === undefined ? 2 : dec);
  return Math.round(v * f) / f;
}

/* Todo lo que se imprime pasa por aqui. La consola de Windows es cp1252: un
   emoji o un guion largo launchan la impresion con un signo de reemplazo y
   rompen la lectura de la tabla. Las letras acentuadas se transliteran (se
   siguen leyendo) y el resto se marca con "?" (no se puede representar). El
   informe JSON conserva el texto EXACTO, asi que el detalle perdido en consola
   se recupera ahi. */
const NO_ASCII_A_TXT = {
  '€': 'EUR', '—': '--', '–': '-', '‘': "'", '’': "'", '“': '"', '”': '"',
  '•': '*', '…': '...', '·': '.', '→': '->', '×': 'x', '°': ' deg', '±': '+/-',
  '«': '"', '»': '"', ' ': ' '
};
function asciiSeguro(s) {
  let out = '';
  const t = String(s === null || s === undefined ? '' : s);
  for (let i = 0; i < t.length; i++) {
    const c = t.charAt(i);
    const code = t.charCodeAt(i);
    if (code >= 32 && code < 127) { out += c; continue; }
    if (NO_ASCII_A_TXT[c] !== undefined) { out += NO_ASCII_A_TXT[c]; continue; }
    if (code >= 0xA0 && ACENTOS_A_BASE[c] !== undefined) {
      /* ACENTOS_A_BASE guarda la vocal en minuscula (Acentos a a); se devuelve
         en mayuscula si la original lo era, para que "EDUCACIoN" se lea
         "EDUCACION" y no "EDUCACion". */
      const base = ACENTOS_A_BASE[c];
      out += (c === c.toUpperCase() && c !== c.toLowerCase()) ? base.toUpperCase() : base;
      continue;
    }
    out += '?';
  }
  return out;
}

/* Normaliza para comparar: sin acentos, sin signos, minusculas, espacios
   colapsados. Sirve para buscar "EXPERIENCIA LABORAL" en un PDF que lo escribio
   con un guion, o para comparar una needle que el motor partio en dos lineas. */
const ACENTOS_A_BASE = {
  '\u00C1': 'a', '\u00E1': 'a', '\u00E0': 'a', '\u00E2': 'a', '\u00C0': 'a', '\u00C2': 'a',
  '\u00C9': 'e', '\u00E9': 'e', '\u00E8': 'e', '\u00EA': 'e', '\u00C8': 'e', '\u00CA': 'e',
  '\u00CD': 'i', '\u00ED': 'i', '\u00EC': 'i', '\u00EE': 'i', '\u00CC': 'i', '\u00CE': 'i',
  '\u00D3': 'o', '\u00F3': 'o', '\u00F2': 'o', '\u00F4': 'o', '\u00D2': 'o', '\u00D4': 'o',
  '\u00DA': 'u', '\u00FA': 'u', '\u00F9': 'u', '\u00FB': 'u', '\u00D9': 'u', '\u00DB': 'u',
  '\u00D1': 'n', '\u00F1': 'n', '\u00C7': 'c', '\u00E7': 'c', '\u00DC': 'u', '\u00FC': 'u',
  '\u00D6': 'o', '\u00F6': 'o', '\u00DD': 'y', '\u00FD': 'y'
};

function normalizar(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[\u00C0-\u00FF]/g, function (c) { return ACENTOS_A_BASE[c] !== undefined ? ACENTOS_A_BASE[c] : c; })
    .replace(/[^\w\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/* Version sin espacios: para needles que el motor pudo partir en varias lineas
   (por ejemplo un nombre de 24 caracteres dentro de una banda de 56 mm). */
function compactar(s) { return normalizar(s).replace(/\s+/g, ''); }

/** Un texto aparece en el PDF, tolerando que el motor lo parta en lineas. */
function apareceEnTexto(aguja, texto) {
  const a = compactar(aguja);
  if (!a) return 0;
  const n = compactar(texto);
  if (n.indexOf(a) === -1) return 0;
  let c = 0, i = n.indexOf(a);
  while (i !== -1) { c++; i = n.indexOf(a, i + a.length); }
  return c;
}

/* ==========================================================================
 * 3. CARGA DE jsPDF, DEL MOTOR Y DEL FIXTURE REAL
 * ========================================================================== */

function cargarJsPDF() {
  const ruta = path.join(WEB, 'vendor', 'jspdf.umd.min.js');
  if (!fs.existsSync(ruta)) throw new Error('no existe ' + ruta);
  const mod = require(ruta);
  const ctor = typeof mod === 'function' ? mod : (mod && (mod.jsPDF || (mod.default && mod.default.jsPDF)));
  if (typeof ctor !== 'function') throw new Error('vendor/jspdf.umd.min.js no exporta un constructor jsPDF');
  return ctor;
}

function cargarMotor() {
  const ruta = path.join(WEB, 'js', 'pdfgen.js');
  if (!fs.existsSync(ruta)) throw new Error('no existe ' + ruta);
  return require(ruta);
}

/* ==========================================================================
 * 4. FIXTURES
 *    Cada fixture declara ademas lo que ESPERA, escrito a mano y NO calculado
 *    con la misma logica del motor: si se calculara aqui, el chequeo compararia
 *    el motor consigo mismo y no detectaria nada.
 *      aguja    texto corto y unico que debe sobrevivir (para los fixtures cuyo
 *               nombre se parte en varias lineas y ya no se puede buscar entero)
 *      espera   conteos y secciones, a mano
 *      literales  en el fixture `acentos`: cadenas que deben aparecer TEXTUALES
 *               en el texto extraido, para validar el round trip por WinAnsi
 * ========================================================================== */

const ETIQUETAS = {
  contacto: 'CONTACTO',
  perfil: 'PERFIL',
  experiencia: 'EXPERIENCIA LABORAL',
  educacion: 'EDUCACIÓN',
  certificaciones: 'CERTIFICACIONES',
  proyectos: 'PROYECTOS',
  habilidades: 'HABILIDADES',
  idiomas: 'IDIOMAS'
};

const TODAS_LAS_SECCIONES = [
  ETIQUETAS.contacto, ETIQUETAS.perfil, ETIQUETAS.experiencia, ETIQUETAS.educacion,
  ETIQUETAS.certificaciones, ETIQUETAS.proyectos, ETIQUETAS.habilidades, ETIQUETAS.idiomas
];

/* Orden de lectura exigido a la plantilla 2 (la unica ATS-safe).
   `ats` es el orden que pide el PRD y que declara el comentario de cabecera del
   motor (linea ~44: "orden perfil -> contacto -> experiencia -> ...").
   `implementado` es el orden que el codigo pinta de verdad. Se puede medir la
   diferencia con --orden sin tocar el codigo. */
const ORDEN_LECTURA_ATS = [
  ETIQUETAS.perfil, ETIQUETAS.contacto, ETIQUETAS.experiencia, ETIQUETAS.educacion,
  ETIQUETAS.certificaciones, ETIQUETAS.proyectos, ETIQUETAS.habilidades, ETIQUETAS.idiomas
];
const ORDEN_LECTURA_IMPLEMENTADO = [
  ETIQUETAS.contacto, ETIQUETAS.perfil, ETIQUETAS.experiencia, ETIQUETAS.educacion,
  ETIQUETAS.certificaciones, ETIQUETAS.proyectos, ETIQUETAS.habilidades, ETIQUETAS.idiomas
];

/* Etiquetas de seccion que una plantilla dibuja SIN barra de titulo por diseno de
   su cabecera, con el motivo declarado. No es lo mismo que "seccion omitida": el
   CONTENIDO esta ahi, lo que no esta es la etiqueta.
     - Plantilla 3 (cajas): renderPlantillaCajas() mete los datos de contacto en
       la caja de cabecera (js/pdfgen.js:1957, escribirCajaTexto sin
       barraSeccion) mientras que las plantillas 1 y 2 si la ponen (js/pdfgen.js
       :1660 y :940). El bloque de identidad (nombre, titular, contacto) va sin
       barra; a partir de PERFIL todas las secciones llevan la suya.
   Se reporta como AVISO en cada corrida (no como OK) para que la inconsistencia
   quede a la vista y no se normalice por costumbre. */
const ETIQUETAS_OPCIONALES = {
  3: {
    'CONTACTO': 'la caja de cabecera de la plantilla 3 no lleva barra de titulo por diseno (js/pdfgen.js:1957); el contenido si esta'
  }
};

function clonar(o) { return JSON.parse(JSON.stringify(o)); }

/* ==========================================================================
 * 3.5 DATOS PROPIOS DEL FIXTURE `real`
 *     El fixture NO lee js/data.js: se autoprovisiona.
 *
 *     POR QUE
 *       DEFAULT_DATA es la semilla de los formularios de la app y en otra
 *       rama se esta vaciando a proposito (los rellenables arrancan en blanco
 *       para que no quede dato de nadie en el repo). Si el harness leyera esa
 *       semilla, vaciarla le tumbaria el fixture `real` entero y con el los
 *       fixtures que lo derivan (`skills-0`, `skills-40`, `exp-13` y
 *       `skills-array`): 4 de los 10 fixtures y 12 checks
 *       ats.nombre-visible fallarian por una causa que NO esta en el motor
 *       PDF. Un banco de pruebas que depende del archivo que otro equipo
 *       esta editando mide el archivo, no el motor. Aqui los datos son del
 *       harness y nadie mas los toca.
 *
 *     QUE ES
 *       Datos ANONIMOS y de stress, con la MISMA FORMA que DEFAULT_DATA: no
 *       describen a ninguna persona y su trabajo es que el motor tenga que
 *       trabajar lo mas duro posible. Se conservan los conteos con los que se
 *       calibro PAGINAS_ESPERADAS: 13 exp + 14 educ + 13 cert + 7 proy = 47
 *       items, y 32 habilidades en 6 grupos (5 de habilidades + el grupo
 *       `idiomas`, que el motor no lista como habilidad porque ya sale en su
 *       propia seccion).
 *
 *     Los items son ademas UNICOS dentro del fixture, que es lo que hace util
 *     el check int.items-supervivientes: un item repetido se degrada a
 *     ">= 1" y dejaria de poder afirmar que se dibujo una vez y no tres.
 *
 *     RUT: 12.345.678-5. El digito verificador va CALCULADO (modulo 11,
 *     pesos 2..7 ciclicos desde la derecha, resto 0 -> dv 0), no escrito a
 *     ojo: suma 138, resto 6, dv 5. Que el dato sea coherente importa porque
 *     el motor lo imprime tal cual y un dv falso se colaria en el PDF sin
 *     que ningun check lo notara.
 *
 *     `focusAreas` es la lista de areas foco de la app, que el motor usa para
 *     resolver el titular de `focusArea`. Va copiada aqui (no leida de
 *     js/data.js) por el mismo motivo que el resto: este objeto no depende
 *     de ningun archivo del repo.
 * ========================================================================== */

const DATOS_QA = {
  personal: {
    nombre: 'Nombre Apellido Apellido',
    rut: '12.345.678-5',
    fechaNacimiento: '1990-01-01',
    nacionalidad: 'Chilena',
    direccion: 'Calle Ejemplo 123',
    ciudad: 'Santiago',
    telefono: '+56 9 1234 5678',
    email: 'nombre.apellido@ejemplo.cl',
    estadoCivil: 'Soltero/a',
    idiomas: 'Espanol nativo, Ingles B1',
    disponibilidad: 'Inmediata',
    github: 'https://github.com/ejemplo',
    portafolio: 'https://ejemplo.cl/cv'
  },
  focusArea: 'integral',
  focusAreas: [
    { id: 'cocina', icon: '[COCINA]', name: 'Cocina y Gastronomía', desc: 'Preparación de alimentos, producción, higiene' },
    { id: 'atencion', icon: '[CLTE]', name: 'Atención al Cliente', desc: 'Servicio, resolución de problemas, retail' },
    { id: 'seguridad', icon: '[SEGUR]', name: 'Seguridad y Vigilancia', desc: 'CCTV, control de accesos, rondas' },
    { id: 'ventas', icon: '[VENTA]', name: 'Ventas y Comercial', desc: 'Venta directa, retail, captación' },
    { id: 'informatica', icon: '[TIC]', name: 'Informática y TIC', desc: 'Desarrollo web, programación, soporte' },
    { id: 'corretaje', icon: '[PROP]', name: 'Corretaje de Propiedades', desc: 'Certificado en corretaje' },
    { id: 'marketing', icon: '[DIGITAL]', name: 'Marketing Digital', desc: 'SEO, Growth Hacking, analítica' },
    { id: 'integral', icon: '[MULTI]', name: 'Integral (Multiárea)', desc: 'Todas las áreas combinadas' }
  ],
  experience: [
    { empresa: 'Empresa Demo SA', cargo: 'Analista de Sistemas', ubicacion: 'Santiago', fechaInicio: '2024-03', fechaFin: '', presente: true, funciones: 'Analisis y documentacion de requisitos de sistemas internos\nConstruccion de interfaces web con HTML, CSS y JavaScript\nAutomatizacion de procesos con Python y SQL\nApoyo a usuarios finales en incidencias de aplicacion' },
    { empresa: 'Comercio Ejemplo Ltda', cargo: 'Supervisor de Piso de Ventas', ubicacion: 'Ciudad Ejemplo', fechaInicio: '2022-05', fechaFin: '2024-02', presente: false, funciones: 'Supervision directa de un equipo de quince vendedores\nControl de stock y reposicion de gondola\nReportes diarios de venta y cumplimiento de metas\nAtencion de clientes y resolucion de reclamos' },
    { empresa: 'Servicios Integrales SpA', cargo: 'Tecnico de Soporte Computacional', ubicacion: 'Santiago', fechaInicio: '2021-01', fechaFin: '2022-04', presente: false, funciones: 'Instalacion y configuracion de equipos de escritorio\nMantenimiento preventivo y correctivo de hardware\nRespuesta a solicitudes de soporte en primer nivel\nRedaccion de manuales de procedimiento' },
    { empresa: 'Empresa Demo SA', cargo: 'Analista de Datos', ubicacion: 'Santiago', fechaInicio: '2020-02', fechaFin: '2020-12', presente: false, funciones: 'Consolidacion de fuentes de datos heterogeneas\nConstruccion de tableros de indicadores\nAnalisis de ventas y segmentacion de clientes\nAutomatizacion de reportes mensuales' },
    { empresa: 'Comercio Ejemplo Ltda', cargo: 'Encargado de Bodega', ubicacion: 'Ciudad Ejemplo', fechaInicio: '2019-06', fechaFin: '2020-01', presente: false, funciones: 'Recepcion y control de mercaderia\nInventario permanente y conteos ciclicos\nCoordinacion de despacho a sucursales\nSeguridad y orden del recinto' },
    { empresa: 'Servicios Integrales SpA', cargo: 'Operador de CCTV', ubicacion: 'Santiago', fechaInicio: '2018-01', fechaFin: '2019-05', presente: false, funciones: 'Monitoreo de camaras en centro de control\nRegistro de eventos y elaborated de reportes\nControl de accesos de personal y visitas\nAtencion de emergencies y contacto concentral' },
    { empresa: 'Empresa Demo SA', cargo: 'Desarrollador Web', ubicacion: 'Santiago', fechaInicio: '2017-03', fechaFin: '2017-12', presente: false, funciones: 'Desarrollo de modulos web con bases de datos\nPruebas funcionales y correccion de defectos\nDespliegue de versiones en servidor de pruebas\nDocumentacion tecnica de cada entrega' },
    { empresa: 'Comercio Ejemplo Ltda', cargo: 'Coordinador de Turnos', ubicacion: 'Ciudad Ejemplo', fechaInicio: '2016-01', fechaFin: '2016-12', presente: false, funciones: 'Elaboracion de escalas de trabajo\nControl de asistencia y ausencias\nCoordinacion de relevos y cobertura de puestos\nPlanificacion de capacidad semanal' },
    { empresa: 'Servicios Integrales SpA', cargo: 'Asistente Administrativa', ubicacion: 'Santiago', fechaInicio: '2015-01', fechaFin: '2015-11', presente: false, funciones: 'Recepcion y despacho de correspondencia\nRedaccion de documentos y actas de reunion\nOrganizacion de archivos fisicos y digitales\nApoyo administrativo a gerencia' },
    { empresa: 'Empresa Demo SA', cargo: 'Tecnico de Mantenimiento', ubicacion: 'Santiago', fechaInicio: '2014-02', fechaFin: '2014-12', presente: false, funciones: 'Mantenimiento preventivo de instalaciones\nReparacion de equipos y componentes electricos\nControl de repuestos y herramientas\nDisponibilidad en tareas de guardia' },
    { empresa: 'Comercio Ejemplo Ltda', cargo: 'Vendedor y Captacion de Clientes', ubicacion: 'Ciudad Ejemplo', fechaInicio: '2013-01', fechaFin: '2013-10', presente: false, funciones: 'Ventas directas en sala de exhibiciones\nCaptacion de clientela y seguimiento de contactos\nManejo de caja y cierre de caja diaria\nOrden y reposicion de productos' },
    { empresa: 'Servicios Integrales SpA', cargo: 'Conductor de Reparto', ubicacion: 'Santiago', fechaInicio: '2012-03', fechaFin: '2012-12', presente: false, funciones: 'Reparto de mercaderia en rutas asignadas\nVerificacion de entregas y firma de comprobantes\nMantenimiento basico del vehiculo\nCoordinacion con bodega y clientes' },
    { empresa: 'Empresa Demo SA', cargo: 'Practicante de Mantenimiento', ubicacion: 'Santiago', fechaInicio: '2011-01', fechaFin: '2011-06', presente: false, funciones: 'Apoyo en tareas de mantenimiento preventivo\nOrden de taller y control de herramienta\nRegistro de interveneciones en planilla\nAprendizaje de normas de seguridad' }
  ],
  education: [
    { institucion: 'Centro de Formacion Demo', programa: 'Desarrollo de Aplicaciones Web Integrales', horas: 462, nota: 'En curso', estado: 'En curso', ano: 2026 },
    { institucion: 'Instituto de Ejemplo', programa: 'Diplomado en Gestion de Proyectos Digitales', horas: 100, nota: '100/100', estado: 'Completo', ano: 2025 },
    { institucion: 'Instituto de Ejemplo', programa: 'Analitica de Datos y Visualizacion', horas: 80, nota: '100/100', estado: 'Completo', ano: 2025 },
    { institucion: 'Instituto de Ejemplo', programa: 'Programacion con Python', horas: 60, nota: '98/100', estado: 'Completo', ano: 2025 },
    { institucion: 'Centro de Formacion Demo', programa: 'Bases de Datos Relacionales', horas: 40, nota: '96/100', estado: 'Completo', ano: 2025 },
    { institucion: 'Centro de Formacion Demo', programa: 'Seguridad de la Informacion', horas: 40, nota: '100/100', estado: 'Completo', ano: 2025 },
    { institucion: 'Instituto de Ejemplo', programa: 'Diseno de Interfaces Accesibles', horas: 30, nota: '94/100', estado: 'Completo', ano: 2025 },
    { institucion: 'Instituto de Ejemplo', programa: 'Automatizacion de Procesos', horas: 30, nota: '100/100', estado: 'Completo', ano: 2025 },
    { institucion: 'Centro de Formacion Demo', programa: 'Redes y Protocolos', horas: 50, nota: '92/100', estado: 'Completo', ano: 2025 },
    { institucion: 'Centro de Formacion Demo', programa: 'Gestion de Punto de Venta', horas: 30, nota: '100/100', estado: 'Completo', ano: 2025 },
    { institucion: 'Instituto de Ejemplo', programa: 'Marketing Digital Aplicado', horas: 40, nota: '98/100', estado: 'Completo', ano: 2024 },
    { institucion: 'Centro de Formacion Demo', programa: 'Control de Accesos y CCTV', horas: 30, nota: '100/100', estado: 'Completo', ano: 2024 },
    { institucion: 'Instituto de Ejemplo', programa: 'Mediacion y Corretaje Comercial', horas: 57, nota: '-', estado: 'Completo', ano: 2024 },
    { institucion: 'Instituto de Ejemplo', programa: 'Tecnico Superior en Informatica', horas: 0, nota: 'Incompleto', estado: 'Incompleto', ano: 2010 }
  ],
  skills: {
    frontend: ['HTML5', 'CSS3', 'JavaScript ES6+', 'Bootstrap 5', 'jQuery', 'Diseno responsivo'],
    backend: ['Python', 'Django', 'FastAPI', 'SQL', 'SQLite', 'ORM', 'APIs REST'],
    devops: ['Docker', 'Git', 'GitHub Actions', 'Linux', 'CI/CD', 'Selenium'],
    seguridad: ['CCTV', 'Control de accesos', 'OS-10', 'Ciberseguridad', 'Prevencion de perdidas', 'Rondas de vigilancia'],
    marketing: ['SEO', 'Growth Hacking', 'Analitica Web', 'Marketing Digital', 'Google Analytics'],
    idiomas: ['Espanol nativo', 'Ingles B1']
  },
  certifications: [
    { nombre: 'Certificacion en Analisis Funcional', institucion: 'Instituto de Ejemplo', horas: 40, nota: 100, ano: 2025 },
    { nombre: 'Certificacion en Gestion de Proyectos', institucion: 'Centro de Formacion Demo', horas: 60, nota: 98, ano: 2025 },
    { nombre: 'Certificacion en Seguridad Informatica', institucion: 'Instituto de Ejemplo', horas: 40, nota: 100, ano: 2025 },
    { nombre: 'Certificacion en Datos y Visualizacion', institucion: 'Centro de Formacion Demo', horas: 80, nota: 95, ano: 2025 },
    { nombre: 'Certificacion en Diseno Web Accesible', institucion: 'Instituto de Ejemplo', horas: 40, nota: 100, ano: 2024 },
    { nombre: 'Certificacion en Redes Industriales', institucion: 'Centro de Formacion Demo', horas: 50, nota: 92, ano: 2024 },
    { nombre: 'Certificacion en Operacion de CCTV', institucion: 'Instituto de Ejemplo', horas: 30, nota: 100, ano: 2024 },
    { nombre: 'Certificacion en Control de Accesos', institucion: 'Centro de Formacion Demo', horas: 40, nota: 96, ano: 2024 },
    { nombre: 'Certificacion en Prevencion de Perdidas', institucion: 'Instituto de Ejemplo', horas: 30, nota: 100, ano: 2023 },
    { nombre: 'Certificacion en Primeros Auxilos', institucion: 'Centro de Formacion Demo', horas: 20, nota: 100, ano: 2023 },
    { nombre: 'Certificacion en Ventas y Atencion al Cliente', institucion: 'Instituto de Ejemplo', horas: 30, nota: 94, ano: 2023 },
    { nombre: 'Certificacion en Administracion de Punto de Venta', institucion: 'Centro de Formacion Demo', horas: 40, nota: 90, ano: 2022 },
    { nombre: 'Certificacion en Mediacion Comercial', institucion: 'Instituto de Ejemplo', horas: 57, nota: null, ano: 2022 }
  ],
  projects: [
    { nombre: 'Sistema de Inventario', descripcion: 'Aplicacion completa para control de stock: backend con Python, interfaz web, escaneo de facturas con OCR, autenticacion con roles y reportes financieros. Ocho modulos funcionales.', tecnologias: 'Python, FastAPI, HTML5, CSS3, JavaScript, SQLite, Tesseract OCR' },
    { nombre: 'Panel de Metricas', descripcion: 'Visualizacion de indicadores de sistema en tiempo real, con actualizacion automatica, alertas por umbral y exportacion de datos para analisis posterior.', tecnologias: 'Python, Docker, Grafana, Prometheus' },
    { nombre: 'Sitio de Cine Independiente', descripcion: 'Sitio web para un proyecto cultural independiente: cartelera, fichas de peliculas, galeria de imagenes y seccion de noticias del festival.', tecnologias: 'HTML5, CSS3, JavaScript, WordPress' },
    { nombre: 'Portal de Gestion de Turnos', descripcion: 'Sistema web para publicar y controlar escalas de trabajo, con avisos automaticos, control de ausencias y panel de cobertura para supervisores.', tecnologias: 'Python, Django, SQLite, Bootstrap 5' },
    { nombre: 'Aplicacion de Control de Rondas', descripcion: 'Aplicacion movil para registro de rondas de seguridad con geolocalizacion, fotos de evidencia, hora de cada punto y informe exportable.', tecnologias: 'JavaScript, IndexedDB, Service Workers' },
    { nombre: 'Catalogo Digital de Productos', descripcion: 'Catalogo con busqueda por categoria y filtros de atributos, fichas con ficha tecnica, disponibilidad por sucursal y formulario de cotizacion.', tecnologias: 'JavaScript, Chart.js, Excel, Web Scraping' },
    { nombre: 'Sistema de Tickets y Soporte', descripcion: 'Mesa de ayuda interna con clasificacion por prioridad, asignacion de responsables, historial de conversaciones y base de conocimiento consultable.', tecnologias: 'Python, REST APIs, PostgreSQL, Docker' }
  ]
};


function construirFixtures() {
  const real = clonar(DATOS_QA);
  const focusAreas = clonar(real.focusAreas);

  /* ---- 1. real: los datos propios de este archivo ----------------------- */
  const fReal = {
    id: 'real',
    titulo: 'datos propios del harness (13 exp / 14 educ / 13 cert / 7 proy)',
    datos: clonar(real),
    aguja: 'Nombre Apellido Apellido',
    espera: {
      items: 47,
      itemsPorSeccion: { experiencia: 13, educacion: 14, certificaciones: 13, proyectos: 7 },
      habilidadesCategorias: 5, habilidadesItems: 30, idiomas: 2,
      secciones: TODAS_LAS_SECCIONES.slice()
    }
  };

  /* ---- 2. skills-0: cero habilidades, 2 idiomas intactos ----------------
     Se vacian SOLO las categorias de habilidades. `personal.idiomas` sigue
     poblado a proposito: asi se comprueba que HABILIDADES se omite por falta de
     datos sin que arrastre la seccion IDIOMAS. */
  const fSkills0 = clonar(real);
  fSkills0.skills = { frontend: [], backend: [], devops: [], seguridad: [], marketing: [], idiomas: [] };
  const f0 = {
    id: 'skills-0',
    titulo: '0 habilidades (los 2 idiomas siguen viniendo de personal.idiomas)',
    datos: fSkills0,
    aguja: 'Nombre Apellido Apellido',
    espera: {
      items: 47,
      itemsPorSeccion: { experiencia: 13, educacion: 14, certificaciones: 13, proyectos: 7 },
      habilidadesCategorias: 0, habilidadesItems: 0, idiomas: 2,
      secciones: TODAS_LAS_SECCIONES.filter(function (s) { return s !== ETIQUETAS.habilidades; })
    }
  };

  /* ---- 3. skills-40: 40 habilidades en 6 categorias ---------------------
     Misma forma que `real` (6 claves, la ultima `idiomas`): 38 habilidades + 2
     idiomas = 40. Estresa el llenado de la banda lateral (pildoras) y la lista
     de HABILIDADES de las otras dos plantillas. */
  const f40 = {
    id: 'skills-40',
    titulo: '40 habilidades en 6 categorias (38 + 2 idiomas)',
    datos: {
      personal: clonar(real.personal),
      focusArea: real.focusArea,
      focusAreas: focusAreas,
      experience: clonar(real.experience),
      education: [], certifications: [], projects: [],
      skills: {
        frontend: ['HTML5', 'CSS3', 'JavaScript', 'TypeScript', 'React', 'Vue', 'Svelte', 'Angular'],
        backend: ['Python', 'Django', 'FastAPI', 'Node.js', 'Java', 'Go', 'PHP', 'Laravel', 'SQL'],
        devops: ['Docker', 'Kubernetes', 'Git', 'GitHub Actions', 'Linux', 'Ansible', 'Terraform'],
        seguridad: ['OWASP', 'CCTV', 'Control de accesos', 'Ciberseguridad', 'Rondas', 'Prevencion de perdidas', 'ISO 27001'],
        marketing: ['SEO', 'Google Analytics', 'Sem', 'Content Marketing', 'Email Marketing', 'Meta Ads', 'Growth Hacking'],
        idiomas: ['Espanol nativo', 'Ingles B1']
      }
    },
    aguja: 'Kubernetes',
    espera: {
      items: 13,
      itemsPorSeccion: { experiencia: 13, educacion: 0, certificaciones: 0, proyectos: 0 },
      habilidadesCategorias: 5, habilidadesItems: 38, idiomas: 2,
      secciones: [ETIQUETAS.contacto, ETIQUETAS.perfil, ETIQUETAS.experiencia,
        ETIQUETAS.habilidades, ETIQUETAS.idiomas]
    }
  };

  /* ---- 4. exp-13: 13 experiencias aisladas -------------------------------
     Solo experiencia: aisla el bloque que mas lineas produce y descarta todo lo
     demas, para que un fallo de paginacion dentro de un item sea atribuible. */
  const fExp13 = {
    id: 'exp-13',
    titulo: '13 experiencias y nada mas (bloque aislado)',
    datos: {
      personal: {
        nombre: 'Prueba Aislada', cargo: 'Tecnico', telefono: '+56 9 0000 0000',
        email: 'aislado@ejemplo.cl', direccion: 'Calle 1', ciudad: 'Santiago',
        idiomas: 'Espanol nativo', github: '', portafolio: '', sitio: '',
        rut: '', fechaNacimiento: '', nacionalidad: '', estadoCivil: '', disponibilidad: ''
      },
      focusArea: 'integral',
      focusAreas: focusAreas,
      experience: clonar(real.experience),
      education: [], certifications: [], projects: [],
      skills: { frontend: [], backend: [], devops: [], seguridad: [], marketing: [], idiomas: [] }
    },
    aguja: 'Empresa Demo SA',
    espera: {
      items: 13,
      itemsPorSeccion: { experiencia: 13, educacion: 0, certificaciones: 0, proyectos: 0 },
      habilidadesCategorias: 0, habilidadesItems: 0, idiomas: 1,
      /* Sin PERFIL: este fixture no pone objetivo ni ninguno de los pares
         clave-valor que la seccion acepta (rut, nacimiento, nacionalidad,
         estadoCivil, disponibilidad). El resto de fixtures si los traen, por eso
         los demas si declaran PERFIL y este no. */
      secciones: [ETIQUETAS.contacto, ETIQUETAS.experiencia, ETIQUETAS.idiomas]
    }
  };

  /* ---- 5. texto-largo: lo que revienta los layouts ---------------------
     Funciones de 2000 caracteres, nombre de 90 y empresa de 120. Fuerza:
     partido de palabras, troceado por ancho (una sola palabra mas larga que la
     caja no cabe ni partida por espacios) y paginacion de un bloque mas alto
     que una pagina completa. */
  function larga(n, semilla) {
    const palabras = ['diseno', 'implementacion', 'verificacion', 'despliegue', 'medicion',
      'arquitectura', 'seguridad', 'documentacion', 'automatizacion', 'monitoreo'];
    let s = '';
    for (let i = 0; s.length < n; i++) s += (i ? ' ' : '') + palabras[(i + semilla) % palabras.length];
    return s.slice(0, n);
  }
  const fLargo = {
    id: 'texto-largo',
    titulo: 'funciones de 2000 caracteres, nombre de 90, empresa de 120',
    datos: {
      personal: {
        nombre: 'Alejandra' + 'X'.repeat(81),   /* 9 + 81 = 90 caracteres exactos */
        cargo: larga(120, 1),
        telefono: '+56 9 1234 5678', email: 'largo@ejemplo.cl',
        direccion: 'Avenida Muy Larga 12345', ciudad: 'Valparaiso',
        idiomas: 'Espanol nativo, Ingles C1',
        github: 'https://github.com/ejemplo/largo', portafolio: ''
      },
      focusArea: 'integral',
      focusAreas: focusAreas,
      experience: [{
        empresa: 'Industrias' + 'Y'.repeat(110),
        cargo: 'Director' + 'Z'.repeat(110),
        ubicacion: 'Ciudad' + 'W'.repeat(110),
        fechaInicio: '2019-01', fechaFin: '', presente: true,
        funciones: [0, 1, 2, 3, 4].map(function (i) { return 'F' + i + ': ' + larga(2000, i); }).join('\n')
      }],
      education: [], certifications: [], projects: [],
      skills: { general: [larga(200, 3)], idiomas: ['Espanol nativo', 'Ingles C1'] }
    },
    aguja: 'largo@ejemplo.cl',
    espera: {
      items: 1,
      itemsPorSeccion: { experiencia: 1, educacion: 0, certificaciones: 0, proyectos: 0 },
      habilidadesCategorias: 1, habilidadesItems: 1, idiomas: 2,
      secciones: [ETIQUETAS.contacto, ETIQUETAS.experiencia, ETIQUETAS.habilidades, ETIQUETAS.idiomas]
    }
  };

  /* ---- 6. acentos: WinAnsi de punta a punta -----------------------------
     Todos los caracteres imprimibles del rango latino que WinAnsiEncoding
     representa, mas los signos tipograficos y el euro, mas UN emoji. Del emoji
     no se espera nada: WinAnsi no puede representarlo y el motor lo sustituye
     con su tabla de reemplazo, asi que se mide y se reporta aparte (vease
     `emoji` mas abajo y el check acentos.emoji-winansi). */
  const fAcentos = {
    id: 'acentos',
    titulo: 'acentos, enye, dieresis, signos, rayas, euro y comillas',
    datos: {
      personal: {
        nombre: 'José Ñuñez',
        cargo: 'Analista ¿Sistemas? ¡Excelente!',
        telefono: '+56 9 1234 5678', email: 'jose.nunez@ejemplo.cl',
        direccion: 'Av. Ñuble 1234', ciudad: 'Valparaíso',
        idiomas: 'Español nativo, Alemán B1',
        github: 'https://github.com/ejemplo', portafolio: '',
        rut: '12.345.678-9', fechaNacimiento: '1990-01-01', nacionalidad: 'Chilena',
        estadoCivil: 'Soltero', disponibilidad: 'Inmediata',
        objetivo: 'Diseño, medición y verificación de procesos con atención máxima al detalle y una devoted Dedication al usuario final.'
      },
      focusArea: 'integral',
      focusAreas: focusAreas,
      experience: [{
        empresa: 'Compañía Ñandú S.A. — “Sucursal”',
        cargo: 'Analista ¿Sénior? ¡Urgente!',
        ubicacion: 'Zürich, Ätaland',
        fechaInicio: '2020-01', fechaFin: '', presente: true,
        funciones: 'Diseño de sistemas ñoños\n¿Verificación? ¡Sí!\nCosto: €45.000 — ahorro 30%\nRango: 10–20 µm\nComillas: “así” y ‘así’'
      }],
      education: [{
        institucion: 'Ünïversidad Ñ', programa: 'Ç ç ü ö', horas: 10, nota: 7, ano: 2020
      }],
      skills: {
        ñandú: ['Ñoño', 'ÜBER-herramienta', '€uro'],
        îndex: ['Índice', 'Ñandú'],
        idiomas: ['Español nativo', 'Alemán B1']
      },
      certifications: [{ nombre: 'Certificación €1000', institucion: 'Ñandú', horas: 5, nota: 10, ano: 2021 }],
      projects: [{
        nombre: 'Proyecto ñ',
        descripcion: 'Descripción con acentos: áéíóúüñ ¿ ¡ € – — “ ” ‘ ’ 🚀',
        tecnologias: 'Ñ, Ü, €'
      }]
    },
    aguja: 'José Ñuñez',
    /* El emoji entra en los DATOS a proposito y NO en `literales`. WinAnsi
       Encoding (el que escribe jsPDF con las fuentes base) solo representa el
       rango latino: un emoji no tiene byte posible, asi que el motor lo
       convierte con su tabla de reemplazo y sale basura visible. Se mide aparte
       para que quede constancia del defecto sin teñir de rojo el chequeo de
       acentos, que es el que de verdad importa. */
    emoji: { entrada: '🚀', donde: 'projects[0].descripcion' },
    literales: [
      'José Ñuñez',
      '¿Sistemas?',
      '¡Excelente!',
      'Compañía Ñandú S.A.',
      '“Sucursal”',
      'Zürich, Ätaland',
      'Diseño de sistemas ñoños',
      '¿Verificación? ¡Sí!',
      'Costo: €45.000 — ahorro 30%',
      'Rango: 10–20 µm',
      'Comillas: “así” y ‘así’',
      'Ünïversidad Ñ',
      'Ñoño',
      'ÜBER-herramienta',
      '€uro',
      'Índice',
      'Certificación €1000',
      'áéíóúüñ',
      'Ñ, Ü, €'
    ],
    espera: {
      items: 4,
      itemsPorSeccion: { experiencia: 1, educacion: 1, certificaciones: 1, proyectos: 1 },
      habilidadesCategorias: 2, habilidadesItems: 5, idiomas: 2,
      secciones: TODAS_LAS_SECCIONES.slice()
    }
  };

  /* ---- 7. vacio: null / undefined / vacio en todas las secciones -------- */
  const fVacio = {
    id: 'vacio',
    titulo: 'datos vacios, null y undefined en todas las secciones',
    datos: {
      personal: {
        nombre: null, cargo: undefined, telefono: null, email: undefined,
        direccion: '', ciudad: '   ', idiomas: '', github: null, portafolio: undefined,
        sitio: '', rut: '', fechaNacimiento: '', nacionalidad: '',
        estadoCivil: '', disponibilidad: '', objetivo: undefined
      },
      focusArea: undefined,
      focusAreas: null,
      experience: null,
      education: undefined,
      certifications: null,
      projects: null,
      skills: { frontend: [], backend: null, devops: undefined, seguridad: [], marketing: [], idiomas: [] }
    },
    aguja: null,
    /* Un CV sin datos NO puede tener texto: exigir "texto no vacio" aqui seria
       exigir un fallo. Lo que este fixture exige es lo contrario y mas fuerte:
       que el motor NO lance, que produzca un PDF valido de al menos una pagina y
       que no invente nada. El texto no vacio se mide en los otros 9 fixtures. */
    textoVacioEsperado: true,
    espera: {
      items: 0,
      itemsPorSeccion: { experiencia: 0, educacion: 0, certificaciones: 0, proyectos: 0 },
      habilidadesCategorias: 0, habilidadesItems: 0, idiomas: 0,
      secciones: []
    }
  };

  /* ---- 8. densidad: partido forzado en todos los estilos ----------------
     Fixture construido SOLO para el chequeo de interlineado. Cada bloque es
     largo a proposito para que se parta en varias lineas con TODOS los estilos
     que el motor usa en columna (nombre 18, titular y seccion 10.5, item 10,
     secundario y cuerpo 9.5, meta 8.5, contacto 9, pastilla 7.5). Sin el, el
     interlineado de un estilo que nunca envuelve (los titulos de seccion, por
     ejemplo) no se puede medir. */
  const fDensidad = {
    id: 'densidad',
    titulo: 'partido forzado en todos los estilos (para el chequeo de interlineado)',
    datos: {
      personal: {
        nombre: 'Densidad Maxima',
        cargo: 'Titular Con Un Texto Suficientemente Largo Para Partirse En Varias Lineas De Verdad',
        telefono: '+56 9 1234 5678', email: 'densidad@ejemplo.cl',
        direccion: 'Calle Densidad 123', ciudad: 'Santiago',
        idiomas: 'Espanol nativo',
        github: 'https://github.com/densidad/probando-el-interlineado-de-la-maquina',
        portafolio: 'https://ejemplo.cl/un/portafolio/bastante/largo/para/que/embuelva',
        rut: '12.345.678-9', fechaNacimiento: '1990-01-01', nacionalidad: 'Chilena',
        estadoCivil: 'Soltero', disponibilidad: 'Inmediata',
        objetivo: 'Este objetivo es deliberadamente largo para forzar el partido del bloque de cuerpo en varias lineas consecutivas y asi poder medir el avance real entre lineas del estilo secundario.'
      },
      focusArea: 'integral',
      focusAreas: focusAreas,
      experience: [{
        empresa: 'Empresa De Densidad Con Un Razonamiento Social Extenso Y Suficientemente Largo',
        cargo: 'Cargo Concreto Con Descripcion Extensa Para Comprobar El Interlineado Del Estilo De Item',
        ubicacion: 'Ciudad Grande De Prueba 1234',
        fechaInicio: '2019-01', fechaFin: '', presente: true,
        funciones: 'Este es el detalle de la funcion uno y es deliberadamente largo para que el motor tenga que partirlo en tres lineas o mas y poder medir el avance entre ellas sin trampas.\nSegundo detalle de la funcion con longitud suficiente para provocar al menos un salto de linea en el ancho de la columna principal.\nTercer detalle corto.'
      }],
      education: [{
        institucion: 'Institucion De Densidad Con Nombre Extenso Para Generar Al Menos Dos Lineas',
        programa: 'Programa De Densidad Con Un Titulo larguisimo que no cabe en una sola linea del ancho util',
        horas: 462, nota: 7, ano: 2026
      }],
      certifications: [{
        nombre: 'Certificacion De Densidad Con Un Nombre Tan Extenso Que Necesita Varias Lineas',
        institucion: 'Instituto De Densidad Con Razon Social Larga Para Forzar El Partido Del Subtitulo',
        horas: 40, nota: 100, ano: 2025
      }],
      projects: [{
        nombre: 'Proyecto De Densidad Con Un Titulo Extenso Para Forzar La Caja Grande',
        descripcion: 'Descripcion del proyecto de densidad deliberadamente larga para que la caja del proyecto tenga que repartirse o al menos partir su descripcion en varias lineas consecutivas del estilo de cuerpo.',
        tecnologias: 'Python, Densidad, Interlineado, Medicion, Verificacion, Automatizacion'
      }],
      skills: {
        primera: ['Densidad', 'Interlineado', 'Medicion'],
        segunda: ['Verificacion', 'Automatizacion', 'Documentacion'],
        idiomas: ['Espanol nativo']
      }
    },
    aguja: 'densidad@ejemplo.cl',
    espera: {
      items: 4,
      itemsPorSeccion: { experiencia: 1, educacion: 1, certificaciones: 1, proyectos: 1 },
      habilidadesCategorias: 2, habilidadesItems: 6, idiomas: 1,
      secciones: TODAS_LAS_SECCIONES.slice()
    }
  };

  /* ---- 9. numeros-lentos: campos numericos sin sentido ------------------
     horas 0 y negativas, nota null / 'NaN' / texto no numerico / '-', anio null,
     presente false sin fechaFin, fecha como objeto, funciones como array.
     Comprueba numeroTexto() y que no se imprima jamas un NaN, un Infinity ni un
     "0 h" fantasma. */
  const fNumeros = {
    id: 'numeros-lentos',
    titulo: 'horas 0, nota null/NaN/texto, anio null, presente sin fechaFin',
    datos: {
      personal: {
        nombre: 'Numeros Lentos', cargo: 'Probador', telefono: '+56 9 1234 5678',
        email: 'numeros@ejemplo.cl', direccion: 'Calle 2', ciudad: 'Santiago',
        idiomas: 'Espanol nativo, Ingles B1, Portugues B2, Frances A2, Italiano B1',
        github: '', portafolio: '', sitio: '', rut: '1.234.567-8',
        fechaNacimiento: '1980-12-31', nacionalidad: 'Chilena',
        estadoCivil: 'Casado', disponibilidad: '30 dias'
      },
      focusArea: 'integral',
      focusAreas: focusAreas,
      experience: [
        { empresa: 'Sin Fechas', cargo: 'Sin Rango', ubicacion: '', fechaInicio: '', fechaFin: '', presente: false, funciones: '' },
        /* El TITULO no puede llevar escrito el token "NaN": el check
           ats.sin-basura lo busca tal cual en el texto extraido, y texto()
           (js/pdfgen.js:306) solo descarta los valores que son EXACTAMENTE
           "NaN"/"null"/"undefined", no los que lo contienen. El dato sucio de
           verdad viaja en education[1].nota, que si se descarta. */
        { empresa: 'Numero Raro', cargo: 'Cargo Con Numero No Numerico', ubicacion: 'X', fechaInicio: '2020-01', fechaFin: '', presente: true, funciones: 'Una sola funcion sin acentos' },
        { empresa: 'Con Tipo Raro', cargo: 'Fecha Como Objeto', ubicacion: 'Y', fechaInicio: { anio: 2020 }, fechaFin: 2021, presente: true, funciones: ['array', 'de', 'funciones'] }
      ],
      education: [
        { institucion: 'Sin Horas', programa: 'Programa Sin Horas', horas: 0, nota: null, estado: '', ano: null },
        { institucion: 'Nota Nan', programa: 'Programa Con Nota Nan', horas: -5, nota: 'NaN', estado: 'X', ano: 'n/d' },
        { institucion: 'Nota Texto', programa: 'Programa Con Nota De Texto', horas: 'muchas', nota: 'Aprobado', estado: 'Completo', ano: 2024 }
      ],
      certifications: [
        { nombre: 'Cert Sin Nada', institucion: '', horas: null, nota: null, ano: null },
        { nombre: 'Cert Con Cero', institucion: 'Inst', horas: 0, nota: 0, ano: 0 }
      ],
      projects: [
        { nombre: 'Proyecto Sin Descripcion', descripcion: '', tecnologias: '' },
        { nombre: 'Proyecto Con Numeros', descripcion: 'Descripcion con numeros 1234567890', tecnologias: 'A, B, C' }
      ],
      skills: {
        conVacios: ['', '   ', 'Real', '-', 'n/a', 'null'],
        /* La CLAVE de la categoria no puede contener el token "NaN": el motor la
           imprime como titulo (capitalizar -> "ConNaN") y ats.sin-basura lo
           detectaria como basura, aunque los VALORES (que es lo que se prueba) si
           se descarten bien. Los valores sucios van aqui dentro. */
        sucios: ['NaN', 'undefined', 'Valido'],
        idiomas: ['Espanol nativo', 'Ingles B1']
      }
    },
    aguja: 'Numeros Lentos',
    espera: {
      items: 10,
      itemsPorSeccion: { experiencia: 3, educacion: 3, certificaciones: 2, proyectos: 2 },
      habilidadesCategorias: 2, habilidadesItems: 2, idiomas: 5,
      secciones: TODAS_LAS_SECCIONES.slice()
    }
  };

  /* ---- 10. skills-array: habilidades como lista plana --------------------
     El motor acepta `skills` como array plano (una sola categoria, "Otros")
     ademas de como objeto. Esa forma la produce cualquier importador de datos
     que no clasifique; si el motor la acepta, el harness la ACCOUNTAR. */
  const fArray = {
    id: 'skills-array',
    titulo: 'skills como array plano en vez de objeto por categorias',
    datos: {
      personal: clonar(real.personal),
      focusArea: real.focusArea,
      focusAreas: focusAreas,
      experience: [clonar(real.experience[0]), clonar(real.experience[5])],
      education: [clonar(real.education[0])],
      certifications: [clonar(real.certifications[0])],
      projects: [clonar(real.projects[0])],
      skills: ['React', 'Python', 'Docker', 'SEO', 'CCTV', null, '   ', 'Git']
    },
    aguja: 'Comercio Ejemplo Ltda',
    espera: {
      items: 5,
      itemsPorSeccion: { experiencia: 2, educacion: 1, certificaciones: 1, proyectos: 1 },
      habilidadesCategorias: 1, habilidadesItems: 6, idiomas: 2,
      secciones: TODAS_LAS_SECCIONES.slice()
    }
  };

  return [fReal, f0, f40, fExp13, fLargo, fAcentos, fVacio, fDensidad, fNumeros, fArray];
}

/* ==========================================================================
 * 5. POPPLER
 * ========================================================================== */

function resolverPoppler() {
  const sufijo = process.platform === 'win32' ? '.exe' : '';
  for (const dir of RUTAS_POPPLER) {
    const pdftotext = path.join(dir, 'pdftotext' + sufijo);
    const pdftoppm = path.join(dir, 'pdftoppm' + sufijo);
    if (fs.existsSync(pdftotext) && fs.existsSync(pdftoppm)) return { dir: dir, pdftotext: pdftotext, pdftoppm: pdftoppm };
  }
  throw new Error('no se encontro Poppler (pdftotext + pdftoppm). Rutas probadas:\n  ' +
    RUTAS_POPPLER.join('\n  ') + '\nDefina POPPLER_BIN con la carpeta que los contiene.');
}

function poppler(bin, args) {
  return execFileSync(bin, args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
}

/* ==========================================================================
 * 6. LECTOR DEL PDF (content stream): posiciones y tamanos de fuente exactos
 *
 *    Se recorre el PDF como bytes latin1 (NO como texto Unicode: el byte de un
 *    glifo acentuado no es un caracter y se perderia), se localizan los
 *    objetos, se sigue /Contents de cada /Type /Page y se tokeniza el stream.
 *    jsPDF escribe cada Show-Text dentro de su propio BT/ET con un Td medido
 *    desde la matriz de texto (que BT pone a identidad), asi que un Td seguido
 *    de un Tj da coordenadas absolutas. Aun asi se acumula la matriz para que
 *    un Td relativo dentro de un bloque multilinea tambien funcione.
 * ========================================================================== */

function leerObjetos(buf) {
  const s = buf.toString('latin1');
  const mapa = new Map();
  const re = /(\d+)\s+0\s+obj\b([\s\S]*?)\bendobj/g;
  let m;
  while ((m = re.exec(s)) !== null) mapa.set(Number(m[1]), m[2]);
  return mapa;
}

function streamDe(cuerpo) {
  const i = cuerpo.indexOf('stream');
  if (i < 0) return '';
  let ini = i + 6;
  if (cuerpo.charAt(ini) === '\r') ini++;
  if (cuerpo.charAt(ini) === '\n') ini++;
  const fin = cuerpo.lastIndexOf('endstream');
  if (fin < ini) return '';
  const bruto = Buffer.from(cuerpo.slice(ini, fin), 'latin1');
  if (/FlateDecode/.test(cuerpo.slice(0, i))) {
    try { return zlib.inflateSync(bruto).toString('latin1'); } catch (e) { return ''; }
  }
  return bruto.toString('latin1');
}

/** Tokeniza un content stream: cadenas, nombres, numeros, operadores. */
function tokenizar(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s.charAt(i);
    if (c === '(') {
      let nivel = 1, j = i + 1, txt = '';
      while (j < s.length && nivel > 0) {
        const ch = s.charAt(j);
        if (ch === '\\') { txt += s.charAt(j + 1); j += 2; continue; }
        if (ch === '(') nivel++;
        else if (ch === ')') { nivel--; if (nivel === 0) break; }
        txt += ch; j++;
      }
      out.push({ t: 'str', v: txt });
      i = j + 1; continue;
    }
    if (c === '<' && s.charAt(i + 1) !== '<') {
      const j = s.indexOf('>', i);
      if (j < 0) break;
      out.push({ t: 'hex', v: s.slice(i + 1, j) });
      i = j + 1; continue;
    }
    if (c === '/') {
      let j = i + 1;
      while (j < s.length && /[^\s()\/<>\[\]]/.test(s.charAt(j))) j++;
      out.push({ t: 'name', v: s.slice(i + 1, j) });
      i = j; continue;
    }
    if (/[-+0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[-+0-9.eE]/.test(s.charAt(j))) j++;
      const v = parseFloat(s.slice(i, j));
      if (isFinite(v)) { out.push({ t: 'num', v: v }); i = j; continue; }
      i++; continue;
    }
    if (/[A-Za-z'"*[\]]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9*'"\[\]]/.test(s.charAt(j))) j++;
      out.push({ t: 'op', v: s.slice(i, j) });
      i = j; continue;
    }
    i++;
  }
  return out;
}

/**
 * Devuelve, por pagina y en orden de pagina, las operaciones de texto con su
 * linea base y su tamano de fuente, en MILIMETROS con origen arriba-izquierda
 * (el mismo sistema con el que trabaja js/pdfgen.js).
 */
function leerLineasDeTexto(buf) {
  const objetos = leerObjetos(buf);
  const latin = buf.toString('latin1');
  const paginas = [];
  for (const num of objetos.keys()) {
    const cuerpo = objetos.get(num);
    if (!/\/Type\s*\/Page[^s]/.test(cuerpo)) continue;
    const c = cuerpo.match(/\/Contents\s+(\d+)\s+0\s+R/);
    if (!c) continue;
    paginas.push({ obj: num, contenido: Number(c[1]) });
  }
  /* Orden de pagina: por numero de objeto. jsPDF numera los objetos segun el
     orden de escritura, que en este motor coincide con el orden de pagina. */
  paginas.sort(function (a, b) { return a.obj - b.obj; });

  const mb = latin.match(/\/MediaBox\s*\[\s*[\d.]+\s+[\d.]+\s+[\d.]+\s+([\d.]+)\s*\]/);
  const altoPt = mb ? parseFloat(mb[1]) : 841.89;

  return paginas.map(function (pg) {
    const cuerpo = objetos.get(pg.contenido);
    const filas = [];
    let tam = 0, x = 0, y = 0, pend = [];
    for (const tk of tokenizar(cuerpo ? streamDe(cuerpo) : '')) {
      if (tk.t !== 'op') { pend.push(tk); continue; }
      if (tk.v === 'BT') { x = 0; y = 0; }
      else if (tk.v === 'Tf') {
        const n = pend[pend.length - 1];
        if (n && n.t === 'num') tam = n.v;
      } else if (tk.v === 'Td' || tk.v === 'TD') {
        const b = pend.slice(-2);
        if (b.length === 2 && b[0].t === 'num' && b[1].t === 'num') { x += b[0].v; y += b[1].v; }
      } else if (tk.v === 'Tm') {
        const b = pend.slice(-6);
        if (b.length === 6 && b[4].t === 'num' && b[5].t === 'num') { x = b[4].v; y = b[5].v; }
      } else if (tk.v === 'Tj' || tk.v === 'TJ' || tk.v === "'" || tk.v === '"') {
        let txt = '';
        for (const o of pend) if (o.t === 'str') txt += o.v;
        if (txt.trim().length) {
          filas.push({ x: x / PT_POR_MM, y: (altoPt - y) / PT_POR_MM, tam: tam, txt: txt });
        }
      }
      pend = [];
    }
    return filas;
  });
}

/* ==========================================================================
 * 7. LECTOR DE pdftotext -bbox: cajas de tinta reales, en mm
 * ========================================================================== */

function desescaparXml(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Devuelve, por pagina, las cajas de tinta de cada palabra, en mm. */
function leerCajasDeTinta(bboxHtml) {
  const paginas = [];
  const rePag = /<page\b[^>]*>([\s\S]*?)<\/page>/g;
  const rePal = /<word\s+xMin="([\d.-]+)"\s+yMin="([\d.-]+)"\s+xMax="([\d.-]+)"\s+yMax="([\d.-]+)"\s*>([\s\S]*?)<\/word>/g;
  let mp;
  while ((mp = rePag.exec(bboxHtml)) !== null) {
    const palabras = [];
    let mw;
    while ((mw = rePal.exec(mp[1])) !== null) {
      palabras.push({
        x0: parseFloat(mw[1]) * MM_POR_PT, y0: parseFloat(mw[2]) * MM_POR_PT,
        x1: parseFloat(mw[3]) * MM_POR_PT, y1: parseFloat(mw[4]) * MM_POR_PT,
        txt: desescaparXml(mw[5])
      });
    }
    paginas.push(palabras);
  }
  return paginas;
}

/* El pie de pagina vive en el margen inferior por diseno (PIE_Y = 289 mm con
   un limite inferior de 281). Para no banalizar el chequeo de "nada bajo el
   limite", solo se acepta como pie una LINEA COMPLETA cuya y este en el margen
   inferior y que ademas tenga la forma "Pagina N de M": un texto de cuerpo que
   se derrame ahi no podria pasar por el filtro. */
function marcarPiesDePagina(cajas, limiteInferior) {
  const permitidos = new Set();
  cajas.forEach(function (palabras) {
    const enMargen = palabras.filter(function (w) { return w.y0 > limiteInferior; });
    if (!enMargen.length) return;
    const lineas = new Map();
    for (const w of enMargen) {
      const clave = Math.round(w.y0 * 2);
      if (!lineas.has(clave)) lineas.set(clave, []);
      lineas.get(clave).push(w);
    }
    for (const grupo of lineas.values()) {
      grupo.sort(function (a, b) { return a.x0 - b.x0; });
      const texto = grupo.map(function (w) { return w.txt; }).join(' ');
      if (/^(P[a\u00E1]gina)\s+\d+\s+de\s+\d+$/i.test(texto.trim())) {
        for (const w of grupo) permitidos.add(w);
      }
    }
  });
  return permitidos;
}

/* ==========================================================================
 * 8. COLECTOR DE CHEQUEOS
 *    FALLA = regresion real -> el harness sale con codigo 1.
 *    AVISO = limitacion conocida y explicada -> no ensucia el codigo de salida.
 *    N/A   = no aplica a este caso, con el porque en `detalle`.
 * ========================================================================== */

function crearColector() {
  const checks = [];
  return {
    checks: checks,
    add: function (n, e, v, x, d) { checks.push({ nombre: n, estado: e, valor: v, esperado: x, detalle: d || '' }); },
    ok: function (n, v, e, d) { this.add(n, OK, v, e, d); },
    falla: function (n, v, e, d) { this.add(n, FALLA, v, e, d); },
    aviso: function (n, v, e, d) { this.add(n, AVISO, v, e, d); },
    na: function (n, v, e, d) { this.add(n, NA, v, e, d); },
    /* `cond` es la condicion de EXITO: se registra FALLA cuando NO se cumple. */
    fallaSi: function (cond, n, v, e, d) { if (cond) this.ok(n, v, e, d); else this.falla(n, v, e, d); }
  };
}

/* Tolerancia al comparar el avance DIBUJADO entre dos lineas con el
   interlineado DECLARADO (TIPO[].inter). El motor dibuja cada linea con una y
   explicita a multiplos exactos de inter, asi que la diferencia real es del orden
   del redondeo al escribir el numero en el PDF. */
const TOL_AVANCE = 0.15;

/* Interlineado declarado por el motor para un tamano de fuente dado, en mm, o
   null si ningun estilo de TIPO usa ese tamano. */
function interDeTipo(motor, tam) {
  if (!esNumero(tam)) return null;
  let mejor = null;
  for (const k in motor.TIPO) {
    if (!Object.prototype.hasOwnProperty.call(motor.TIPO, k)) continue;
    if (motor.TIPO[k].tam !== tam) continue;
    if (mejor === null || motor.TIPO[mejor].inter < motor.TIPO[k].inter) mejor = k;
  }
  return mejor === null ? null : motor.TIPO[mejor].inter;
}

/**
 * Un RENGLON es un bloque de lineas consecutivas que forman un mismo parrafo
 * envuelto. No se puede trabajar con "lineas del mismo x y tamaño" porque en
 * una pagina con 47 items eso mete en el mismo grupo los titulos de los cuatro
 * bloques de secciones: las dos lineas de un titulo partido quedan separadas por
 * las de los demas y el motor parece haber perdido el texto.
 *
 * Dos lineas consecutive son del MISMO renglon cuando su distancia vertical es
 * el interlineado DECLARADO del estilo (TIPO[].inter). Ese es el contrato del
 * motor, escrito en una sola linea de codigo (escribirLineas dibuja cada linea
 * con y = yBase0 + i*inter), asi que es la unica prueba fiable de "el motor
 * ENVOLVIO esto y no es un parrafo nuevo".
 *
 * Y NO se puede usar un umbral relativo (1.3x, 1.6 em): el espacio de parrafo es
 * una constante de 1.2 mm, o sea un 28% del interlineado de un cuerpo de 9.5pt.
 * Cualquier umbral proporcional lo deja pasar como si fuera una linea envuelta
 * y el avance medido sale contaminado con el espacio de parrafo. Y si el umbral
 * se deriva de la banda aceptada (1.15-1.6 em) el defecto se esconde al reves:
 * un interlineado de 3.6 em pareceria un salto de parrafo, sus lineas quedarian
 * en renglones de una y el check concluiria "aquí no hay interlineado que medir"
 * justo en el check que existe para cazar eso.
 *
 * Orden: las coordenadas de leerLineasDeTexto() tienen origen ARRIBA-IZQUIERDA,
 * asi que la linea siguiente esta mas abajo y tiene la y MAYOR. Ordenar por y
 * CRECIENTE da deltas positivos.
 */
function partirEnRenglones(filas, motor) {
  const orden = filas.slice().sort(function (a, b) { return a.y - b.y; });
  const renglones = [];
  let actual = [];
  for (const f of orden) {
    if (!actual.length) { actual.push(f); continue; }
    const previo = actual[actual.length - 1];
    const declarado = motor ? interDeTipo(motor, f.tam) : null;
    if (declarado !== null && Math.abs((f.y - previo.y) - declarado) <= TOL_AVANCE) {
      actual.push(f);
      continue;
    }
    renglones.push(actual);
    actual = [f];
  }
  if (actual.length) renglones.push(actual);
  return renglones;
}

/** Todas las lineas del PDF agrupadas en RENGLONES (ver partirEnRenglones). */
function renglonesDeLineas(plantilla, lineas, motor) {
  const grupos = new Map();
  lineas.forEach(function (filas, pi) {
    for (const f of filas) {
      const col = (plantilla === '1' && f.x < BANDA_ANCHO_MM) ? 'banda' : 'principal';
      const clave = pi + '|' + col + '|' + redondear(f.x, 2) + '|' + f.tam;
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave).push(f);
    }
  });
  const salida = [];
  for (const filas of grupos.values()) {
    for (const r of partirEnRenglones(filas, motor)) salida.push(r);
  }
  return salida;
}

/** Busca `aguja` entre las lineas realmente dibujadas. Devuelve las lineas en
 *  que quedo, o null. Primero exige coincidencia exacta de UNA linea; si no la
 *  hay, acumula lineas consecutivas del mismo renglon (que es como el motor
 *  representa una needle partida). */
function hallarLineas(renglones, aguja) {
  const objetivo = normalizar(aguja);
  if (!objetivo) return null;
  for (const renglon of renglones) {
    for (const f of renglon) if (normalizar(f.txt) === objetivo) return [f.txt];
  }
  for (const renglon of renglones) {
    for (let i = 0; i < renglon.length; i++) {
      let pos = 0, j = i;
      while (j < renglon.length && pos < objetivo.length) {
        const l = normalizar(renglon[j].txt);
        if (!l) { j++; continue; }
        const resto = objetivo.slice(pos);
        if (resto === l) { pos = objetivo.length; j++; break; }
        if (resto.indexOf(l) === 0) {
          pos += l.length;
          /* El corte de linea se traga el espacio que habia entre las dos
             palabras: sin esto el resto del needle empieza con un espacio que la
             linea siguiente no tiene y el caso NUNCA cierra, que es exactamente
             lo que pasaba con los titulos partidos de los items largos. */
          while (pos < objetivo.length && /\s/.test(objetivo.charAt(pos))) pos++;
          j++;
          continue;
        }
        if (l.indexOf(resto) === 0) { pos = objetivo.length; break; }
        break;
      }
      if (pos >= objetivo.length) return renglon.slice(i, j).map(function (f) { return f.txt; });
    }
  }
  return null;
}

/** Cajas de las columnas de una plantilla, leidas del motor. */
function cajasDeColumna(plantilla, motor) {
  const P = motor.PAGINA, M = motor.MARGENES;
  if (plantilla !== '1') {
    return [{ nombre: 'principal', x0: M.izquierda, x1: P.ancho - M.derecha, y0: M.arriba, y1: motor.LIMITE_INFERIOR }];
  }
  return [
    { nombre: 'banda', x0: 0, x1: BANDA_ANCHO_MM, y0: M.arriba, y1: motor.LIMITE_INFERIOR },
    { nombre: 'principal', x0: PRINCIPAL_X_MM, x1: P.ancho - M.derecha, y0: M.arriba, y1: motor.LIMITE_INFERIOR }
  ];
}

/** Lineas del PDF agrupadas en renglones por pagina + columna + x + tamano. */
function agruparLineas(plantilla, lineas, motor) {
  return renglonesDeLineas(plantilla, lineas, motor);
}

/** Agujas de identificacion de cada item, con su seccion y si es unico. */
function needlesDeItems(fixture) {
  const d = fixture.datos || {};
  const out = [];
  function anadir(seccion, lista, claves) {
    (Array.isArray(lista) ? lista : []).forEach(function (item, i) {
      if (!item || typeof item !== 'object') return;
      for (const k of claves) {
        const v = item[k];
        if (v === undefined || v === null || typeof v === 'object') continue;
        if (String(v).trim() === '') continue;
        out.push({ seccion: seccion, aguja: String(v), idx: i, unico: true });
        return;
      }
    });
  }
  anadir('experiencia', d.experience, ['cargo', 'empresa']);
  anadir('educacion', d.education, ['programa', 'titulo', 'institucion']);
  anadir('certificaciones', d.certifications, ['nombre', 'programa']);
  anadir('proyectos', d.projects, ['nombre']);
  /* Un texto que se repite en otra seccion no se puede contar por ocurrencia:
     "aparecer una vez" no distingue "se imprimio dos veces" de "se imprimio una
     y el ATS lo ve dos". Esos pasan a exigir >= 1 en vez de == 1. */
  const cuenta = new Map();
  for (const n of out) {
    const k = normalizar(n.aguja);
    cuenta.set(k, (cuenta.get(k) || 0) + 1);
  }
  for (const n of out) if (cuenta.get(normalizar(n.aguja)) > 1) n.unico = false;
  return out;
}

/* ==========================================================================
 * 9. DENSIDAD / INTERLINEADO  (ver comentario largo arriba de medirDensidad)
 * ========================================================================== */

function nombreDeTipo(motor, tam) {
  let mejor = null;
  for (const k in motor.TIPO) {
    if (!Object.prototype.hasOwnProperty.call(motor.TIPO, k)) continue;
    if (motor.TIPO[k].tam !== tam) continue;
    if (mejor === null || motor.TIPO[mejor].inter < motor.TIPO[k].inter) mejor = k;
  }
  return mejor;
}

function medirDensidad(col, ctx, motor, plantilla, lineas) {
  const porEstilo = new Map();
  /* Deltas CRUDOS entre lineas consecutivas del mismo grupo (pagina + columna +
     x + tamano), sin respetar los cortes de renglon. Van aparte de los deltas de
     renglon porque sirven para el chequeo de solape, que DEBE poder ver el
     defecto que hunt: si dos lineas se solapan, su distancia no es el
     interlineado declarado, no forman renglon, y un chequeo que solo mirara
     dentro de los renglones no tendria nada que mirar. Exactamente por eso el
     solape se mide sobre todos los deltas y el interlineado solo sobre los de
     renglon. */
  const deltasCrudos = [];
  function anotar(tam, d) {
    if (!esNumero(tam) || d <= 0) return;
    deltasCrudos.push({ tam: tam, d: d });
    if (!porEstilo.has(tam)) porEstilo.set(tam, { deltas: [] });
    porEstilo.get(tam).deltas.push(d);
  }
  lineas.forEach(function (filas) {
    for (const renglon of renglonesDeLineas(plantilla, [filas], motor)) {
      for (let i = 1; i < renglon.length; i++) {
        anotar(renglon[i].tam, renglon[i].y - renglon[i - 1].y);   /* mm; abajo es positivo */
      }
    }
    /* Pares consecutivos aunque esten en renglones distintos: es lo que permite
       ver un solape. Se recalcula el grupo con la misma clave que
       renglonesDeLineas para no mezclar columnas ni paginas. */
    const grupos = new Map();
    for (const f of filas) {
      const col2 = (plantilla === '1' && f.x < BANDA_ANCHO_MM) ? 'banda' : 'principal';
      const clave = col2 + '|' + redondear(f.x, 2) + '|' + f.tam;
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave).push(f);
    }
    for (const g of grupos.values()) {
      g.sort(function (a, b) { return a.y - b.y; });
      for (let i = 1; i < g.length; i++) {
        const d = g[i].y - g[i - 1].y;
        if (d <= 0) continue;
        if (!esNumero(g[i].tam)) continue;
        deltasCrudos.push({ tam: g[i].tam, d: d });
      }
    }
  });

  /* 1. sin solape: ningun avance por debajo de 1.15 em. */
  const solapes = [];
  for (const r of deltasCrudos) {
    const limite = INTERLINEADO_MIN_EM * (r.tam * MM_POR_PT);
    if (r.d < limite - 0.05) {
      solapes.push(r.tam + 'pt: ' + redondear(r.d, 2) + 'mm < ' + redondear(limite, 2) + 'mm');
    }
  }
  col.fallaSi(solapes.length === 0, 'densidad.sin-solape', solapes.length + ' solapes',
    '0 (todo avance >= ' + INTERLINEADO_MIN_EM + ' em)', solapes.slice(0, 4).join(' | '));

  /* 2. interlineado de los estilos que SI partieron alguna linea. */
  const medidos = [];
  const fuera = [];
  for (const [tam, reg] of porEstilo) {
    const em = tam * MM_POR_PT;
    const nombreTipo = nombreDeTipo(motor, tam);
    if (nombreTipo === null) continue;
    const inter = motor.TIPO[nombreTipo].inter;
    const coincide = reg.deltas.filter(function (d) { return Math.abs(d - inter) <= TOL_AVANCE; });
    if (!coincide.length) continue;
    const min = Math.min.apply(null, coincide);
    const max = Math.max.apply(null, coincide);
    const ratio = inter / em;
    const rango = (max - min) <= TOL_AVANCE ? '' : ' (dibujado ' + redondear(min, 2) + '-' + redondear(max, 2) + 'mm)';
    medidos.push(nombreTipo + ' ' + redondear(ratio, 2) + 'em x' + coincide.length + rango);
    if (ratio < INTERLINEADO_MIN_EM - 0.001 || ratio > INTERLINEADO_MAX_EM) {
      fuera.push(nombreTipo + ' ' + tam + 'pt: avance ' + redondear(inter, 3) + 'mm = ' + redondear(ratio, 2) + ' em');
    }
  }
  if (!medidos.length) {
    /* N/A y no AVISO: que en este caso ningun estilo envuelva una linea es una
       propiedad del FIXTURE, no una limitacion del motor ni del harness. Lo que
       garantiza que el interlineado se midio de verdad es el chequeo de corrida
       densidad.cobertura, que exige un minimo de estilos medidos en el conjunto. */
    col.na('densidad.interlineado', 'sin lineas partidas en este caso',
      INTERLINEADO_MIN_EM + '-' + INTERLINEADO_MAX_EM + ' em',
      'ningun estilo envuelve una linea aqui: no hay interlineado que medir (ver densidad.cobertura)');
    return;
  }
  col.fallaSi(fuera.length === 0, 'densidad.interlineado', medidos.join(', '),
    INTERLINEADO_MIN_EM + '-' + INTERLINEADO_MAX_EM + ' em', fuera.join(' | '));
  for (const m of medidos) {
    const tipo = m.split(' ')[0];
    if (!ctx.estilosMedidos[tipo]) ctx.estilosMedidos[tipo] = m;
  }
}

/* ==========================================================================
 * 10. UN CASO = fixture x plantilla
 * ========================================================================== */

function ejecutarCaso(ctx, fixture, plantilla) {
  const col = crearColector();
  const motor = ctx.motor;
  const nombre = fixture.id + '/t' + plantilla;
  const base = path.join(ctx.outdir, fixture.id + '-t' + plantilla);

  /* ---- GENERACION ------------------------------------------------------ */
  let doc = null, pdf = null, error = null;
  try {
    doc = motor.generarPDFCv(fixture.datos, plantilla, { JsPDFCtor: ctx.JsPDF, compress: false });
    pdf = Buffer.from(doc.output('arraybuffer'));
    fs.writeFileSync(base + '.pdf', pdf);
  } catch (e) {
    error = e;
  }

  if (error) {
    col.falla('gen.sin-excepcion', 'EXCEPCION: ' + String(error.message).split('\n')[0], 'generarPDFCv no lanza');
    return cerrarCaso(ctx, fixture, plantilla, nombre, col, null, error);
  }

  const paginas = doc.getNumberOfPages();
  const diag = doc.__pdfgen.diagnostico;
  const e = fixture.espera;

  /* ---- ARCHIVO --------------------------------------------------------- */
  const cabecera = pdf.slice(0, 4).toString('latin1');
  col.fallaSi(cabecera === '%PDF', 'archivo.magic', cabecera, '%PDF');
  col.fallaSi(pdf.length >= PDF_BYTES_MIN && pdf.length <= PDF_BYTES_MAX, 'archivo.tamano',
    pdf.length + ' B', PDF_BYTES_MIN + '-' + PDF_BYTES_MAX + ' B');
  col.fallaSi(paginas >= 1, 'gen.paginas', paginas, '>= 1');

  /* ---- POPPLER --------------------------------------------------------- */
  poppler(ctx.poppler.pdftotext, ['-enc', 'UTF-8', base + '.pdf', base + '.txt']);
  const texto = fs.readFileSync(base + '.txt', 'utf8');
  poppler(ctx.poppler.pdftotext, ['-enc', 'UTF-8', '-bbox', base + '.pdf', base + '-bbox.html']);
  const cajas = leerCajasDeTinta(fs.readFileSync(base + '-bbox.html', 'utf8'));
  const lineas = leerLineasDeTexto(pdf);

  const sinPie = texto.split(/\r?\n/).filter(function (l) { return !/^P[a\u00E1]gina\s+\d+\s+de\s+\d+$/i.test(l.trim()); }).join('\n');

  /* ---- ATS / TEXTO ----------------------------------------------------- */
  if (fixture.textoVacioEsperado) {
    col.na('ats.texto-no-vacio', '0 car. de contenido (por diseno)',
      '> 0 en los fixtures con datos',
      'este fixture no tiene datos: que no haya texto es el resultado correcto; lo que se le exige es que el motor no lance y el PDF sea valido');
  } else {
    col.fallaSi(/\S/.test(sinPie), 'ats.texto-no-vacio',
      sinPie.replace(/\s+/g, ' ').trim().length + ' car.', '> 0 (texto real, no imagen)');
  }

  const basura = CADENAS_BASURA.filter(function (b) { return texto.indexOf(b) !== -1; });
  if (basura.length) {
    const muestras = basura.map(function (b) {
      const i = texto.indexOf(b);
      return b + ' ~ "' + texto.slice(Math.max(0, i - 26), i + b.length + 26).replace(/\s+/g, ' ') + '"';
    });
    col.falla('ats.sin-basura', basura.join(', '), 'ninguna de: ' + CADENAS_BASURA.join(', '), muestras.join(' | '));
  } else {
    col.ok('ats.sin-basura', 'ninguna', 'ninguna de: ' + CADENAS_BASURA.join(', '));
  }

  if (fixture.aguja) {
    const n = apareceEnTexto(fixture.aguja, sinPie);
    col.fallaSi(n >= 1, 'ats.nombre-visible', n + ' vez', '>= 1', '"' + fixture.aguja + '"');
  } else {
    col.na('ats.nombre-visible', 'fixture sin aguja', '>= 1', 'no hay texto unico que buscar');
  }

  const secciones = e.secciones || [];
  const opcionales = ETIQUETAS_OPCIONALES[plantilla] || {};
  const ausentes = secciones.filter(function (s) { return texto.indexOf(s) === -1; });
  /* Se separan las ausentes de las que la plantilla dibuja sin barra: faltan
     -> FALLA, porque una seccion con datos no puede desaparecer; opcionales ->
     AVISO, porque ahi el contenido esta y lo que no se pinta es el titulo. */
  const ausentesRequeridas = ausentes.filter(function (s) { return !opcionales[s]; });
  col.fallaSi(ausentesRequeridas.length === 0, 'int.secciones-no-omitidas',
    (secciones.length - ausentesRequeridas.length) + '/' + secciones.length,
    secciones.length + ' secciones con datos, cada una con su etiqueta',
    ausentesRequeridas.length ? 'AUSENTES: ' + ausentesRequeridas.join(', ') : '');
  const ausentesOpcionales = ausentes.filter(function (s) { return !!opcionales[s]; });
  if (ausentesOpcionales.length) {
    col.aviso('int.etiquetas-sin-barra',
      'sin barra: ' + ausentesOpcionales.join(', '),
      'todas las secciones con barra de titulo, o la excepcion declarada',
      ausentesOpcionales.map(function (s) { return s + ': ' + opcionales[s]; }).join(' | '));
  } else {
    col.ok('int.etiquetas-sin-barra', 'ninguna seccion se salta su titulo',
      'todas las secciones con barra de titulo, o la excepcion declarada');
  }

  if (plantilla === '2') {
    if (!secciones.length) {
      col.na('ats.orden-lectura', 'fixture sin secciones', ctx.nombreOrden, 'no hay orden que medir');
    } else {
      const pos = ctx.ordenLectura.map(function (s) { return texto.indexOf(s); });
      const presentes = pos.filter(function (p) { return p >= 0; });
      const creciente = presentes.every(function (p, i) { return i === 0 || p > presentes[i - 1]; });
      const real = ctx.ordenLectura.filter(function (s, i) { return pos[i] >= 0; })
        .sort(function (a, b) { return texto.indexOf(a) - texto.indexOf(b); });
      col.fallaSi(creciente, 'ats.orden-lectura', real.join(' -> '), ctx.nombreOrden,
        !creciente ? 'orden realmente pintado: ' + real.join(' -> ') : '');
    }
  } else {
    col.na('ats.orden-lectura', 'plantilla ' + plantilla, 'solo plantilla 2',
      'en 1 y 3 manda el orden de columnas, no una secuencia vertical');
  }

  /* ---- INTEGRIDAD ------------------------------------------------------ */
  const suma = e.itemsPorSeccion.experiencia + e.itemsPorSeccion.educacion +
    e.itemsPorSeccion.certificaciones + e.itemsPorSeccion.proyectos;
  col.fallaSi(suma === e.items && diag.itemsRenderizados === e.items, 'int.items-renderizados',
    diag.itemsRenderizados + ' (suma declarada ' + suma + ')', e.items,
    'conteo del motor (doc.__pdfgen.diagnostico.itemsRenderizados)');

  const modelo = motor.normalizarDatos(fixture.datos);
  const itemsHab = modelo.habilidades.reduce(function (a, g) { return a + g.items.length; }, 0);
  col.fallaSi(modelo.habilidades.length === e.habilidadesCategorias && itemsHab === e.habilidadesItems,
    'int.normalizacion-habilidades',
    modelo.habilidades.length + ' cat / ' + itemsHab + ' items',
    e.habilidadesCategorias + ' cat / ' + e.habilidadesItems + ' items',
    'cuenta lo que el motor normaliza; el texto dibujado se comprueba con los items');
  col.fallaSi(modelo.idiomas.length === e.idiomas, 'int.normalizacion-idiomas',
    modelo.idiomas.length, e.idiomas, 'fusion de personal.idiomas + skills.idiomas, sin duplicar');

  const grupos = agruparLineas(plantilla, lineas, motor);
  const needles = needlesDeItems(fixture);
  const unicos = needles.filter(function (n) { return n.unico; });
  const noUnicos = needles.filter(function (n) { return !n.unico; });
  if (!needles.length) {
    col.na('int.items-supervivientes', 'fixture sin items', 'todos los items unicos', 'nada que verificar');
    col.na('int.items-repetidos', 'fixture sin items', '>= 1 cada uno', '');
  } else {
    const faltanU = unicos.filter(function (n) { return !hallarLineas(grupos, n.aguja); });
    col.fallaSi(faltanU.length === 0, 'int.items-supervivientes',
      (unicos.length - faltanU.length) + '/' + unicos.length, 'todos los items unicos dibujados',
      faltanU.length ? 'NO DIBUJADOS: ' + faltanU.slice(0, 6).map(function (n) { return n.seccion + ' "' + n.aguja + '"'; }).join(' | ') : '');
    const faltanR = noUnicos.filter(function (n) { return !hallarLineas(grupos, n.aguja); });
    col.fallaSi(faltanR.length === 0, 'int.items-repetidos',
      (noUnicos.length - faltanR.length) + '/' + noUnicos.length, '>= 1 cada uno',
      faltanR.length ? 'NO DIBUJADOS: ' + faltanR.slice(0, 6).map(function (n) { return n.aguja; }).join(' | ') : '');
  }

  /* ---- GEOMETRIA POR PAGINA (cajas de tinta de pdftotext) ---------------- */
  const cajasCol = cajasDeColumna(plantilla, motor);
  const fugas = [], bajos = [], cruces = [];
  let palabrasBanda = 0, anchoBandaMax = 0, anchoColMin = Infinity;
  const permitidos = marcarPiesDePagina(cajas, motor.LIMITE_INFERIOR);

  /* Datos para el chequeo de pagina huerfana: caracteres de contenido por pagina
     (sin el pie, que no es contenido) y, por pagina, la y mas baja de contenido
     para saber cuanto alto libre quedaba. */
  ctx.textoPorPagina = [];
  ctx.yMaxPorPagina = [];
  cajas.forEach(function (palabras) {
    let chars = 0, yMax = 0;
    for (const w of palabras) {
      if (permitidos.has(w)) continue;
      chars += w.txt.length;
      if (w.y1 > yMax) yMax = w.y1;
    }
    ctx.textoPorPagina.push(chars);
    ctx.yMaxPorPagina.push(yMax);
  });
  const penultima = paginas >= 2 ? (ctx.yMaxPorPagina[paginas - 2] || 0) : 0;
  ctx.libreAnterior = penultima ? motor.LIMITE_INFERIOR - penultima : motor.LIMITE_INFERIOR - motor.MARGENES.arriba;

  cajas.forEach(function (palabras, pi) {
    for (const w of palabras) {
      /* El pie de pagina no cuenta ni para medir la banda ni para exigir que la
         columna empiece en 82 mm: va centrado en el ancho completo y en un CV
         vacio es lo unico que hay (por eso el caso sin cuerpo cae en N/A y no en
         FALLA mas abajo). */
      if (permitidos.has(w)) continue;
      const enBanda = w.x0 < BANDA_ANCHO_MM - TOL_X_MM;
      if (enBanda) { palabrasBanda++; anchoBandaMax = Math.max(anchoBandaMax, w.x1); }
      else if (plantilla === '1') anchoColMin = Math.min(anchoColMin, w.x0);
      const caja = (plantilla === '1' && enBanda) ? cajasCol[0] : cajasCol[cajasCol.length - 1];
      if (!permitidos.has(w)) {
        if (w.y1 > motor.LIMITE_INFERIOR + TOL_Y_MM) {
          bajos.push('p' + (pi + 1) + ' "' + w.txt + '" y1=' + redondear(w.y1, 1) + 'mm > ' + motor.LIMITE_INFERIOR);
        }
        if (w.y0 < caja.y0 - TOL_Y_MM) {
          fugas.push('p' + (pi + 1) + ' "' + w.txt + '" y0=' + redondear(w.y0, 1) + 'mm (margen sup ' + caja.y0 + ')');
        }
      }
      if (w.x0 < caja.x0 - TOL_X_MM) {
        fugas.push('p' + (pi + 1) + ' "' + w.txt + '" x0=' + redondear(w.x0, 1) + 'mm (min ' + caja.x0 + ')');
      }
      if (w.x1 > caja.x1 + TOL_X_MM) {
        fugas.push('p' + (pi + 1) + ' "' + w.txt + '" x1=' + redondear(w.x1, 1) + 'mm (max ' + caja.x1 + ')');
      }
      if (plantilla === '1') {
        if (enBanda && w.x1 > BANDA_ANCHO_MM + TOL_X_MM) {
          cruces.push('p' + (pi + 1) + ' la banda invade la columna: "' + w.txt + '" x1=' + redondear(w.x1, 1) + 'mm');
        } else if (!enBanda && w.x0 < BANDA_ANCHO_MM - TOL_X_MM) {
          cruces.push('p' + (pi + 1) + ' la columna invade la banda: "' + w.txt + '" x0=' + redondear(w.x0, 1) + 'mm');
        }
      }
    }
  });

  col.fallaSi(fugas.length === 0, 'geo.ink-dentro-caja', fugas.length + ' fugas', '0 fugas',
    fugas.slice(0, 5).join(' | '));
  col.fallaSi(bajos.length === 0, 'geo.ink-sobre-limite-inferior', bajos.length + ' fugas',
    '0 fugas (el pie de pagina vive en el margen inferior por diseno)', bajos.slice(0, 5).join(' | '));

  if (plantilla === '1') {
    col.fallaSi(cruces.length === 0, 'geo.banda-sin-invasion', cruces.length + ' cruces', '0 cruces',
      cruces.slice(0, 5).join(' | '));
    /* Comprobacion cruzada de la constante BANDA_ANCHO_MM: si el motor cambiase
       la banda, el chequeo de arriba dejaria de ser valido. Sin texto de cuerpo
       no hay nada que medir (CV vacio): se declara N/A en vez de dar un FALLA
       que no significaria nada. */
    if (palabrasBanda === 0 && anchoColMin === Infinity) {
      col.na('geo.banda', 'documento sin texto de cuerpo',
        'banda <= ' + BANDA_ANCHO_MM + 'mm, columna >= ' + PRINCIPAL_X_MM + 'mm',
        'no hay ni banda ni columna que medir en este caso: solo el pie de pagina');
    } else {
      col.fallaSi(palabrasBanda > 0 && anchoBandaMax <= BANDA_ANCHO_MM + TOL_X_MM &&
        (anchoColMin === Infinity || anchoColMin >= BANDA_ANCHO_MM - TOL_X_MM),
        'geo.banda', 'banda hasta ' + redondear(anchoBandaMax, 1) + 'mm, columna desde ' +
        (anchoColMin === Infinity ? 'n/a' : redondear(anchoColMin, 1)) + 'mm',
        'banda <= ' + BANDA_ANCHO_MM + 'mm, columna >= ' + PRINCIPAL_X_MM + 'mm');
    }
  } else {
    col.na('geo.banda-sin-invasion', 'plantilla ' + plantilla, 'solo plantilla 1', 'no hay banda lateral');
    col.na('geo.banda', 'plantilla ' + plantilla, 'solo plantilla 1', '');
  }

  const media = pdf.toString('latin1').match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
  const mmAncho = media ? redondear(parseFloat(media[3]) * MM_POR_PT, 1) : 0;
  const mmAlto = media ? redondear(parseFloat(media[4]) * MM_POR_PT, 1) : 0;
  col.fallaSi(mmAncho === A4.ancho && mmAlto === A4.alto, 'geo.mediabox-a4',
    mmAncho + ' x ' + mmAlto + ' mm', A4.ancho + ' x ' + A4.alto + ' mm');

  /* ---- TEXTO SELECCIONABLE, NO RASTERIZADO ----------------------------- */
  const nLineas = lineas.reduce(function (a, l) { return a + l.length; }, 0);
  const nPalabras = cajas.reduce(function (a, c) { return a + c.length; }, 0);
  col.fallaSi(nLineas > 0, 'pdf.texto-por-linea', nLineas, '> 0', 'operaciones Tj en el content stream');
  col.fallaSi(nPalabras >= nLineas, 'pdf.caja-por-palabra', nPalabras, '>= ' + nLineas,
    'pdftotext -bbox devuelve una caja por palabra: el texto es seleccionable y buscable');
  const imagenes = (pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length;
  col.fallaSi(imagenes === 0, 'pdf.sin-imagenes', imagenes, '0 (texto real, nada rasterizado)');

  /* ---- JERARQUIA VISUAL -------------------------------------------------
     El nombre del candidato tiene que ser el texto mas grande del documento.
     No es una cuestion de gusto: si el nombre no es lo primero que se ve, el
     recruiter tarda mas en identificar a quien esta leyendo, y en una plantilla
     de dos columnas el nombre pequeno se pierde dentro de la banda. La banda
     minima es 1.4x el cuerpo (9.5pt -> 13.3pt) y el nombre tiene que alcanzar el
     tamano maximo dibujado, que es como se comprueba que NADIE mas lo supere. */
  const tams = [];
  lineas.forEach(function (filas) { for (const f of filas) if (esNumero(f.tam)) tams.push(f.tam); });
  const tamMax = tams.length ? Math.max.apply(null, tams) : 0;
  const cuerpo = motor.TIPO.cuerpo.tam;
  const minimoNombre = Math.round(JERARQUIA_NOMBRE_MIN_FACTOR * cuerpo * 10) / 10;
  const nombreCv = fixture.datos && fixture.datos.personal && fixture.datos.personal.nombre;
  if (!nombreCv || !String(nombreCv).trim()) {
    col.na('leg.nombre-destacado', 'fixture sin nombre', 'el nombre es el texto mas grande',
      'el candidato no tiene nombre que destacar');
  } else {
    /* Se localiza el nombre por un PREFIJO corto de su primera palabra, no por
       el nombre entero: un nombre largo e indivisible (90 caracteres) se parte en
       varias lineas, y ni la igualdad ni la busqueda del token completo lo
       encuentra nunca. Con 6 caracteres alcanza para que la coincidencia sea la
       linea del titulo, y se toma el MAYOR tam de las coincidencias porque el
       mismo nombre puede aparecer ademas dentro del cuerpo en un estilo menor. */
    const palabras = normalizar(nombreCv).split(' ').filter(Boolean);
    const prefijo = (palabras[0] || '').slice(0, 6);
    let tamNombre = 0;
    if (prefijo.length >= 4) {
      for (const filas of lineas) {
        for (const f of filas) {
          if (normalizar(f.txt).indexOf(prefijo) >= 0 && esNumero(f.tam) && f.tam > tamNombre) tamNombre = f.tam;
        }
      }
    }
    if (!tamNombre) {
      /* Que el nombre no aparezca es trabajo de ats.nombre-visible; aqui no se
         duplica la FALLA, solo se deja constancia de que no se pudo medir. */
      col.na('leg.nombre-destacado', 'no se localizo el nombre (' + prefijo + '...)', '>= ' + minimoNombre + 'pt',
        'el nombre no aparece en ninguna linea (ver ats.nombre-visible)');
    } else if (tamNombre < minimoNombre || tamNombre < tamMax) {
      col.falla('leg.nombre-destacado', tamNombre + 'pt', '>= ' + minimoNombre + 'pt y == maximo del documento (' + tamMax + 'pt)',
        tamMax > tamNombre
          ? 'la mayor aparicion del nombre (' + tamNombre + 'pt) queda por debajo de otro texto (' + tamMax + 'pt): la jerarquia visual esta invertida'
          : 'la mayor aparicion del nombre esta a ' + tamNombre + 'pt, por debajo del minimo de ' + minimoNombre +
            'pt (cuerpo ' + cuerpo + 'pt): en una banda de dos columnas el nombre se pierde');
    } else {
      col.ok('leg.nombre-destacado', tamNombre + 'pt (cuerpo ' + cuerpo + 'pt, maximo del documento ' + tamMax + 'pt)',
        '>= ' + minimoNombre + 'pt y == maximo del documento');
    }
  }

  /* ---- DENSIDAD -------------------------------------------------------- */
  medirDensidad(col, ctx, motor, plantilla, lineas);

  /* ---- PAGINAS --------------------------------------------------------- */
  if (fixture.id === 'real') {
    col.fallaSi(paginas >= PAGINAS_RANGO_SANITY.min && paginas <= PAGINAS_RANGO_SANITY.max,
      'pag.rango-sanity', paginas, PAGINAS_RANGO_SANITY.min + '-' + PAGINAS_RANGO_SANITY.max);
    const esp = PAGINAS_ESPERADAS[plantilla];
    col.fallaSi(Math.abs(paginas - esp) <= PAGINAS_TOLERANCIA, 'pag.paginas-esperadas',
      paginas, esp + ' +- ' + PAGINAS_TOLERANCIA, 'medido con DATOS_QA');
  } else {
    col.na('pag.rango-sanity', paginas, 'solo fixture real', 'rango calibrado con DATOS_QA');
    col.na('pag.paginas-esperadas', paginas, 'solo fixture real', '');
  }

  /* ---- PAGINA HUERFANA (la ultima) --------------------------------------
     El motor nunca parte un bloque entre paginas: si el bloque no cabe entero en
     lo que queda, lo baja completo. Consecuencia medible: cuando el bloque
     ensiende todo lo que resta, la ultima pagina se queda con dos o tres lineas
     y el CV "termina a medias" en una hoja que se paga igual.

     El umbral sale de los datos, no de una intuicion. Medida la ultima pagina de
     los 30 casos del corpus, en porcentaje de la mediana de su caso:

       pagina huerfana    1% - 13%   (20-198 chars)
       ultima pagina OK  33% - 133%  (280-4012 chars)

     Hay un hueco limpio entre 13% y 33%, asi que el corte va en 20%. Solo se
     compara el PORCENTAJE: un suelo absoluto de caracteres marcaba paginas
     legitimate de casos con poco texto (247 chars = 52% de su mediana) y eso es
     una pagina a medio llenar, no una huerfana. El minimo de mediana evita
     juzgar fixtures tan pequenos que el porcentaje no significa nada. */
  const charsPorPagina = ctx.textoPorPagina || [];
  if (paginas < 2) {
    col.na('pag.sin-huerfana', paginas + ' pagina(s)', 'la ultima pagina lleva contenido',
      'un CV de una sola pagina no puede terminar huerfano');
  } else {
    const conTexto = charsPorPagina.filter(function (c) { return c > 0; });
    const mediana = conTexto.slice().sort(function (a, b) { return a - b; })[Math.floor(conTexto.length / 2)] || 0;
    const ultima = charsPorPagina[paginas - 1] || 0;
    const pct = mediana ? Math.round(ultima / mediana * 100) : 0;
    if (mediana < MEDIANA_MIN_PARA_HUERFANA) {
      col.na('pag.sin-huerfana', 'mediana ' + mediana + ' chars', 'mediana >= ' + MEDIANA_MIN_PARA_HUERFANA,
        'este caso tiene demasiado poco texto para que el porcentaje signifique algo');
    } else if (ultima >= ULTIMA_PAGINA_MIN_PCT * mediana) {
      col.ok('pag.sin-huerfana', ultima + ' chars (' + pct + '% de la mediana)', '>= ' + Math.round(ULTIMA_PAGINA_MIN_PCT * 100) + '% de la mediana',
        'la pagina anterior dejaba ' + redondear(ctx.libreAnterior, 1) + 'mm libres');
    } else {
      col.falla('pag.sin-huerfana', ultima + ' chars (' + pct + '% de la mediana ' + mediana + ')',
        '>= ' + Math.round(ULTIMA_PAGINA_MIN_PCT * 100) + '% de la mediana',
        'la ultima pagina tiene ' + ultima + ' caracteres y la pagina anterior dejaba ' +
        redondear(ctx.libreAnterior, 1) + 'mm libres: el motor bajo el bloque entero en vez de partirlo');
    }
  }

  /* ---- ACENTOS --------------------------------------------------------- */
  if (fixture.literales) {
    const faltan = fixture.literales.filter(function (s) { return texto.indexOf(s) === -1; });
    col.fallaSi(faltan.length === 0, 'acentos.winansi',
      (fixture.literales.length - faltan.length) + '/' + fixture.literales.length,
      fixture.literales.length + ' cadenas literales (round trip por WinAnsiEncoding)',
      faltan.length ? 'PERDIDAS: ' + faltan.map(function (s) { return JSON.stringify(s); }).join(', ') : '');
  } else {
    col.na('acentos.winansi', 'fixture sin literales', 'solo fixture acentos', '');
  }

  /* ---- EMOJI: defecto conocido, medido sinonnetear el resultado ---------- */
  if (fixture.emoji) {
    const entrada = fixture.emoji.entrada;
    if (texto.indexOf(entrada) !== -1) {
      col.ok('acentos.emoji-winansi', 'sobrevive intacto', 'el emoji llega tal cual');
    } else {
      /* Se busca la linea donde estaba y se recorta para ensenar como salio. */
      let muestra = '(no se encontro el texto que lo contenia)';
      for (const l of texto.split(/\r?\n/)) {
        if (l.indexOf('Descripción con acentos') !== -1) { muestra = l.trim(); break; }
      }
      col.aviso('acentos.emoji-winansi', 'mangled: "' + muestra.replace(/\s+/g, ' ').slice(0, 90) + '"',
        'sobrevive intacto (o mangled, defecto conocido)',
        'DEFECTO DEL MOTOR, no del harness: jsPDF escribe con WinAnsiEncoding (fuentes base Helvetica/Times), que no tiene byte para un emoji y cae en su tabla de reemplazo. Un CV con emoji en los datos imprime basura legible. Arreglo: fuente embebida con tabla Unicode (UnicodeTTF/Identity-H) o saneado de caracteres fuera de WinAnsi en la entrada. Origen: ' + fixture.emoji.donde);
    }
  } else {
    col.na('acentos.emoji-winansi', 'fixture sin emoji', 'solo fixture acentos', '');
  }

  return cerrarCaso(ctx, fixture, plantilla, nombre, col, {
    paginas: paginas, bytes: pdf.length, items: diag.itemsRenderizados,
    pdfPath: base + '.pdf', txtPath: base + '.txt', bboxPath: base + '-bbox.html',
    diag: diag, base: base, paginasGeom: cajas.length
  }, null);
}

function cerrarCaso(ctx, fixture, plantilla, nombre, col, info, error) {
  const resumen = resumenVacio();
  for (const c of col.checks) { resumen[c.estado]++; resumen.total++; }
  const registro = {
    fixture: fixture.id, titulo: fixture.titulo, plantilla: plantilla, nombre: nombre,
    resumen: resumen, total: col.checks.length, checks: col.checks, info: info,
    error: error ? String(error.message).split('\n')[0] : null
  };
  ctx.resultados.push(registro);
  return registro;
}

/* ==========================================================================
 * 11. ORQUESTACION
 * ========================================================================== */

function parsearArgs(argv) {
  const o = {
    outdir: null, fixtures: null, plantillas: null, dpi: 110,
    png: 'real,acentos', json: null, orden: 'ats', quiet: false, list: false, help: false
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const valor = function () {
      const v = argv[i + 1];
      if (v === undefined || v.indexOf('--') === 0) throw new Error('falta el valor de ' + a);
      i++;
      return v;
    };
    if (a === '--outdir') o.outdir = valor();
    else if (a === '--fixtures' || a === '--fixture') o.fixtures = valor().split(',').map(function (s) { return s.trim(); });
    else if (a === '--templates' || a === '--plantilla') o.plantillas = valor().split(',').map(function (s) { return s.trim(); });
    else if (a === '--dpi') o.dpi = parseInt(valor(), 10);
    else if (a === '--png') o.png = valor();
    else if (a === '--no-png') o.png = '';
    else if (a === '--json') o.json = valor();
    else if (a === '--orden') o.orden = valor();
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--list') o.list = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error('argumento desconocido: ' + a + ' (use --help)');
  }
  if (o.orden !== 'ats' && o.orden !== 'implementado') {
    throw new Error('--orden debe ser "ats" o "implementado"');
  }
  return o;
}

const AYUDA = [
  'QA-PDF.JS - banco de pruebas del motor PDF (js/pdfgen.js)',
  '',
  '  node tools/qa-pdf.js [opciones]',
  '',
  '  --outdir <dir>      donde escribir PDF/TXT/PNG. Por defecto, un temporal',
  '                      fuera del repo (C:\\Temp\\cv-builder-qa-pdf, o %TEMP%).',
  '  --fixtures <a,b>    fixtures a ejecutar (por defecto, todas)',
  '  --templates <a,b>   plantillas a ejecutar (por defecto, 1,2,3)',
  '  --dpi <n>           resolucion de pdftoppm (por defecto 110)',
  '  --png <a,b>         fixtures de los que rasterizar (por defecto real,acentos)',
  '  --no-png            no rasterizar nada',
  '  --json <archivo>    volcar el informe completo en JSON',
  '  --orden <ats|implementado>  orden de lectura exigido a la plantilla 2.',
  '                      ats = perfil,contacto,experiencia,... (lo que pide el',
  '                      PRD y el comentario de cabecera del motor);',
  '                      implementado = lo que el codigo pinta de verdad.',
  '  --list              listar fixtures y salir',
  '  --quiet             solo el resumen y los fallos',
  '  --help              esta ayuda',
  '',
  '  Codigo de salida: 0 todo OK | 1 hay un check en FALLA | 2 no se pudo ejecutar'
].join('\n');

function outdirPorDefecto() {
  /* Se evita %TEMP% porque en este equipo es C:\\Users\\HPVICT~1\\... y las
     herramientas de MiKTeX interpretan "~" como home. tools/generar-previews.js
     tiene el mismo apunte. */
  const candidatos = [
    path.join(process.env.SystemDrive || 'C:', 'Temp', 'cv-builder-qa-pdf'),
    path.join(os.tmpdir(), 'cv-builder-qa-pdf')
  ];
  for (const c of candidatos) {
    try {
      fs.mkdirSync(c, { recursive: true });
      const prueba = path.join(c, '.escribible');
      fs.writeFileSync(prueba, 'ok');
      fs.unlinkSync(prueba);
      return c;
    } catch (e) { /* siguiente candidato */ }
  }
  return os.tmpdir();
}

function main() {
  let args;
  try {
    args = parsearArgs(process.argv);
  } catch (e) {
    logErr('error: ' + e.message);
    logErr(AYUDA);
    return 2;
  }
  if (args.help) { log(AYUDA); return 0; }

  const fixtures = construirFixtures();
  if (args.list) {
    log('FIXTURES (' + fixtures.length + '):');
    for (const f of fixtures) {
      log('  ' + f.id.padEnd(15) + f.titulo);
      log('  ' + ''.padEnd(15) + 'items=' + f.espera.items +
        ' secciones=' + f.espera.secciones.length +
        ' aguja=' + (f.aguja || '-'));
    }
    log('');
    log('PLANTILLAS: 1 (banda lateral), 2 (una columna ATS), 3 (cajas)');
    return 0;
  }

  const outdir = args.outdir ? path.resolve(args.outdir) : outdirPorDefecto();
  const plantillas = (args.plantillas || ['1', '2', '3']).map(String);
  const paraPng = args.png ? args.png.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];

  let ctx;
  try {
    ctx = {
      outdir: outdir,
      motor: cargarMotor(),
      JsPDF: cargarJsPDF(),
      poppler: resolverPoppler(),
      resultados: [],
      estilosMedidos: {},
      ordenLectura: args.orden === 'implementado' ? ORDEN_LECTURA_IMPLEMENTADO : ORDEN_LECTURA_ATS,
      nombreOrden: args.orden === 'implementado'
        ? 'implementado (contacto -> perfil -> ...)' : 'ats (perfil -> contacto -> ...)'
    };
  } catch (e) {
    logErr('error: ' + e.message);
    return 2;
  }

  const seleccionados = args.fixtures
    ? fixtures.filter(function (f) { return args.fixtures.indexOf(f.id) !== -1; })
    : fixtures;
  if (!seleccionados.length) {
    logErr('error: ningun fixture coincide con --fixtures ' + args.fixtures.join(','));
    logErr('disponibles: ' + fixtures.map(function (f) { return f.id; }).join(', '));
    return 2;
  }

  /* Artefactos fuera del repo, reejecutable sin estado. */
  try {
    fs.mkdirSync(outdir, { recursive: true });
    for (const n of fs.readdirSync(outdir)) {
      const p = path.join(outdir, n);
      if (fs.statSync(p).isFile()) fs.unlinkSync(p);
      else fs.rmSync(p, { recursive: true, force: true });
    }
  } catch (e) {
    logErr('error: no se pudo limpiar ' + outdir + ': ' + e.message);
    return 2;
  }

  const t0 = Date.now();
  if (!args.quiet) {
    log('QA-PDF :: ' + seleccionados.length + ' fixtures x ' + plantillas.length + ' plantillas');
    log('         salida: ' + outdir);
    log('         poppler: ' + ctx.poppler.dir);
    log('         orden t2: ' + ctx.nombreOrden);
    log('');
    log('  ' + 'caso'.padEnd(22) + 'pag'.padStart(6) + 'bytes'.padStart(10) + 'items'.padStart(8) +
      '   ' + 'ok/falla/aviso/na'.padEnd(22) + 'marcas');
  }

  const pngs = [];
  for (const f of seleccionados) {
    for (const t of plantillas) {
      const reg = ejecutarCaso(ctx, f, t);
      if (!args.quiet) logLinea(reg);
      if (reg.info && paraPng.indexOf(f.id) !== -1) {
        const salida = rasterizar(ctx, reg, f, t, args.dpi);
        for (const p of salida) pngs.push(p);
      }
    }
  }

  /* ---- Chequeos de nivel corrida -------------------------------------- */
  const corrida = crearColector();
  const estilos = Object.keys(ctx.estilosMedidos);
  corrida.fallaSi(estilos.length >= INTERLINEADO_ESTILOS_MINIMOS, 'densidad.cobertura',
    estilos.length + ': ' + estilos.join(', '), '>= ' + INTERLINEADO_ESTILOS_MINIMOS,
    'estilos cuyo avance de linea se pudo MEDIR porque alguna linea se partio');

  /* ---- Resumen --------------------------------------------------------- */
  let total = 0, ok = 0, falla = 0, aviso = 0, na = 0;
  const porFixture = new Map();
  for (const r of ctx.resultados) {
    total += r.resumen.total;
    ok += r.resumen[OK]; falla += r.resumen[FALLA]; aviso += r.resumen[AVISO]; na += r.resumen[NA];
    if (!porFixture.has(r.fixture)) porFixture.set(r.fixture, resumenVacio());
    const pf = porFixture.get(r.fixture);
    for (const e of ESTADOS) pf[e] += r.resumen[e];
    pf.total += r.resumen.total;
  }

  log('');
  log('CHECKS DE CORRIDA');
  for (const c of corrida.checks) {
    log('  [' + (c.estado === OK ? 'x' : ' ') + '] ' + c.nombre.padEnd(24) +
      c.estado.padEnd(6) + String(c.valor).slice(0, 76));
  }

  log('');
  log('RESUMEN POR FIXTURE');
  log('  ' + 'fixture'.padEnd(16) + 'checks'.padStart(7) + 'OK'.padStart(6) + 'FALLA'.padStart(7) +
    'AVISO'.padStart(7) + 'N/A'.padStart(6));
  for (const [fid, r] of porFixture) {
    log('  ' + fid.padEnd(16) + String(r.total).padStart(7) + String(r[OK]).padStart(6) +
      String(r[FALLA]).padStart(7) + String(r[AVISO]).padStart(7) + String(r[NA]).padStart(6));
  }

  const conFallas = ctx.resultados.filter(function (r) { return r.resumen[FALLA] > 0; });
  if (conFallas.length) {
    log('');
    log('DETALLE DE FALLAS (' + conFallas.length + ' casos)');
    for (const r of conFallas) {
      log('  ' + r.nombre);
      for (const c of r.checks) {
        if (c.estado !== FALLA) continue;
        log('    - ' + c.nombre);
        log('        valor:    ' + c.valor);
        log('        esperado: ' + c.esperado);
        if (c.detalle) log('        detalle:  ' + c.detalle);
      }
    }
  }

  const conAvisos = ctx.resultados.filter(function (r) { return r.resumen[AVISO] > 0; });
  if (conAvisos.length) {
    log('');
    log('AVISOS (limitaciones conocidas; no son regresiones)');
    for (const r of conAvisos) {
      for (const c of r.checks) {
        if (c.estado !== AVISO) continue;
        log('  ' + r.nombre + ' :: ' + c.nombre + ' = ' + c.valor);
        if (c.detalle) log('      ' + c.detalle);
      }
    }
  }

  if (pngs.length) {
    log('');
    log('PNG PARA REVISION VISUAL (' + pngs.length + ')');
    for (const p of pngs) log('  ' + p);
  }

  log('');
  log('TOTAL: ' + total + ' checks | OK ' + ok + ' | FALLA ' + falla + ' | AVISO ' + aviso +
    ' | N/A ' + na + ' | ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  log('SALIDA: ' + outdir);

  if (args.json) {
    const informe = {
      generado: new Date().toISOString(),
      outdir: outdir, poppler: ctx.poppler.dir, orden: args.orden,
      coberturaInterlineado: estilos,
      totales: { total: total, ok: ok, falla: falla, aviso: aviso, na: na },
      corrida: corrida.checks,
      png: pngs,
      resultados: ctx.resultados.map(function (r) {
        return {
          fixture: r.fixture, titulo: r.titulo, plantilla: r.plantilla,
          resumen: r.resumen, checks: r.checks,
          info: r.info ? {
            paginas: r.info.paginas, bytes: r.info.bytes, items: r.info.items,
            paginasConTinta: r.info.paginasGeom,
            pdf: r.info.pdfPath, txt: r.info.txtPath, bbox: r.info.bboxPath,
            diagnostico: r.info.diag
          } : null,
          error: r.error
        };
      })
    };
    fs.writeFileSync(args.json, JSON.stringify(informe, null, 2), 'utf8');
    log('JSON: ' + path.resolve(args.json));
  }

  const fallas = falla + corrida.checks.filter(function (c) { return c.estado === FALLA; }).length;
  log(fallas === 0 ? 'RESULTADO: todo OK' : 'RESULTADO: ' + fallas + ' check(s) en FALLA');
  return fallas === 0 ? 0 : 1;
}

function logLinea(r) {
  const i = r.info;
  const marcas = [];
  for (const c of r.checks) {
    if (c.estado === FALLA) marcas.push('FALLA');
    else if (c.estado === AVISO) marcas.push('AVISO');
  }
  const resumen = r.resumen[OK] + 'ok ' + r.resumen[FALLA] + 'f ' + r.resumen[AVISO] + 'a ' + r.resumen[NA] + 'na';
  log('  ' + r.nombre.padEnd(22) +
    (i ? (String(i.paginas) + 'pag').padStart(6) + (String(i.bytes) + 'B').padStart(10) +
      (String(i.items) + 'it').padStart(8) : 'SIN PDF'.padStart(25)) +
    '   ' + resumen.padEnd(20) + marcas.join(' '));
}

function rasterizar(ctx, reg, fixture, plantilla, dpi) {
  const prefijo = path.join(ctx.outdir, 'png-' + fixture.id + '-t' + plantilla);
  try {
    poppler(ctx.poppler.pdftoppm, ['-r', String(dpi), '-png', reg.info.base + '.pdf', prefijo]);
  } catch (e) {
    logErr('  aviso: pdftoppm fallo en ' + fixture.id + '/t' + plantilla + ': ' +
      String(e.message).split('\n')[0]);
    return [];
  }
  const marca = path.basename(prefijo);
  return fs.readdirSync(ctx.outdir)
    .filter(function (n) { return n.indexOf(marca) === 0 && /\.png$/.test(n); })
    .sort(function (a, b) {
      return parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10);
    })
    .map(function (n) { return path.join(ctx.outdir, n); });
}

if (require.main === module) {
  let codigo = 2;
  try {
    codigo = main();
  } catch (e) {
    logErr('error inesperado: ' + (e && e.stack ? e.stack : String(e)));
    codigo = 2;
  }
  process.exit(codigo);
}

module.exports = {
  construirFixtures: construirFixtures,
  leerLineasDeTexto: leerLineasDeTexto,
  leerCajasDeTinta: leerCajasDeTinta,
  cargarMotor: cargarMotor,
  cargarJsPDF: cargarJsPDF,
  main: main
};
