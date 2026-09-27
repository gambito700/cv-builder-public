/**
 * DATA.JS - Modelo de datos del CV Builder
 *
 * Datos precargados: vacíos a propósito. El asistente arranca en blanco para
 * que ningún dato real quede en el repo.
 *
 *
 * Este archivo se sirve al navegador: no puede contener nombres, empleadores ni
 * credenciales de ninguna persona, real o ficticia.
 */

const DEFAULT_DATA = {
  personal: {
    nombre: "",
    rut: "",
    fechaNacimiento: "",
    nacionalidad: "",
    direccion: "",
    ciudad: "",
    telefono: "",
    email: "",
    estadoCivil: "",
    idiomas: "",
    disponibilidad: "",
    github: "",
    portafolio: ""
  },

  focusArea: "integral",

  experience: [],

  education: [],

  skills: {
    frontend: [],
    backend: [],
    devops: [],
    seguridad: [],
    marketing: [],
    idiomas: []
  },

  // Fortalezas: texto libre que escribe la persona, un item por entrada. Arranca
  // vacio a proposito, como todo lo demas: el generador LaTeX dibuja la seccion
  // solo si hay algo que dibujar y nunca la rellena por su cuenta.
  fortalezas: [],

  certifications: [],

  projects: [],

  // Areas foco disponibles
  focusAreas: [
    { id: "cocina", icon: "[COCINA]", name: "Cocina y Gastronomía", desc: "Preparación de alimentos, producción, higiene" },
    { id: "atencion", icon: "[CLTE]", name: "Atención al Cliente", desc: "Servicio, resolución de problemas, retail" },
    { id: "seguridad", icon: "[SEGUR]", name: "Seguridad y Vigilancia", desc: "CCTV, control de accesos, rondas" },
    { id: "ventas", icon: "[VENTA]", name: "Ventas y Comercial", desc: "Venta directa, retail, captación" },
    { id: "informatica", icon: "[TIC]", name: "Informática y TIC", desc: "Desarrollo web, programación, soporte" },
    { id: "corretaje", icon: "[PROP]", name: "Corretaje de Propiedades", desc: "Certificado en corretaje" },
    { id: "marketing", icon: "[DIGITAL]", name: "Marketing Digital", desc: "SEO, Growth Hacking, analítica" },
    { id: "integral", icon: "[MULTI]", name: "Integral (Multiárea)", desc: "Todas las áreas combinadas" }
  ],

  // Estados civiles para select
  estadosCiviles: ["Soltero", "Casado", "Divorciado", "Viudo", "Conviviente"],

  // Disponibilidades
  disponibilidades: ["Inmediata", "1 semana", "2 semanas", "1 mes"]
};

/**
 * Clave para localStorage
 */
const STORAGE_KEY = 'cv_builder_data';

/**
 * Cargar datos desde localStorage o usar los por defecto
 */
function loadData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Merge con defaults para campos nuevos
      return deepMerge(structuredClone(DEFAULT_DATA), parsed);
    }
  } catch (e) {
    console.warn('Error cargando datos guardados:', e);
  }
  return structuredClone(DEFAULT_DATA);
}

/**
 * Guardar datos en localStorage
 */
function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Error guardando datos:', e);
  }
}

/**
 * Resetear a datos por defecto
 */
function resetData() {
  localStorage.removeItem(STORAGE_KEY);
  return structuredClone(DEFAULT_DATA);
}

/**
 * Merge profundo de objetos
 */
function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}
