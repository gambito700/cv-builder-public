# CV Builder

Generador de CV gratuito, sin registro y sin servidor. El PDF se crea **en tu
navegador**: ningún dato del CV sale de tu dispositivo.

El asistente **arranca en blanco**: no trae datos cargados, ni de muestra ni de
ficha. Los campos los llenas tú y el PDF sale de lo que escribiste. La página
en GitHub Pages se publica al activar Pages, en
`https://gambito700.github.io/cv-builder-public/`; hasta entonces, el
repositorio es la referencia.

## Activar GitHub Pages

Este es el **paso 1 pendiente** del proyecto: mientras Pages no este activo, el
repo es la referencia y la URL publica responde 404. Son 5 pasos.

1. En el repo: **Settings -> Pages**.
2. En **Build and deployment**, pon **Source: "Deploy from a branch"**.
3. **Branch: `main`**, **folder: `/ (root)`**. **Save**.
4. Espera 1 a 2 minutos. La URL es
   `https://gambito700.github.io/cv-builder-public/`.
5. Verifica: la pagina carga, el pie de pagina con los 2 enlaces (portafolio y
   repo) funciona, y el selector de telefono con banderas funciona.

Lo que conviene saber antes de apretar Save:

- El sitio es **estatico puro**. No hay paso de build, no hay `npm install`, no
  hay `package.json` y no hay nada que configurar en la seccion de build: Pages
  sirve lo que hay en la raiz del repo, tal cual.
- **HTTPS es automatico.** GitHub Pages emite el certificado solo; no hay que
  pedirlo ni configurarlo.
- **`vendor/` tiene que estar commiteado.** El boton de PDF carga
  `vendor/jspdf.umd.min.js` con ruta relativa. Si ese archivo no viaja en el
  commit, el boton de PDF se rompe. Ya esta commiteado y `.gitignore` no lo
  toca, pero el aviso queda: si alguien agrega `vendor/` al `.gitignore`, la app
  se publica sin su motor de PDF y el fallo aparece en el navegador, no en la
  configuracion.
- Cada `push` **reconstruye**: no es instantaneo. Dale cerca de 1 minuto y
  despues haz **hard-refresh** (Ctrl+Shift+R), porque el cache del navegador y
  el del CDN de GitHub te pueden seguir sirviendo la version anterior.
- El limite de GitHub Pages es **1 GB por sitio**. El repo va en ~2 MB, tres
  ordenes de magnitud por debajo. No es un problema aca ni lo va a ser.

## Qué hace

- 6 pasos guiados para armar tu CV
- 3 plantillas descargables en `.tex` (en reescritura, ver Proximamente)
- Las mismas 3 plantillas descargables en **PDF**, con texto real
- 1 de las 3 es ATS-safe; las otras 2 son diseño visual
- Sin cuenta, sin base de datos, sin cookies

### Teléfono

El campo de teléfono es un **selector de prefijo de país, con bandera, más el
número**. Eliges el prefijo en la lista y escribes el número aparte; la bandera
se actualiza sola con esa elección. Si escribes directamente un prefijo
internacional, la app lo detecta y ajusta la bandera por su cuenta.

## Plantillas

El numero de la **card** (lo que ves en pantalla) y el **id de plantilla PDF**
no son el mismo numero. El mapa esta en `js/results.js`
(`PDF_PLANTILLAS_POR_CARD`).

| Card | Nombre en pantalla | id PDF | PDF ATS | .tex |
|------|--------------------|--------|---------|------|
| 0 | Moderno Limpio | 1 | No | Sí |
| 1 | Creativo | 3 | No | Sí |
| 2 | Profesional Clásico | 2 | **Sí** | Sí |

Las 3 generan PDF. La 2 es la unica ATS-safe.

La columna `.tex` esta en reescritura: los botones siguen visibles, pero la
salida del motor actual no compila limpio con el formulario vacio, asi que no
es una funcionalidad lista. Ver **Proximamente**.

Lo que marca la diferencia no es el motor, que es el mismo para las tres, sino
el **diseno**:

