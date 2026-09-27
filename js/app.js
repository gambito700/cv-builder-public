/**
 * APP.JS - Funciones de renderizado de cada paso del wizard
 * Contiene la logica de UI para cada pantalla
 */

/* ============================================================
   STEP 0: WELCOME
   ============================================================ */
function renderWelcome(container) {
  container.innerHTML = `
    <div class="welcome-greeting">
      <h2 class="scribble-underline">¡Hola! Vamos a crear tu currículum</h2>
      <p>
        Este asistente te guiará paso a paso para generar tu CV en formato LaTeX.
        La app abre en blanco. Completa los datos de cada paso y genera tu CV.
      </p>
    </div>

    ${carouselHtml()}

    <div style="text-align: center;">
      <p style="font-size: var(--text-base); color: #999;">
        Tu información se guarda automáticamente en tu navegador.<br>
        Puedes cerrar y volver en cualquier momento.
      </p>
    </div>
  `;

  // El carrusel viene del template (este paso reemplaza el innerHTML entero).
  // Se engancha despues de pintar y recuerda en que slide se quedo.
  initCarousel(container.querySelector('.example-carousel'));
}

/* ============================================================
   TELEFONO: paises con bandera + deteccion de prefijo
   ============================================================
   El campo telefono NO es un input simple: es un grupo
   [select de pais con bandera] + [input del numero].

   CONTRATO DE DATOS: `personal.telefono` sigue siendo un STRING con el numero
   completo ya montado (prefijo + numero). No se parte en dos campos ni se
   convierte en objeto, porque js/pdfgen.js y js/generator.js lo leen como
   string. Ver composeTelefono() y WizardController.savePersonalData().

   Deteccion BIDIRECCIONAL:
   (a) elegir un pais en el select actualiza la bandera visible y el prefijo;
   (b) si el usuario escribe/pega un numero que ya trae prefijo internacional
       (+56, +1, +34, ...), se detecta, se sincroniza el select a ese pais y se
       muestra su bandera. Un prefijo desconocido (+999) no rompe nada: el input
       queda tal cual y el select no se mueve.

   La bandera se dibuja con banderaDe() a partir del codigo ISO del pais, no
   con emojis pegados en el fuente: una sola fuente de verdad, y el archivo
   sigue siendo ASCII (los emojis de bandera son pares de indicadores
   regionales U+1F1E6..U+1F1FF). El nombre del pais va SIEMPRE en texto al
   lado del emoji, porque el emoji no puede ser la unica informacion.
   ============================================================ */

/**
 * Lista de paises con prefijo internacional. `iso` es el codigo de 2 letras
 * que genera la bandera; `grupo` marca el primer pais de cada grupo y abre un
 * <optgroup> en el select. Chile va primero porque es el default de la app.
 */
const PHONE_COUNTRIES = [
  // America Latina
  { grupo: 'América Latina', iso: 'CL', dial: '+56', name: 'Chile' },
  { iso: 'AR', dial: '+54', name: 'Argentina' },
  { iso: 'BR', dial: '+55', name: 'Brasil' },
  { iso: 'CO', dial: '+57', name: 'Colombia' },
  { iso: 'MX', dial: '+52', name: 'México' },
  { iso: 'PE', dial: '+51', name: 'Perú' },
  { iso: 'UY', dial: '+598', name: 'Uruguay' },
  { iso: 'PY', dial: '+595', name: 'Paraguay' },
  { iso: 'BO', dial: '+591', name: 'Bolivia' },
  { iso: 'EC', dial: '+593', name: 'Ecuador' },
  { iso: 'VE', dial: '+58', name: 'Venezuela' },
  { iso: 'CR', dial: '+506', name: 'Costa Rica' },
  { iso: 'PA', dial: '+507', name: 'Panamá' },
  { iso: 'GT', dial: '+502', name: 'Guatemala' },
  { iso: 'HN', dial: '+504', name: 'Honduras' },
  { iso: 'SV', dial: '+503', name: 'El Salvador' },
  { iso: 'NI', dial: '+505', name: 'Nicaragua' },
  { iso: 'DO', dial: '+1809', name: 'República Dominicana' },
  { iso: 'CU', dial: '+53', name: 'Cuba' },
  { iso: 'PR', dial: '+1787', name: 'Puerto Rico' },
  // Europa
  { grupo: 'Europa', iso: 'ES', dial: '+34', name: 'España' },
  { iso: 'GB', dial: '+44', name: 'Reino Unido' },
  { iso: 'FR', dial: '+33', name: 'Francia' },
  { iso: 'DE', dial: '+49', name: 'Alemania' },
  { iso: 'IT', dial: '+39', name: 'Italia' },
  { iso: 'PT', dial: '+351', name: 'Portugal' },
  { iso: 'NL', dial: '+31', name: 'Países Bajos' },
  { iso: 'CH', dial: '+41', name: 'Suiza' },
  { iso: 'AT', dial: '+43', name: 'Austria' },
  { iso: 'BE', dial: '+32', name: 'Bélgica' },
  { iso: 'IE', dial: '+353', name: 'Irlanda' },
  // Norteamerica
  { grupo: 'Norteamérica', iso: 'US', dial: '+1', name: 'Estados Unidos' },
  { iso: 'CA', dial: '+1', name: 'Canadá' },
  // Asia
  { grupo: 'Asia', iso: 'JP', dial: '+81', name: 'Japón' },
  { iso: 'KR', dial: '+82', name: 'Corea del Sur' },
  { iso: 'IN', dial: '+91', name: 'India' },
  { iso: 'CN', dial: '+86', name: 'China' },
  { iso: 'IL', dial: '+972', name: 'Israel' },
  { iso: 'AE', dial: '+971', name: 'Emiratos Árabes Unidos' },
  // Oceania
  { grupo: 'Oceanía', iso: 'AU', dial: '+61', name: 'Australia' },
  { iso: 'NZ', dial: '+64', name: 'Nueva Zelanda' }
];

