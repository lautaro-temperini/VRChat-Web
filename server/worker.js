// Punto de entrada del servidor.
//   /api/*      cuentas (invitado, registro, login, perfil)
//   /ws/<sala>  conexión en tiempo real con una sala
export { Room } from './room.js';
export { Accounts } from './accounts.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function bearer(request) {
  const h = request.headers.get('Authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// Vista previa de un sitio web: lee las etiquetas Open Graph (título, descripción, imagen)
async function linkPreview(raw) {
  let url;
  try { url = new URL(raw); } catch { return { ok: false, error: 'Link inválido.' }; }
  if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, error: 'Link inválido.' };
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(url.hostname)) return { ok: false, error: 'Link inválido.' };

  let res;
  try {
    res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'GaleriaOnline/0.1 (vista previa de links)' } });
  } catch {
    return { ok: false, error: 'No se pudo abrir el sitio.' };
  }
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/html')) return { ok: false, error: 'No se pudo abrir el sitio.' };

  const meta = {};
  let title = '';
  await new HTMLRewriter()
    .on('meta', {
      element(e) {
        const key = (e.getAttribute('property') ?? e.getAttribute('name') ?? '').toLowerCase();
        const content = e.getAttribute('content');
        if (content && /^(og:|twitter:|description$)/.test(key) && !(key in meta)) meta[key] = content;
      },
    })
    .on('title', { text(t) { if (title.length < 300) title += t.text; } })
    .transform(res)
    .arrayBuffer();

  const image = meta['og:image'] ?? meta['twitter:image'];
  return {
    ok: true,
    url: res.url,
    site: meta['og:site_name'] ?? new URL(res.url).hostname.replace(/^www\./, ''),
    title: (meta['og:title'] ?? meta['twitter:title'] ?? title).trim().slice(0, 200),
    description: (meta['og:description'] ?? meta['twitter:description'] ?? meta.description ?? '').trim().slice(0, 400),
    image: image ? new URL(image, res.url).href : null,
  };
}

async function api(request, env, path) {
  const accounts = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('global'));
  const token = bearer(request);
  let body = {};
  if (request.method !== 'GET') {
    try { body = await request.json(); } catch { body = {}; }
  }
  let result;
  switch (`${request.method} ${path}`) {
    case 'POST guest': result = await accounts.guest(body.name, body.look); break;
    case 'POST register': result = await accounts.register(token, body.username, body.password, body.name, body.look); break;
    case 'POST login': result = await accounts.login(body.username, body.password); break;
    case 'POST logout': result = await accounts.logout(token); break;
    case 'GET me': {
      const user = await accounts.auth(token);
      return user ? json({ ok: true, user }) : json({ ok: false, error: 'Sesión vencida.' }, 401);
    }
    case 'PUT me': result = await accounts.update(token, body.name, body.look, body.bio); break;
    case 'GET profile': result = await accounts.profile(new URL(request.url).searchParams.get('id'), token); break;
    case 'GET inventory': result = await accounts.inventory(token); break;
    case 'POST equip': result = await accounts.equip(token, body.iid, !!body.on); break;
    case 'GET friends': result = await accounts.friends(token); break;
    case 'POST friendrequest': result = await accounts.friendRequest(token, String(body.id ?? '')); break;
    case 'POST friendrespond': result = await accounts.friendRespond(token, String(body.id ?? ''), !!body.accept); break;
    case 'POST friendremove': result = await accounts.friendRemove(token, String(body.id ?? '')); break;
    case 'GET preview': result = await linkPreview(new URL(request.url).searchParams.get('url')); break;
    default: return json({ ok: false, error: 'No encontrado' }, 404);
  }
  return json(result, result.ok ? 200 : 400);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const apiMatch = url.pathname.match(/^\/api\/([a-z]+)$/);
    if (apiMatch) return api(request, env, apiMatch[1]);

    const wsMatch = url.pathname.match(/^\/ws\/([a-z0-9-]{1,32})$/i);
    if (wsMatch && request.headers.get('Upgrade') === 'websocket') {
      const room = wsMatch[1].toLowerCase();
      const stub = env.ROOMS.get(env.ROOMS.idFromName(room));
      // La sala no conoce su propio nombre: se lo pasamos (lo usa para avisar presencia)
      const headers = new Headers(request.headers);
      headers.set('X-Room', room);
      return stub.fetch(new Request(request, { headers }));
    }
    return new Response('No encontrado', { status: 404 });
  },
};
