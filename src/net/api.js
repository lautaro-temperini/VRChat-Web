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