/** Pais por defecto cuando no hay nada escrito: Chile. */
const PHONE_DEFAULT = Math.max(0, PHONE_COUNTRIES.findIndex(c => c.iso === 'CL'));

/**
 * Bandera de un pais a partir de su codigo ISO de 2 letras.
 * 'CL' -> 2 indicators regionales: la bandera de Chile.
 */
function banderaDe(iso) {
  const letras = String(iso || '').toUpperCase();
  let salida = '';
  for (let i = 0; i < letras.length; i++) {
    salida += String.fromCodePoint(0x1F1E6 + letras.charCodeAt(i) - 65);
  }
  return salida;
}

/**
 * Indice del pais cuyo prefijo empieza el texto, o -1 si no hay ninguno.
 * Gana el prefijo MAS LARGO: "+1787" (Puerto Rico) antes que "+1" (USA), y
 * "+1809" (Republica Dominicana) antes que "+1".
 */
function phoneIndexFromDial(texto) {
  const t = String(texto == null ? '' : texto).trim();
  if (t.charAt(0) !== '+') return -1;
  let mejor = -1;
  let largo = 0;
  for (let i = 0; i < PHONE_COUNTRIES.length; i++) {
    const dial = PHONE_COUNTRIES[i].dial;
    if (dial.length > largo && t.startsWith(dial)) {
      mejor = i;
      largo = dial.length;
    }
  }
  return mejor;
}

/** Pais actualmente elegido en el select, o null. */
function phoneCountryFromSelect(select) {
  if (!select) return null;
  const opt = select.options[select.selectedIndex];
  if (!opt) return null;
  const idx = parseInt(opt.value, 10);
  return isNaN(idx) ? null : (PHONE_COUNTRIES[idx] || null);
}

/** Prefijo (dial) del pais elegido en el select, o '' si no hay. */
function phoneDialFromSelect(select) {
  const pais = phoneCountryFromSelect(select);
  return pais ? pais.dial : '';
}

/**
 * Parte un telefono guardado en (pais, numero sin prefijo).
 * Si el valor trae un prefijo desconocido (+999) se respeta tal cual: el numero
 * queda entero y el select se queda en el default.
 */
function splitTelefono(valor) {
  const bruto = String(valor == null ? '' : valor).trim();
  if (!bruto) return { indice: PHONE_DEFAULT, numero: '' };
  if (bruto.charAt(0) === '+') {
    const idx = phoneIndexFromDial(bruto);
    if (idx >= 0) {
      const resto = bruto.slice(PHONE_COUNTRIES[idx].dial.length).replace(/^[\s.\-()]+/, '');
      return { indice: idx, numero: resto };
    }
    return { indice: PHONE_DEFAULT, numero: bruto };
  }
  return { indice: PHONE_DEFAULT, numero: bruto };
}

/**
 * Arma el string final que se guarda en personal.telefono.
 * - sin numero: queda VACIO. Un prefijo solo ("+56") no es informacion de
 *   contacto y terminaria impreso en el PDF de alguien que no escribio nada;
 * - numero que ya empieza con '+': se respeta tal cual (trae su propio prefijo,
 *   que puede ser un pais que no esta en la lista);
 * - en cualquier otro caso: el prefijo del select va por delante.
 */
function composeTelefono(prefijo, numero) {
  const num = String(numero == null ? '' : numero).trim();
  if (!num) return '';
  if (num.charAt(0) === '+') return num;
  return prefijo ? prefijo + ' ' + num : num;
}

/** <option> del select, agrupado por region. value = indice, data-dial = prefijo. */
function phoneOptionsHtml(indiceSeleccionado) {
  let html = '';
  let grupoAbierto = false;
  PHONE_COUNTRIES.forEach((c, i) => {
    if (c.grupo) {
      if (grupoAbierto) html += '</optgroup>';
      grupoAbierto = true;
      html += `<optgroup label="${escapeAttr(c.grupo)}">`;
    }
    html += `<option value="${i}" data-dial="${c.dial}"${i === indiceSeleccionado ? ' selected' : ''}>` +
            `${banderaDe(c.iso)} ${c.dial} ${escapeHtml(c.name)}</option>`;
  });
  if (grupoAbierto) html += '</optgroup>';
  return html;
}

