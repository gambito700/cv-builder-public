/**
 * GENERAR-PREVIEWS.JS
 * Genera un preview PNG de cada template de CV usando los MISMOS templates
 * LaTeX de la app (js/generator.js), compilados con pdflatex reales.
 *
 * Uso:  node tools/generar-previews.js
 *
 * Requisitos:
 *   - pdflatex en el PATH (MiKTeX: C:\Program Files\MiKTeX\miktex\bin\x64)
 *   - pdftoppm en el PATH (viene con MiKTeX)
 *
 * IMPORTANTE: los datos de ejemplo son ANONIMIZOS a proposito. Los previews
 * se muestran dentro de la app y podrian terminar publicados en GitHub Pages:
 * si usaramos los datos reales del usuario, su nombre, RUT, telefono y email
 * quedarian horneados en las imagenes.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const WEB = path.resolve(__dirname, '..');
const SALIDA = path.join(WEB, 'assets', 'previews');
// OJO con la ruta de compilacion: kpathsea (el motor de MiKTeX) interpreta
// el caracter ~ como "home", asi que %TEMP% de este equipo
// (C:\Users\HPVICT~1\...) revienta los .tex. Compilamos en una ruta lisa
// y despues copiamos el PNG a la carpeta final con fs (que si maneja espacios).
const TMP = process.env.CV_PREVIEW_BUILD || path.join(process.env.SystemDrive || 'C:', 'Temp', 'cv-builder-previews');

/** Datos de ejemplo ANONIMIZOS. Misma forma que DEFAULT_DATA de js/data.js. */
const DATOS_EJEMPLO = {
  personal: {
    nombre: 'Nombre Apellido',
    rut: '12.345.678-9',
    fechaNacimiento: '1990-01-01',
    nacionalidad: 'Chilena',
    direccion: 'Calle Ejemplo 123',
    ciudad: 'Santiago',
    telefono: '+56 9 1234 5678',
    email: 'nombre.apellido@ejemplo.cl',
    estadoCivil: 'Soltero/a',
    idiomas: 'Espanol nativo, Ingles B2',
    disponibilidad: 'Inmediata',
    github: 'https://github.com/ejemplo',
    portafolio: 'https://ejemplo.cl'
  },
  focusArea: 'informatica',
  experience: [
    {
      empresa: 'Empresa Ejemplo S.A.',
      cargo: 'Desarrollador Full Stack',
      ubicacion: 'Santiago, Chile',
      fechaInicio: '2022-03-01',
      fechaFin: '',
      presente: true,
      funciones: 'Desarrollo y mantenimiento de aplicaciones web con Python y Django.\nConstruccion de APIs REST consumidas por el frontend.\nAutomatizacion de despliegues con Docker y CI/CD.\nRevision de codigo y mentoria a desarrolladores junior.'
    },
    {
      empresa: 'Comercial Norte Ltda.',
      cargo: 'Tecnico de Soporte',
      ubicacion: 'Valparaiso, Chile',
      fechaInicio: '2018-01-15',
      fechaFin: '2022-02-28',
      presente: false,
      funciones: 'Soporte tecnico a usuarios internos y externos.\nMantenimiento preventivo de equipos.\nDocumentacion de procedimientos y base de conocimiento.'
    }
  ],
  education: [
    { institucion: 'Universidad Ejemplo', programa: 'Ingenieria en Sistemas', horas: '462', nota: '6.5', estado: 'Titulado', ano: '2019' },
    { institucion: 'Instituto Ejemplo', programa: 'Diplomado en Gestion Estrategica', horas: '90', nota: '100', estado: 'Aprobado', ano: '2023' }
  ],
  skills: {
    frontend: ['HTML5', 'CSS3', 'JavaScript', 'TypeScript', 'React'],
    backend: ['Python', 'Django', 'FastAPI', 'Node.js', 'SQL'],
    devops: ['Docker', 'Git', 'GitHub Actions', 'Linux', 'CI/CD'],
    seguridad: ['OWASP', 'CCTV', 'Control de accesos'],
    marketing: ['SEO', 'Google Analytics', 'WordPress'],
    idiomas: ['Espanol nativo', 'Ingles B2']
  },
  certifications: [
    { nombre: 'Certificacion en Desarrollo Web', institucion: 'Instituto Ejemplo', horas: '380', nota: '95', ano: '2021' },
    { nombre: 'Curso de Seguridad Web', institucion: 'Academia Ejemplo', horas: '40', nota: '90', ano: '2024' }
  ],
  projects: [
    { nombre: 'App de gestion interna', descripcion: 'Aplicacion web para centralizar reportes y tareas del equipo.', tecnologias: 'Python, Django, PostgreSQL, Docker' },
    { nombre: 'Sitio institucional', descripcion: 'Sitio corporativo responsive con constructor visual de paginas.', tecnologias: 'JavaScript, CSS3, WordPress' }
  ],
  focusAreas: [
    { id: 'informatica', icon: 'code', name: 'Tecnologia e Informatica', desc: 'Desarrollo, soporte y sistemas' },
    { id: 'integral', icon: 'star', name: 'Perfil Integral', desc: 'Todas las areas juntas' }
  ],
  estadosCiviles: ['Soltero/a', 'Casado/a'],
  disponibilidades: ['Inmediata', '30 dias', '60 dias']
};

