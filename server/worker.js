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
  const q = new URL(request.url).searchParams;

  // Fotos: se suben y se bajan como archivo (no JSON)
  if (path === 'photo' && request.method === 'GET') {
    const p = await accounts.photoGet(token, q.get('id'));
    if (!p) return new Response('No encontrada', { status: 404 });
    return new Response(p.data, { headers: { 'content-type': p.mime, 'cache-control': 'private, max-age=86400' } });
  }
  if (path === 'photo' && request.method === 'POST') {
    const mime = (request.headers.get('content-type') ?? '').split(';')[0].trim();
    const data = await request.arrayBuffer();
    const result = await accounts.photoAdd(token, mime, data, Number(q.get('w')), Number(q.get('h')));
    return json(result, result.ok ? 200 : 400);
  }

  // Museo rotativo: postular (formulario con archivos) y bajar los archivos de una obra (de R2)
  if (path === 'work' && request.method === 'POST') {
    let fd;
    try { fd = await request.formData(); } catch { return json({ ok: false, error: 'Formulario inválido.' }, 400); }
    const file = async (name) => {
      const f = fd.get(name);
      return f && typeof f === 'object' ? { mime: f.type, data: await f.arrayBuffer() } : null;
    };
    const f = Object.fromEntries(['kind', 'title', 'description', 'technique', 'year', 'link', 'w', 'h'].map((k) => [k, fd.get(k) ?? '']));
    Object.assign(f, { hd: await file('hd'), wall: await file('wall'), model: await file('model') });
    const result = await accounts.workSubmit(token, f);
    return json(result, result.ok ? 200 : 400);
  }
  if (path === 'workfile' && request.method === 'GET') {
    const key = await accounts.workFile(token, q.get('id'), q.get('f'));
    const obj = key && env.ART ? await env.ART.get(key) : null;
    if (!obj) return new Response('No encontrada', { status: 404 });
    return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream', 'cache-control': 'private, max-age=3600' } });
  }

  // Vuelta de Google / Discord: se canjea el código y se vuelve al juego con un código de un solo uso
  // (el token de sesión nunca viaja en la dirección)
  const cb = path.match(/^oauth\/(google|discord)\/callback$/);
  if (cb && request.method === 'GET') {
    const r = await accounts.oauthCallback(cb[1], q.get('code'), q.get('state'), q.get('error'));
    const back = r.origin ?? new URL(request.url).origin;
    const hash = r.ok ? `login=${r.code}` : `loginerror=${encodeURIComponent(r.error)}`;
    return Response.redirect(`${back}/#${hash}`, 302);
  }

  let body = {};
  if (request.method !== 'GET') {
    try { body = await request.json(); } catch { body = {}; }
  }
  let result;
  switch (`${request.method} ${path}`) {
    case 'POST guest': result = await accounts.guest(body.name, body.look, !!body.terms); break;
    case 'POST register': result = await accounts.register(token, { email: body.email, nick: body.nick, password: body.password, look: body.look, terms: !!body.terms }); break;
    case 'POST login': result = await accounts.login(body.login ?? body.username, body.password); break;
    case 'GET blocks': result = await accounts.blocks(token); break;
    case 'POST block': result = await accounts.setBlock(token, String(body.id ?? ''), !!body.on); break;
    case 'POST oauthstart': result = await accounts.oauthStart(token, String(body.provider ?? ''), String(body.origin ?? '')); break;
    case 'POST oauthfinish': result = await accounts.oauthFinish(String(body.code ?? '')); break;
    case 'POST oauthnick': result = await accounts.oauthNick(token, { nick: body.nick, terms: !!body.terms }); break;
    case 'GET ignores': result = await accounts.ignores(token); break;
    case 'POST ignore': result = await accounts.setIgnore(token, String(body.id ?? ''), !!body.on); break;
    case 'POST report': result = await accounts.report(token, body); break;
    case 'GET reports': result = await accounts.reports(token); break;
    case 'POST reportresolve': result = await accounts.resolveReport(token, body.id); break;
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
    // Red social
    case 'GET photos': result = await accounts.photoList(token, q.get('id')); break;
    case 'POST photodelete': result = await accounts.photoDelete(token, body.id); break;
    case 'POST galleryprivacy': result = await accounts.setGalleryPrivacy(token, body.privacy); break;
    case 'GET notes': result = await accounts.notesList(q.get('id')); break;
    case 'POST note': result = await accounts.noteAdd(token, body.text); break;
    case 'POST notedelete': result = await accounts.noteDelete(token, body.id); break;
    case 'GET feed': result = await accounts.feed(token); break;
    case 'POST like': result = await accounts.like(token, body.type, body.id, !!body.on); break;
    case 'GET hearts': result = await accounts.hearts(token, q.get('id')); break;
    case 'POST heart': result = await accounts.heartGive(token, String(body.id ?? '')); break;
    case 'GET roominfo': result = await accounts.roomInfo(q.get('id')); break;
    case 'PUT myroom': result = await accounts.setMyRoom(token, body); break;
    case 'GET favorites': result = await accounts.favorites(token); break;
    case 'POST favorite': result = await accounts.setFavorite(token, body.room, !!body.on); break;
    case 'GET search': result = await accounts.search(token, q.get('q')); break;
    case 'GET notifications': result = await accounts.notifications(token); break;
    case 'POST notificationsseen': result = await accounts.notificationsSeen(token); break;
    case 'GET museum': result = await accounts.museumNow(); break;
    case 'GET myworks': result = await accounts.myWorks(token); break;
    case 'GET review': result = await accounts.reviewNext(token, q.get('skip')); break;
    case 'POST reviewvote': result = await accounts.reviewVote(token, body.id, body.vote, body.reason, body.text); break;
    case 'GET worksadmin': result = await accounts.worksAdmin(token); break;
    case 'POST workremove': result = await accounts.workRemove(token, body.id); break;
    case 'POST title': result = await accounts.setTitle(token, body.nick, body.title); break;
    default: return json({ ok: false, error: 'No encontrado' }, 404);
  }
  return json(result, result.ok ? 200 : 400);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const apiMatch = url.pathname.match(/^\/api\/([a-z]+|oauth\/(?:google|discord)\/callback)$/);
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
