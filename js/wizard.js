/**
 * WIZARD.JS - Navegacion de pasos, validacion, estado del wizard
 */

/**
 * Configuracion de pasos del wizard
 */
const WIZARD_STEPS = [
  { id: 0, name: "Bienvenida",   label: "Inicio" },
  { id: 1, name: "Datos",        label: "Datos" },
  { id: 2, name: "Enfoque",      label: "Enfoque" },
  { id: 3, name: "Experiencia",  label: "Experiencia" },
  { id: 4, name: "Habilidades",  label: "Habilidades" },
  { id: 5, name: "Resultados",   label: "Resultados" }
];

/**
 * Wizard Controller
 */
class WizardController {
  constructor() {
    this.currentStep = 0;
    this.data = loadData();
    this.totalSteps = WIZARD_STEPS.length;
    // Navegacion libre: "visitado" no es "completado". Un paso queda visitado
    // en cuanto se entra a el, sin importar si se completo.
    this.visitedSteps = new Set([0]);
  }

  /**
   * Ir a un paso especifico
   */
  goToStep(stepIndex) {
    if (stepIndex < 0 || stepIndex >= this.totalSteps) return;

    // Guardar datos del paso actual antes de cambiar
    this.saveCurrentStepData();

    // Si la navegacion vino desde el rail, el re-render va a destruir el
    // elemento con foco. Lo detectamos ahora para passarle el foco al paso.
    const rail = document.getElementById('wizard-rail');
    const focusWasInRail = !!(rail && document.activeElement && rail.contains(document.activeElement));

    this.currentStep = stepIndex;
    this.visitedSteps.add(stepIndex);

    // Actualizar UI
    this.renderStepIndicator();
    this.renderStep();
    this.renderFooter();

    // Guardar estado en localStorage
    saveData(this.data);

    // Devolver el foco al contenido del paso nuevo (lectores de pantalla)
    if (focusWasInRail) {
      this.focusStepRegion();
    }

    // Scroll al top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Mover el foco programmatico al <section> del paso activo.
   * Necesario porque el dot activo queda disabled y sale del tab order:
   * sin esto, tras navegar con teclado el foco se pierde en el body.
   */
  focusStepRegion() {
    const stepEl = document.getElementById('step-' + this.currentStep);
    if (!stepEl) return;
    stepEl.setAttribute('tabindex', '-1');
    stepEl.focus({ preventScroll: true });
  }

  /**
   * Avanzar al siguiente paso
   */
  nextStep() {
    if (this.currentStep < this.totalSteps - 1) {
      this.goToStep(this.currentStep + 1);
    }
  }

  /**
   * Retroceder al paso anterior
   */
  prevStep() {
    if (this.currentStep > 0) {
      this.goToStep(this.currentStep - 1);
    }
  }

  /**
   * Saltar directo a resultados
   */
  skipToResults() {
    this.saveCurrentStepData();
    saveData(this.data);
    this.goToStep(this.totalSteps - 1);
  }

  /**
   * Guardar datos del paso actual desde el DOM
   */
  saveCurrentStepData() {
    switch (this.currentStep) {
      case 1:
        this.savePersonalData();
        break;
      case 2:
        this.saveFocusArea();
        break;
      case 3:
        this.saveExperienceAndEducation();
        break;
      case 4:
        this.saveSkillsAndCertifications();
        break;
    }
  }

  /**
   * Guardar datos personales desde el formulario
   */
  savePersonalData() {
    const fields = [
      'nombre', 'rut', 'fechaNacimiento', 'nacionalidad',
      'direccion', 'ciudad', 'email',
      'estadoCivil', 'idiomas', 'disponibilidad',
      'github', 'portafolio'
    ];

    for (const field of fields) {
      const el = document.getElementById('field-' + field);
      if (el) {
        this.data.personal[field] = el.value;
      }
    }

    /* El telefono no es un input simple: es un grupo con un select de pais
       (con bandera) y un input con el numero pelado, asi que no entra en la
       lista de arriba. personal.telefono se sigue guardando como STRING con el
       numero completo (prefijo + numero) porque pdfgen.js y generator.js lo
       consumen asi. El select antepone su prefijo; si el numero ya viene con
       un '+' propio se respeta tal cual. Ver composeTelefono en app.js. */
    const telNumero = document.getElementById('field-telefono-num');
    if (telNumero) {
      const telPais = document.getElementById('field-telefono-pais');
      const prefijo = (telPais && typeof phoneDialFromSelect === 'function')
        ? phoneDialFromSelect(telPais)
        : '';
      const compuesto = (typeof composeTelefono === 'function')
        ? composeTelefono(prefijo, telNumero.value)
        : telNumero.value;
      this.data.personal.telefono = compuesto;
    }
  }

  /**
   * Guardar area de enfoque seleccionada
   */
  saveFocusArea() {
    const selected = document.querySelector('.focus-card.selected');
    if (selected) {
      this.data.focusArea = selected.dataset.area;
    }
  }

  /**
   * Guardar experiencia y educacion desde el DOM
   */
  saveExperienceAndEducation() {
    // Experiencia
    const expEntries = document.querySelectorAll('.exp-entry');
    this.data.experience = [];
    expEntries.forEach(entry => {
      const get = (sel) => {
        const el = entry.querySelector(sel);
        return el ? el.value : '';
      };
      this.data.experience.push({
        empresa: get('.exp-empresa'),
        cargo: get('.exp-cargo'),
        ubicacion: get('.exp-ubicacion'),
        fechaInicio: get('.exp-fecha-inicio'),
        fechaFin: get('.exp-fecha-fin'),
        presente: entry.querySelector('.exp-presente') ? entry.querySelector('.exp-presente').checked : false,
        funciones: get('.exp-funciones')
      });
    });

    // Educacion
    const eduEntries = document.querySelectorAll('.edu-entry');
    this.data.education = [];
    eduEntries.forEach(entry => {
      const get = (sel) => {
        const el = entry.querySelector(sel);
        return el ? el.value : '';
      };
      this.data.education.push({
        institucion: get('.edu-institucion'),
        programa: get('.edu-programa'),
        horas: parseInt(get('.edu-horas')) || 0,
        nota: get('.edu-nota'),
        estado: get('.edu-estado'),
        ano: parseInt(get('.edu-ano')) || 0
      });
    });
  }

  /**
   * Guardar habilidades y certificaciones desde el DOM
   */
  saveSkillsAndCertifications() {
    // Habilidades - ya se guardan en tiempo real via eventos
    // pero hacemos un save final aqui tambien

    // Certificaciones
    const certEntries = document.querySelectorAll('.cert-entry');
    this.data.certifications = [];
    certEntries.forEach(entry => {
      const get = (sel) => {
        const el = entry.querySelector(sel);
        return el ? el.value : '';
      };
      this.data.certifications.push({
        nombre: get('.cert-nombre'),
        institucion: get('.cert-institucion'),
        horas: parseInt(get('.cert-horas')) || 0,
        nota: parseInt(get('.cert-nota')) || null,
        ano: parseInt(get('.cert-ano')) || null
      });
    });

    // Proyectos
    const projEntries = document.querySelectorAll('.proj-entry');
    this.data.projects = [];
    projEntries.forEach(entry => {
      const get = (sel) => {
        const el = entry.querySelector(sel);
        return el ? el.value : '';
      };
      this.data.projects.push({
        nombre: get('.proj-nombre'),
        descripcion: get('.proj-descripcion'),
        tecnologias: get('.proj-tecnologias')
      });
    });
  }

  /**
   * Renderizar indicador de pasos dentro del rail (#step-indicator).
   * Cada numero es un <button type="button">: navegacion libre a cualquier
   * paso, incluso uno nunca visitado. type="button" es obligatorio para que
   * no dispare submit si el rail llegara a estar dentro de un form.
   */
  renderStepIndicator() {
    const container = document.getElementById('step-indicator');
    if (!container) return;

    let html = '';
    WIZARD_STEPS.forEach((step, i) => {
      const isActive = i === this.currentStep;
      const isVisited = this.visitedSteps.has(i);

      const dotClass = isActive ? 'step-dot step-dot--active' :
                       isVisited ? 'step-dot step-dot--visited' : 'step-dot';

      // aria-label descriptivo: el title viejo solo decia el nombre del paso
      const label = `Paso ${i + 1} de ${this.totalSteps}: ${step.name}` +
                    (isVisited ? '' : ' (sin completar)');

      html += `<button type="button" class="${dotClass}"` +
              ` onclick="wizard.goToStep(${i})"` +
              ` title="${escapeAttr(label)}"` +
              ` aria-label="${escapeAttr(label)}"` +
              (isActive ? ' aria-current="step" disabled' : '') +
              `>${i}` +
              // Tooltip visual al hover/foco. aria-hidden porque el nombre ya
              // lo anuncian el title y el aria-label del boton.
              `<span class="step-tooltip" aria-hidden="true">${escapeAttr(step.name)}</span>` +
              `</button>`;

      if (i < WIZARD_STEPS.length - 1) {
        // El conector marca como visitar el paso siguiente
        const connVisited = this.visitedSteps.has(i + 1);
        const connClass = connVisited ? 'step-connector step-connector--visited' : 'step-connector';
        html += `<div class="${connClass}" aria-hidden="true"></div>`;
      }
    });

    container.innerHTML = html;
  }

  /**
   * Renderizar el paso actual
   */
  renderStep() {
    // Ocultar todos los pasos
    document.querySelectorAll('.wizard-step').forEach(el => {
      el.classList.remove('active');
    });

    // Mostrar el paso actual
    const stepEl = document.getElementById('step-' + this.currentStep);
    if (stepEl) {
      stepEl.classList.add('active');
    }

    // Renderizar contenido del paso
    switch (this.currentStep) {
      case 0: renderWelcome(stepEl); break;
      case 1: renderPersonalData(stepEl, this.data); break;
      case 2: renderFocusArea(stepEl, this.data); break;
      case 3: renderExperience(stepEl, this.data); break;
      case 4: renderSkills(stepEl, this.data); break;
      case 5: renderResults(stepEl, this.data); break;
    }
  }

  /**
   * Renderizar los botones de navegacion (Atras / Saltar / Siguiente).
   * El elemento #wizard-footer es .wizard-footer-cluster: un bloque fijo en
   * la esquina inferior izquierda, hermano del rail y fuera de
   * .wizard.container, asi que los botones NO empujan el paso. Cada uno es un
   * circulo de 48px con icono SVG y tooltip a la derecha (no hay texto, por
   * eso desaparecen los .scribble-arrow: el nombre lo dan aria-label, title y
   * el propio tooltip). La logica de cuando aparece cada boton NO cambia:
   * Atras no en el paso 0, Saltar solo en pasos intermedios, Siguiente no en
   * el ultimo.
   */
  renderFooter() {
    const footer = document.getElementById('wizard-footer');
    if (!footer) return;

    const isFirst = this.currentStep === 0;
    const isLast = this.currentStep === this.totalSteps - 1;

    // Mismo patron de icono que los .scroll-fab-btn de index.html
    const icono = (paths) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"` +
      ` stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `${paths}</svg>`;

    // Un circulo: icono + tooltip. El texto corto va al tooltip y la frase
    // completa al aria-label/title, que es lo que lee el lector de pantalla.
    const circulo = (svg, texto, etiqueta, accion, claseExtra) =>
      `<button type="button" class="nav-circle ${claseExtra}" onclick="${accion}"` +
      ` aria-label="${escapeAttr(etiqueta)}" title="${escapeAttr(etiqueta)}">` +
      svg +
      `<span class="nav-circle-tip" aria-hidden="true">${escapeAttr(texto)}</span>` +
      `</button>`;

    let html = '';

    // Boton atras (en el primer paso no hay)
    if (!isFirst) {
      html += circulo(
        icono('<path d="M19 12H5"></path><path d="M12 19l-7-7 7-7"></path>'),
        'Atrás',
        'Retroceder al paso anterior',
        'wizard.prevStep()',
        ''
      );
    }

    // Saltar (solo en pasos intermedios)
    if (!isFirst && !isLast) {
      html += circulo(
        icono('<path d="M5 12h12"></path><path d="M13 7l5 5-5 5"></path><path d="M19 5v14"></path>'),
        'Saltar',
        'Saltar a resultados',
        'wizard.skipToResults()',
        ''
      );
    }

    // Boton siguiente (en el ultimo paso no hay)
    if (!isLast) {
      html += circulo(
        icono('<path d="M5 12h14"></path><path d="M12 5l7 7-7 7"></path>'),
        'Siguiente',
        'Avanzar al siguiente paso',
        'wizard.nextStep()',
        'nav-circle--primary'
      );
    }

    footer.innerHTML = html;
  }

  /**
   * Desplazar la pagina dentro del paso actual (botones flotantes laterales).
   * 'up' vuelve al inicio del paso; 'down' avanza casi una pantalla. Suavizado,
   * sin tocar el paso: solo mueve el scroll.
   */
  scrollStep(direction) {
    const delta = window.innerHeight * 0.8;
    const top = direction === 'up' ? 0 : window.scrollY + delta;
    window.scrollTo({ top, behavior: 'smooth' });
  }
}

/**
 * Instancia global del wizard
 */
let wizard;

/**
 * Inicializar al cargar DOM
 */
document.addEventListener('DOMContentLoaded', () => {
  wizard = new WizardController();
  wizard.renderStepIndicator();
  wizard.renderStep();
  wizard.renderFooter();
});