- id `1` Moderno y Limpio: banda lateral de color a dos columnas.
- id `2` Profesional Clásico: una sola columna, sin cajas, sin fondos de color.
- id `3` Ejecutivo: cajas y barras de color por bloque.

En el `.tex` la 0 usa `sidebar`, `tabularx` y `minipage`; la 1 usa `tcolorbox`
y decoracion con `tikz`. Segun la documentacion oficial de Greenhouse, **las
columnas, las tablas y el texto dentro de cajas rompen el parsing automatico**
de los sistemas ATS. Por eso la 1 y la 3 dicen "no ATS-safe" en la nota bajo
el boton, aunque generen un PDF perfectamente legible para una persona.

Preferimos decirte la verdad a fingir. Otros sitios ofrecen decenas de
plantillas "ATS" que en realidad rasterizan el documento a una imagen, y una
imagen no tiene texto que un ATS pueda leer. Ahi el problema es invisible: el
sitio dice ATS y tu postulacion se pierde sola. Las 3 plantillas de aqui
escriben texto real siempre, asi que al menos el problema es visible.

## Cómo funciona el PDF

Lo genera **jsPDF 4.2.1** dentro de tu navegador. Sin LaTeX, sin servidor, sin
WASM. La libreria esta vendorizada en `vendor/jspdf.umd.min.js` (MIT) y se
carga del propio repo, no de un CDN.

El archivo se arma con `doc.text()`, que escribe **texto real**: seleccionable,
buscable, con los acentos correctos y en el orden en que se lee. Nunca se
rasteriza a imagen.

WinAnsi, la codificacion de las fuentes estandar de PDF, cubre todo el
espanol chileno: a con tilde, e con tilde, i con tilde, o con tilde, u con
tilde, n con tilde, u con dieresis, interrogacion y exclamacion. No hace falta
embeber ninguna fuente. Lo que WinAnsi **no** tiene es byte para un emoji: si
pones un emoji en tus datos, sale basura legible.

Formato A4 portrait, metadatos `Title`, `Author`, `Subject`, `Keywords` y
`Creator`, y pie con "Pagina X de Y".

La plantilla 2 (la unica ATS-safe) ademas cumple el criterio que revisamos en
los ATS reales:

- Una sola columna
- Contacto en lineas de texto, nunca en tablas
- Secciones en texto plano en mayusculas
- Sin cajas, sin iconos, sin fondos de color

### Paginacion

La paginacion es **determinista**: el motor mide el ancho de cada linea con las
metricas de la fuente antes de escribir, y decide los cortes con numeros fijos
de margen, caja util y limite inferior. No depende del contenido ni de un
`splitTextToSize` que se comporte distinto segun el navegador.

El motor **nunca recorta contenido**. Si un item no cabe en lo que queda de la
pagina, lo baja entero a la siguiente. Un CV largo crece en paginas, nunca
pierde items. Un item que no cabe ni en una pagina entera se parte por lineas.

El conteo de páginas no se puede sacar de la app por sí sola, porque el
asistente arranca en blanco. La medición sale del banco de pruebas: el fixture
`real` del banco de pruebas, que es un CV denso con 13 experiencias, 14
educaciones, 13 certificaciones y 7 proyectos, o sea 47 items, más 5 categorías
de habilidades con 30 habilidades y 2 idiomas. Con ese CV la 1 da 5 páginas, la
2 da 5 y la 3 da 6.

## Estado de la verificación del PDF

El banco de pruebas es una herramienta local y no se publica. Genera los PDF de 10 fixtures
en las 3 plantillas, los somete a Poppler (`pdftotext`, `pdftoppm`) y comprueba
un catalogo de invariantes: coordenadas de cada palabra contra la caja util,
orden de lectura, cobertura de estilos, densidad, conteo de items, acentos y
metadatos.

Ultima corrida, en esta maquina:

```
900 checks | OK 668 | FALLA 15 | AVISO 12 | N/A 205
```

**15 checks siguen en FALLA.** No son todos del mismo tipo:

- 7 x `ats.orden-lectura`: el motor pinta `CONTACTO` y luego `PERFIL`, y el
  check espera el orden inverso. Es una discrepancia entre el criterio del
  harness y el orden elegido en el motor, no texto perdido.
- 7 x `pag.sin-huerfana`: la ultima pagina queda por debajo del 20% de su
  mediana porque el motor baja el bloque entero en vez de partirlo. Deja hueco
  al final, no pierde contenido.
- 1 x `geo.ink-dentro-caja`: con un texto patologico (una palabra larguisima sin
  cortes) la tinta se sale 0.9mm de la caja util en la pagina 1 de la
  plantilla 1.

Ademas hay 12 AVISOS, dos de ellos conocidos y ya diagnosticados:

- `acentos.emoji-winansi`: los emoji no tienen byte en WinAnsi y salen
  alterados. Es un defecto del motor, no del harness.
- `int.etiquetas-sin-barra`: la caja de cabecera de la plantilla 3 no lleva
  barra de titulo, por diseno.

Sobre ese mismo fixture `real` de 47 items, las tres plantillas renderizan los
47. Ninguna recorta contenido.

**Lo que no se ha hecho: la revision visual.** El harness deja 21 PNG en
`C:\Temp\cv-builder-qa-pdf` para mirar a ojo, y nadie los ha mirado. Todo lo de
arriba son coordenadas, texto extraido y conteos. Que el PDF se vea bien es
una afirmacion que todavia no se puede hacer.

## Privacidad

- Los datos se guardan solo en tu `localStorage`, en la clave `cv_builder_data`.
  No hay servidor.
- El PDF se arma en tu navegador con jsPDF vendorizado en `vendor/`. No se
  carga de ningun CDN ni de ningun servidor.
- Sin cookies, sin analytics, sin terceros, sin cuentas.
- Boton **"Empezar de Nuevo"** en la pantalla de resultados: borra la clave del
  `localStorage` y recarga la pagina.
- El RUT es un dato personal bajo la **Ley 21.719**. Es un campo de texto
  normal; si queda con contenido, el motor lo escribe en el PDF. Borralo si no
  lo quieres ahi.
- El archivo se llama `cv-plantilla-1.pdf`, `cv-plantilla-2.pdf` o
  `cv-plantilla-3.pdf`. Sin nombre, RUT, email ni telefono en el nombre.
- Detalle completo en [PRIVACIDAD.md](PRIVACIDAD.md).

La unica peticion a un tercero que hace la pagina es la hoja de estilos de
Google Fonts (Kalam y Patrick Hand), en el `<head>` de `index.html`. No
lleva datos del CV: es la URL de un CSS y la de sus `.woff2`. Los logs van a
la consola del navegador y a un `.txt` que descargas tu.

## Uso local

```bash
python -m http.server 8080
# abrir http://localhost:8080
```

## Publicar en GitHub Pages

El repo se sirve desde la raiz, asi que basta activar Pages con
**branch `main`, folder `/ (root)`**. El paso a paso completo esta arriba, en
**Activar GitHub Pages**.

Esa URL todavía no está activa: Pages hay que habilitarlo a mano desde la
configuración del repositorio.

## Diagnóstico

Los logs van a la consola del navegador. No se envia nada a ningun servidor.

```bash
# todo el detalle
http://localhost:8080/?debug=1

# solo avisos y errores
http://localhost:8080/?log=warn
```

En la consola:

```js
LOG.info('prueba')      // mensaje
LOG.history()           // ultimos 300 eventos
LOG.exportar()          // descarga cv-builder-log.txt
```

El logger **nunca registra datos personales**, solo formas: cuantas
experiencias hay, que indice de plantilla, cuantos bytes pesa el PDF. Hay una
guarda en `js/logger.js` que revisa las **claves** del contexto que se le pasa
a `LOG.debug` y avisa en consola si una se llama `nombre`, `rut`, `email`,
`telefono`, `direccion` o similar. Ojo: mira los nombres de los campos, no los
valores ni el texto del mensaje.

## Estructura

