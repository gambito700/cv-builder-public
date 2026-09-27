/**
 * TUTORIAL.JS - Guia rapida de 2 pasos en dos lugares distintos.
 *
 * 1. 'asistente'  -> al abrir el asistente: que numeros y que botones hay.
 * 2. 'resultados' -> al llegar al paso 5: que hace cada boton de cada opcion.
 *
 * No guarda NADA: ni localStorage, ni cookies, ni flags. Al cerrarse saca todo
 * del DOM, asi que reaparece cada vez que se entra a esa pantalla. Los datos
 * del CV los guarda data.js, esto no lo toca.
 *
 * El mecanismo es un halo con box-shadow gigante que hace de agujero sobre el
 * elemento apuntado (el resto queda en penumbra) + un post-it con el texto.
 * El halo tiene pointer-events:none, asi que el clic pasa al boton real.
 *
 * En la escena 'asistente' eso resuelve el paso solo: apretas el elemento y
 * avanza. En 'resultados' NO, porque los botones de ahi disparan descargas y
 * modales de verdad, asi que se avanza con el boton del post-it.
 *
 * Para volver a verla cuando haga falta: tutorialStart() en la consola.
 */

const TUTORIALES = {
  asistente: {
    pasos: [
      {
        target: '#step-indicator',
        title: 'Los números de la izquierda',
        hint: 'Apretar acá',
        text: 'Cada número es un paso. Apretar el que quieras y saltas directo, sin tener que avanzar uno por uno. El azul lleno es el paso en el que estás.',
        action: 'Entendido'
      },
      {
        target: '#wizard-footer',
        title: 'Atrás, Saltar y Siguiente',
        hint: 'Y estos también',
        text: 'Abajo a la izquierda, siempre en el mismo lugar aunque subas o bajes: Atrás vuelve, Saltar te lleva directo a los resultados y Siguiente avanza. En la primera pantalla solo hay Siguiente; en la última, los botones de resultados. A la derecha hay dos flechas para ir al inicio o al final del paso.',
        action: 'Listo'
      }
    ]
  },

  resultados: {
    pasos: [
      {
        target: '#acciones-0',
        title: 'Los 3 botones de cada opción',
        hint: 'Para ver y para llevarte',
        text: 'Ver Código LaTeX abre el archivo .tex que genera este diseño, para que veas cómo está armado. Desde esa ventana puedes copiarlo al portapapeles o descargarlo, sin buscar otro botón.',
        action: 'Entendido',
        avanzaConClic: false
      },
      {
        target: '#btn-pdf-0',
        title: 'Los dos PDF',
        hint: 'Para llevártelo',
        text: 'Descargar PDF arma el documento al instante en tu navegador, sin instalar nada y sin mandar nada a internet. Descargar PDF LaTeX hace lo mismo pero mandando tu .tex a la API, que lo compila con pdflatex y devuelve el diseño exacto; la primera vez puede tardar unos segundos mientras el servidor se despierta. Las 3 opciones traen los mismos 3 botones: lo único que cambia es el diseño, y si es compatible con ATS o no, que está escrito bajo cada botón.',
        action: 'Listo',
        avanzaConClic: false
      }
    ]
  }
};

let tutorialEscena = null;
let tutorialIndex = 0;
let tutorialSpotlight = null;
let tutorialCard = null;
let tutorialTarget = null;
let tutorialLastFocus = null;
let tutorialTargetClick = null;

/* Margen entre el halo y el elemento apuntado, y contra los bordes de la pantalla */
const TUT_PADDING = 12;
const TUT_GAP = 14;
const TUT_MARGIN = 16;

/**
 * Arranca la guia de una escena. Es idempotente: si esa misma escena ya esta
 * corriendo, no la duplica. Si habia otra escena corriendo, la cierra antes.
 */
function tutorialStart(escena = 'asistente') {
  const pasos = TUTORIALES[escena] ? TUTORIALES[escena].pasos : null;
  if (!pasos) return;
  if (tutorialCard && tutorialEscena === escena) return;
  if (tutorialCard) tutorialStop();
  if (window.matchMedia('(max-width: 480px)').matches) {
    // En pantallas muy angostas la guia estorba mas de lo que ayuda.
    return;
  }
  tutorialEscena = escena;
  tutorialIndex = 0;
  tutorialShow();
}

/**
 * Dibuja el paso actual de la escena actual.
 */
