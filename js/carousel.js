/**
 * CAROUSEL.JS - Carrusel de imagenes de ejemplo del paso 0 (Bienvenida)
 *
 * Vanilla JS, sin dependencias y sin build. El HTML lo genera carouselHtml() y
 * lo inyecta renderWelcome() (js/app.js) DESPUES de asignar el innerHTML del
 * paso: el paso 0 se re-renderiza entero en cada visita, asi que el carrusel no
 * puede vivir suelto en index.html.
 *
 * Sin auto-rotacion: solo cambia de slide al hacer clic, al pulsar las flechas
 * o con el teclado (ArrowLeft / ArrowRight con el carrusel enfocado).
 */

/* ============================================================
   CONTENIDO DEL CARRUSEL
   Unico lugar donde viven las imagenes, sus alt y sus captions.
   Las imagenes son LOCALES: viven en apps/web/assets/examples/ y se pescan
   de ahi, asi que la app no depende de Pexels ni de internet (importante en
   un constructor de CV: la primera carga no debe filtrar a un tercero).
   Para cambiar un ejemplo, reemplaza el archivo en assets/examples/ o apunta
   el src a otro archivo local. Si el archivo no existe o no carga, sale el
   marcador de papel .example-carousel__fallback.
   ============================================================ */
const CAROUSEL_SLIDES = [
  {
    src: './assets/examples/01-sobrio.jpg',
    alt: 'Espacio de trabajo minimalista con laptop, cuadernos y muestras de diseño',
    caption: 'Ejemplo: un CV sobrio y profesional'
  },
  {
    src: './assets/examples/02-una-pagina.jpg',
    alt: 'Disposición minimalista con laptop cerrada, cuaderno y planta',
    caption: 'Ejemplo: una sola página, sin relleno'
  },
  {
    src: './assets/examples/03-secciones.jpg',
    alt: 'Vista superior de auriculares, bloc de notas y tablet',
    caption: 'Ejemplo: secciones ordenadas y legibles'
  },
  {
    src: './assets/examples/04-logros.jpg',
    alt: 'Espacio de trabajo con laptop, libreta y artículos de papelería',
    caption: 'Ejemplo: enfoque en logros medibles'
  },
  {
    src: './assets/examples/05-a-mano.jpg',
    alt: 'Oficina minimalista con laptop, cuaderno y jarrón',
    caption: 'Ejemplo: un bosquejo a mano y tipografiado'
  }
];

/* Slide actual. Vive a nivel de modulo a proposito: renderWelcome() vuelve a
   pintar el paso 0 entero cada vez que se vuelve a el, y el carrusel debe
   reaparecer en la foto que el usuario estaba viendo, no siempre en la 1. */
let carouselCurrent = 0;

/* Teardown por raiz: initCarousel() se puede llamar varias veces sobre el mismo
   elemento sin duplicar listeners (limpia los previos antes de enganchar). */
const CAROUSEL_TEARDOWN = new WeakMap();

/**
 * Escapar texto para insertarlo en el HTML del carrusel.
 */
function carouselEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escapar valor para atributo (los src de Pexels traen & de query string).
 */
