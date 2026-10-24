// Lo que comparten las partes del cliente (src/app/*). Cada módulo deja en G lo que usan los
// demás (funciones y objetos) y lee de G lo de los otros. main.js los importa en orden: cada uno
// corre al importarse, así que solo puede usar al momento lo de los módulos anteriores (lo de los
// siguientes, recién cuando pasa algo: un click, un mensaje de la sala…).
export const G = {
  account: null, // { id, username, name, look, bio } de la cuenta con la que se entró
  joined: false, // ya entró a la sala (después de la pantalla de ingreso / el editor)
};

export const $ = (id) => document.getElementById(id);
export const body = document.body;

// Preferencias guardadas en el navegador
export const pref = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};

// Pantalla de carga (está en index.html): avanza por etapas y se va cuando está todo listo
export function loading(pct, text) {
  $('loading-fill').style.width = `${pct}%`;
  if (text) $('loading-text').textContent = text;
}