/**
 * Centra el elemento apuntado cuando quedo fuera de la pantalla, para que el
 * halo no quede señalizando algo que el usuario no ve.
 *
 * El scroll es instantaneo y arranca en el siguiente frame a proposito: el
 * wizard scrollea al top al cambiar de paso (wizard.js goToStep), asi que un
 * scroll suave iniciado antes pierde contra el suyo. Un scrollTo instantaneo
 * cancela el suave que este en curso, de ahi el frame de espera.
 */
function tutorialCentrarTarget(target) {
  const r = target.getBoundingClientRect();
  const vh = window.innerHeight;
  /* Si ya entra en la pantalla no se toca nada: el rail y el footer son
     fijos y no hay por que mover la pagina. */
  if (r.top >= 0 && r.bottom <= vh) return;
  const y = window.scrollY + r.top - (vh - r.height) / 2;
  window.requestAnimationFrame(() => {
    /* Si la guia se cerro antes del frame, no se mueve la pagina. */
    if (!tutorialSpotlight) return;
    window.scrollTo({ top: Math.max(0, y), behavior: 'auto' });
    tutorialPlace();
  });
}

function tutorialShow() {
  const pasos = TUTORIALES[tutorialEscena].pasos;
  const step = pasos[tutorialIndex];
  const target = document.querySelector(step.target);

  if (!target) {
    // El elemento no existe en este momento: no hay nada que señalar.
    tutorialStop();
    return;
  }

  /* El foco solo se guarda al abrir la guia. Si lo guardáramos en cada paso,
     al cerrar intentariamos devolverlo a un boton que ya no existe. */
  if (!tutorialLastFocus) tutorialLastFocus = document.activeElement;

  /* Suelta el objetivo anterior antes de tomar el nuevo: si no, el listener
     del paso 1 seguiria vivo y un clic tarde en el elemento viejo avanzaria
     la guia a destiempo. */
  tutorialDesenlazarTarget();
  tutorialTarget = target;

  tutorialCentrarTarget(target);

  /* --- Halo --- */
  if (!tutorialSpotlight) {
    tutorialSpotlight = document.createElement('div');
    tutorialSpotlight.className = 'tutorial-spotlight';
    tutorialSpotlight.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tutorialSpotlight);
  }

  /* --- Post-it --- */
  if (!tutorialCard) {
    tutorialCard = document.createElement('div');
    tutorialCard.className = 'tutorial-card';
    tutorialCard.setAttribute('role', 'dialog');
    // No es modal a proposito: el elemento apuntado se puede usar de verdad.
    tutorialCard.setAttribute('aria-modal', 'false');

    const count = document.createElement('p');
    count.className = 'tutorial-card__count';

    const title = document.createElement('h3');
    title.className = 'tutorial-card__title';

    const hint = document.createElement('span');
    hint.className = 'tutorial-card__hint';

    const text = document.createElement('p');
    text.className = 'tutorial-card__text';

    const actions = document.createElement('div');
    actions.className = 'tutorial-card__actions';

    const pips = document.createElement('div');
    pips.className = 'tutorial-card__pips';

    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'tutorial-card__skip';
    skip.textContent = 'Saltar';
    skip.addEventListener('click', tutorialStop);

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'tutorial-card__next';
    next.addEventListener('click', tutorialNext);

    actions.appendChild(pips);
    actions.appendChild(skip);
    actions.appendChild(next);

    tutorialCard.append(count, title, hint, text, actions);
    document.body.appendChild(tutorialCard);

    tutorialCard._count = count;
    tutorialCard._title = title;
    tutorialCard._hint = hint;
    tutorialCard._text = text;
    tutorialCard._pips = pips;
    tutorialCard._next = next;
  }

  const card = tutorialCard;
  card._count.textContent = 'Paso ' + (tutorialIndex + 1) + ' de ' + pasos.length;
  card._title.textContent = step.title;
  card._hint.textContent = step.hint;
  card._text.textContent = step.text;
  card._next.textContent = step.action;

  /* Los puntitos se rehacen porque el numero de pasos cambia entre escenas. */
  card._pips.textContent = '';
  for (let i = 0; i < pasos.length; i++) {
    const pip = document.createElement('span');
    pip.className = 'tutorial-card__pip' + (i === tutorialIndex ? ' is-active' : '');
    card._pips.appendChild(pip);
  }

  /* En la escena 'asistente' el clic sobre el elemento apuntado tambien avanza
     la guia: el usuario aprende apretando y por eso son 2 clics. En
     'resultados' no, porque esos botones descargan y abren modales de verdad. */
  if (step.avanzaConClic !== false) {
    tutorialTargetClick = function () { tutorialNext(); };
    target.addEventListener('click', tutorialTargetClick, true);
  }

  /* Si el usuario aprieta un boton de verdad en vez de seguir la guia, esta se
     aparta: si no, el post-it quedaria encima del modal de "Ver Codigo LaTeX". */
  if (tutorialEscena === 'resultados') {
    document.addEventListener('click', tutorialSiApretaBotonReal, true);
  }

  tutorialPlace();

  window.addEventListener('resize', tutorialPlace);
  window.addEventListener('scroll', tutorialPlace, true);
  document.addEventListener('keydown', tutorialOnKey);

  card._next.focus();
}

