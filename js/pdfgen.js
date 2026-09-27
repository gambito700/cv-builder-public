/**
 * PDFGEN.JS - Nucleo comun de paginacion + motor de plantillas PDF (jsPDF)
 * ---------------------------------------------------------------------------
 * Rama PUBLICA: el PDF se genera en el navegador, sin backend.
 *
 * Este archivo es INDEPENDIENTE de js/generator.js (que produce .tex de LaTeX).
 * No lo importa, no lo lee, no comparte API con el.
 *
 * Reglas de diseno que gobiernan este archivo (skill cv-builder):
 *
 *  1. INTEGRIDAD DEL CONTENIDO
 *     Nunca se descarta informacion del usuario. Si un bloque no entra en la
 *     pagina, se pagina: el flujo por linea de `escribirLineas` garantiza que
 *     un item mas largo que una pagina completa se reparta entre paginas en
 *     lugar de dibujarse fuera del MediaBox (donde el lector no lo veria).
 *
 *  2. LEGIBILIDAD
 *     Jerarquia por tamano y peso, interlineado 1.15x-1.28x del tamano de
 *     fuente (1.28x en el cuerpo de 9.5pt), contraste verificado
 *     sobre fondo blanco (#111827 = 16.1:1, #4B5563 = 7.5:1, #6B7280 = 4.8:1;
 *     los tres superan WCAG AA). Sin texto sobre fondos de color.
 *
 *  3. ROBUSTEZ
 *     Todo el texto pasa por `texto()` / `lineasDe()` / `listaDe()`. Ningun
 *     null, undefined, 0-item, NaN o cadena de un solo caracter produce un error
 *     ni imprime literalmente "undefined", "null" o "NaN".
 *
 *  4. LAYOUT DETERMINISTA
 *     Cadena obligatoria en todo el archivo:
 *         contenido -> medicion (partirTexto / getTextWidth) -> alto calculado
 *         -> asegurarEspacio(alto) -> dibujo -> y += alto
 *     No existe ninguna coordenada magica dependiente del contenido anterior
 *     (no hay y = 183 ni jumping baselines). Cada linea se dibuja con su
 *     baseline calculada dentro de su propia caja de linea:
 *         base = yTecho + em(tam) * 0.80 + i * inter
 *     donde `em(tam) = tam * 25.4/72` pasa el tamano de fuente de PUNTOS a
 *     MILIMETROS e `inter = em(tam) * factor` es el avance de linea en mm.
 *     Los tamanos de fuente viven en puntos (es lo que espera setFontSize) y
 *     TODA longitud en milimetros; la conversion ocurre en un solo sitio.
 *
 *  5. ATS
 *     Texto real (nunca imagen), una sola columna, secciones en mayusculas con
 *     nomenclatura estandar, orden perfil -> contacto -> experiencia ->
 *     educacion -> certificaciones -> proyectos -> habilidades -> idiomas.
 *     Los guiones y vinetas son caracteres de texto, no imagenes.
 *
 * Verificado contra jsPDF 4.2.1 (vendor/jspdf.umd.min.js):
 *   - La API de color SOLO acepta 3 numeros separados. `setTextColor([r,g,b])`
 *     LANZA "Invalid argument passed to jsPDF.f3" en esta version, por eso todo
 *     el archivo pasa por `pintar()` / `trazo()` y usa la forma de 3 numeros.
 *   - `doc.text(texto, x, y)` interpreta x como borde izquierdo e y como linea
 *     base (verificado en el content stream: 20mm/100mm -> Td 56.69 558.42).
 *   - Los caracteres Unicode fuera de ASCII se convierten a WinAnsiEncoding
 *     correctamente (n=0xF1, u=0xFC, ?=0xBF, !=0xA1, en dash=0x96, em=0x97).
 *
 * Sin `import` ni `export`: es un script clasico. Al final se expone un guard de
 * CommonJS para que un harness de QA pueda requirear el archivo en Node.
 */