```
index.html
css/         8 hojas: tokens, base, components, wizard, results,
             responsive, carousel, tutorial
js/          logger, data, wizard, carousel, app, generator, pdfgen,
             results, tutorial
assets/      examples/ (carrusel), previews/
vendor/      jspdf.umd.min.js 4.2.1  (MIT, 410.3 KiB, -text en .gitattributes)
```

No hay `assets/fonts/`. Las tipografias del PDF son las estandar de PDF
(WinAnsi) y las de la pagina vienen de Google Fonts.

## Orden de los scripts

No hay build. Los scripts son globales y el orden importa.

```
vendor/jspdf.umd.min.js
js/logger.js       <- primero
js/data.js
js/wizard.js
js/carousel.js
js/app.js
js/generator.js    <- 3 plantillas .tex
js/pdfgen.js       <- PDF de las 3 plantillas
js/results.js
js/tutorial.js
```

## Estado

| Qué | Estado |
|---|---|
| PDF de las 3 plantillas | Funciona |
| PDF ATS (plantilla 2, id `2`) | Funciona |
| Descarga `.tex` de las 3 | En reescritura |
| Vista de codigo LaTeX | En reescritura |
| 15 checks en FALLA del banco de pruebas | Abierto |
| Revision visual del PDF renderizado | Pendiente |
| GitHub Pages | Pendiente de activar (ver arriba) |

## Proximamente

La **exportacion `.tex` y la vista de codigo LaTeX se estan reescribiendo**.
Se documentan como pendiente a proposito: los botones `.tex` siguen en pantalla
y el `.tex` se sigue descargando, pero la salida actual no es confiable.

La decision tecnica **ya esta tomada**:

- Se usara un **fork modificado de
  [latex-on-http](https://github.com/YtoTech/latex-on-http)**, desplegado en
  **Render**, invocado mediante una llamada API desde la pagina estatica.
- El motor actual genera el `.tex` **en el navegador**. Es exactamente lo que se
  va a reemplazar.

**Deuda conocida, y documentada a proposito:** el LaTeX que produce el motor
actual **no compila limpiamente cuando el formulario esta vacio**. Queda un `\\`
colgando tras los campos de contacto vacios, y hay un `itemize` al que no se le
puede meter ningun `\\item`. Es un defecto conocido y **deliberadamente no se
arreglo en este ciclo**, porque el motor se va a reemplazar: arreglar algo que
se descarta es trabajo tirado.

Por eso el `.tex` que sale hoy no debe tomarse como entregable. El PDF, en
cambio, no depende de LaTeX y sigue siendo la via soportada.

## Licencia

MIT. Ver [LICENSE](LICENSE).

Este generador no guarda, envia ni perfila nada. Si pierdes tus datos, no hay
copia en ningun lado. Eso es parte del trato.

## Creditos y licencias de terceros

La app no tiene backend, pero si tiene dependencias de terceros. Esta es la
lista completa, con la licencia de cada una y de donde se sirve.

### jsPDF 4.2.1 (MIT) - vendorizado, sin CDN

| | |
|---|---|
| Que | El motor que escribe el PDF en el navegador |
| Version | 4.2.1 (compilado el 2026-03-17) |
| Licencia | MIT |
| Donde vive | `vendor/jspdf.umd.min.js`, 420.165 bytes (410.3 KiB) |
| De donde se sirve | Del propio repo, con ruta relativa. **No hay CDN**: no se pide nada a cdnjs ni a ningun otro host |
| Proyecto | <https://github.com/parallax/jsPDF> |

El header de licencia se conserva **intacto**, porque la MIT exige que el aviso
de copyright y el texto de la licencia viajen con todas las copias o partes
sustanciales. Por eso `.gitattributes` declara `vendor/*.js -text`: para que Git
no le toque un byte al archivo.

Los titulares de copyright que aparecen en ese header son:

> 2010-2025 James Hall (`james@parall.ax`), 2015-2025 yWorks GmbH, 2015-2025
> Lukas Holländer, 2016-2018 Aras Abbasi, 2010 Aaron Spike, 2012 Willow Systems
> Corporation, 2012 Pablo Hess, 2012 Florian Jenett, 2013 Warren Weckesser, 2013
> Youssef Beddad, 2013 Lee Driscoll, 2013 Stefan Slonevskiy, 2013 Jeremy Morel,
> 2013 Christoph Hartmann, 2014 Juan Pablo Gaviria, 2014 James Makes, 2014 Diego
> Casorran, 2014 Steven Spungin, 2014 Kenneth Glassey.

Son 19, con sus emails y sus URLs en el header del archivo. Se listan aqui
completos para que el aviso de atribucion sea legible sin abrir el `.js`.

### Google Fonts: Kalam (400, 700) y Patrick Hand (SIL Open Font License)

| | |
|---|---|
| Que | Las tipografias web de la pagina |
| Licencia | SIL Open Font License |
| Donde se piden | `index.html` L10 (`preconnect`) y L12 (hoja de estilos) |
| De donde | `https://fonts.googleapis.com` (el CSS) y `https://fonts.gstatic.com` (los `.woff2`) |
| Pesos | Kalam 400 y 700, Patrick Hand |

**Esta es la UNICA peticion externa que hace la app.** La consecuencia es
directa: al cargar la pagina se le filtra la IP del visitante a Google. No
lleva datos del CV: se mandan la URL de la hoja de estilos y la de cada
`.woff2`, que son las mismas para todos los que abren la pagina.

Es la **unica excepcion** a "sin peticiones externas". El resto de las
librerias estan vendorizadas, asi que fuera de las tipografias no hay ningun
otro recurso de terceros en red.

Y es una excepcion eliminable: la OFL permite auto-hospedar los `.woff2`, y
bastaria con dejarlos en `assets/fonts/` para que la app quedara con cero
peticiones a terceros. El repo hoy no lo hace, y por eso se documenta en vez de
ocultarse.

### Fotos de ejemplo del carrusel

5 archivos en `assets/examples/`, que usa el carrusel de la portada
(`js/carousel.js` L25-45). Las 5 fueron recortadas y reescaladas a `1200x627`
para el carrusel.

| Archivo | `dc:creator` (XMP) | `dc:rights` (XMP) |
|---|---|---|
| `01-sobrio.jpg` | Ludmila Nilava | DREAMWOOD |
| `02-una-pagina.jpg` | Ludmila Nilava | DREAMWOOD |
| `03-secciones.jpg` | Ludmila Nilava | DREAMWOOD |
| `04-logros.jpg` | **sin metadatos** | **sin metadatos** |
| `05-a-mano.jpg` | Ludmila Nilava | DREAMWOOD |

**Lo que si se puede verificar desde el repo:** 4 de las 5 llevan metadatos XMP
que acreditan a `Ludmila Nilava` como autora y `DREAMWOOD` en `dc:rights`.

**Lo que NO se puede verificar:** la plataforma de origen y la licencia exacta.
`dc:rights` dice `DREAMWOOD`, que es una marca registrada de derechos, no el
nombre de una licencia ni de una plataforma, y ningun archivo del repo aclara
mas. Asi que la procedencia y la licencia quedan marcadas como **procedencia
por confirmar**. Preferimos dejarlo incompleto a inventar una fuente que el
archivo no respalda.

Se atribuye a la fotogra de todos modos porque es lo correcto, aunque la
licencia que sea termine (y sigue sin confirmarse) no llegue a exigirlo.

`04-logros.jpg` es el caso limite: no conserva `dc:creator` ni `dc:rights`, asi
que su origen **no se puede verificar desde el archivo**. Se le atribuye la
misma autoria por compartir origen con las otras 4, y eso es una **inferencia**,
no un dato que el archivo respalde.

### Sobre los nombres de terceros

Los nombres que aparecen arriba (los autores de jsPDF, la fotogra del
carrusel) **no son datos personales de quien mantiene el proyecto**. Son
atribucion de fuente: la MIT y la OFL exigen que esos avisos se conserven, y
su presencia en el repo es deliberada y conforme a licencia. La unica
identidad del propietario en todo el repositorio es la firma publica
`gambito700` en el `LICENSE` y en los 2 enlaces del pie de pagina.

