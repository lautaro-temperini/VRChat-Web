// Llamadas a /api (cuentas). El token de sesión se guarda en el navegador,
// así al recargar la página no hace falta volver a entrar.

let memoryToken = null;

export const session = {
  get token() {
    try { return localStorage.getItem('token') ?? memoryToken; } catch { return memoryToken; }
  },
  set token(v) {
    memoryToken = v;
    try { v ? localStorage.setItem('token', v) : localStorage.removeItem('token'); } catch { /* sin almacenamiento */ }
  },
};

const authHeader = () => (session.token ? { Authorization: `Bearer ${session.token}` } : {});

// Foto de una galería → URL local para <img> (las fotos pueden ser privadas: van con la sesión)
const photoCache = new Map();
export async function photoUrl(id) {
  if (photoCache.has(id)) return photoCache.get(id);
  const res = await fetch(`/api/photo?id=${encodeURIComponent(id)}`, { headers: authHeader() });
  if (!res.ok) return null;
  const url = URL.createObjectURL(await res.blob());
  photoCache.set(id, url);
  return url;
}

// Subir una foto ya achicada (Blob JPEG)
export async function uploadPhoto(blob, w, h) {
  try {
    const res = await fetch(`/api/photo?w=${w}&h=${h}`, { method: 'POST', headers: { 'content-type': blob.type, ...authHeader() }, body: blob });
    return await res.json();
  } catch {
    return { ok: false, error: 'No hay conexión con el servidor.' };
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  let data;
  try {
    const res = await fetch(`/api/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    data = await res.json();
  } catch {
    return { ok: false, error: 'No hay conexión con el servidor.' };
  }
  if (data.ok && data.token) session.token = data.token;
  return data;
}

// Archivo de una obra del Museo (imagen o modelo) → URL local. Las que todavía no se expusieron
// solo las ven el autor y los curadores, así que también van con la sesión.
const workCache = new Map();
export async function workFileUrl(id, f) {
  const key = `${id}/${f}`;
  if (!workCache.has(key)) {
    workCache.set(key, fetch(`/api/workfile?id=${encodeURIComponent(id)}&f=${f}`, { headers: authHeader() })
      .then(async (res) => (res.ok ? URL.createObjectURL(await res.blob()) : null))
      .catch(() => null));
  }
  return workCache.get(key);
}

// Postular una obra (formulario con los archivos)
export async function submitWork(form) {
  try {
    const res = await fetch('/api/work', { method: 'POST', headers: authHeader(), body: form });
    return await res.json();
  } catch {
    return { ok: false, error: 'No hay conexión con el servidor.' };
  }
}
