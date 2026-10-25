import { isImage, DESIGN_KINDS, DESIGN_ITEM, STAMP_PLACES, STAMP_SIZES, DESIGN_IMAGE, cleanDesign } from './shared.js';
import { checkGLB } from './glb.js';

// Diseños de artistas como objetos del juego. Se suman a la clase Accounts (comparten la base SQLite);
// los archivos van a R2 (binding ART) en disenos/<id>/<archivo>.
// - Cualquier cuenta registrada sube estampas, cuadros y objetos 3D, sin límite por día; solo pasa el
//   control automático (imágenes válidas, modelos GLB con las reglas de MODEL_RULES).
// - El que lo sube recibe una copia. Solo el autor puede "Hacer copia" (sin límite); soltar o
//   intercambiar una copia se la saca, como cualquier objeto.
// - Con 3 objetos 3D que pasen el control se gana el título de Diseñador (solo reconocimiento).

const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const has = (obj, key) => typeof key === 'string' && Object.hasOwn(obj, key);
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
const IMAGE_MIMES = ['image/jpeg', 'image/webp', 'image/png'];
const LIMITS = { img: 900_000, hd: 2_000_000 }; // bytes
export const DESIGNER_MODELS = 3; // objetos 3D para el título de Diseñador

export function setupDesigns(sql) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS designs (
      id TEXT PRIMARY KEY, author TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
      place TEXT, size TEXT, w INTEGER, h INTEGER, dims TEXT, tris INTEGER, created INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS designs_author ON designs (author, created);
  `);
  const cols = sql.exec('PRAGMA table_info(items)').toArray().map((c) => c.name);
  if (!cols.includes('design')) sql.exec('ALTER TABLE items ADD COLUMN design TEXT');
}

export const designsMethods = {
  // Lo público de un diseño (viaja con el objeto: inventario, suelo, sala, lo que tiene puesto)
  designInfo(id) {
    const d = id && this.sql.exec('SELECT * FROM designs WHERE id = ?', String(id)).toArray()[0];
    if (!d) return null;
    const author = this.row(d.author);
    return {
      ...cleanDesign({ id: d.id, kind: d.kind, title: d.title, place: d.place, size: d.size, w: d.w, h: d.h, dims: d.dims ? JSON.parse(d.dims) : null }),
      author: author ? { id: author.id, name: author.name } : null,
    };
  },

  // ---------- Subir ----------
  async designSubmit(token, f) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    if (this.isGuest(me)) return this.guestError();
    if (!this.env.ART) return { ok: false, error: 'Falta configurar el almacenamiento de archivos (R2).' };
    const kind = f.kind;
    if (!has(DESIGN_KINDS, kind)) return { ok: false, error: 'Elegí si es una estampa, un cuadro o un objeto 3D.' };
    const title = clip(f.title, 60);
    if (!title) return { ok: false, error: 'El diseño necesita un nombre.' };

    const files = [];
    let w = null, h = null, dims = null, tris = null;
    if (kind === 'objeto') {
      const file = f.model;
      if (!file || !(file.data instanceof ArrayBuffer)) return { ok: false, error: 'Falta el modelo 3D (GLB).' };
      const r = checkGLB(file.data);
      if (!r.ok) return r;
      dims = r.size;
      tris = r.tris;
      files.push(['model', { mime: 'model/gltf-binary', data: file.data }]);
    } else {
      // Imagen para el juego (hasta 1024 px); los cuadros pueden traer además la HD (hasta 2048 px)
      for (const [name, max, need] of [['img', LIMITS.img, true], ['hd', LIMITS.hd, false]]) {
        const file = f[name];
        if (!file && !need) continue;
        if (name === 'hd' && kind !== 'cuadro') continue;
        if (!file || !IMAGE_MIMES.includes(file.mime) || !(file.data instanceof ArrayBuffer) || !file.data.byteLength) return { ok: false, error: 'Falta la imagen (JPG, PNG o WebP).' };
        if (file.data.byteLength > max) return { ok: false, error: 'La imagen es demasiado pesada.' };
        if (!isImage(file.mime, file.data)) return { ok: false, error: 'El archivo no es una imagen JPG, PNG o WebP.' };
        files.push([name, file]);
      }
      w = Math.round(Number(f.w)); h = Math.round(Number(f.h));
      if (!(w >= 16 && h >= 16 && w <= DESIGN_IMAGE && h <= DESIGN_IMAGE)) return { ok: false, error: `La imagen tiene que medir entre 16 y ${DESIGN_IMAGE} px.` };
    }
    const place = kind === 'estampa' ? (has(STAMP_PLACES, f.place) ? f.place : 'pecho') : null;
    const size = kind === 'estampa' ? (has(STAMP_SIZES, f.size) ? f.size : 'mediano') : null;

    const id = randomHex(8);
    for (const [name, file] of files) {
      await this.env.ART.put(`disenos/${id}/${name}`, file.data, { httpMetadata: { contentType: file.mime } });
    }
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`INSERT INTO designs (id, author, kind, title, place, size, w, h, dims, tris, created)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, me.id, kind, title, place, size, w, h, dims && JSON.stringify(dims), tris, Date.now());
      this.addDesignItem(me.id, id, kind);
    });
    // Título de Diseñador: 3 objetos 3D que pasaron el control (no se pierde)
    let designer = false;
    if (kind === 'objeto' && !this.hasTitle(me.id, 'disenador')) {
      const n = this.sql.exec("SELECT COUNT(*) AS n FROM designs WHERE author = ? AND kind = 'objeto'", me.id).one().n;
      if (n >= DESIGNER_MODELS) {
        this.sql.exec('INSERT OR IGNORE INTO titles (user_id, title, created) VALUES (?, ?, ?)', me.id, 'disenador', Date.now());
        this.notifyData(me.id, 'title_designer', me.id, {});
        designer = true;
      }
    }
    return { ok: true, id, designer, items: this.items(me.id) };
  },

  addDesignItem(userId, designId, kind) {
    this.sql.exec('INSERT INTO items (iid, owner_id, type, color, created, design) VALUES (?, ?, ?, ?, ?, ?)',
      randomHex(8), userId, DESIGN_ITEM[kind], '#ffffff', Date.now(), designId);
  },

  // ---------- Hacer copia (solo el autor, de un diseño que tenga en el inventario) ----------
  async designCopy(token, iid) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    if (this.isGuest(me)) return this.guestError();
    const item = this.sql.exec('SELECT * FROM items WHERE iid = ? AND owner_id = ?', String(iid ?? ''), me.id).toArray()[0];
    const d = item?.design && this.sql.exec('SELECT * FROM designs WHERE id = ?', item.design).toArray()[0];
    if (!d) return { ok: false, error: 'Ese diseño no está en tu inventario.' };
    if (d.author !== me.id) return { ok: false, error: 'Solo quien hizo el diseño puede hacer copias.' };
    this.addDesignItem(me.id, d.id, d.kind);
    return { ok: true, items: this.items(me.id) };
  },

  // Archivos: los diseños se ven sobre la gente y en las salas, así que son públicos
  designFile(id, name) {
    const d = this.sql.exec('SELECT kind FROM designs WHERE id = ?', String(id ?? '')).toArray()[0];
    if (!d) return null;
    const ok = d.kind === 'objeto' ? name === 'model' : name === 'img' || (name === 'hd' && d.kind === 'cuadro');
    return ok ? `disenos/${String(id)}/${name}` : null;
  },
};