var PDFGEN = (function () {
  'use strict';

  var VERSION = '1.0.0';

  /* ==================================================================
   * 1. GEOMETRIA DE PAGINA (A4), MARGENES Y UNIDADES
   * ================================================================== */

  /* CONVERSION DE UNIDADES. Regla unica del archivo:
   *
   *   - `tam` (tamano de fuente) esta en PUNTOS, porque es lo que espera
   *     doc.setFontSize(). NO se usa como magnitud de espacio.
   *   - TODO espacio vertical (interlineado, baseline, reservas) se expresa en
   *     MILIMETROS, que es la unidad de PAGINA, MARGENES y ANCHO_UTIL.
   *   - La unica conversion es `em(tam) = tam * MM_POR_PT`. Cualquier valor
   *     derivado de un tamano de fuente pasa por ahi; usar los puntos
   *     directamente como mm es lo que producia el interlineado inflado
   *     (error b54b24ff-488f-49d9-bf85-7a82732659e3).
   */
  var MM_POR_PT = 25.4 / 72; // 0.352778

  /* Alto de un "em" en mm: la unidad de referencia tipografica del archivo. */
  function em(tamPuntos) {
    return tamPuntos * MM_POR_PT;
  }

  var PAGINA = { ancho: 210, alto: 297 };
  var MARGENES = { arriba: 18, derecha: 16, abajo: 16, izquierda: 16 };

  /* Ancho de la caja de texto util. Todo se mide contra este valor, nunca
     contra un ancho supuesto. */
  var ANCHO_UTIL = PAGINA.ancho - MARGENES.izquierda - MARGENES.derecha; // 178

  /* Y por debajo del cual NO se dibuja contenido (queda libre el pie de pagina). */
  var LIMITE_INFERIOR = PAGINA.alto - MARGENES.abajo; // 281

  /* Y del pie de pagina: vive dentro del margen inferior, nunca choca. */
  var PIE_Y = PAGINA.alto - 8; // 289

  /* Tolerancia de medicion en mm al comparar anchos. */
  var EPS = 0.05;

  /* Posicion de la linea base DENTRO de su caja de linea, como fraccion del em.
     La caja de linea mide `factor` ems (ver TIPO) y la baseline se coloca a
     `SUBIDA` ems del techo, medido sobre el em EN MILIMETROS.

     Por que 0.80 y no "lo que salga": con las metricas de Helvetica
     (AFM: ascender 718, descender -207, cap 718, em 1000) y el factor 1.28 del
     cuerpo, la linea necesita cubrir:
       - por encima: 0.80 em disponibles contra ~0.75 em que alcanza el acento
         mas alto (A tilde, dieresis). Margen: 0.05 em.
       - por debajo: (1.28 - 0.80) = 0.48 em disponibles contra 0.21 em de
         descendente (g, j, p, y). Margen: 0.27 em.
     Asi la linea siguiente NUNCA pisa el acento de la anterior, y la caja
     reserva el alto completo: el avance de linea es `inter`, no `inter - em`.
     Con el factor mas cerrado del nombre (1.15) siguen sobrando 0.13 em de
     margen superior y 0.13 em de descendente, por eso 0.80 es valido para
     todos los tipos de la tabla. */
  var SUBIDA = 0.80;

  /* Sangria de las vinetas. */
  var SANGRIA = 4;

  /* ==================================================================
   * 2. COLOR - sintaxis UNICA en todo el archivo: 3 numeros separados.
   *    Ninguna llamada a setTextColor/setFillColor/setDrawColor fuera de
   *    pintar() y trazo().
   * ================================================================== */

  var COLORES = {
    texto: [17, 24, 39],    // #111827 - tinta principal          (16.1:1)
    suave: [75, 85, 99],    // #4B5563 - metadatos y subtitulos  (7.5:1)
    pie: [107, 114, 128],   // #6B7280 - pie de pagina            (4.8:1)
    regla: [209, 213, 219]  // #D1D5DB - filetes (no es texto)
  };

  function pintar(doc, color) {
    doc.setTextColor(color[0], color[1], color[2]);
  }

  function trazo(doc, color) {
    doc.setDrawColor(color[0], color[1], color[2]);
  }

  /* Tercera salida de color del archivo, para los RELLENOS de las plantillas
     0 (banda lateral) y 1 (cajas). Misma sintaxis de 3 numeros: la regla de
     "una sola forma de escribir un color" se mantiene. */
  function rellenar(doc, color) {
    doc.setFillColor(color[0], color[1], color[2]);
  }

  /* ==================================================================
   * 2b. CONTRASTE DE COLOR (WCAG 2.1, luminancia relativa)
   *
   *     L  = 0.2126 R + 0.7152 G + 0.0722 B   (canales linealizados)
   *     r  = (L_claro + 0.05) / (L_oscuro + 0.05)
   *
   *     Existe para ELEGIR el color del texto sobre un fondo en vez de
   *     suponerlo, y para dejar el numero real anotado junto al color. Las
   *     plantillas 0 y 1 pintan texto sobre fondos de color: un #111827
   *     sobre una banda #1F2937 seria ilegible (1.2:1) y es exactamente el
   *     fallo que este calculo evita.
   * ================================================================== */

  function luminancia(color) {
    var pesos = [0.2126, 0.7152, 0.0722];
    var suma = 0;
    for (var i = 0; i < 3; i++) {
      var c = color[i] / 255;
      var lineal = (c <= 0.03928) ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      suma += pesos[i] * lineal;
    }
    return suma;
  }

  function ratioContraste(a, b) {
    var la = luminancia(a);
    var lb = luminancia(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /* Elige, entre dos candidatos ya elegidos por el diseno, el que MAS
     contraste da contra el fondo. No inventa colores: solo ordena dos. */
  function mejorContraste(primero, segundo, fondo) {
    return (ratioContraste(primero, fondo) >= ratioContraste(segundo, fondo))
      ? primero : segundo;
  }

  /* ==================================================================
   * 3. TIPOGRAFIA
   *
   * CONVENCION DE UNIDADES (reemplaza a la anterior, que mezclaba puntos y mm):
   *   - `tam`    = tamano de fuente en PUNTOS. Se entrega tal cual a
   *                doc.setFontSize() y NO se usa nunca como longitud.
   *   - `factor` = interlineado como fraccion del em. SIN UNIDADES: 1.28
   *                significa "1.28 veces el tamano de la fuente".
   *   - `inter`  = AVANCE DE LINEA EN MILIMETROS. Derivado, no editado a mano:
   *                se calcula una sola vez aqui con `interlineado()`.
   *
   * Todo el consumo de altura del motor usa `inter` (mm) o `em(tam)` (mm), de
   * modo que el unico camino de conversion es la funcion de abajo.
   * ================================================================== */

  var TIPO = {
    nombre:     { fuente: 'helvetica', estilo: 'bold',   tam: 18,   factor: 1.15 },
    titular:    { fuente: 'helvetica', estilo: 'normal', tam: 10.5, factor: 1.25 },
    seccion:    { fuente: 'helvetica', estilo: 'bold',   tam: 10.5, factor: 1.25 },
    item:       { fuente: 'helvetica', estilo: 'bold',   tam: 10,   factor: 1.25 },
    secundario: { fuente: 'helvetica', estilo: 'normal', tam: 9.5,  factor: 1.28 },
    meta:       { fuente: 'helvetica', estilo: 'normal', tam: 8.5,  factor: 1.28 },
    cuerpo:     { fuente: 'helvetica', estilo: 'normal', tam: 9.5,  factor: 1.28 },
    contacto:   { fuente: 'helvetica', estilo: 'normal', tam: 9,    factor: 1.28 },
    /* Pastillas de la banda lateral (plantilla 0). Entra en la misma escala
       porque comparte la conversion em()/interlineado() del resto: si se
       midiera aparte habria dos reglas de unidades en el archivo. */
    pastilla:   { fuente: 'helvetica', estilo: 'normal', tam: 7.5, factor: 1.30 },
    pie:        { fuente: 'helvetica', estilo: 'normal', tam: 8,    factor: 1.20 }
  };

  /* UNICO lugar donde un factor sin unidades se convierte a milimetros. */
  function interlineado(tipo) {
    return em(tipo.tam) * tipo.factor;
  }

  /* Deriva `inter` en mm una sola vez. Se mantiene la clave por compatibilidad
     con la API publica (TIPO se exporta), pero su valor ya no se edita a mano:
     cambiar `factor` y volver a leer esta tabla es lo unico necesario. */
  (function derivarInterlineados() {
    for (var nombre in TIPO) {
      if (Object.prototype.hasOwnProperty.call(TIPO, nombre)) {
        TIPO[nombre].inter = interlineado(TIPO[nombre]);
      }
    }
  }());

  var ESPACIO = {
    trasTitular: 2.5,
    trasSeccion: 3.5,
    entreItems: 2.2,
    trasFila: 1.2,
    regla: 1.4
  };

  /* Reservas anti-huerfano. Un encabezado (titulo de seccion o titulo de item)
     nunca debe quedar como ultima linea de una pagina. La reserva se calcula a
     partir del interlineado real del bloque que sigue, no con un numero fijo:
       - bajo un titulo de item viene subtitulo + metadatos (2 lineas de meta)
       - bajo un titulo de seccion viene el titulo del primer item + lo anterior
     Compartir estas dos constantes entre tituloSeccion() y escribirItem()
     garantiza que la comprobacion que hizo el titulo sea exactamente la misma
     que hace el item. Si divergieran, el item se saltaria de pagina y dejaria
     el titulo solo (defecto observado en QA antes de unificar las constantes). */
  var RESERVA_ENCABEZADO = ESPACIO.entreItems + interlineado(TIPO.meta) * 2;
  var RESERVA_ITEM_ENTERO = interlineado(TIPO.item) + RESERVA_ENCABEZADO;
  var RESERVA_LINEA = ESPACIO.trasFila + interlineado(TIPO.secundario);

  function aplicarTipo(doc, nombreTipo) {
    var t = TIPO[nombreTipo] || TIPO.cuerpo;
    doc.setFont(t.fuente, t.estilo);
    doc.setFontSize(t.tam);
    return t;
  }

  /* ==================================================================
   * 4. SANEADO - ninguna impresion de undefined / null / NaN / [object Object]
   * ================================================================== */

  /* Marcadores que el usuario escribe para decir "sin dato". No son contenido:
     imprimirlos ("Nota: -") seria ruido, omitirlos no pierde informacion. */
  var MARCADORES_VACIOS = [
    '', '-', '--', '---', '.', 'n/a', 'n.a.', 'na', 'n/d', 's/n', 'sin',
    'null', 'undefined', 'nan', 'no', 'ninguno', 'ninguna'
  ];

  function esVacio(valor) {
    if (valor === null || valor === undefined) return true;
    if (typeof valor === 'number') return !isFinite(valor);
    if (typeof valor === 'boolean') return false;
    var s = String(valor).replace(/\s+/g, ' ').trim().toLowerCase();
    return MARCADORES_VACIOS.indexOf(s) !== -1;
  }

  /* Texto de una linea. Acepta string, number, array (se aplana) y descarta
     objetos. Devuelve '' cuando no hay nada que imprimir. */
  function texto(valor) {
    if (valor === null || valor === undefined) return '';
    if (typeof valor === 'number') return isFinite(valor) ? String(valor) : '';
    if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';
    if (typeof valor === 'object') {
      if (Array.isArray(valor)) {
        var partes = [];
        for (var i = 0; i < valor.length; i++) {
          var p = texto(valor[i]);
          if (p) partes.push(p);
        }
        return partes.join(', ');
      }
      return '';
    }
    if (typeof valor !== 'string') return '';
    var limpio = valor.replace(/\r\n?/g, '\n').replace(/[\t ]+/g, ' ');
    limpio = limpio.replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n');
    limpio = limpio.replace(/^[ \n]+|[ \n]+$/g, '');
    if (!limpio) return '';
    var plano = limpio.toLowerCase();
    if (MARCADORES_VACIOS.indexOf(plano) !== -1) return '';
    if (plano === 'undefined' || plano === 'null' || plano === 'nan') return '';
    return limpio;
  }

  /* Multilinea: parte un string por saltos de linea o acepta un array. */
  function lineasDe(valor) {
    if (Array.isArray(valor)) {
      var salida = [];
      for (var i = 0; i < valor.length; i++) {
        var t = texto(valor[i]);
        if (t) salida.push(t);
      }
      return salida;
    }
    var s = texto(valor);
    if (!s) return [];
    var partes = s.split('\n');
    var res = [];
    for (var j = 0; j < partes.length; j++) {
      var p = texto(partes[j]);
      if (p) res.push(p);
    }
    return res;
  }

  /* Normaliza cualquier valor a array de objetos planos (nunca null). */
  function listaDe(valor) {
    if (!Array.isArray(valor)) return [];
    var salida = [];
    for (var i = 0; i < valor.length; i++) {
      var v = valor[i];
      if (v === null || v === undefined) continue;
      if (typeof v !== 'object') {
        var suelto = texto(v);
        if (suelto) salida.push({ __texto: suelto });
        continue;
      }
      salida.push(v);
    }
    return salida;
  }

  /* Numero para "horas" / "nota": 0, null, NaN o texto no numerico -> ''. */
  function numeroTexto(valor) {
    if (valor === null || valor === undefined || valor === '') return '';
    if (typeof valor === 'number') return isFinite(valor) && valor > 0 ? String(valor) : '';
    var s = texto(valor);
    if (!s) return '';
    var n = parseFloat(s.replace(',', '.'));
    if (!isFinite(n) || n <= 0) return '';
    return String(n);
  }

  function esVerdadero(valor) {
    return valor === true || valor === 1 || valor === '1' ||
      valor === 'true' || valor === 'si' || valor === 'sí';
  }

  function objeto(valor) {
    return (valor && typeof valor === 'object' && !Array.isArray(valor)) ? valor : {};
  }

  /* Une partes no vacias evitando duplicados exactos (el fixture trae
     nota:"En curso" y estado:"En curso" en la misma fila). */
  function unirPartes(partes, separador) {
    var salida = [];
    for (var i = 0; i < partes.length; i++) {
      var p = texto(partes[i]);
      if (!p) continue;
      var repetido = false;
      for (var j = 0; j < salida.length; j++) {
        if (salida[j].toLowerCase() === p.toLowerCase()) { repetido = true; break; }
      }
      if (!repetido) salida.push(p);
    }
    return salida.join(separador || ' | ');
  }

  /* ==================================================================
   * 5. MEDICION - contenido -> medida. Unica fuente de verdad del ancho.
   * ================================================================== */

  /* Divide una linea que sigue siendo mas ancha que la caja. jsPDF 4.2.1 ya
     parte palabras largas, pero esta red de seguridad no depende de ese
     comportamiento: si una linea medida excede el ancho, se corta por
     caracteres. Evita que un nombre de 90 caracteres se salga de la pagina. */
  function cortarPorAncho(doc, linea, ancho) {
    var partes = [];
    var resto = linea;
    var vueltas = 0;
    while (resto.length > 0 && vueltas < 2000) {
      vueltas++;
      if (doc.getTextWidth(resto) <= ancho + EPS) { partes.push(resto); break; }
      var lo = 1;
      var hi = resto.length;
      var mejor = 1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (doc.getTextWidth(resto.slice(0, mid)) <= ancho + EPS) { mejor = mid; lo = mid + 1; }
        else { hi = mid - 1; }
      }
      if (mejor < 1) mejor = 1;
      partes.push(resto.slice(0, mejor));
      resto = resto.slice(mejor).replace(/^ +/, '');
    }
    return partes;
  }

  /* Unica puerta de entrada al ajuste de linea de todo el motor.
     `nombreTipo` es OBLIGATORIO en el uso interno: aplica la fuente ANTES de
     medir. Sin esto se mediria con la fuente que dejo puesta el bloque anterior
     y se dibujaria con otra, produciendo lineas mas anchas que su caja (y en
     el peor caso fuera de la pagina). Medir y dibujar con la misma fuente es
     parte de la cadena contenido -> medicion -> alto. */
  function partirTexto(doc, contenido, ancho, nombreTipo) {
    if (nombreTipo) aplicarTipo(doc, nombreTipo);
    var s = texto(contenido);
    if (!s) return [];
    var base;
    try {
      base = doc.splitTextToSize(s, ancho);
    } catch (e) {
      base = [s];
    }
    if (!base || !base.length) base = [s];
    var salida = [];
    for (var i = 0; i < base.length; i++) {
      var linea = texto(base[i]);
      if (!linea) continue;
      if (doc.getTextWidth(linea) <= ancho + EPS) {
        salida.push(linea);
      } else {
        var troceada = cortarPorAncho(doc, linea, ancho);
        for (var j = 0; j < troceada.length; j++) {
          if (troceada[j]) salida.push(troceada[j]);
        }
      }
    }
    return salida;
  }

  /* ==================================================================
   * 6. PAGINACION - ensureSpace / addPage
   * ================================================================== */

  /**
   * Crea un flujo de escritura vertical.
   *
   * `opciones` permite que una plantilla tenga MAS DE UNA columna con su
   * propia caja y su propio limite inferior (plantilla 0: banda lateral +
   * columna de contenido). Los tres valores por defecto son los de siempre,
   * asi que `crearFlujo(doc)` se comporta exactamente igual que antes.
   *
   * opciones: {
   *   x, ancho,           caja horizontal de la columna
   *   limiteInferior,     Y por debajo del cual esta columna no dibuja
   *   nuevaPagina,        hook opcional: como se obtiene una pagina nueva
   * }
   */
  function crearFlujo(doc, opciones) {
    var o = opciones || {};
    return {
      doc: doc,
      y: (o.y === undefined) ? MARGENES.arriba : o.y,
      pagina: doc.getNumberOfPages(),
      x: (o.x === undefined) ? MARGENES.izquierda : o.x,
      ancho: (o.ancho === undefined) ? ANCHO_UTIL : o.ancho,
      limiteInferior: (o.limiteInferior === undefined)
        ? LIMITE_INFERIOR : o.limiteInferior,
      /* Inyectable para columnas que no son la principal. Permite que la
         columna lateral avance a la pagina siguiente reutilizando paginas que
         la columna principal ya creo, sin duplicar la logica de paginacion:
         la decision de "hace falta otra pagina" sigue tomandose aqui, en
         asegurarEspacio(), con un alto ya medido. */
      nuevaPagina: o.nuevaPagina || null,
      diag: {
        saltosPagina: 0,
        bloquesPartidos: 0,
        itemsRenderizados: 0,
        itemsVacios: 0,
        seccionesOmitidas: [],
        lineasCortadasPorAncho: 0
      }
    };
  }

  function siguientePagina(flujo) {
    if (flujo.nuevaPagina) {
      flujo.nuevaPagina(flujo);
    } else {
      flujo.doc.addPage();
      flujo.pagina = flujo.doc.getNumberOfPages();
    }
    flujo.y = MARGENES.arriba;
    flujo.diag.saltosPagina++;
    return flujo;
  }

  /* La unica funcion que decide si hay que cambiar de pagina. Se llama
     SIEMPRE con un alto ya medido, nunca con un numero supuesto. */
  function asegurarEspacio(flujo, altoNecesario) {
    var disponible = flujo.limiteInferior - flujo.y;
    if (altoNecesario <= disponible + EPS) return false;
    siguientePagina(flujo);
    return true;
  }

  /* ==================================================================
   * 7. DIBUJO DE BLOQUES - la primitiva de layout del motor.
   * ================================================================== */

  function dibujarLinea(doc, linea, x, ancho, yBase, alineacion, color) {
    var anchoLinea = doc.getTextWidth(linea);
    var xFinal = x;
    /* Alineacion calculada aqui, no delegada a jsPDF: si la linea midiera mas
       que la caja, se alinea a la izquierda en vez de salirse del papel. */
    if (anchoLinea < ancho - EPS) {
      if (alineacion === 'center') xFinal = x + (ancho - anchoLinea) / 2;
      else if (alineacion === 'right') xFinal = x + ancho - anchoLinea;
    }
    pintar(doc, color || COLORES.texto);
    doc.text(linea, xFinal, yBase);
  }

  /* Modo "atomico": el bloque cabe entero, asi que se mueve completo. */
  function escribirBloqueCompleto(flujo, doc, t, lineas, o) {
    var yTecho = flujo.y + o.espacioAntes;
    /* Baseline de la linea i: techo de la caja + SUBIDA ems + i avances de
       linea completos. El em va en mm (em()), nunca el `tam` en puntos. */
    var yBase0 = yTecho + em(t.tam) * SUBIDA;
    for (var i = 0; i < lineas.length; i++) {
      var yBase = yBase0 + i * o.inter;
      if (o.marcador && i === 0) {
        pintar(doc, o.colorMarcador || o.color);
        doc.text(o.marcador, o.xMarcador, yBase);
      }
      dibujarLinea(doc, lineas[i], o.x, o.ancho, yBase, o.alineacion, o.color);
    }
  }

  /* Modo "fluido": el bloque es mas alto que una pagina entera. Se dibuja
     linea por linea comprobando el espacio antes de CADA linea, de modo que
     nada se pierde y nada se dibuja fuera del area imprimible. */
  function escribirBloqueFluido(flujo, doc, t, lineas, o) {
    flujo.diag.bloquesPartidos++;
    for (var i = 0; i < lineas.length; i++) {
      asegurarEspacio(flujo, o.inter);
      if (i === 0) flujo.y += o.espacioAntes;
      var yBase = flujo.y + em(t.tam) * SUBIDA;
      if (o.marcador && i === 0) {
        pintar(doc, o.colorMarcador || o.color);
        doc.text(o.marcador, o.xMarcador, yBase);
      }
      dibujarLinea(doc, lineas[i], o.x, o.ancho, yBase, o.alineacion, o.color);
      flujo.y += o.inter;
    }
  }

  /**
   * Escribe un bloque de texto ya medido, con paginacion correcta.
   *
   * opciones: {
   *   tipo: 'cuerpo',        nombre de la entrada de TIPO
   *   x, ancho,              caja (por defecto la caja util completa)
   *   alineacion: 'left'|'center'|'right'
   *   color: COLORES.texto
   *   espacioAntes, espacioDespues
   *   marcador, xMarcador    vineta de la primera linea
   *   reservarDespues         alto extra que se reserva para lo que sigue
   * }
   */
  function escribirLineas(flujo, lineas, opciones) {
    var o = opciones || {};
    var doc = flujo.doc;
    var t = aplicarTipo(doc, o.tipo || 'cuerpo');
    var cfg = {
      x: (o.x === undefined) ? flujo.x : o.x,
      ancho: (o.ancho === undefined) ? flujo.ancho : o.ancho,
      alineacion: o.alineacion || 'left',
      color: o.color || COLORES.texto,
      colorMarcador: o.colorMarcador || o.color || COLORES.texto,
      marcador: o.marcador || '',
      xMarcador: (o.xMarcador === undefined) ? flujo.x : o.xMarcador,
      espacioAntes: o.espacioAntes || 0,
      inter: interlineado(t)
    };
    cfg.espacioDespues = o.espacioDespues || 0;

    if (!lineas || lineas.length === 0) {
      flujo.y += cfg.espacioAntes + cfg.espacioDespues;
      return 0;
    }

    var altoTotal = cfg.espacioAntes + lineas.length * cfg.inter +
      cfg.espacioDespues + (o.reservarDespues || 0);
    var disponible = flujo.limiteInferior - flujo.y;
    var disponiblePaginaNueva = flujo.limiteInferior - MARGENES.arriba;

    if (altoTotal > disponible + EPS) {
      if (altoTotal <= disponiblePaginaNueva + EPS) {
        /* Cabe entero en una pagina: salto atomico, el bloque no se parte. */
        asegurarEspacio(flujo, altoTotal);
        escribirBloqueCompleto(flujo, doc, t, lineas, cfg);
        flujo.y += cfg.espacioAntes + lineas.length * cfg.inter + cfg.espacioDespues;
        return lineas.length;
      }
      /* Mas alto que una pagina entera: flujo linea a linea, sin perder nada. */
      escribirBloqueFluido(flujo, doc, t, lineas, cfg);
      flujo.y += cfg.espacioDespues;
      return lineas.length;
    }

    escribirBloqueCompleto(flujo, doc, t, lineas, cfg);
    flujo.y += cfg.espacioAntes + lineas.length * cfg.inter + cfg.espacioDespues;
    return lineas.length;
  }

  /* Atajo: mide y escribe. Es la cadena contenido -> medicion -> alto ->
     asegurarEspacio -> dibujo -> y += alto, en una sola llamada. */
  function escribirTexto(flujo, contenido, opciones) {
    var o = opciones || {};
    var doc = flujo.doc;
    aplicarTipo(doc, o.tipo || 'cuerpo');
    var ancho = (o.ancho === undefined) ? flujo.ancho : o.ancho;
    var lineas = partirTexto(doc, contenido, ancho, o.tipo || 'cuerpo');
    escribirLineas(flujo, lineas, o);
    return lineas.length;
  }

  /* ==================================================================
   * 8. HELPERS DE PLANTILLA
   * ================================================================== */

  /* Titulo de seccion: mayusculas, filete inferior, y la primera linea del
     bloque siguiente reservada para que un titulo nunca quede huerfano al pie
     de una pagina. `reservaSiguiente` es el alto que el bloque de abajo exige
     (lo pasa quien conoce la seccion: un item o una linea simple). */
  function tituloSeccion(flujo, etiqueta, reservaSiguiente) {
    var doc = flujo.doc;
    var t = aplicarTipo(doc, 'seccion');
    var lineas = partirTexto(doc, etiqueta, flujo.ancho, 'seccion');
    if (lineas.length === 0) return;
    var reserva = (reservaSiguiente === undefined) ? RESERVA_ITEM_ENTERO : reservaSiguiente;
    var altoTitulo = lineas.length * interlineado(t);
    var altoTotal = ESPACIO.trasTitular + altoTitulo + ESPACIO.trasSeccion +
      ESPACIO.regla;
    asegurarEspacio(flujo, altoTotal + reserva);
    var yTecho = flujo.y + ESPACIO.trasTitular;
    var yBaseTitulo = yTecho + em(t.tam) * SUBIDA;
    for (var i = 0; i < lineas.length; i++) {
      dibujarLinea(doc, lineas[i], flujo.x, flujo.ancho,
        yBaseTitulo + i * interlineado(t), 'left', COLORES.texto);
    }
    var yFilete = yTecho + altoTitulo - ESPACIO.regla * 0.4;
    trazo(doc, COLORES.regla);
    doc.setLineWidth(0.5);
    doc.setLineCap('butt');
    doc.line(flujo.x, yFilete, flujo.x + flujo.ancho, yFilete);
    flujo.y = yTecho + altoTitulo + ESPACIO.trasSeccion;
  }

  /* Par "etiqueta: valor". Se omite entero si no hay valor. */
  function parClaveValor(flujo, etiqueta, valor) {
    var v = texto(valor);
    if (!v) return false;
    var partes = [];
    partes.push({ t: texto(etiqueta) + ': ', g: true });
    partes.push({ t: v, g: false });
    escribirLineas(flujo, aplanarPartes(flujo.doc, partes, flujo.ancho, 'secundario'), {
      tipo: 'secundario',
      espacioAntes: ESPACIO.trasFila
    });
    return true;
  }

  /* Une trocitos con estilo distinto y devuelve lineas ya partidas. El ancho
     de la parte en negrita se mide con su propia fuente (medicion real). */
  function aplanarPartes(doc, partes, ancho, nombreTipo) {
    var textoPlano = '';
    for (var i = 0; i < partes.length; i++) {
      textoPlano += (partes[i].t || '') + (i < partes.length - 1 ? ' ' : '');
    }
    textoPlano = textoPlano.replace(/ +/g, ' ').trim();
    return partirTexto(doc, textoPlano, ancho, nombreTipo);
  }

  /* ==================================================================
   * 9. NORMALIZACION DEL MODELO DE DATOS
   *    Traduce el fixture de js/data.js a una forma estable. No borra
   *    informacion: solo convierte y descarta lo que estaba vacio.
   * ================================================================== */

  function normalizarExperiencia(exp) {
    var e = objeto(exp);
    var inicio = texto(e.fechaInicio);
    var fin = esVerdadero(e.presente) ? 'Presente' : texto(e.fechaFin);
    var rango = '';
    if (inicio && fin) rango = inicio + ' – ' + fin;
    else rango = inicio || fin || '';
    return {
      empresa: texto(e.empresa) || texto(e.__texto),
      cargo: texto(e.cargo) || texto(e.__texto),
      ubicacion: texto(e.ubicacion),
      rango: rango,
      funciones: lineasDe(e.funciones)
    };
  }

  function normalizarEducacion(ed) {
    var e = objeto(ed);
    var horas = numeroTexto(e.horas);
    var nota = texto(e.nota);
    var meta = unirPartes([
      texto(e.ano),
      horas ? horas + ' h' : '',
      nota ? 'Nota: ' + nota : '',
      texto(e.estado)
    ], ' | ');
    return {
      titulo: texto(e.programa) || texto(e.titulo) || texto(e.__texto),
      institucion: texto(e.institucion),
      meta: meta
    };
  }

  function normalizarCertificacion(cert) {
    var e = objeto(cert);
    var horas = numeroTexto(e.horas);
    var nota = numeroTexto(e.nota) || texto(e.nota);
    var meta = unirPartes([
      texto(e.ano),
      horas ? horas + ' h' : '',
      nota ? 'Nota: ' + nota : ''
    ], ' | ');
    return {
      titulo: texto(e.nombre) || texto(e.programa) || texto(e.__texto),
      institucion: texto(e.institucion),
      meta: meta
    };
  }

  function normalizarProyecto(p) {
    var e = objeto(p);
    return {
      titulo: texto(e.nombre) || texto(e.__texto),
      descripcion: texto(e.descripcion),
      tecnologias: texto(e.tecnologias)
    };
  }

  /* Categorias de habilidades en el orden en que las declara el modelo.
     Se respeta el orden de claves del objeto: es el orden que ve el usuario. */
  function normalizarHabilidades(skills) {
    var salida = [];
    if (Array.isArray(skills)) {
      var lista = listaDe(skills).map(function (s) {
        return texto(s.__texto) || texto(s);
      }).filter(function (s) { return s.length > 0; });
      if (lista.length) salida.push({ categoria: 'Otros', clave: 'otros', items: lista });
      return salida;
    }
    var obj = objeto(skills);
    var claves = Object.keys(obj);
    for (var i = 0; i < claves.length; i++) {
      var cat = claves[i];
      /* Los idiomas NO se listan aqui: se emiten una sola vez en la seccion
         IDIOMAS, que ya fusiona personal.idiomas con skills.idiomas y deduplica.
         Incluirlos aqui los duplicaria en el mismo documento. */
      if (esCategoriaIdioma(cat)) continue;
      var items = listaDe(obj[cat]).map(function (s) {
        return texto(s.__texto) || texto(s);
      }).filter(function (s) { return s.length > 0; });
      if (items.length > 0) {
        salida.push({ categoria: capitalizar(cat), clave: cat, items: items });
      }
    }
    return salida;
  }

  var CLAVES_IDIOMA = ['idioma', 'idiomas', 'language', 'languages', 'lang', 'langs'];

  function esCategoriaIdioma(clave) {
    var c = texto(clave).toLowerCase().replace(/[\s_-]+/g, '');
    if (!c) return false;
    for (var i = 0; i < CLAVES_IDIOMA.length; i++) {
      if (c === CLAVES_IDIOMA[i]) return true;
    }
    return false;
  }

  function capitalizar(s) {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /* Idiomas: acepta el string de personal.idiomas, el array de skills.idiomas o
     ambos, y separa el nivel cuando existe. Nunca inventa un nivel. */
  function normalizarIdioma(entrada) {
    var s = texto(entrada);
    if (!s) return null;
    var m = s.match(/^(.*?)[\s\-–—]+(A1|A2|B1|B2|C1|C2)$/i);
    if (m) {
      return { idioma: texto(m[1]) || s, nivel: m[2].toUpperCase() };
    }
    if (/\bnativ[oa]\s*$/i.test(s)) {
      return { idioma: texto(s.replace(/\bnativ[oa]\s*$/i, '')) || s, nivel: 'nativo' };
    }
    return { idioma: s, nivel: '' };
  }

  function normalizarIdiomas(personal, skills) {
    var crudos = [];
    var porDefecto = texto(personal.idiomas);
    if (porDefecto) {
      var partes = porDefecto.split(/\s*[,;]\s*/);
      for (var i = 0; i < partes.length; i++) {
        if (texto(partes[i])) crudos.push(partes[i]);
      }
    }
    var skillsObj = objeto(skills);
    var deSkills = listaDe(skillsObj.idiomas);
    for (var j = 0; j < deSkills.length; j++) {
      var t = texto(deSkills[j].__texto) || texto(deSkills[j]);
      if (t) crudos.push(t);
    }
    var vistos = {};
    var salida = [];
    for (var k = 0; k < crudos.length; k++) {
      var idioma = normalizarIdioma(crudos[k]);
      if (!idioma || !idioma.idioma) continue;
      var clave = idioma.idioma.toLowerCase() + '|' + idioma.nivel.toLowerCase();
      if (vistos[clave]) continue;
      vistos[clave] = true;
      salida.push(idioma);
    }
    return salida;
  }

  function nombreFocus(datos, focusArea) {
    var areas = listaDe(datos.focusAreas);
    for (var i = 0; i < areas.length; i++) {
      if (texto(areas[i].id) === focusArea) {
        return texto(areas[i].name) || focusArea;
      }
    }
    return focusArea;
  }

  function normalizarDatos(data) {
    var d = objeto(data);
    var personal = objeto(d.personal);
    return {
      personal: {
        nombre: texto(personal.nombre),
        cargo: texto(personal.cargo) || texto(personal.titulo),
        telefono: texto(personal.telefono),
        email: texto(personal.email),
        direccion: unirPartes([texto(personal.direccion), texto(personal.ciudad)], ', '),
        github: texto(personal.github),
        portafolio: texto(personal.portafolio),
        sitio: texto(personal.sitio) || texto(personal.linkedin) || texto(personal.web),
        rut: texto(personal.rut),
        nacimiento: texto(personal.fechaNacimiento),
        nacionalidad: texto(personal.nacionalidad),
        estadoCivil: texto(personal.estadoCivil),
        disponibilidad: texto(personal.disponibilidad),
        objetivo: texto(personal.objetivo) || texto(personal.resumen) ||
          texto(personal.perfil) || texto(personal.summary)
      },
      titular: nombreFocus(d, texto(d.focusArea)),
      experiencia: listaDe(d.experience).map(normalizarExperiencia),
      educacion: listaDe(d.education).map(normalizarEducacion),
      certificaciones: listaDe(d.certifications).map(normalizarCertificacion),
      proyectos: listaDe(d.projects).map(normalizarProyecto),
      habilidades: normalizarHabilidades(d.skills),
      idiomas: normalizarIdiomas(personal, d.skills)
    };
  }

  function itemVacio(item, claves) {
    for (var i = 0; i < claves.length; i++) {
      var v = item[claves[i]];
      if (Array.isArray(v)) {
        if (v.length > 0) return false;
      } else if (texto(v)) {
        return false;
      }
    }
    return true;
  }

  /* ==================================================================
   * 10. PLANTILLA 2 - "PROFESIONAL CLASICO"
   *     Una sola columna. Contacto en lineas de texto (nunca tabla).
   *     Secciones en mayusculas texto plano. Sin cajas, sin iconos y sin
   *     fondos de color. Todo el contenido del usuario se imprime.
   * ================================================================== */

  function renderPlantillaClasica(doc, m) {
    var flujo = crearFlujo(doc);
    var p = m.personal;

    /* --- Cabecera: nombre + titular + filete --- */
    if (p.nombre) {
      escribirTexto(flujo, p.nombre, {
        tipo: 'nombre',
        espacioDespues: ESPACIO.regla
      });
      trazo(doc, COLORES.texto);
      doc.setLineWidth(0.8);
      doc.setLineCap('butt');
      doc.line(MARGENES.izquierda, flujo.y - ESPACIO.regla * 0.5,
        MARGENES.izquierda + ANCHO_UTIL, flujo.y - ESPACIO.regla * 0.5);
    }
    if (p.cargo) {
      escribirTexto(flujo, p.cargo, { tipo: 'titular', espacioDespues: 1 });
    }
    if (m.titular) {
      escribirTexto(flujo, m.titular, {
        tipo: 'titular',
        color: COLORES.suave,
        espacioDespues: ESPACIO.trasSeccion
      });
    }

    /* --- CONTACTO: lineas de texto, nunca tabla --- */
    var contacto = [
      p.telefono, p.email, p.direccion, p.github, p.portafolio, p.sitio
    ];
    var hayContacto = false;
    for (var i = 0; i < contacto.length; i++) {
      if (contacto[i]) { hayContacto = true; break; }
    }
    if (hayContacto) {
      tituloSeccion(flujo, 'CONTACTO', RESERVA_LINEA);
      for (var j = 0; j < contacto.length; j++) {
        if (!contacto[j]) continue;
        escribirTexto(flujo, contacto[j], {
          tipo: 'contacto',
          espacioAntes: ESPACIO.trasFila
        });
      }
      flujo.y += ESPACIO.trasFila;
    }

    /* --- PERFIL --- */
    var perfil = [
      ['RUT', p.rut],
      ['Fecha de nacimiento', p.nacimiento],
      ['Nacionalidad', p.nacionalidad],
      ['Estado civil', p.estadoCivil],
      ['Disponibilidad', p.disponibilidad]
    ];
    var hayPerfil = !!p.objetivo;
    if (!hayPerfil) {
      for (var k = 0; k < perfil.length; k++) {
        if (perfil[k][1]) { hayPerfil = true; break; }
      }
    }
    if (hayPerfil) {
      tituloSeccion(flujo, 'PERFIL', RESERVA_LINEA);
      if (p.objetivo) {
        escribirTexto(flujo, p.objetivo, {
          tipo: 'secundario',
          espacioDespues: ESPACIO.trasFila
        });
      }
      for (var l = 0; l < perfil.length; l++) {
        parClaveValor(flujo, perfil[l][0], perfil[l][1]);
      }
    }

    /* --- EXPERIENCIA LABORAL --- */
    var items = m.experiencia;
    if (items.length === 0) {
      flujo.diag.seccionesOmitidas.push('EXPERIENCIA LABORAL (sin items)');
    } else {
      tituloSeccion(flujo, 'EXPERIENCIA LABORAL');
      for (var e = 0; e < items.length; e++) {
        var exp = items[e];
        if (itemVacio(exp, ['empresa', 'cargo', 'rango', 'ubicacion', 'funciones'])) {
          flujo.diag.itemsVacios++;
          continue;
        }
        var primero = e === 0;
        escribirItem(flujo, {
          titulo: exp.cargo || exp.empresa,
          subtitulo: exp.cargo ? exp.empresa : '',
          meta: unirPartes([exp.rango, exp.ubicacion], ' | '),
          detalles: exp.funciones,
          primero: primero
        });
        flujo.diag.itemsRenderizados++;
      }
    }

    /* --- EDUCACION (y CERTIFICACIONES: se muestran LAS DOS, aunque el
           fixture tenga solapados, porque son secciones distintas y el
           usuario pidio ambas) --- */
    if (m.educacion.length === 0) {
      flujo.diag.seccionesOmitidas.push('EDUCACIÓN (sin items)');
    } else {
      tituloSeccion(flujo, 'EDUCACIÓN');
      for (var ed = 0; ed < m.educacion.length; ed++) {
        var edu = m.educacion[ed];
        if (itemVacio(edu, ['titulo', 'institucion', 'meta'])) {
          flujo.diag.itemsVacios++;
          continue;
        }
        escribirItem(flujo, {
          titulo: edu.titulo,
          subtitulo: edu.institucion,
          meta: edu.meta,
          detalles: [],
          primero: ed === 0
        });
        flujo.diag.itemsRenderizados++;
      }
    }

    if (m.certificaciones.length === 0) {
      flujo.diag.seccionesOmitidas.push('CERTIFICACIONES (sin items)');
    } else {
      tituloSeccion(flujo, 'CERTIFICACIONES');
      for (var ce = 0; ce < m.certificaciones.length; ce++) {
        var cert = m.certificaciones[ce];
        if (itemVacio(cert, ['titulo', 'institucion', 'meta'])) {
          flujo.diag.itemsVacios++;
          continue;
        }
        escribirItem(flujo, {
          titulo: cert.titulo,
          subtitulo: cert.institucion,
          meta: cert.meta,
          detalles: [],
          primero: ce === 0
        });
        flujo.diag.itemsRenderizados++;
      }
    }

    /* --- PROYECTOS --- */
    if (m.proyectos.length === 0) {
      flujo.diag.seccionesOmitidas.push('PROYECTOS (sin items)');
    } else {
      tituloSeccion(flujo, 'PROYECTOS');
      for (var pr = 0; pr < m.proyectos.length; pr++) {
        var pro = m.proyectos[pr];
        if (itemVacio(pro, ['titulo', 'descripcion', 'tecnologias'])) {
          flujo.diag.itemsVacios++;
          continue;
        }
        escribirItem(flujo, {
          titulo: pro.titulo,
          subtitulo: '',
          meta: '',
          detalles: pro.descripcion ? [pro.descripcion] : [],
          extra: pro.tecnologias ? 'Tecnologías: ' + pro.tecnologias : '',
          primero: pr === 0
        });
        flujo.diag.itemsRenderizados++;
      }
    }

    /* --- HABILIDADES --- */
    if (m.habilidades.length === 0) {
      flujo.diag.seccionesOmitidas.push('HABILIDADES (sin items)');
    } else {
      tituloSeccion(flujo, 'HABILIDADES', RESERVA_LINEA);
      for (var ha = 0; ha < m.habilidades.length; ha++) {
        var grupo = m.habilidades[ha];
        if (!grupo.items.length) continue;
        escribirLineas(flujo, partirTexto(flujo.doc, grupo.categoria + ': ' + grupo.items.join(', '), ANCHO_UTIL, 'secundario'), {
          tipo: 'secundario',
          espacioAntes: ha === 0 ? ESPACIO.trasFila : ESPACIO.trasFila
        });
      }
      flujo.y += ESPACIO.trasFila;
    }

    /* --- IDIOMAS --- */
    if (m.idiomas.length === 0) {
      flujo.diag.seccionesOmitidas.push('IDIOMAS (sin items)');
    } else {
      tituloSeccion(flujo, 'IDIOMAS', RESERVA_LINEA);
      for (var id = 0; id < m.idiomas.length; id++) {
        var idioma = m.idiomas[id];
        var etiqueta = idioma.nivel
          ? (idioma.nivel.toLowerCase() === 'nativo'
            ? idioma.idioma + ' nativo'
            : idioma.idioma + ' – ' + idioma.nivel)
          : idioma.idioma;
        escribirTexto(flujo, etiqueta, {
          tipo: 'secundario',
          espacioAntes: ESPACIO.trasFila
        });
      }
    }

    return flujo;
  }

  /* Bloque de item: titulo en negrita, subtitulo, metadatos y vinetas.
     El titulo reserva ademas las dos primeras lineas del detalle para que
     ningun encabezado quede solo al final de una pagina. */
  /**
   * Define que contiene un item y en que orden, ya MEDIDO con la fuente
   * correcta y partido al ancho de la columna.
   *
   * Es la definicion UNICA de "un item": la plantilla 2 la escribe linea a
   * linea con `escribirItem` y la plantilla 1 la pinta dentro de una caja.
   * Si cada plantilla tuviera su propia lista de campos, un item podria verse
   * distinto en una plantilla que en otra.
   *
   * Devuelve grupos: { lineas, tipo, color, colorMarcador, sangria,
   *                   marcador, espacioAntes }
   */
  function estructuraItem(doc, spec, ancho, sangria) {
    var sang = sangria === undefined ? SANGRIA : sangria;
    var antes = spec.primero ? 0 : ESPACIO.entreItems;
    var grupos = [];
    var primeroDetalle = true;

    function anadir(lineas, tipo, color, opciones) {
      var o = opciones || {};
      grupos.push({
        lineas: lineas,
        tipo: tipo,
        color: color || COLORES.texto,
        colorMarcador: o.colorMarcador || color || COLORES.texto,
        sangria: o.sangria || 0,
        marcador: o.marcador || '',
        espacioAntes: (o.espacioAntes === undefined)
          ? (primeroDetalle ? antes : ESPACIO.trasFila)
          : o.espacioAntes
      });
      primeroDetalle = false;
    }

    if (texto(spec.titulo)) {
      anadir(partirTexto(doc, spec.titulo, ancho, 'item'), 'item', COLORES.texto,
        { espacioAntes: antes });
    }
    if (texto(spec.subtitulo)) {
      anadir(partirTexto(doc, spec.subtitulo, ancho, 'secundario'), 'secundario',
        COLORES.suave, { espacioAntes: primeroDetalle ? antes : 0 });
    }
    if (texto(spec.meta)) {
      anadir(partirTexto(doc, spec.meta, ancho, 'meta'), 'meta', COLORES.suave,
        { espacioAntes: primeroDetalle ? antes : (ESPACIO.trasFila * 0.6) });
    }
    var detalles = spec.detalles || [];
    for (var i = 0; i < detalles.length; i++) {
      anadir(partirTexto(doc, detalles[i], ancho - sang, 'cuerpo'), 'cuerpo',
        COLORES.texto, {
          espacioAntes: primeroDetalle ? antes : ESPACIO.trasFila,
          sangria: sang,
          marcador: '-',
          colorMarcador: COLORES.suave
        });
    }
    if (texto(spec.extra)) {
      anadir(partirTexto(doc, spec.extra, ancho, 'meta'), 'meta', COLORES.suave,
        { espacioAntes: primeroDetalle ? antes : ESPACIO.trasFila });
    }
    return grupos;
  }

  /* Bloque de item: titulo en negrita, subtitulo, metadatos y vinetas.
     El titulo reserva ademas las dos primeras lineas del detalle para que
     ningun encabezado quede solo al final de una pagina. */
  function escribirItem(flujo, spec) {
    var doc = flujo.doc;
    var grupos = estructuraItem(doc, spec, flujo.ancho, SANGRIA);
    if (grupos.length === 0) return;

    /* Misma constante que usa tituloSeccion: el titulo no puede quedar solo.
       Se reserva ANTES de escribir nada, con el alto ya medido. */
    if (texto(spec.titulo)) {
      var lineasTitulo = partirTexto(doc, spec.titulo, flujo.ancho, 'item');
      asegurarEspacio(flujo, ESPACIO.entreItems +
        lineasTitulo.length * interlineado(TIPO.item) + RESERVA_ENCABEZADO);
    }

    for (var i = 0; i < grupos.length; i++) {
      var g = grupos[i];
      escribirLineas(flujo, g.lineas, {
        tipo: g.tipo,
        x: flujo.x + g.sangria,
        xMarcador: flujo.x,
        marcador: g.marcador,
        color: g.color,
        colorMarcador: g.colorMarcador,
        espacioAntes: g.espacioAntes
      });
    }
  }

  /* ==================================================================
   * 10b. SECCIONES COMPARTIDAS POR LAS TRES PLANTILLAS
   *
   * Las tres plantilla imprimen EXACTAMENTE las mismas secciones. Para que no
   * se desincronicen, el "que secciones existen y con que datos" vive aqui una
   * sola vez y cada plantilla decide solo como las PINTA (columna suelta, caja,
   * banda lateral).
   * ================================================================== */

  function clavesExperiencia() {
    return ['empresa', 'cargo', 'rango', 'ubicacion', 'funciones'];
  }

  function specExperiencia(exp) {
    return {
      titulo: exp.cargo || exp.empresa,
      subtitulo: exp.cargo ? exp.empresa : '',
      meta: unirPartes([exp.rango, exp.ubicacion], ' | '),
      detalles: exp.funciones
    };
  }

  function specTituloInstitucion(x) {
    return {
      titulo: x.titulo,
      subtitulo: x.institucion,
      meta: x.meta,
      detalles: []
    };
  }

  function specProyecto(p) {
    return {
      titulo: p.titulo,
      subtitulo: '',
      meta: '',
      detalles: p.descripcion ? [p.descripcion] : [],
      extra: p.tecnologias ? 'Tecnologías: ' + p.tecnologias : ''
    };
  }

  /* Perfil: el objetivo y los pares clave-valor. */
  var CLAVES_PERFIL = [
    ['RUT', 'rut'],
    ['Fecha de nacimiento', 'nacimiento'],
    ['Nacionalidad', 'nacionalidad'],
    ['Estado civil', 'estadoCivil'],
    ['Disponibilidad', 'disponibilidad']
  ];

  function hayPerfil(m) {
    if (texto(m.personal.objetivo)) return true;
    for (var i = 0; i < CLAVES_PERFIL.length; i++) {
      if (texto(m.personal[CLAVES_PERFIL[i][1]])) return true;
    }
    return false;
  }

  function escribirPerfil(flujo, m) {
    if (texto(m.personal.objetivo)) {
      escribirTexto(flujo, m.personal.objetivo, {
        tipo: 'secundario',
        espacioDespues: ESPACIO.trasFila
      });
    }
    for (var i = 0; i < CLAVES_PERFIL.length; i++) {
      parClaveValor(flujo, CLAVES_PERFIL[i][0], m.personal[CLAVES_PERFIL[i][1]]);
    }
  }

  function contactoDe(m) {
    var p = m.personal;
    return [p.telefono, p.email, p.direccion, p.github, p.portafolio, p.sitio]
      .filter(function (v) { return !!texto(v); });
  }

  function escribirContacto(flujo, m) {
    var lineas = contactoDe(m);
    for (var i = 0; i < lineas.length; i++) {
      escribirTexto(flujo, lineas[i], {
        tipo: 'contacto',
        espacioAntes: ESPACIO.trasFila
      });
    }
    if (lineas.length) flujo.y += ESPACIO.trasFila;
    return lineas.length;
  }

  /* Habilidades: "Categoria: a, b, c" en texto plano (la banda lateral de la
     plantilla 0 usa pildoras en su lugar). */
  function escribirHabilidades(flujo, m) {
    var n = 0;
    for (var i = 0; i < m.habilidades.length; i++) {
      var grupo = m.habilidades[i];
      if (!grupo.items.length) continue;
      escribirTexto(flujo, grupo.categoria + ': ' + grupo.items.join(', '), {
        tipo: 'secundario',
        espacioAntes: ESPACIO.trasFila
      });
      n++;
    }
    if (n) flujo.y += ESPACIO.trasFila;
    return n;
  }

  function etiquetaIdioma(idioma) {
    if (!idioma.nivel) return idioma.idioma;
    return idioma.nivel.toLowerCase() === 'nativo'
      ? idioma.idioma + ' nativo'
      : idioma.idioma + ' – ' + idioma.nivel;
  }

  function escribirIdiomas(flujo, m) {
    for (var i = 0; i < m.idiomas.length; i++) {
      escribirTexto(flujo, etiquetaIdioma(m.idiomas[i]), {
        tipo: 'secundario',
        espacioAntes: ESPACIO.trasFila
      });
    }
    return m.idiomas.length;
  }

  /* Recorre una coleccion de items. Descarta los vacios contandolos, delega
     el pintado en `pintarItem` (linea suelta o caja) y lleva la cuenta. */
  function recorrerItems(flujo, etiqueta, items, claves, construirSpec, pintarItem) {
    if (items.length === 0) {
      flujo.diag.seccionesOmitidas.push(etiqueta + ' (sin items)');
      return;
    }
    tituloSeccion(flujo, etiqueta);
    for (var i = 0; i < items.length; i++) {
      if (itemVacio(items[i], claves)) {
        flujo.diag.itemsVacios++;
        continue;
      }
      var spec = construirSpec(items[i]);
      spec.primero = (i === 0);
      pintarItem(flujo, spec);
      flujo.diag.itemsRenderizados++;
    }
  }

  function pintarItemSuelto(flujo, spec) {
    escribirItem(flujo, spec);
  }

  /* ==================================================================
   * 10c. PRIMITIVAS VISUALES DE LAS PLANTILLAS 0 Y 1
   *
   * Regla que atraviesa todas estas funciones: el alto se MIDE antes de
   * dibujar, con la fuente ya puesta y al ancho util menos el padding. Nunca
   * se dibuja y se mide despues, y nunca se dibuja un fragmento de una
   * pastilla o de una caja: si no cabe, se parte por lineas o pasa de pagina.
   * ================================================================== */

  /* --- Plantilla 0: banda lateral ------------------------------------- */
  var BANDA_CFG = {
    x: 0,
    ancho: 72,              /* a sangre: de 0 a 72 mm */
    pad: 8,                 /* margen interior del texto */
    gutter: 10,             /* aire entre la banda y la columna */
    /* CONTRASTE sobre la banda #1F2937, calculado con ratioContraste():
       texto #F9FAFB 14.05:1 | titulo #93C5FD 8.14:1 | suave #D1D5DB 9.96:1
       El inverso, tinta #111827 sobre la banda, da 1.21:1: ilegible, y por
       eso aqui NO se usa tinta oscura. */
    relleno: [31, 41, 55],
    texto: [249, 250, 251],
    titulo: [147, 197, 253],
    suave: [209, 213, 219],
    pastillaFondo: [55, 65, 81],   /* #374151 */
    pastillaTexto: [243, 244, 246],/* #F3F4F6  9.37:1 sobre #374151 */
    puntoLleno: [147, 197, 253],
    puntoVacio: [107, 114, 128]
  };
  var LATERAL_X = BANDA_CFG.pad;                                        /* 8  */
  var LATERAL_ANCHO = BANDA_CFG.ancho - BANDA_CFG.pad * 2;              /* 56 */
  var PRINCIPAL_X = BANDA_CFG.ancho + BANDA_CFG.gutter;                 /* 82 */
  var PRINCIPAL_ANCHO = PAGINA.ancho - MARGENES.derecha - PRINCIPAL_X;   /* 112 */

  var PILDORA = { padX: 2.2, padY: 1.0, sep: 1.4, radio: 1.6 };

  /* --- Plantilla 1: cajas --------------------------------------------- */
  var CAJA_CFG = {
    padX: 3.4,
    padY: 2.4,
    radio: 1.8,
    entreGrupos: 0.7,
    /* CONTRASTE dentro de las cajas: tinta #111827 sobre #F3F4F6 da 16.12:1
       (AAA) y los metadatos #4B5563 sobre #F3F4F6 dan 6.87:1 (AA). */
    fondo: [243, 244, 246],
    borde: [229, 231, 235],
    /* La barra de seccion invierte: #FFFFFF sobre #1F2937 da 14.68:1 (AAA). */
    barraFondo: [31, 41, 55],
    barraTexto: [255, 255, 255],
    barraPadX: 3.4,
    barraPadY: 1.9
  };

  /* --- Idiomas: puntos 1-5 -------------------------------------------- */
  /* Un nivel ausente o no reconocido NO se dibuja: cero puntos, sin inventar
     un valor por defecto. 'nativo' equivale al maximo. */
  var NIVEL_A_NUMERO = {
    a1: 1, a2: 2, b1: 3, b2: 4, c1: 5, c2: 5, nativo: 5, native: 5
  };
  var PUNTOS = { diam: 1.7, sep: 1.1, total: 5 };

  function nivelANumero(nivel) {
    var c = texto(nivel).toLowerCase();
    if (!c) return 0;
    if (!Object.prototype.hasOwnProperty.call(NIVEL_A_NUMERO, c)) return 0;
    return NIVEL_A_NUMERO[c];
  }

  function anchoPuntos() {
    return PUNTOS.total * PUNTOS.diam + (PUNTOS.total - 1) * PUNTOS.sep;
  }

  function dibujarPuntos(doc, x, yCentro, llenos, colorLleno, colorVacio) {
    for (var i = 0; i < PUNTOS.total; i++) {
      var cx = x + PUNTOS.diam / 2 + i * (PUNTOS.diam + PUNTOS.sep);
      if (i < llenos) {
        rellenar(doc, colorLleno);
        doc.circle(cx, yCentro, PUNTOS.diam / 2, 'F');
      } else {
        trazo(doc, colorVacio);
        doc.setLineWidth(0.25);
        doc.circle(cx, yCentro, PUNTOS.diam / 2, 'S');
      }
    }
  }

  /* ==================================================================
   * 10d. PLANTILLA 0 - "MODERNO Y LIMPIO" (banda lateral de color)
   *
   * DOS COLUMNAS, cada una con su cursor `y`, su caja y su limite inferior:
   *   - BANDA (izquierda, a sangre): nombre, cargo, titular, contacto,
   *     habilidades en pildoras e idiomas con puntos.
   *   - COLUMNA (derecha): perfil, experiencia, educacion, certificaciones y
   *     proyectos.
   * Mismas secciones que la plantilla 2, sin anadir ni quitar ninguna.
   * El texto es real en las dos columnas: nada rasterizado.
   *
   * NO ES ATS-SAFE y no se disimula: la banda de color rompe el parsing de
   * dos columnas que hacen muchos ATS. Es una opcion visual; el texto sigue
   * siendo extraible con pdftotext.
   * ================================================================== */

  function pintarBanda(doc) {
    rellenar(doc, BANDA_CFG.relleno);
    doc.rect(BANDA_CFG.x, 0, BANDA_CFG.ancho, PAGINA.alto, 'F');
  }

  function tituloBanda(flujo, etiqueta) {
    var doc = flujo.doc;
    var t = aplicarTipo(doc, 'pastilla');
    var lineas = partirTexto(doc, etiqueta, LATERAL_ANCHO, 'pastilla');
    if (!lineas.length) return;
    var inter = interlineado(t);
    var alto = lineas.length * inter + ESPACIO.trasTitular;
    asegurarEspacio(flujo, alto + ESPACIO.trasFila);
    var yTecho = flujo.y + ESPACIO.trasTitular * 0.4;
    pintar(doc, BANDA_CFG.titulo);
    for (var i = 0; i < lineas.length; i++) {
      doc.text(lineas[i], LATERAL_X, yTecho + em(t.tam) * SUBIDA + i * inter);
    }
    flujo.y = yTecho + lineas.length * inter;
  }

  /* Pildoras de habilidades.
     El alto de cada pastilla se mide con la fuente 'pastilla' ya puesta y al
     ancho de la banda MENOS el padding horizontal, de modo que una etiqueta
     larga se parte en varias lineas DENTRO de su pastilla y nunca se sale.
     Si la pastilla no cabe en el alto que queda, salta de pagina entera: no
     existe el caso de una pastilla cortada. */
  function escribirPildoras(flujo, items) {
    var doc = flujo.doc;
    var t = aplicarTipo(doc, 'pastilla');
    var inter = interlineado(t);
    var xDerecha = LATERAL_X + LATERAL_ANCHO;
    var yLinea = flujo.y;
    var x = LATERAL_X;
    var altoLinea = 0;
    var altoPagina = flujo.limiteInferior - MARGENES.arriba;

    /* Coloca UNA pastilla (ya partida en lineas) en la banda: la envuelve en la
       fila actual si cabe, salta de fila y de pagina cuando no, y dibuja con la
       fuente real ya puesta. Es la unica que mide y avanza, para que el ancho
       ocupado y la altura de la fila nunca se calculen en un sitio y se pinten
       en otro. */
    function colocar(lineas) {
      var w = 0;
      for (var i = 0; i < lineas.length; i++) {
        if (doc.getTextWidth(lineas[i]) > w) w = doc.getTextWidth(lineas[i]);
      }
      w += PILDORA.padX * 2;
      var h = lineas.length * inter + PILDORA.padY * 2;

      if (x + w > xDerecha + EPS) {
        yLinea += altoLinea + PILDORA.sep;
        x = LATERAL_X;
        altoLinea = 0;
      }
      /* La decision de salto la toma asegurarEspacio() con el alto ya medido. */
      flujo.y = yLinea;
      var huboSalto = asegurarEspacio(flujo, h + PILDORA.sep);
      yLinea = flujo.y;
      if (huboSalto) {
        x = LATERAL_X;
        altoLinea = 0;
      }

      rellenar(doc, BANDA_CFG.pastillaFondo);
      doc.roundedRect(x, yLinea, w, h, PILDORA.radio, PILDORA.radio, 'F');
      pintar(doc, BANDA_CFG.pastillaTexto);
      var yBase0 = yLinea + PILDORA.padY + em(t.tam) * SUBIDA;
      for (var k = 0; k < lineas.length; k++) {
        doc.text(lineas[k], x + PILDORA.padX, yBase0 + k * inter);
      }
      x += w + PILDORA.sep;
      if (h > altoLinea) altoLinea = h;
    }

    for (var i = 0; i < items.length; i++) {
      var lineas = partirTexto(doc, items[i], LATERAL_ANCHO - PILDORA.padX * 2, 'pastilla');
      if (!lineas.length) continue;
      var h = lineas.length * inter + PILDORA.padY * 2;
      if (h <= altoPagina) {
        colocar(lineas);
        continue;
      }
      /* Una etiqueta mas alta que una pagina no cabe en ninguna pastilla ni
         se puede recortar (recortar seria perder texto del usuario): se
         reparte en varias pildoras, una por trozo de lineas. Ninguna linea se
         descarta y ninguna se parte por la mitad. */
      flujo.diag.bloquesPartidos++;
      var caben = Math.max(1, Math.floor(
        (altoPagina - PILDORA.padY * 2 - PILDORA.sep) / inter));
      for (var ini = 0; ini < lineas.length; ini += caben) {
        colocar(lineas.slice(ini, ini + caben));
      }
    }
    flujo.y = yLinea + altoLinea;
  }

  /* Idiomas en la banda: la ETIQUETA con su nivel ("Ingles - B1", "Espanol
     nativo") y, encima, el mapeo visual de 5 puntos.
     El texto del nivel se conserva siempre: los puntos son un adorno y 5
     puntos_full no distinguen "C2" de "nativo", asi que si solo se dibujaran
     puntos se perderia informacion (y el texto dejaria de ser extraible).
     Sin nivel valido no se dibuja ningun punto: cero, no un default. */
  function escribirIdiomaBanda(flujo, idioma) {
    var doc = flujo.doc;
    var t = aplicarTipo(doc, 'contacto');
    var inter = interlineado(t);
    var llenos = nivelANumero(idioma.nivel);
    var anchoPts = llenos ? anchoPuntos() : 0;
    var lineas = partirTexto(doc, etiquetaIdioma(idioma), LATERAL_ANCHO, 'contacto');
    if (!lineas.length) return;

    var cabenAlLado = !!llenos;
    if (cabenAlLado) {
      for (var i = 0; i < lineas.length; i++) {
        if (doc.getTextWidth(lineas[i]) + 2 + anchoPts > LATERAL_ANCHO) {
          cabenAlLado = false;
          break;
        }
      }
    }
    var alto = lineas.length * inter + ESPACIO.trasFila +
      ((llenos && !cabenAlLado) ? inter : 0);
    asegurarEspacio(flujo, alto);

    var yTecho = flujo.y + ESPACIO.trasFila;
    var yBase0 = yTecho + em(t.tam) * SUBIDA;
    pintar(doc, BANDA_CFG.suave);
    for (var j = 0; j < lineas.length; j++) {
      doc.text(lineas[j], LATERAL_X, yBase0 + j * inter);
    }
    if (llenos) {
      if (cabenAlLado) {
        dibujarPuntos(doc, LATERAL_X + LATERAL_ANCHO - anchoPts,
          yBase0 + (lineas.length - 1) * inter - em(t.tam) * 0.25,
          llenos, BANDA_CFG.puntoLleno, BANDA_CFG.puntoVacio);
      } else {
        dibujarPuntos(doc, LATERAL_X, yTecho + lineas.length * inter + inter / 2,
          llenos, BANDA_CFG.puntoLleno, BANDA_CFG.puntoVacio);
      }
    }
    flujo.y = yTecho + lineas.length * inter + (llenos && !cabenAlLado ? inter : 0);
  }

  function renderPlantillaSidebar(doc, m) {
    var principal = crearFlujo(doc, { x: PRINCIPAL_X, ancho: PRINCIPAL_ANCHO });

    /* La columna lateral avanza a la pagina siguiente REUTILIZANDO las que la
       columna principal ya creo; solo crea paginas nuevas si la corre de largo,
       y en ese caso la banda se pinta antes de dibujar el primer texto. */
    var lateral = crearFlujo(doc, {
      x: LATERAL_X,
      ancho: LATERAL_ANCHO,
      nuevaPagina: function (flujo) {
        var proxima = flujo.pagina + 1;
        if (proxima > doc.getNumberOfPages()) {
          doc.addPage();
          pintarBanda(doc);
        } else {
          doc.setPage(proxima);
        }
        flujo.pagina = proxima;
      }
    });

    /* ---------------- COLUMNA DE CONTENIDO ---------------- */
    if (hayPerfil(m)) {
      tituloSeccion(principal, 'PERFIL', RESERVA_LINEA);
      escribirPerfil(principal, m);
    }
    recorrerItems(principal, 'EXPERIENCIA LABORAL', m.experiencia,
      clavesExperiencia(), specExperiencia, pintarItemSuelto);
    recorrerItems(principal, 'EDUCACIÓN', m.educacion,
      ['titulo', 'institucion', 'meta'], specTituloInstitucion, pintarItemSuelto);
    recorrerItems(principal, 'CERTIFICACIONES', m.certificaciones,
      ['titulo', 'institucion', 'meta'], specTituloInstitucion, pintarItemSuelto);
    recorrerItems(principal, 'PROYECTOS', m.proyectos,
      ['titulo', 'descripcion', 'tecnologias'], specProyecto, pintarItemSuelto);

    var paginasPrincipal = doc.getNumberOfPages();

    /* ---------------- BANDA LATERAL ----------------
       La banda se pinta en TODAS las paginas existentes, tambien la primera.
       No hay solape posible: ocupa x de 0 a 72 mm y el texto de la columna
       empieza en x = 82 mm, asi que puede ir despues sin tapar nada. */
    for (var pg = 1; pg <= paginasPrincipal; pg++) {
      doc.setPage(pg);
      pintarBanda(doc);
    }

    doc.setPage(1);
    var p = m.personal;
    if (p.nombre) {
      escribirTexto(lateral, p.nombre, {
        tipo: 'nombre', color: BANDA_CFG.texto, espacioDespues: ESPACIO.trasFila
      });
    }
    if (p.cargo) {
      escribirTexto(lateral, p.cargo, {
        tipo: 'titular', color: BANDA_CFG.texto, espacioDespues: ESPACIO.trasFila * 0.4
      });
    }
    if (m.titular) {
      escribirTexto(lateral, m.titular, {
        tipo: 'meta', color: BANDA_CFG.suave, espacioDespues: ESPACIO.trasSeccion
      });
    }

    if (contactoDe(m).length) {
      tituloBanda(lateral, 'CONTACTO');
      lateral.y += ESPACIO.trasFila;
      var contacto = contactoDe(m);
      for (var c = 0; c < contacto.length; c++) {
        escribirTexto(lateral, contacto[c], {
          tipo: 'contacto', color: BANDA_CFG.suave, espacioAntes: ESPACIO.trasFila
        });
      }
    }

    if (m.habilidades.length) {
      tituloBanda(lateral, 'HABILIDADES');
      lateral.y += ESPACIO.trasFila;
      for (var h = 0; h < m.habilidades.length; h++) {
        var grupo = m.habilidades[h];
        if (!grupo.items.length) continue;
        if (h > 0) lateral.y += ESPACIO.trasFila * 0.6;
        var tCat = aplicarTipo(doc, 'meta');
        pintar(doc, BANDA_CFG.titulo);
        var catLineas = partirTexto(doc, grupo.categoria, LATERAL_ANCHO, 'meta');
        asegurarEspacio(lateral,
          catLineas.length * interlineado(tCat) + ESPACIO.trasFila);
        var yCat = lateral.y + ESPACIO.trasFila * 0.4;
        for (var ci = 0; ci < catLineas.length; ci++) {
          doc.text(catLineas[ci], LATERAL_X,
            yCat + em(tCat.tam) * SUBIDA + ci * interlineado(tCat));
        }
        lateral.y = yCat + catLineas.length * interlineado(tCat);
        lateral.y += ESPACIO.trasFila * 0.5;
        escribirPildoras(lateral, grupo.items);
        lateral.y += ESPACIO.trasFila;
      }
    }

    if (m.idiomas.length === 0) {
      lateral.diag.seccionesOmitidas.push('IDIOMAS (sin items)');
    } else {
      tituloBanda(lateral, 'IDIOMAS');
      lateral.y += ESPACIO.trasFila;
      for (var id = 0; id < m.idiomas.length; id++) {
        escribirIdiomaBanda(lateral, m.idiomas[id]);
      }
    }

    /* Se devuelve un flujo con el diagnostico de las DOS columnas fundido: el
       generador lee `flujo.diag`, asi que la forma debe ser la misma que la de
       una plantilla de una sola columna. */
    return { diag: fusionarDiag(principal.diag, lateral.diag) };
  }

  /* El pie de la plantilla 0 va en la columna de contenido: centrado caeria
     sobre la banda de color y el gris #6B7280 sobre #1F2937 no se leeria. */
  function pieSidebar(doc, pagina, total) {
    doc.setFont(TIPO.pie.fuente, TIPO.pie.estilo);
    doc.setFontSize(TIPO.pie.tam);
    pintar(doc, COLORES.pie);
    doc.text('Página ' + pagina + ' de ' + total, PAGINA.ancho - MARGENES.derecha,
      PIE_Y, { align: 'right' });
  }

  function fusionarDiag(a, b) {
    return {
      saltosPagina: a.saltosPagina + b.saltosPagina,
      bloquesPartidos: a.bloquesPartidos + b.bloquesPartidos,
      itemsRenderizados: a.itemsRenderizados,
      itemsVacios: a.itemsVacios + b.itemsVacios,
      seccionesOmitidas: a.seccionesOmitidas.concat(b.seccionesOmitidas),
      lineasCortadasPorAncho: a.lineasCortadasPorAncho + b.lineasCortadasPorAncho
    };
  }

  /* ==================================================================
   * 10e. PLANTILLA 1 - "CREATIVO" (cajas de color)
   *
   * Equivalente a tcolorbox: cada item es un rectangulo redondeado con relleno
   * de color y TEXTO REAL dentro. El alto se calcula antes de dibujar, a
   * partir del texto ya partido con la fuente correcta; una caja que no cabe
   * pasa entera a la pagina siguiente y, si es mas alta que una pagina, se
   * reparte por lineas (nunca se corta una linea por la mitad).
   *
   * NO ES ATS-SAFE: las cajas y las barras de seccion rompen el parsing. Se
   * declara, no se disimula. El texto sigue siendo real y extraible.
   * ================================================================== */

  function barraSeccion(flujo, etiqueta) {
    var doc = flujo.doc;
    var t = aplicarTipo(doc, 'seccion');
    var lineas = partirTexto(doc, etiqueta,
      flujo.ancho - CAJA_CFG.barraPadX * 2, 'seccion');
    if (!lineas.length) return;
    var inter = interlineado(t);
    var alto = lineas.length * inter + CAJA_CFG.barraPadY * 2;
    asegurarEspacio(flujo, ESPACIO.trasTitular + alto + ESPACIO.trasSeccion +
      RESERVA_ITEM_ENTERO);
    var yTecho = flujo.y + ESPACIO.trasTitular;
    rellenar(doc, CAJA_CFG.barraFondo);
    doc.roundedRect(flujo.x, yTecho, flujo.ancho, alto,
      CAJA_CFG.radio, CAJA_CFG.radio, 'F');
    pintar(doc, CAJA_CFG.barraTexto);
    var yBase0 = yTecho + CAJA_CFG.barraPadY + em(t.tam) * SUBIDA;
    for (var i = 0; i < lineas.length; i++) {
      doc.text(lineas[i], flujo.x + CAJA_CFG.barraPadX, yBase0 + i * inter);
    }
    flujo.y = yTecho + alto + ESPACIO.trasSeccion;
  }

  /* Convierte grupos medidos en filas: una fila por linea, con sangria,
     marcador y color. Es la lista que consume tanto el dibujado entero como
     el repartido por paginas, para que ambos pinten EXACTAMENTE lo mismo. */
  function filasDe(grupos) {
    var filas = [];
    for (var i = 0; i < grupos.length; i++) {
      var g = grupos[i];
      for (var j = 0; j < g.lineas.length; j++) {
        filas.push({
          txt: g.lineas[j],
          tipo: g.tipo,
          color: g.color,
          colorMarcador: g.colorMarcador,
          sangria: g.sangria,
          marcador: g.marcador,
          primera: j === 0,
          alto: interlineado(TIPO[g.tipo]),
          separacion: (j === 0 && i > 0) ? CAJA_CFG.entreGrupos : 0
        });
      }
    }
    return filas;
  }

  function altoDeFilas(filas) {
    var alto = 0;
    for (var i = 0; i < filas.length; i++) alto += filas[i].alto + filas[i].separacion;
    return alto;
  }

  function dibujarCaja(flujo, x, y, ancho, filas, fondo, borde) {
    var doc = flujo.doc;
    var alto = altoDeFilas(filas) + CAJA_CFG.padY * 2;
    rellenar(doc, fondo);
    if (borde) {
      trazo(doc, borde);
      doc.setLineWidth(0.3);
      doc.roundedRect(x, y, ancho, alto, CAJA_CFG.radio, CAJA_CFG.radio, 'FD');
    } else {
      doc.roundedRect(x, y, ancho, alto, CAJA_CFG.radio, CAJA_CFG.radio, 'F');
    }
    var yCursor = y + CAJA_CFG.padY;
    for (var i = 0; i < filas.length; i++) {
      var f = filas[i];
      yCursor += f.separacion;
      /* La fuente se pone ANTES de dibujar, y es la MISMA que se uso para
         medir el alto de la fila. Si se dibujara con otra, el alto reservado y
         el texto dibujado dejarian de coincidir: es el bug de medir con una
         fuente y dibujar con otra. */
      var t = aplicarTipo(doc, f.tipo);
      var yBase = yCursor + em(t.tam) * SUBIDA;
      if (f.marcador && f.primera) {
        pintar(doc, f.colorMarcador);
        doc.text(f.marcador, x + CAJA_CFG.padX, yBase);
      }
      pintar(doc, f.color);
      doc.text(f.txt, x + CAJA_CFG.padX + f.sangria, yBase);
      yCursor += f.alto;
    }
    return alto;
  }

  /* Dibuja una caja en el flujo y resuelve los tres casos de paginacion:
       1. cabe donde estamos -> se dibuja ahi;
       2. no cabe pero cabe en una pagina -> la caja entra COMPLETA en la
          siguiente (nunca se dibuja una caja cortada);
       3. es mas alta que una pagina entera -> se reparte POR LINEAS en varias
          cajas, sin partir ninguna linea y sin perder ninguna.
     Devuelve cuantos trozos se dibujaron. `antes` es el espacio a reservar antes
     de la primera caja (0 en la primera de su seccion). */
  function dibujarCajaFluida(flujo, filas, fondo, borde, antes) {
    if (!filas || !filas.length) return 0;
    var alto = altoDeFilas(filas) + CAJA_CFG.padY * 2;
    var disponible = flujo.limiteInferior - flujo.y;
    var altoPagina = flujo.limiteInferior - MARGENES.arriba;

    if (antes + alto <= disponible + EPS) {
      flujo.y += antes;
      dibujarCaja(flujo, flujo.x, flujo.y, flujo.ancho, filas, fondo, borde);
      flujo.y += alto;
      return 1;
    }
    if (antes + alto <= altoPagina + EPS) {
      asegurarEspacio(flujo, antes + alto);
      dibujarCaja(flujo, flujo.x, flujo.y, flujo.ancho, filas, fondo, borde);
      flujo.y += alto;
      return 1;
    }

    flujo.diag.bloquesPartidos++;
    var i = 0;
    var primeroTrozo = true;
    var trozos = 0;
    while (i < filas.length) {
      var caben = 0;
      var acumular = 0;
      while (i + caben < filas.length) {
        var siguiente = filas[i + caben].alto + filas[i + caben].separacion;
        if (acumular + siguiente > altoPagina - CAJA_CFG.padY * 2) break;
        acumular += siguiente;
        caben++;
      }
      /* Una sola fila siempre cabe: garantiza que el bucle avanza. */
      if (caben === 0) caben = 1;
      var trozo = filas.slice(i, i + caben);
      var trozoAlto = altoDeFilas(trozo) + CAJA_CFG.padY * 2;
      var antesTrozo = primeroTrozo ? antes : 0;
      if (antesTrozo + trozoAlto > disponible + EPS) {
        asegurarEspacio(flujo, antesTrozo + trozoAlto);
      } else {
        flujo.y += antesTrozo;
      }
      dibujarCaja(flujo, flujo.x, flujo.y, flujo.ancho, trozo, fondo, borde);
      flujo.y += trozoAlto;
      disponible = flujo.limiteInferior - flujo.y;
      i += caben;
      primeroTrozo = false;
      trozos++;
    }
    return trozos;
  }

  /* Caja de texto simple (contacto, habilidades, idiomas, perfil).
     Recibe los TRAMOS EN CRUDO y es ella quien los parte, porque es la unica
     que conoce el ancho interior real (ancho de la caja menos el padding):
     partir fuera y dibujar dentro permitiria que una linea se saliera de la
     caja. Mismo contrato que escribirCajaItem: alto medido antes de dibujar y
     reparto por lineas si el bloque es mas alto que una pagina. */
  function escribirCajaTexto(flujo, tramos, tipo, color, opciones) {
    var o = opciones || {};
    var doc = flujo.doc;
    var t = aplicarTipo(doc, tipo);
    var interior = flujo.ancho - CAJA_CFG.padX * 2;
    var antes = o.primero ? 0 : ESPACIO.entreItems;
    var filas = [];
    for (var i = 0; i < tramos.length; i++) {
      if (!texto(tramos[i])) continue;
      var lineas = partirTexto(doc, tramos[i], interior, tipo);
      for (var j = 0; j < lineas.length; j++) {
        filas.push({
          txt: lineas[j],
          tipo: tipo,
          color: color || COLORES.texto,
          colorMarcador: COLORES.suave,
          sangria: 0,
          marcador: '',
          primera: j === 0,
          alto: interlineado(t),
          separacion: (filas.length === 0) ? 0 : CAJA_CFG.entreGrupos
        });
      }
    }
    if (!filas.length) return 0;
    dibujarCajaFluida(flujo, filas, o.fondo || CAJA_CFG.fondo,
      o.borde === undefined ? CAJA_CFG.borde : o.borde, antes);
    return filas.length;
  }

  function escribirCajaItem(flujo, spec) {
    var doc = flujo.doc;
    var interior = flujo.ancho - CAJA_CFG.padX * 2;
    var grupos = estructuraItem(doc, spec, interior, SANGRIA);
    if (!grupos.length) return;
    dibujarCajaFluida(flujo, filasDe(grupos), CAJA_CFG.fondo, CAJA_CFG.borde,
      spec.primero ? 0 : ESPACIO.entreItems);
  }

  function renderPlantillaCajas(doc, m) {
    var flujo = crearFlujo(doc);
    var p = m.personal;

    if (p.nombre) {
      escribirTexto(flujo, p.nombre, {
        tipo: 'nombre', espacioDespues: ESPACIO.regla
      });
      rellenar(doc, CAJA_CFG.barraFondo);
      doc.roundedRect(MARGENES.izquierda, flujo.y - ESPACIO.regla * 0.6, 46, 1.4,
        0.7, 0.7, 'F');
      flujo.y += ESPACIO.regla * 0.4;
    }
    if (p.cargo) {
      escribirTexto(flujo, p.cargo, { tipo: 'titular', espacioDespues: 1 });
    }
    if (m.titular) {
      escribirTexto(flujo, m.titular, {
        tipo: 'titular', color: COLORES.suave, espacioDespues: ESPACIO.trasSeccion
      });
    }

    var contacto = contactoDe(m);
    if (contacto.length) {
      escribirCajaTexto(flujo, contacto, 'contacto', COLORES.texto, { primero: true });
    }

    if (hayPerfil(m)) {
      barraSeccion(flujo, 'PERFIL');
      var tramosPerfil = [];
      if (texto(p.objetivo)) tramosPerfil.push(p.objetivo);
      for (var k = 0; k < CLAVES_PERFIL.length; k++) {
        var v = texto(p[CLAVES_PERFIL[k][1]]);
        if (v) tramosPerfil.push(CLAVES_PERFIL[k][0] + ': ' + v);
      }
      escribirCajaTexto(flujo, tramosPerfil, 'secundario', COLORES.texto, {});
    }

    recorrerItems(flujo, 'EXPERIENCIA LABORAL', m.experiencia,
      clavesExperiencia(), specExperiencia, escribirCajaItem);
    recorrerItems(flujo, 'EDUCACIÓN', m.educacion,
      ['titulo', 'institucion', 'meta'], specTituloInstitucion, escribirCajaItem);
    recorrerItems(flujo, 'CERTIFICACIONES', m.certificaciones,
      ['titulo', 'institucion', 'meta'], specTituloInstitucion, escribirCajaItem);
    recorrerItems(flujo, 'PROYECTOS', m.proyectos,
      ['titulo', 'descripcion', 'tecnologias'], specProyecto, escribirCajaItem);

    if (m.habilidades.length === 0) {
      flujo.diag.seccionesOmitidas.push('HABILIDADES (sin items)');
    } else {
      barraSeccion(flujo, 'HABILIDADES');
      var hab = [];
      for (var h = 0; h < m.habilidades.length; h++) {
        if (!m.habilidades[h].items.length) continue;
        hab.push(m.habilidades[h].categoria + ': ' + m.habilidades[h].items.join(', '));
      }
      escribirCajaTexto(flujo, hab, 'secundario', COLORES.texto, {});
    }

    if (m.idiomas.length === 0) {
      flujo.diag.seccionesOmitidas.push('IDIOMAS (sin items)');
    } else {
      barraSeccion(flujo, 'IDIOMAS');
      var idiomas = [];
      for (var id = 0; id < m.idiomas.length; id++) {
        idiomas.push(etiquetaIdioma(m.idiomas[id]));
      }
      escribirCajaTexto(flujo, idiomas, 'secundario', COLORES.texto, {});
    }

    return flujo;
  }

  /* ==================================================================
   * 11. METADATOS Y PIE DE PAGINA
   * ================================================================== */

  function aplicarMetadatos(doc, m, nombrePlantilla) {
    var palabras = [];
    for (var i = 0; i < m.habilidades.length; i++) {
      for (var j = 0; j < m.habilidades[i].items.length; j++) {
        palabras.push(m.habilidades[i].items[j]);
      }
    }
    for (var k = 0; k < m.idiomas.length; k++) {
      palabras.push(m.idiomas[k].idioma);
    }
    /* 20 palabras clave: suficiente para indexado, no un volcado del CV. */
    var claves = palabras.slice(0, 20).join(', ');
    var propiedades = {
      title: (m.personal.nombre || 'Curriculum Vitae') + ' - Curriculum Vitae',
      subject: 'Curriculum Vitae' + (nombrePlantilla ? ' (' + nombrePlantilla + ')' : ''),
      author: m.personal.nombre || 'CV Builder',
      keywords: claves,
      creator: 'CV Builder - ' + VERSION,
      producer: 'jsPDF'
    };
    try {
      if (typeof doc.setProperties === 'function') doc.setProperties(propiedades);
      else if (typeof doc.setDocumentProperties === 'function') {
        doc.setDocumentProperties(propiedades);
      }
    } catch (e) {
      /* Los metadatos nunca deben tumbar la generacion del PDF. */
    }
  }

  /* Se estampan al final, cuando ya se conoce el total de paginas.
     Una plantilla puede aportar su propio pie con `pieDoc` (la plantilla 0
     lo necesita: el pie centrado caeria sobre la banda de color). Sin
     `pieDoc` se usa el pie centrado de siempre, que es el de la plantilla 2. */
  function estamparPie(doc, plantilla) {
    var total = doc.getNumberOfPages();
    if (total < 1) return;
    for (var p = 1; p <= total; p++) {
      try {
        doc.setPage(p);
        if (plantilla && typeof plantilla.pieDoc === 'function') {
          plantilla.pieDoc(doc, p, total);
          continue;
        }
        doc.setFont(TIPO.pie.fuente, TIPO.pie.estilo);
        doc.setFontSize(TIPO.pie.tam);
        pintar(doc, COLORES.pie);
        doc.text('Página ' + p + ' de ' + total, PAGINA.ancho / 2, PIE_Y, {
          align: 'center',
          maxWidth: ANCHO_UTIL,
          lineHeightFactor: 1
        });
      } catch (e) {
        /* Un pie que falla no puede invalidar el documento. */
      }
    }
  }

  /* ==================================================================
   * 12. REGISTRO DE PLANTILLAS
   * ================================================================== */

  var TEMPLATES = {};

  function registrarPlantilla(id, definicion) {
    var clave = String(id);
    if (!definicion || typeof definicion.render !== 'function') {
      throw new Error('registrarPlantilla: falta render() en la definicion de "' + clave + '"');
    }
    if (TEMPLATES[clave] && TEMPLATES[clave].disponible) {
      try {
        console.warn('[pdfgen] Plantilla "' + clave + '" ya implementada; se reemplaza.');
      } catch (e) { /* sin consola */ }
    }
    TEMPLATES[clave] = {
      id: clave,
      nombre: definicion.nombre || ('Plantilla ' + clave),
      disponible: definicion.disponible !== false,
      /* Metadatos de la plantilla. `ats.seguro` NO es cosmetico: la UI y el
         usuario necesitan saber si el texto sobrevive a un parser de ATS.
         La 2 es la unica ATS-safe; la 0 y la 1 pintan sobre fondos de color y
         declaran que no lo son. */
      ats: definicion.ats || { seguro: true },
      pieDoc: typeof definicion.pieDoc === 'function' ? definicion.pieDoc : null,
      render: definicion.render
    };
    return TEMPLATES[clave];
  }

  function listarPlantillas() {
    var claves = Object.keys(TEMPLATES);
    claves.sort();
    var salida = [];
    for (var i = 0; i < claves.length; i++) {
      salida.push({
        id: TEMPLATES[claves[i]].id,
        nombre: TEMPLATES[claves[i]].nombre,
        disponible: TEMPLATES[claves[i]].disponible,
        ats: TEMPLATES[claves[i]].ats
      });
    }
    return salida;
  }

  /* Plantilla 2: la unica ATS-safe. Una sola columna, sin cajas ni colores de
     fondo: es la que un parser de ATS puede leer en orden de lectura. */
  registrarPlantilla('2', {
    nombre: 'Profesional Clásico',
    disponible: true,
    ats: {
      seguro: true,
      motivo: 'Una sola columna, sin fondos de color ni tablas: el texto fluye en orden de lectura.'
    },
    render: renderPlantillaClasica
  });

  /* Plantilla 0: banda lateral de color. El texto sigue siendo real y
     extraible, pero la banda rompe la lectura en dos columnas de un ATS. */
  registrarPlantilla('1', {
    nombre: 'Moderno y Limpio',
    disponible: true,
    ats: {
      seguro: false,
      motivo: 'Banda lateral de color a dos columnas: muchos ATS leen solo la primera y pierden la banda.'
    },
    pieDoc: pieSidebar,
    render: renderPlantillaSidebar
  });

  /* Plantilla 1: cajas de color. El texto es real, pero las cajas y las barras
     de seccion rompen el parsing. */
  registrarPlantilla('3', {
    nombre: 'Ejecutivo',
    disponible: true,
    ats: {
      seguro: false,
      motivo: 'Cajas y barras de color por bloque: el ATS no sabe donde empieza y acaba cada seccion.'
    },
    render: renderPlantillaCajas
  });

  var PLANTILLA_POR_DEFECTO = '2';

  /* ==================================================================
   * 13. API PUBLICA
   * ================================================================== */

  function resolverJsPDF(opciones) {
    if (opciones && typeof opciones.JsPDFCtor === 'function') {
      return opciones.JsPDFCtor;
    }
    var g = typeof globalThis !== 'undefined' ? globalThis : null;
    if (g) {
      if (g.jspdf && typeof g.jspdf.jsPDF === 'function') return g.jspdf.jsPDF;
      if (typeof g.jsPDF === 'function') return g.jsPDF;
    }
    if (typeof window !== 'undefined') {
      if (window.jspdf && typeof window.jspdf.jsPDF === 'function') {
        return window.jspdf.jsPDF;
      }
      if (typeof window.jsPDF === 'function') return window.jsPDF;
    }
    return null;
  }

  /**
   * Genera el PDF de un CV.
   *
   * @param {Object} data        Modelo del CV (misma forma que DEFAULT_DATA).
   * @param {String} templateId  '1' | '2' | '3'. Si es null/undefined/'' usa '2'.
   * @param {Object} [opciones]  { JsPDFCtor, compress, putOnlyUsedFonts }
   * @returns {Object}           Instancia de jsPDF, con `__pdfgen` (diagnostico).
   */
  function generarPDFCv(data, templateId, opciones) {
    var opts = opciones || {};
    var id = (templateId === null || templateId === undefined || templateId === '')
      ? PLANTILLA_POR_DEFECTO
      : String(templateId);

    if (!Object.prototype.hasOwnProperty.call(TEMPLATES, id)) {
      throw new Error('generarPDFCv: plantilla desconocida "' + id + '". Disponibles: ' +
        Object.keys(TEMPLATES).join(', '));
    }
    var plantilla = TEMPLATES[id];
    if (!plantilla.disponible) {
      throw new Error('generarPDFCv: la plantilla ' + id + ' (' + plantilla.nombre +
        ') aun no esta implementada en js/pdfgen.js');
    }

    var Ctor = resolverJsPDF(opts);
    if (typeof Ctor !== 'function') {
      throw new Error('generarPDFCv: jsPDF no esta disponible. Carga ' +
        'vendor/jspdf.umd.min.js antes de js/pdfgen.js, o pasa ' +
        'opciones.JsPDFCtor.');
    }

    var doc = new Ctor({
      unit: 'mm',
      format: 'a4',
      orientation: 'portrait',
      compress: opts.compress === true
    });

    var modelo = normalizarDatos(data);
    aplicarMetadatos(doc, modelo, plantilla.nombre);
    var flujo = plantilla.render(doc, modelo);
    estamparPie(doc, plantilla);

    doc.__pdfgen = {
      version: VERSION,
      plantilla: id,
      nombrePlantilla: plantilla.nombre,
      paginas: doc.getNumberOfPages(),
      limiteInferior: LIMITE_INFERIOR,
      anchoUtil: ANCHO_UTIL,
      secciones: seccionNames(modelo),
      diagnostico: flujo ? flujo.diag : null
    };
    return doc;
  }

  function seccionNames(m) {
    var out = [];
    if (m.personal.nombre || m.titular) out.push('CABECERA');
    out.push('CONTACTO', 'PERFIL');
    if (m.experiencia.length) out.push('EXPERIENCIA LABORAL');
    if (m.educacion.length) out.push('EDUCACIÓN');
    if (m.certificaciones.length) out.push('CERTIFICACIONES');
    if (m.proyectos.length) out.push('PROYECTOS');
    if (m.habilidades.length) out.push('HABILIDADES');
    if (m.idiomas.length) out.push('IDIOMAS');
    return out;
  }

  /**
   * Igual que generarPDFCv pero devuelve directamente la salida de jsPDF.
   *
   * @param {Object} data
   * @param {String} templateId
   * @param {String} [tipoSalida] 'blob' | 'arraybuffer' | 'datauristring' | 'pdf'
   * @param {Object} [opciones]  { JsPDFCtor, compress }
   * @returns {Blob|ArrayBuffer|string|Uint8Array}
   */
  function generarPDFCvOutput(data, templateId, tipoSalida, opciones) {
    var doc = generarPDFCv(data, templateId, opciones);
    var tipo = tipoSalida || 'arraybuffer';
    if (tipo === 'datauristring') return doc.output('datauristring');
    return doc.output(tipo);
  }

  return {
    version: VERSION,
    generarPDFCv: generarPDFCv,
    generarPDFCvOutput: generarPDFCvOutput,
    TEMPLATES: TEMPLATES,
    registrarPlantilla: registrarPlantilla,
    listarPlantillas: listarPlantillas,
    normalizarDatos: normalizarDatos,
    resolverJsPDF: resolverJsPDF,
    PAGINA: PAGINA,
    MARGENES: MARGENES,
    ANCHO_UTIL: ANCHO_UTIL,
    LIMITE_INFERIOR: LIMITE_INFERIOR,
    TIPO: TIPO,
    COLORES: COLORES,
    texto: texto,
    partirTexto: partirTexto
  };
})();

/* ====================================================================
 * 14. EXPOSICION
 *     - Navegador: window.PdfGen (namespace) y window.generarPDFCv (API).
 *     - Node:      guard CommonJS para el harness de QA. Inerte en el
 *                  navegador, donde `module` no existe.
 * ==================================================================== */

if (typeof window !== 'undefined') {
  window.PdfGen = PDFGEN;
  window.generarPDFCv = PDFGEN.generarPDFCv;
  window.generarPDFCvOutput = PDFGEN.generarPDFCvOutput;
  window.PDFGEN_PLANTILLAS = PDFGEN.TEMPLATES;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    generarPDFCv: PDFGEN.generarPDFCv,
    generarPDFCvOutput: PDFGEN.generarPDFCvOutput,
    TEMPLATES: PDFGEN.TEMPLATES,
    registrarPlantilla: PDFGEN.registrarPlantilla,
    listarPlantillas: PDFGEN.listarPlantillas,
    normalizarDatos: PDFGEN.normalizarDatos,
    resolverJsPDF: PDFGEN.resolverJsPDF,
    PAGINA: PDFGEN.PAGINA,
    MARGENES: PDFGEN.MARGENES,
    ANCHO_UTIL: PDFGEN.ANCHO_UTIL,
    LIMITE_INFERIOR: PDFGEN.LIMITE_INFERIOR,
    TIPO: PDFGEN.TIPO,
    COLORES: PDFGEN.COLORES,
    texto: PDFGEN.texto,
    partirTexto: PDFGEN.partirTexto,
    version: PDFGEN.version
  };
}