/** Carga js/generator.js en un contexto de vm y devuelve generateAllTemplates. */
function cargarGenerador() {
  const ruta = path.join(WEB, 'js', 'generator.js');
  const ctx = { console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ruta, 'utf8') + '\n;globalThis.__gen = generateAllTemplates;', ctx, { filename: ruta });
  return ctx.__gen;
}

/** Compila un .tex a PDF (dos pasadas) y devuelve la ruta del PDF. */
function compilar(tex, dir, nombre) {
  const rutaTex = path.join(dir, `${nombre}.tex`);
  fs.writeFileSync(rutaTex, tex, 'utf8');
  for (let pasada = 1; pasada <= 2; pasada++) {
    execFileSync('pdflatex', [
      '-interaction=nonstopmode', '-halt-on-error',
      `-output-directory=${dir}`, rutaTex
    ], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  const pdf = path.join(dir, `${nombre}.pdf`);
  if (!fs.existsSync(pdf)) throw new Error(`pdflatex no produjo ${nombre}.pdf`);
  return pdf;
}

/** Convierte la pagina 1 del PDF en PNG de ancho `ancho` px y lo deja en destino. */
function pdfAPng(pdf, destino, ancho = 900) {
  // pdftoppm escribe en el directorio de compilacion y despues copiamos con
  // fs: el destino final vive en una ruta con espacios y no queremos depender
  // de como resuelva las comillas cada herramienta.
  const local = destino.replace(/\.png$/, '');
  execFileSync('pdftoppm', [
    '-png', '-singlefile', '-scale-to', String(ancho),
    '-f', '1', '-l', '1', pdf, local
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const produced = local + '.png';
  if (!fs.existsSync(produced)) throw new Error('pdftoppm no produjo ' + produced);
  fs.copyFileSync(produced, destino);
}

function main() {
  fs.mkdirSync(SALIDA, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  const generateAllTemplates = cargarGenerador();
  const templates = generateAllTemplates(DATOS_EJEMPLO);
  console.log(`Templates a renderizar: ${templates.length}`);

  const nombres = ['01-moderno-limpio', '02-creativo', '03-profesional-clasico'];
  let errores = 0;

  templates.forEach((tpl, i) => {
    const base = nombres[i];
    try {
      const tex = tpl.tex;
      const pdf = compilar(tex, TMP, base);
      const png = path.join(SALIDA, `${base}.png`);
      pdfAPng(pdf, png);
      const kb = (fs.statSync(png).size / 1024).toFixed(0);
      console.log(`  [x] ${base}.png  ${kb} KB  (${tpl.name})`);
    } catch (e) {
      errores++;
      console.log(`  [ ] ${base}  FALLO: ${String(e.message).split('\n')[0]}`);
      const log = path.join(TMP, `${base}.log`);
      if (fs.existsSync(log)) {
        const m = fs.readFileSync(log, 'utf8').split('\n').filter(l => /^!/.test(l.trim()));
        m.slice(0, 4).forEach(l => console.log(`        ${l.trim().substring(0, 110)}`));
      }
    }
  });

  console.log(errores === 0 ? `Listo: ${SALIDA}` : `${errores} template(s) fallaron. Logs en ${TMP}`);
  process.exit(errores === 0 ? 0 : 1);
}

if (require.main === module) main();

module.exports = { DATOS_EJEMPLO, cargarGenerador, compilar, pdfAPng, SALIDA, TMP };