/**
 * Markup del grupo telefono. La bandera visible va en un <span> propio pegado
 * al input, no solo dentro del <option>: un select cerrado no siempre pinta el
 * contenido de la option seleccionada. El <span> es aria-hidden porque el
 * nombre del pais ya esta en el texto de la option y en el hint de abajo.
 */
function phoneGroupHtml(telefonoGuardado) {
  const tel = splitTelefono(telefonoGuardado);
  const pais = PHONE_COUNTRIES[tel.indice];
  return `
      <div class="form-group">
        <label class="form-label" for="field-telefono-num">Teléfono</label>
        <div class="phone-group">
          <select class="form-select phone-country" id="field-telefono-pais"
                  aria-label="País y prefijo internacional del teléfono"
                  aria-describedby="hint-telefono">
            ${phoneOptionsHtml(tel.indice)}
          </select>
          <span class="phone-flag" aria-hidden="true">${banderaDe(pais.iso)}</span>
          <input class="form-input phone-number" type="tel" id="field-telefono-num"
                 inputmode="tel" autocomplete="tel-national" spellcheck="false"
                 value="${escapeAttr(tel.numero)}" placeholder="000 000 0000"
                 aria-describedby="hint-telefono">
        </div>
        <div class="form-hint" id="hint-telefono">
          Prefijo ${escapeHtml(pais.dial)} (${escapeHtml(pais.name)}). El prefijo se arma con el país de la izquierda: escribe solo el número. Si pegas un número con prefijo (+56, +1, +34) se detecta solo.
        </div>
      </div>
  `;
}

/**
 * Conecta el grupo telefono: sincroniza la bandera visible con el select y
 * detecta el prefijo internacional que el usuario escriba o pegue.
 */
function initPhoneField(root) {
  const select = root.querySelector('#field-telefono-pais');
  const input = root.querySelector('#field-telefono-num');
  if (!select || !input) return;

  const flag = root.querySelector('.phone-flag');
  const hint = root.querySelector('#hint-telefono');

  const pintar = () => {
    const pais = phoneCountryFromSelect(select);
    if (!pais) return;
    if (flag) flag.textContent = banderaDe(pais.iso);
    if (hint) {
      hint.textContent = 'Prefijo ' + pais.dial + ' (' + pais.name + '). ' +
        'El prefijo se arma con el país de la izquierda: escribe solo el número. ' +
        'Si pegas un número con prefijo (+56, +1, +34) se detecta solo.';
    }
  };

  // (a) Elegir pais en el select: cambia la bandera visible y el prefijo.
  select.addEventListener('change', pintar);

  // (b) Escribir o pegar un numero que ya trae prefijo internacional.
  input.addEventListener('input', () => {
    const valor = input.value;
    if (valor.charAt(0) !== '+') return;   // sin '+' al inicio no hay nada que detectar
    const idx = phoneIndexFromDial(valor);
    if (idx < 0) return;                    // prefijo desconocido: no se toca nada
    select.value = String(idx);
    pintar();
    // El prefijo ya quedo en el select: se saca del input para no duplicarlo al
    // armar el string final ("+56 +56 9 ...").
    const resto = valor.slice(PHONE_COUNTRIES[idx].dial.length).replace(/^[\s.\-()]+/, '');
    if (resto !== valor) {
      input.value = resto;
      if (typeof input.setSelectionRange === 'function') {
        try { input.setSelectionRange(0, 0); } catch (e) { /* input no textual */ }
      }
    }
  });

  pintar();
}

/* ============================================================
   STEP 1: DATOS PERSONALES
   ============================================================ */