function carouselEscapeAttr(value) {
  return carouselEscape(value).replace(/"/g, '&quot;');
}

/**
 * Icono de flecha del proyecto: mismo SVG que los botones de navegacion.
 */
function carouselArrowIcon(direccion) {
  const path = direccion === 'prev'
    ? '<path d="M15 18l-6-6 6-6"></path>'
    : '<path d="M9 18l6-6-6-6"></path>';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"' +
    ' stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"' +
    ' aria-hidden="true">' + path + '</svg>';
}

/**
 * HTML del carrusel de ejemplos.
 * Lo inyecta renderWelcome() al final de su template.
 */
function carouselHtml() {
  const total = CAROUSEL_SLIDES.length;

  const slides = CAROUSEL_SLIDES.map((slide, i) => `
          <img class="example-carousel__slide${i === 0 ? ' is-active' : ''}"
               src="${carouselEscapeAttr(slide.src)}"
               alt="${carouselEscapeAttr(slide.alt)}"
               data-index="${i}"
               decoding="async"
               ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}${i === 0 ? '' : ' aria-hidden="true"'}>
`).join('');

  const dots = CAROUSEL_SLIDES.map((slide, i) => `
          <button type="button" class="example-carousel__dot${i === 0 ? ' is-active' : ''}"
                  data-index="${i}"
                  aria-label="Ir al ejemplo ${i + 1} de ${total}"
                  ${i === 0 ? 'aria-current="true"' : ''}></button>
`).join('');

  return `
    <section class="example-carousel"
             role="region"
             aria-roledescription="carrusel"
             aria-label="Ejemplos de resultados"
             tabindex="0">
      <div class="example-carousel__inner">
        <span class="example-carousel__tape" aria-hidden="true"></span>
        <div class="example-carousel__frame">
          <div class="example-carousel__viewport">${slides}
            <div class="example-carousel__fallback" hidden></div>
            <p class="example-carousel__caption" aria-live="polite">${carouselEscape(CAROUSEL_SLIDES[0].caption)}</p>
            <button type="button" class="example-carousel__arrow" data-carousel="prev"
                    aria-label="Ejemplo anterior" title="Anterior">${carouselArrowIcon('prev')}</button>
            <button type="button" class="example-carousel__arrow example-carousel__arrow--next" data-carousel="next"
                    aria-label="Ejemplo siguiente" title="Siguiente">${carouselArrowIcon('next')}</button>
          </div>
        </div>
        <div class="example-carousel__dots" role="group" aria-label="Ir a un ejemplo">${dots}
        </div>
      </div>
    </section>
  `;
}

/**
 * Enganchar el carrusel. Idempotente: si ya habia listeners sobre esta raiz,
 * los quita antes de volver a enganchar.
 */
function initCarousel(root) {
  if (!root) return;

  const teardownPrevio = CAROUSEL_TEARDOWN.get(root);
  if (teardownPrevio) teardownPrevio();

  const slides = Array.from(root.querySelectorAll('.example-carousel__slide'));
  if (slides.length === 0) return;

  const dots = Array.from(root.querySelectorAll('.example-carousel__dot'));
  const dotsBox = root.querySelector('.example-carousel__dots');
  const caption = root.querySelector('.example-carousel__caption');
  const fallback = root.querySelector('.example-carousel__fallback');
  const prevBtn = root.querySelector('[data-carousel="prev"]');
  const nextBtn = root.querySelector('[data-carousel="next"]');
  const total = slides.length;

  // Si el numero de slides cambio, el indice guardado puede quedar fuera.
  if (carouselCurrent > total - 1) carouselCurrent = 0;

  const limpias = [];
  const on = (el, evento, fn) => {
    if (!el) return;
    el.addEventListener(evento, fn);
    limpias.push(() => el.removeEventListener(evento, fn));
  };

  /** Ir a un slide. Cicla en los dos sentidos (el prev del 1 va al 5). */
  const goTo = (indice) => {
    const destino = ((indice % total) + total) % total;
    carouselCurrent = destino;

    slides.forEach((img, i) => {
      const activo = i === destino;
      img.classList.toggle('is-active', activo);
      if (activo) img.removeAttribute('aria-hidden');
      else img.setAttribute('aria-hidden', 'true');
    });

    dots.forEach((dot, i) => {
      const activo = i === destino;
      dot.classList.toggle('is-active', activo);
      if (activo) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });

    if (caption && CAROUSEL_SLIDES[destino]) {
      caption.textContent = CAROUSEL_SLIDES[destino].caption;
    }

    // Sin internet: la imagen rota se oculta y entra el marcador de papel.
    if (fallback) {
      const roto = slides[destino].classList.contains('example-carousel__slide--roto');
      fallback.hidden = !roto;
      if (roto) fallback.textContent = 'Ejemplo ' + (destino + 1) + ' de ' + total;
    }
  };

  /** Una imagen que no carga: marcar el slide y repintar si es el visible. */
  const marcarRoto = (img) => {
    img.classList.add('example-carousel__slide--roto');
    if (slides[carouselCurrent] === img) goTo(carouselCurrent);
  };

  on(prevBtn, 'click', () => goTo(carouselCurrent - 1));
  on(nextBtn, 'click', () => goTo(carouselCurrent + 1));

  // Delegacion: un solo listener para los 5 puntos.
  on(dotsBox, 'click', (e) => {
    const dot = e.target instanceof Element ? e.target.closest('.example-carousel__dot') : null;
    if (!dot || !root.contains(dot)) return;
    goTo(Number(dot.dataset.index));
  });

  on(root, 'keydown', (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goTo(carouselCurrent - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      goTo(carouselCurrent + 1);
    }
  });

  slides.forEach((img) => {
    // La imagen puede haber fallado antes de que llegara el listener.
    if (img.complete && img.naturalWidth === 0) {
      marcarRoto(img);
      return;
    }
    on(img, 'error', () => marcarRoto(img));
  });

  // Aplica el slide guardado: reentrar al paso 0 no reinicia el carrusel.
  goTo(carouselCurrent);

  CAROUSEL_TEARDOWN.set(root, () => {
    limpias.forEach((fn) => fn());
    CAROUSEL_TEARDOWN.delete(root);
  });
}
