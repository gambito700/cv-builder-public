# Politica de privacidad

CV Builder funciona entero en tu navegador. No hay servidor, no hay base de
datos y no hay cuentas. Esta pagina describe exactamente que se guarda, donde,
y que sale de tu dispositivo.

## Que datos se guardan

Una sola cosa: tu CV, en el `localStorage` de tu navegador, bajo la clave
`cv_builder_data`. El valor es el modelo de datos del CV en JSON (datos
personales, experiencia, educacion, habilidades, certificaciones, proyectos).

Se escribe cada vez que avanzas de paso en el asistente. Se lee al cargar la
pagina. `localStorage` es del navegador y del perfil del sistema operativo: no
lo consulta nadie mas.

No se guarda nada mas. Sin cookies, sin `sessionStorage`, sin IndexedDB, sin
cache de servicio, sin tokens, sin identificador de visitante, sin historial de
navegacion, sin analytics, sin pixel de seguimiento.

Los logs de diagnostico tampoco se guardan en ningun lado: van a la consola del
navegador y, si tu lo pides, a un archivo `.txt` que descargas tu con
`LOG.exportar()`.

## Que no sale de tu dispositivo

El PDF se arma **en tu navegador**, con **jsPDF**, desde la memoria del
documento. El archivo se genera con `doc.text()` y se descarga con un
`<a download>`. No hay upload, no hay endpoint que reciba el CV, no hay pdf en
un servidor.

La librería jsPDF está **vendorizada en el repo**, en
`vendor/jspdf.umd.min.js` (4.2.1, MIT). Se carga con una ruta relativa, tal
cual aparece en el `<script>` de `index.html`, así que el navegador la busca en
el mismo repo que ya estás mirando. Publicada en GitHub Pages, esa ruta relativa
se resuelve en `https://gambito700.github.io/cv-builder-public/vendor/jspdf.umd.min.js`:
el mismo repositorio, no otro. Y **no** desde ningún CDN ni desde ningún otro
servidor. Ese es el motivo por el que el generador de PDF no agrega peticiones
a terceros: no es que haya fuentes autoalojadas, es que la única dependencia
pesada está en el repo. Al momento de generar el PDF no se descarga nada.

La descarga `.tex` funciona igual: se genera en el navegador y se descarga.

## La unica peticion a un tercero

La pagina carga dos tipografias web desde Google Fonts: **Kalam** y **Patrick
Hand**. Se piden desde el `<head>` de `index.html`, antes de que corra
cualquier script:

```
fonts.googleapis.com      (hoja de estilos)
fonts.gstatic.com        (los archivos .woff2)
```

Estas peticiones **no llevan datos del CV**. No se manda nombre, ni RUT, ni
email, ni telefono, ni experiencia, ni nada que hayas escrito. Se mandan la URL
de la hoja de estilos y la de cada fuente, que son las mismas para todos los
que abren la pagina. Lo que Google registra de ellas es una visita a una
direccion, con tu IP y tu agente de usuario, igual que en cualquier pagina que
use Google Fonts. Si eso no te sirve, la unica forma de evitarlo es bloquear
`fonts.googleapis.com` y `fonts.gstatic.com` en tu bloqueador: la pagina sigue
funcionando, las tipografias web no cargan y se ve con la tipografia por
defecto del sistema.

El resto de los recursos (CSS, JS, el logo, las imagenes de ejemplo del
carrusel) vienen del mismo repo.

## La app arranca en blanco

**No hay ningún dato de relleno en este repositorio.** Todos los campos del
asistente nacen vacíos, en cada carga: nombre, RUT, fecha de nacimiento,
nacionalidad, dirección, ciudad, teléfono, email, estado civil, idiomas,
disponibilidad, experiencia, educación, habilidades, certificaciones y
proyectos. No hay un CV de muestra que se abra al entrar, ni siquiera en la
memoria del navegador: la primera vez que abres la app, la primera pantalla
aparece tan vacía como la última.

La razón es directa: **un repositorio público es público, y el historial de git
no se borra.** Si la app trajera datos de relleno, quedarían en el histórico
para siempre, a la vista de cualquiera que clonee el repo, aunque después se
borraran del código y de la última versión.

Lo único que puede salir de la app es **el CV que escribiste tú**. Nada más.

## Identidad pública del proyecto

Hay una excepción, y es deliberada: la firma de quien mantiene el proyecto. Se
documenta acá para que nadie la lea como un descuido.

- El repositorio es open source y está firmado como `gambito700` en el
  `LICENSE` (MIT). Esa firma es pública y forma parte de la licencia.
- La app incluye enlaces visibles al perfil de GitHub y al portafolio del
  proyecto, como valores por defecto de los campos **GitHub** y **Portafolio**
  del paso 1. Los puedes editar o borrar como cualquier otro campo.

**Esto no es un dato personal.** No se incluye el nombre, ni el RUT, ni el
email, ni el teléfono, ni la dirección de ninguna persona, ni real ni ficticia.
Lo único que se publica es la identidad pública del proyecto en Internet: el
usuario de GitHub y el sitio donde vive. Todo lo demás nace vacío.

## Tus datos viven en tu navegador