function renderPersonalData(container, data) {
  const p = data.personal;

  /* `placeholder` = ESQUEMA de formato que se ve dentro del input mientras esta
     vacio. Nunca un dato que se pueda tomar por real: ni RUT con digito
     verificador, ni nombre, ni telefono, ni fecha, ni direccion.
     `hint` = texto chico de ayuda DEBAJO del input. Son cosas distintas: no las mezcles. */
  const fields = [
    { id: 'nombre', label: 'Nombre completo', type: 'text', value: p.nombre, placeholder: 'Nombre y apellidos', hint: 'Incluye todos los apellidos' },
    { id: 'rut', label: 'RUT', type: 'text', value: p.rut, placeholder: '00.000.000-0', hint: 'Formato: XX.XXX.XXX-X' },
    // input[type=date] no muestra placeholder en ningun navegador: el esquema
    // AAAA-MM-DD va tambien en el hint para que la guia se vea de verdad.
    { id: 'fechaNacimiento', label: 'Fecha de nacimiento', type: 'date', value: p.fechaNacimiento, placeholder: 'AAAA-MM-DD', hint: 'Formato: año-mes-día (AAAA-MM-DD)' },
    { id: 'nacionalidad', label: 'Nacionalidad', type: 'text', value: p.nacionalidad },
    { id: 'direccion', label: 'Dirección', type: 'text', value: p.direccion, placeholder: 'Calle y número' },
    { id: 'ciudad', label: 'Ciudad', type: 'text', value: p.ciudad, placeholder: 'Ciudad o comuna' },
    // Grupo tel + input numero, no input simple (ver phoneGroupHtml).
    { id: 'telefono', label: 'Teléfono', render: 'telefono' },
    { id: 'email', label: 'Email', type: 'email', value: p.email, placeholder: 'nombre@dominio.cl' },
  ];

  const selectFields = [
    {
      id: 'estadoCivil', label: 'Estado civil', value: p.estadoCivil,
      options: DEFAULT_DATA.estadosCiviles
    },
    {
      id: 'disponibilidad', label: 'Disponibilidad', value: p.disponibilidad,
      options: DEFAULT_DATA.disponibilidades
    }
  ];

  const textFields = [
    { id: 'idiomas', label: 'Idiomas', value: p.idiomas, placeholder: 'Idioma y nivel', hint: 'Separados por coma. Ej: Español nativo, Inglés B1' },
    { id: 'github', label: 'GitHub URL', value: p.github, hint: 'Link a tu perfil de GitHub' },
    { id: 'portafolio', label: 'Portafolio URL', value: p.portafolio, hint: 'Link a tu portafolio web' },
  ];

  let html = `
    <div class="section">
      <h3 class="section-title scribble-underline">Datos Personales</h3>
      <p style="margin-bottom: var(--space-6); color: #666;">
        La app abre en blanco. Lo que escribas se guarda solo en este navegador.
      </p>
      <div class="form-row">
  `;

  // Campos de texto e email
  for (const f of fields) {
    // El telefono se renderiza aparte: es un select de pais + input del numero.
    if (f.render === 'telefono') {
      html += phoneGroupHtml(p.telefono);
      continue;
    }
    html += `
      <div class="form-group">
        <label class="form-label" for="field-${f.id}">${f.label}</label>
        <input class="form-input" type="${f.type}" id="field-${f.id}"
               value="${escapeAttr(f.value)}" placeholder="${escapeAttr(f.placeholder)}">
        ${f.hint ? `<div class="form-hint">${f.hint}</div>` : ''}
      </div>
    `;
  }

  html += '</div><div class="form-row">';

  // Selects
  for (const f of selectFields) {
    html += `
      <div class="form-group">
        <label class="form-label" for="field-${f.id}">${f.label}</label>
        <select class="form-select" id="field-${f.id}">
          ${f.options.map(opt =>
            `<option value="${escapeAttr(opt)}" ${opt === f.value ? 'selected' : ''}>${opt}</option>`
          ).join('')}
        </select>
      </div>
    `;
  }

  // Texto libre
  for (const f of textFields) {
    html += `
      <div class="form-group">
        <label class="form-label" for="field-${f.id}">${f.label}</label>
        <input class="form-input" type="text" id="field-${f.id}"
               value="${escapeAttr(f.value)}" placeholder="${escapeAttr(f.placeholder)}">
        ${f.hint ? `<div class="form-hint">${f.hint}</div>` : ''}
      </div>
    `;
  }

  html += '</div></div>';
  container.innerHTML = html;

  // El grupo telefono necesita JS: bandera visible + deteccion de prefijo.
  initPhoneField(container);
}

/* ============================================================
   STEP 2: AREA DE ENFOQUE
   ============================================================ */
function renderFocusArea(container, data) {
  const areas = DEFAULT_DATA.focusAreas;
  const selected = data.focusArea;

  let html = `
    <div class="section">
      <h3 class="section-title scribble-underline">Área de Enfoque</h3>
      <p style="margin-bottom: var(--space-6); color: #666;">
        Selecciona el área principal para la que quieres generar tu CV.
        Esto determinará qué experiencia y habilidades se destacan.
      </p>
      <div class="focus-grid">
  `;

  for (const area of areas) {
    const isSelected = area.id === selected;
    html += `
      <div class="card focus-card ${isSelected ? 'selected' : ''}"
           data-area="${area.id}"
           onclick="selectFocusArea(this, '${area.id}')"
           onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault(); selectFocusArea(this, '${area.id}');}"
           role="button"
           tabindex="0"
           aria-pressed="${isSelected}"
           aria-label="${area.name}">
        <span class="focus-card-icon">${area.icon}</span>
        <div class="focus-card-name">${area.name}</div>
        <div class="focus-card-desc">${area.desc}</div>
        <div class="focus-card-check">[SELECCIONADO]</div>
      </div>
    `;
  }

  html += '</div></div>';
  container.innerHTML = html;
}

/**
 * Seleccionar area de enfoque
 */
