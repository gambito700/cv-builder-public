# CV Builder

Arma tu CV paso a paso y llévatelo en PDF. Sin cuenta, sin registro y sin que
nadie revise tus datos.

Vive en <https://gambito700.github.io/cv-builder-public/> y es parte de mi
formación fullstack: el frontend es HTML, CSS y JavaScript sin framework ni
build, y la API que compila el LaTeX es Python con Flask.

## Cómo se usa

1. Llenas tus datos: contacto, enfoque, experiencia y habilidades.
2. En **Resultados** eliges el diseño que más te guste.
3. Lo descargas.

El asistente **arranca en blanco**: no trae datos de muestra. El PDF sale
exactamente de lo que escribiste, y **Empezar de Nuevo** lo borra todo.

## Los tres botones de Resultados

| Botón | Qué hace |
|---|---|
| **Ver Código LaTeX** | Abre el `.tex` que genera tu diseño. Desde esa ventana lo copias al portapapeles o lo descargas tal cual. |
| **Descargar PDF** | Arma el PDF en tu navegador con jsPDF. Al instante, sin instalar nada. |
| **Descargar PDF LaTeX** | Manda tu `.tex` a la API, que lo compila con `pdflatex` y devuelve el mismo CV con la tipografía real de LaTeX. Tarda unos segundos la primera vez. |

Los dos PDF se ven iguales; lo que cambia es el motor. Si lo que quieres es el
código para Overleaf o para tu propio computador, el camino es **Ver Código
LaTeX**.

## Los tres diseños

| Diseño | Columnas | ATS |
|---|---|---|
| **Moderno Limpio** | dos, con banda de color | no |
| **Creativo** | una, con cajas y barras | no |
| **Profesional Clásico** | una, plano | **sí** |

Solo **Profesional Clásico** es ATS-safe. Los otros dos usan columnas, tablas y
texto dentro de cajas, que es justo lo que los sistemas de filtrado automático
no leen bien. Se ven bien para una persona, pero no los parsea bien una máquina.

Preferimos decírtelo antes de que postules. Las tres escriben texto real y
seleccionable: nunca dibujan el CV como imagen, que es el truco que usan los
sitios que dicen "ATS" y que en realidad pierde tu postulación en silencio.

## Los dos motores de PDF

**En el navegador**, con [jsPDF](https://github.com/parallax/jsPDF) 4.2.1
vendorizado en `vendor/` (MIT, cargado desde el propio repo y no de un CDN). El
texto se arma con `doc.text()`, o sea texto real: seleccionable, buscable y con
los acentos correctos. A4, con pie de página y metadatos.

**En el servidor**, mandando el `.tex` a la API. Si el LaTeX no compila, te
devolvemos la línea exacta del error y no un "algo salió mal". La API vive en
otro repositorio: [cv-builder-api](https://github.com/gambito700/cv-builder-api).

## Tus datos

- Se guardan solo en tu `localStorage`, en la clave `cv_builder_data`. No hay
  cuenta ni base de datos.
- El PDF del navegador se arma en tu equipo: nada sale.
- El PDF con LaTeX sí manda tu `.tex` a la API. Es lo único que viaja, y solo si
  aprietas ese botón. El servidor no guarda el archivo.
- Sin cookies, sin analytics, sin terceros. La única llamada externa es la hoja
  de estilos de Google Fonts.
- Los archivos se llaman `cv-plantilla-N.pdf`, sin tu nombre ni ningún dato tuyo
  en el nombre.
- El RUT es un dato personal bajo la **Ley 21.719**. Es un campo de texto normal
  y se escribe en el PDF si lo dejaste lleno: bórralo si no lo quieres ahí.

## Correrlo en local

```bash
python -m http.server 8080
# abrir http://localhost:8080
```

No hay build, no hay `npm install`, no hay `package.json`. Los scripts son
globales y el orden importa:

```
vendor/jspdf.umd.min.js
js/logger.js     <- primero
js/data.js
js/wizard.js
js/carousel.js
js/app.js
js/generator.js  <- las 3 plantillas .tex
js/pdfgen.js     <- el PDF en el navegador
js/results.js
js/tutorial.js
```

Los logs salen en la consola con `?debug=1`, o con `?log=warn` si solo quieres
avisos y errores. El logger nunca registra datos personales: solo formas, como
cuántas experiencias hay o cuántos bytes pesa el PDF.

## Publicar

Cada `push` a `main` actualiza GitHub Pages solo: no hay build ni configuración
que tocar. Espera un minuto y haz hard-refresh (Ctrl+Shift+R), porque el caché
del navegador y el del CDN te van a seguir sirviendo la versión anterior.

Un aviso que vale la pena: el PDF del navegador carga
`vendor/jspdf.umd.min.js` desde el repo. Si `vendor/` llega a estar en el
`.gitignore`, la app se publica sin su motor de PDF y el fallo aparece en el
navegador, no en la configuración.

## Licencia

MIT, ver [LICENSE](LICENSE).