Lo que escribes se guarda **en tu navegador**, en el `localStorage`, bajo la
clave `cv_builder_data`. No sale de tu dispositivo. Eso trae tres
consecuencias que conviene tener claras antes de escribir:

- **No hay sincronización.** Si abres la app en otro navegador, en otro
  dispositivo o en otro perfil del sistema, no ves lo que escribiste. El
  `localStorage` es local, punto.
- **No hay cuenta, ni registro, ni copia de seguridad.** No hay ningún servicio
  del otro lado al que volver. La única copia de tu CV es la que tiene ese
  navegador.
- **Si limpias los datos del navegador, los pierdes.** Borrar los datos del
  sitio, borrar el historial o abrir la app en una ventana privada con datos
  limpios borra el CV que llevabas. Sin aviso y sin segunda oportunidad.

Si necesitas una copia que sobreviva al navegador, los archivos que descargas
(PDF y `.tex`) son tuyos y quedan en tu carpeta de descargas. Eso es todo lo
que hay.

## Lo que la app no hace

Cada línea de esta lista es una decisión de diseño, no una funcionalidad
pendiente:

| | |
|---|---|
| Backend | No hay. Ningún servidor, ninguna API propia, ninguna base de datos. |
| Recolección de datos | No hay analytics, ni telemetría, ni tracking, ni píxeles, ni cookies, ni fingerprinting. |
| Servicios de terceros | No hay APIs externas, ni claves, ni tokens, ni credenciales de ningún tipo. |
| Cuentas | No hay registro, ni login, ni password, ni perfil de usuario. |
| Envío del CV | No hay upload. El PDF se arma en la memoria del navegador y se descarga con un `<a download>`. |
| Descarga en el momento de generar | No hay nada que se baje de un CDN. La librería del PDF está en el repo, ya cargada. |

## El RUT

El RUT es un dato personal bajo la **Ley 21.719** (la ley chilena que regula el
tratamiento de datos personales). No es un dato cualquiera: identifica a una
persona.

En esta app el RUT es un **campo de texto normal** en el paso 1, con el formato
sugerido `XX.XXX.XXX-X`. No hay un checkbox para excluirlo y ninguna opcion que
lo desactive. La regla es simple: si el campo esta vacio, el RUT no va al PDF;
si tiene algo, el motor lo escribe en la seccion de perfil.

Es decir, el control lo tienes tu, borrando el campo.

## El nombre del archivo

El archivo descargado se llama siempre:

```
cv-plantilla-1.pdf
cv-plantilla-2.pdf
cv-plantilla-3.pdf
```

Solo el numero de plantilla. Sin tu nombre, sin RUT, sin email, sin telefono.
La razon esta en el codigo: un nombre de archivo viaja en logs del sistema, en
el historial de descargas y en las capturas de pantalla que la gente hace, y en
esos lugares el nombre viaja aunque tu borres el archivo despues.

El PDF si lleva tu nombre y tu contacto, porque para eso es un CV. Eso lo
decides tu al descargarlo.

## Como borrar tus datos

En la pantalla de resultados hay un boton **"Empezar de Nuevo"**. Pide
confirmacion y, si aceptas, borra la clave `cv_builder_data` del
`localStorage` y recarga la pagina. Ademas queda limpio lo que el navegador
pueda tener en su propia cache de la pagina.

Tambien puedes hacerlo a mano, sin la app:

1. Abre la consola del navegador.
2. `localStorage.removeItem('cv_builder_data')`
3. Recarga.

O, si prefieres borrarlo todo: la configuracion del sitio en tu navegador
("Borrar datos del sitio") elimina la clave y tambien la cache. Y si quieres
ir mas lejos, borrar los datos de navegacion completos del navegador.

Recorda que el PDF ya descargado esta en tu carpeta de descargas. La app no lo
puede borrar, porque en el momento de generarlo no sabe donde lo dejaste. Si
descargaste un PDF que no querias, borralo tu.

## Como revisar esta politica

Todo lo que se afirma aca se puede leer en el codigo. Esto es donde vive:

| Que | Donde |
|---|---|
| Que los datos nacen vacios y cual es la unica excepcion | `js/data.js` |
| La clave `cv_builder_data` y las unicas llamadas a `localStorage` | `js/data.js` |
| Que se guarda al cambiar de paso | `js/wizard.js` |
| La guarda que impide registrar PII en los logs | `js/logger.js` |
| Que la libreria del PDF es local, y no un CDN | `vendor/jspdf.umd.min.js`, `index.html` |
| Los ids de plantilla y que se marca como ATS-safe | `js/pdfgen.js` |
| Que escribe el RUT en el perfil si el campo tiene contenido | `js/pdfgen.js` |
| El nombre del archivo y la descarga | `js/results.js` |
| El boton que borra los datos | `js/app.js` |
| Las peticiones a Google Fonts | `index.html` |

Para revisar que no hay peticiones escondidas, abre la pestaña Network de tu
navegador, recarga la pagina y anda completando el asistente. Lo que vas a ver
es el propio repo, las dos URLs de Google Fonts, y al descargar el PDF un
`blob:` local. No hay nada mas.