function selectFocusArea(el, areaId) {
  // Quitar seleccion previa
  document.querySelectorAll('.focus-card').forEach(card => {
    card.classList.remove('selected');
    card.setAttribute('aria-pressed', 'false');
  });

  // Seleccionar nueva
  el.classList.add('selected');
  el.setAttribute('aria-pressed', 'true');

  // Guardar en data
  if (wizard) {
    wizard.data.focusArea = areaId;
  }
}

/* ============================================================
   STEP 3: EXPERIENCIA Y EDUCACION
   ============================================================ */
function renderExperience(container, data) {
  let html = `
    <div class="section">
      <h3 class="section-title scribble-underline">Experiencia Laboral</h3>
      <p style="margin-bottom: var(--space-4); color: #666;">
        La app abre en blanco. Lo que agregues se guarda en este navegador.
      </p>
      <div class="entry-list" id="experience-list">
  `;

  data.experience.forEach((exp, i) => {
    html += renderExpEntry(exp, i);
  });

  html += `
      </div>
      <button class="btn add-entry-btn" onclick="addExperienceEntry()" aria-label="Agregar experiencia">
        + Agregar Experiencia
      </button>
    </div>

    <hr class="dashed-line">

    <div class="section">
      <h3 class="section-title scribble-underline">Educación y Certificaciones</h3>
      <p style="margin-bottom: var(--space-4); color: #666;">
        Cursos, diplomados y formación académica.
      </p>
      <div class="entry-list" id="education-list">
  `;

  data.education.forEach((edu, i) => {
    html += renderEduEntry(edu, i);
  });

  html += `
      </div>
      <button class="btn add-entry-btn" onclick="addEducationEntry()" aria-label="Agregar educación">
        + Agregar Educación
      </button>
    </div>
  `;

  container.innerHTML = html;
}

/**
 * Renderizar una entrada de experiencia
 */
function renderExpEntry(exp, index) {
  return `
    <div class="card entry-item exp-entry" style="transform: rotate(${getRandomRotation()}deg);">
      <div class="entry-header">
        <span class="entry-number">Exp. #${index + 1}</span>
        <button class="entry-remove" onclick="removeEntry(this, '.exp-entry')" aria-label="Eliminar experiencia">X</button>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Empresa</label>
          <input class="form-input exp-empresa" type="text" value="${escapeAttr(exp.empresa)}" placeholder="Nombre de la empresa">
        </div>
        <div class="form-group">
          <label class="form-label">Cargo</label>
          <input class="form-input exp-cargo" type="text" value="${escapeAttr(exp.cargo)}" placeholder="Tu cargo o rol">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Ubicación</label>
          <input class="form-input exp-ubicacion" type="text" value="${escapeAttr(exp.ubicacion)}" placeholder="Ciudad, Región">
        </div>
        <div class="form-group">
          <label class="form-label">Fecha inicio</label>
          <input class="form-input exp-fecha-inicio" type="month" value="${exp.fechaInicio || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Fecha fin</label>
          <input class="form-input exp-fecha-fin" type="month" value="${exp.presente ? '' : (exp.fechaFin || '')}"
                 ${exp.presente ? 'disabled' : ''}>
          <label style="display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-2); cursor: pointer;">
            <input type="checkbox" class="exp-presente" ${exp.presente ? 'checked' : ''}
                   onchange="togglePresente(this)">
            <span class="form-hint" style="margin: 0;">Trabajo aquí actualmente</span>
          </label>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Funciones principales</label>
        <textarea class="form-textarea exp-funciones" rows="3"
                  placeholder="Describe tus funciones principales, una por línea">${escapeHtml(exp.funciones)}</textarea>
        <div class="form-hint">Una función por línea</div>
      </div>
    </div>
  `;
}

/**
 * Renderizar una entrada de educacion
 */