/**
 * Si se aprieta cualquier boton de las tarjetas, la guia se cierra.
 */
function tutorialSiApretaBotonReal(e) {
  const b = e.target && e.target.closest ? e.target.closest('.template-card-actions, .results-nav') : null;
  if (b) tutorialStop();
}

/**
 * Ubica el halo sobre el elemento y el post-it al lado sin salirse de la
 * pantalla. Se recalcula en resize y en scroll porque el elemento apuntado
 * puede estar en el flujo (Atras/Saltar/Siguiente) y no ser fijo.
 */
function tutorialPlace() {
  if (!tutorialSpotlight || !tutorialTarget) return;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r = tutorialTarget.getBoundingClientRect();

  /* Halo */
  const top = Math.max(0, r.top - TUT_PADDING);
  const left = Math.max(0, r.left - TUT_PADDING);
  tutorialSpotlight.style.top = top + 'px';
  tutorialSpotlight.style.left = left + 'px';
  tutorialSpotlight.style.width = Math.min(r.width + TUT_PADDING * 2, vw - left) + 'px';
  tutorialSpotlight.style.height = Math.min(r.height + TUT_PADDING * 2, vh - top) + 'px';

  /* Post-it: a la derecha del elemento si cabe; si no, a la izquierda. */
  const cw = tutorialCard.offsetWidth;
  const ch = tutorialCard.offsetHeight;
  let cx = r.right + TUT_GAP;

  if (cx + cw > vw - TUT_MARGIN) {
    const aLaIzquierda = r.left - TUT_GAP - cw;
    cx = aLaIzquierda >= TUT_MARGIN ? aLaIzquierda : Math.max(TUT_MARGIN, vw - TUT_MARGIN - cw);
  }

  let cy = r.top;
  if (cy + ch > vh - TUT_MARGIN) {
    cy = Math.max(TUT_MARGIN, vh - TUT_MARGIN - ch);
  }

  tutorialCard.style.left = Math.round(cx) + 'px';
  tutorialCard.style.top = Math.round(cy) + 'px';
}

/**
 * Avanza al paso siguiente o cierra si era el ultimo.
 */
function tutorialNext() {
  const pasos = TUTORIALES[tutorialEscena].pasos;
  tutorialIndex++;
  if (tutorialIndex >= pasos.length) {
    tutorialStop();
    return;
  }
  tutorialShow();
}

/**
 * Saca el listener del elemento apuntado, si quedo alguno.
 */
function tutorialDesenlazarTarget() {
  if (tutorialTarget && tutorialTargetClick) {
    tutorialTarget.removeEventListener('click', tutorialTargetClick, true);
  }
  tutorialTarget = null;
  tutorialTargetClick = null;
}

/**
 * Cierra la guia y saca todo del DOM.
 */
function tutorialStop() {
  tutorialDesenlazarTarget();
  document.removeEventListener('click', tutorialSiApretaBotonReal, true);

  if (tutorialSpotlight) {
    tutorialSpotlight.remove();
    tutorialSpotlight = null;
  }
  if (tutorialCard) {
    tutorialCard.remove();
    tutorialCard = null;
  }

  window.removeEventListener('resize', tutorialPlace);
  window.removeEventListener('scroll', tutorialPlace, true);
  document.removeEventListener('keydown', tutorialOnKey);

  if (tutorialLastFocus && tutorialLastFocus.focus) {
    tutorialLastFocus.focus();
  }
  tutorialLastFocus = null;
  tutorialEscena = null;
}

function tutorialOnKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    tutorialStop();
  }
}

/* Se dispara despues del listener de wizard.js (este script va mas abajo en
   index.html), asi que el rail y el footer ya estan pintados. */
document.addEventListener('DOMContentLoaded', () => {
  tutorialStart('asistente');
});