function renderEduEntry(edu, index) {
  const estadosOp = ['Completo', 'En curso', 'Incompleto'];
  return `
    <div class="card entry-item edu-entry" style="transform: rotate(${getRandomRotation()}deg);">
      <div class="entry-header">
        <span class="entry-number">Edu #${index + 1}</span>
        <button class="entry-remove" onclick="removeEntry(this, '.edu-entry')" aria-label="Eliminar educación">X</button>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Institución</label>
          <input class="form-input edu-institucion" type="text" value="${escapeAttr(edu.institucion)}" placeholder="Nombre de la institución">
        </div>
        <div class="form-group">
          <label class="form-label">Programa / Curso</label>
          <input class="form-input edu-programa" type="text" value="${escapeAttr(edu.programa)}" placeholder="Nombre del programa">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Horas</label>
          <input class="form-input edu-horas" type="number" value="${edu.horas || ''}" min="0" placeholder="0">
        </div>
        <div class="form-group">
          <label class="form-label">Nota / Calificación</label>
          <input class="form-input edu-nota" type="text" value="${escapeAttr(edu.nota || '')}" placeholder="Ej: 100/100">
        </div>
        <div class="form-group">
          <label class="form-label">Estado</label>
          <select class="form-select edu-estado">
            ${estadosOp.map(e => `<option value="${e}" ${e === edu.estado ? 'selected' : ''}>${e}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Año</label>
          <input class="form-input edu-ano" type="number" value="${edu.ano || ''}" min="1990" max="2030" placeholder="2025">
        </div>
      </div>
    </div>
  `;
}

/**
 * Agregar entrada de experiencia
 */
function addExperienceEntry() {
  wizard.saveCurrentStepData();
  wizard.data.experience.push({
    empresa: '', cargo: '', ubicacion: '',
    fechaInicio: '', fechaFin: '', presente: false, funciones: ''
  });
  renderExperience(document.getElementById('step-3'), wizard.data);
  showToast('Experiencia agregada', 'success');
}

/**
 * Agregar entrada de educacion
 */
function addEducationEntry() {
  wizard.saveCurrentStepData();
  wizard.data.education.push({
    institucion: '', programa: '', horas: 0,
    nota: '', estado: 'Completo', ano: 0
  });
  renderExperience(document.getElementById('step-3'), wizard.data);
  showToast('Educación agregada', 'success');
}

/**
 * Toggle campo "presente" (deshabilita fecha fin)
 */
function togglePresente(checkbox) {
  const card = checkbox.closest('.exp-entry');
  const fechaFin = card.querySelector('.exp-fecha-fin');
  if (fechaFin) {
    fechaFin.disabled = checkbox.checked;
    if (checkbox.checked) fechaFin.value = '';
  }
}

/**
 * Eliminar una entrada
 */
function removeEntry(btn, selector) {
  const entries = document.querySelectorAll(selector);
  if (entries.length <= 1) {
    showToast('Debe haber al menos una entrada', 'error');
    return;
  }
  wizard.saveCurrentStepData();
  btn.closest(selector).remove();
  // Re-numerar
  document.querySelectorAll(selector).forEach((entry, i) => {
    const num = entry.querySelector('.entry-number');
    if (num) {
      const prefix = selector.includes('exp') ? 'Exp.' : 'Edu.';
      num.textContent = prefix + ' #' + (i + 1);
    }
  });
}

/* ============================================================
   STEP 4: HABILIDADES, CERTIFICACIONES, PROYECTOS
   ============================================================ */
function renderSkills(container, data) {
  const categories = [
    { key: 'frontend', label: 'Frontend' },
    { key: 'backend', label: 'Backend' },
    { key: 'devops', label: 'DevOps' },
    { key: 'seguridad', label: 'Seguridad' },
    { key: 'marketing', label: 'Marketing' },
    { key: 'idiomas', label: 'Idiomas' }
  ];

  let html = `
    <div class="section">
      <h3 class="section-title scribble-underline">Habilidades Técnicas</h3>
      <p style="margin-bottom: var(--space-4); color: #666;">
        Agrega o elimina habilidades por categoría.
      </p>
  `;

  for (const cat of categories) {
    const skills = data.skills[cat.key] || [];
    html += `
      <div class="skill-category">
        <div class="skill-category-title">${cat.label}</div>
        <div class="skill-input-row">
          <input class="form-input skill-input" type="text"
                 placeholder="Agregar habilidad..."
                 data-category="${cat.key}"
                 onkeydown="handleSkillKeydown(event, '${cat.key}')">
          <button class="btn btn--sm" onclick="addSkill('${cat.key}')" aria-label="Agregar ${cat.label}">+</button>
        </div>
        <div class="skill-tags" id="skills-${cat.key}">
          ${skills.map(s => `
            <span class="skill-tag">
              ${escapeHtml(s)}
              <button class="skill-tag-remove" onclick="removeSkill('${cat.key}', this)" aria-label="Eliminar ${s}">X</button>
            </span>
          `).join('')}
        </div>
      </div>
    `;
  }

  html += `
    </div>
    <hr class="dashed-line">
    <div class="section">
      <h3 class="section-title scribble-underline">Certificaciones</h3>
      <div class="entry-list" id="certifications-list">
  `;

  data.certifications.forEach((cert, i) => {
    html += renderCertEntry(cert, i);
  });

  html += `
      </div>
      <button class="btn add-entry-btn" onclick="addCertEntry()" aria-label="Agregar certificación">
        + Agregar Certificación
      </button>
    </div>
    <hr class="dashed-line">
    <div class="section">
      <h3 class="section-title scribble-underline">Proyectos</h3>
      <div class="entry-list" id="projects-list">
  `;

  data.projects.forEach((proj, i) => {
    html += renderProjEntry(proj, i);
  });

  html += `
      </div>
      <button class="btn add-entry-btn" onclick="addProjEntry()" aria-label="Agregar proyecto">
        + Agregar Proyecto
      </button>
    </div>
  `;

  container.innerHTML = html;
}

/**
 * Renderizar entrada de certificacion
 */
function renderCertEntry(cert, index) {
  return `
    <div class="card entry-item cert-entry">
      <div class="entry-header">
        <span class="entry-number">Cert #${index + 1}</span>
        <button class="entry-remove" onclick="removeEntry(this, '.cert-entry')" aria-label="Eliminar certificación">X</button>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Nombre</label>
          <input class="form-input cert-nombre" type="text" value="${escapeAttr(cert.nombre)}" placeholder="Nombre de la certificación">
        </div>
        <div class="form-group">
          <label class="form-label">Institucion</label>
          <input class="form-input cert-institucion" type="text" value="${escapeAttr(cert.institucion)}" placeholder="Institución emisora">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Horas</label>
          <input class="form-input cert-horas" type="number" value="${cert.horas || ''}" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">Nota (0-100)</label>
          <input class="form-input cert-nota" type="number" value="${cert.nota || ''}" min="0" max="100">
        </div>
        <div class="form-group">
          <label class="form-label">Año</label>
          <input class="form-input cert-ano" type="number" value="${cert.ano || ''}" min="1990" max="2030">
        </div>
      </div>
    </div>
  `;
}

/**
 * Renderizar entrada de proyecto
 */
function renderProjEntry(proj, index) {
  return `
    <div class="card entry-item proj-entry" style="transform: rotate(${getRandomRotation()}deg);">
      <div class="entry-header">
        <span class="entry-number">Proj #${index + 1}</span>
        <button class="entry-remove" onclick="removeEntry(this, '.proj-entry')" aria-label="Eliminar proyecto">X</button>
      </div>
      <div class="form-group">
        <label class="form-label">Nombre</label>
        <input class="form-input proj-nombre" type="text" value="${escapeAttr(proj.nombre)}" placeholder="Nombre del proyecto">
      </div>
      <div class="form-group">
        <label class="form-label">Descripción</label>
        <textarea class="form-textarea proj-descripcion" rows="2"
                  placeholder="¿Qué hace el proyecto?">${escapeHtml(proj.descripcion)}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Tecnologías</label>
        <input class="form-input proj-tecnologias" type="text" value="${escapeAttr(proj.tecnologias)}"
               placeholder="Ej: Python, Django, SQLite">
      </div>
    </div>
  `;
}

/**
 * Agregar certificacion
 */
function addCertEntry() {
  wizard.saveCurrentStepData();
  wizard.data.certifications.push({
    nombre: '', institucion: '', horas: 0, nota: null, ano: null
  });
  renderSkills(document.getElementById('step-4'), wizard.data);
  showToast('Certificación agregada', 'success');
}

/**
 * Agregar proyecto
 */
function addProjEntry() {
  wizard.saveCurrentStepData();
  wizard.data.projects.push({
    nombre: '', descripcion: '', tecnologias: ''
  });
  renderSkills(document.getElementById('step-4'), wizard.data);
  showToast('Proyecto agregado', 'success');
}

/**
 * Manejar tecla Enter en input de skills
 */
function handleSkillKeydown(event, category) {
  if (event.key === 'Enter') {
    event.preventDefault();
    addSkill(category);
  }
}

/**
 * Agregar skill
 */
function addSkill(category) {
  const input = document.querySelector(`.skill-input[data-category="${category}"]`);
  if (!input) return;

  const value = input.value.trim();
  if (!value) return;

  if (!wizard.data.skills[category]) {
    wizard.data.skills[category] = [];
  }

  // Evitar duplicados
  if (wizard.data.skills[category].includes(value)) {
    showToast('Habilidad ya existe', 'error');
    return;
  }

  wizard.data.skills[category].push(value);
  input.value = '';

  // Re-render skills de esta categoria
  const container = document.getElementById('skills-' + category);
  if (container) {
    container.innerHTML = wizard.data.skills[category].map(s => `
      <span class="skill-tag">
        ${escapeHtml(s)}
        <button class="skill-tag-remove" onclick="removeSkill('${category}', this)" aria-label="Eliminar ${s}">X</button>
      </span>
    `).join('');
  }
}

/**
 * Eliminar skill
 */
function removeSkill(category, btn) {
  const tag = btn.closest('.skill-tag');
  const value = tag.textContent.replace('X', '').trim();
  wizard.data.skills[category] = wizard.data.skills[category].filter(s => s !== value);
  tag.remove();
}

/* ============================================================
   STEP 5: RESULTADOS
   ============================================================ */
/**
 * Vista previa de cada diseno, una por columna de la grilla.
 * Los archivos son placeholders en assets/previews/: reemplazalos por tus
 * capturas reales y, si usas otro formato, cambia la extension aqui.
 */
const TEMPLATE_PREVIEWS = [
  '01-moderno-limpio.svg',
  '02-creativo.svg',
  '03-profesional-clasico.svg'
];

function renderResults(container, data) {
  // Generar los 3 templates
  const templates = generateAllTemplates(data);

  let html = `
    <div class="results-header">
      <h2 class="scribble-underline">Tus Opciones de CV</h2>
      <p>Elige uno de los 3 diseños generados. Puedes ver el código, copiarlo, descargar el .tex o bajar el PDF que se arma en tu propio navegador</p>
    </div>

    <div id="compile-status" class="compile-status" role="status" aria-live="polite" hidden>
      <div class="compile-status-body">
        <span class="compile-status-spinner" aria-hidden="true"></span>
        <div class="compile-status-text">
          <div class="compile-status-title" id="compile-status-title"></div>
          <div class="compile-status-detail" id="compile-status-detail"></div>
        </div>
      </div>
    </div>

    <div class="results-grid">
  `;

  templates.forEach((tpl, i) => {
    const features = getTemplateFeatures(i);
    html += `
      <div class="card template-card">
        <div class="template-card-header">
          <div class="template-card-number">Opción ${i + 1}</div>
          <div class="template-card-name" id="tpl-nombre-${i}">${tpl.name}</div>
          <div class="template-card-desc">${tpl.description}</div>
        </div>

        <figure class="template-card-preview">
          <img class="template-card-preview-img"
               src="assets/previews/${TEMPLATE_PREVIEWS[i]}"
               alt="Vista previa del diseño ${tpl.name}"
               loading="lazy" decoding="async">
          <figcaption class="template-card-preview-tag">Vista previa</figcaption>
        </figure>
        <div class="template-card-body">
          <ul class="template-card-features">
            ${features.map(f => `<li>${f}</li>`).join('')}
          </ul>
        </div>
        <div class="template-card-actions" id="acciones-${i}">
          <button class="btn" type="button" onclick="showLatexCode(${i})" aria-label="Ver código LaTeX de ${tpl.name}">
            Ver Código LaTeX
          </button>
          <button class="btn btn--primary" type="button" onclick="copyLatexCode(${i})" aria-label="Copiar código de ${tpl.name}">
            Copiar Código
          </button>
          <button class="btn" type="button" onclick="downloadTex(${i})" aria-label="Descargar archivo .tex de ${tpl.name}">
            Descargar .tex
          </button>
          ${pdfAccionesHtml(i)}
        </div>
      </div>
    `;
  });

  html += `
    </div>

    <div class="compile-section">
      <h3 class="scribble-underline">Cómo Llevarte tu CV</h3>
      <p class="compile-disclaimer">
        <strong>EN TU NAVEGADOR:</strong> "Descargar PDF" arma el PDF en tu propio
        navegador con jsPDF, al instante. No hay servidor de compilación, no se envía
        nada a internet y el archivo se llama <code>cv-plantilla-N.pdf</code>: sin
        nombre, RUT, email ni teléfono en el nombre. Si prefieres el código,
        "Descargar .tex" te da el LaTeX para compilar donde quieras.
      </p>
    </div>

    <div class="results-nav">
      <button class="btn" onclick="wizard.goToStep(1)">
        &lt;- Editar Datos
      </button>
      <button class="btn" onclick="wizard.goToStep(4)">
        &lt;- Editar Habilidades
      </button>
      <button class="btn btn--primary" onclick="downloadAllTex()">
        Descargar Todos (.tex)
      </button>
      <button class="btn btn--pdf" id="btn-bulk-pdf" type="button" onclick="descargarTodosLosPdf()"
              aria-describedby="btn-bulk-pdf-label" title="Genera los 3 PDFs en tu navegador, uno por uno">
        <span class="btn-spinner" id="btn-bulk-pdf-spinner" hidden aria-hidden="true"></span>
        <span id="btn-bulk-pdf-label">Descargar Todos (PDF)</span>
      </button>
      <button class="btn" onclick="resetAndReload()">
        Empezar de Nuevo
      </button>
    </div>

    <div class="results-deco">
      Generado por CV Builder -- Edición dibujada a mano
    </div>
  `;

  container.innerHTML = html;

  // Guardar templates para uso global
  window._generatedTemplates = templates;

  /* La guia de los 4 botones se despliega al llegar a este paso. No guarda
     nada: se borra al cerrarse y vuelve a salir cada vez que se entra aca,
     incluso si se retrocede y se vuelve. */
  if (typeof tutorialStart === 'function') tutorialStart('resultados');
}

/**
 * Caracteristicas de cada template
 */
function getTemplateFeatures(index) {
  const features = [
    [
      "Layout limpio con sidebar de color",
      "Encabezado con perfil profesional",
      "Habilidades en columna lateral",
      "Experiencia en área principal",
      "Ideal para IT y desarrollo"
    ],
    [
      "Diseño creativo con cajas de color",
      "Divisores decorativos con tikz",
      "Secciones con fondo coloreado",
      "Formato llamativo y moderno",
      "Ideal para marketing y ventas"
    ],
    [
      "Layout clásico y profesional",
      "Fuentes serif tradicionales",
      "Líneas limpias, sin decoración",
      "Formato optimizado para ATS",
      "Ideal para empresas tradicionales"
    ]
  ];
  return features[index] || [];
}

/**
 * Resetear datos y recargar
 */
function resetAndReload() {
  if (confirm('Esto eliminará todos los datos guardados. ¿Continuar?')) {
    resetData();
    location.reload();
  }
}
