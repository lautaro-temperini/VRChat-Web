import { FURNITURE, ROOM_TEMPLATES, ROOM_MAX_PIECES, TEMPLATE_PIECES, PUBLIC_MAPS, cleanPiece } from './shared.js';

const has = (obj, key) => typeof key === 'string' && Object.hasOwn(obj, key);

// Editor de salas: la plantilla y los muebles de cada sala personal (u-<id>).
// - roomEditorMethods se mezcla en Room (room.js): guarda el diseño en el storage de la sala,
//   valida los cambios (solo el dueño edita) y se los manda a todos.
// - accountsEditorMethods se mezcla en Accounts (accounts.js): los muebles especiales salen del
//   inventario al ponerlos (dueño = "room:<id>") y vuelven al levantarlos o al cambiar de plantilla.
//
// Diseño guardado: { template, pieces: [mueble limpio de cleanPiece], chosen }
// chosen = false mientras el dueño no eligió plantilla (hasta entonces se ve el loft).

// Entrada de las salas personales (todas las plantillas tienen la puerta al sur)
export const ROOM_SPAWN = { x: 0, z: 4 };

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);

export function templateLayout(template, chosen = true) {
  const pieces = (TEMPLATE_PIECES[template] ?? []).map(([type, x, z, deg, y]) =>
    cleanPiece({ id: newId(), type, x, z, y, r: (deg * Math.PI) / 180 }, template));
  return { template, pieces, chosen };
}

export const roomEditorMethods = {
  async layout() {
    if (this.roomLayout) return this.roomLayout;
    if (!(await this.ownerId())) {
      // Mapas públicos: diseño fijo (ids estables, nadie los edita); el Museo no tiene
      const map = PUBLIC_MAPS[await this.roomName()];
      if (!map) return null;
      const pieces = map.pieces.map(([type, x, z, deg, y, w], i) => cleanPiece({ id: `m${i}`, type, x, z, y, r: (deg * Math.PI) / 180, ...(type === 'pantalla' ? { w: w ?? 4, m: 'espejo' } : {}) }, map.template)).filter(Boolean);
      this.roomLayout = { template: map.template, pieces, chosen: true, fixed: true };
      return this.roomLayout;
    }
    this.roomLayout = (await this.ctx.storage.get('layout')) ?? templateLayout('loft', false);
    return this.roomLayout;
  },

  async saveLayout() {
    await this.ctx.storage.put('layout', this.roomLayout);
  },

  // Mensaje { t: 'edit', op: 'template' | 'add' | 'update' | 'remove', ... }
  async editMessage(ws, meta, msg) {
    const owner = await this.ownerId();
    if (!owner || meta.userId !== owner || meta.guest) return this.notice(ws, 'Solo el dueño puede editar esta sala.');
    const layout = await this.layout();
    // Si falla, el cliente deshace lo que ya mostró (piece: cómo quedó el mueble en la sala)
    const fail = (text, piece) => { this.send(ws, { t: 'edit-fail', op: msg.op, id: msg.op === 'add' ? msg.piece?.id : msg.id, piece }); return this.notice(ws, text); };

    if (msg.op === 'template') {
      if (!has(ROOM_TEMPLATES, msg.template) || ROOM_TEMPLATES[msg.template].public) return;
      // Los especiales vuelven al inventario; los básicos se borran (la plantilla trae los suyos)
      // (primero se cambia la sala y después se devuelven: así nada queda puesto y en el inventario a la vez)
      const iids = layout.pieces.filter((p) => p.iid).map((p) => p.iid);
      this.roomLayout = templateLayout(msg.template);
      this.ceil = null; // otra plantilla, otro techo
      await this.saveLayout();
      await this.gearCheck();
      if (iids.length) await this.accounts().furnitureReturn(owner, iids);
      this.broadcast({ t: 'layout', layout: this.roomLayout, back: iids.length });
      return;
    }
    if (!layout.chosen) return fail('Primero elegí la plantilla de tu sala.');

    if (msg.op === 'add') {
      if (!has(FURNITURE, msg.piece?.type)) return;
      const def = FURNITURE[msg.piece.type];
      // Los muebles de los mapas públicos (hidden) no se ponen en salas propias (la barra del café regala café)
      if (def.hidden) return fail('Ese mueble no está en el catálogo.');
      if (layout.pieces.length >= ROOM_MAX_PIECES) return fail(`Llegaste al máximo de ${ROOM_MAX_PIECES} objetos en la sala.`);
      if (def.max && layout.pieces.filter((p) => p.type === msg.piece.type).length >= def.max) {
        return fail(`"${def.name}": puede haber ${def.max === 1 ? 'uno solo' : `hasta ${def.max}`} por sala.`);
      }
      const piece = cleanPiece({ ...msg.piece, id: newId() }, layout.template);
      if (!piece) return;
      if (piece.photo && !(await this.accounts().photoPublic(owner, piece.photo))) delete piece.photo;
      if (def.special) {
        const r = await this.accounts().furnitureTake(owner, piece.iid, piece.type);
        if (!r.ok) return fail(r.error);
        if (def.design) piece.design = r.design; // lo pone la cuenta, no el cliente
      }
      // Mientras se esperaba a la cuenta pudo cambiar la sala (otra pestaña, otra plantilla): se vuelve a mirar
      const full = this.roomLayout !== layout || layout.pieces.length >= ROOM_MAX_PIECES
        || (def.max && layout.pieces.filter((p) => p.type === piece.type).length >= def.max);
      if (full) {
        if (def.special) await this.accounts().furnitureReturn(owner, [piece.iid]);
        return fail(this.roomLayout !== layout ? 'La sala cambió: probá de nuevo.' : 'No entra: la sala ya está llena.');
      }
      layout.pieces.push(piece);
      await this.saveLayout();
      this.broadcast({ t: 'piece', piece, tmp: String(msg.piece.id ?? '').slice(0, 12) });
      return;
    }

    if (msg.op !== 'update' && msg.op !== 'remove') return;
    const i = layout.pieces.findIndex((p) => p.id === msg.id);
    if (i < 0) return fail('Ese objeto ya no está.');
    const cur = layout.pieces[i];

    if (msg.op === 'update') {
      // El tipo y el objeto del inventario no cambian; el resto sí (posición, giro, color, foto, pantalla)
      const next = cleanPiece({ ...cur, ...msg.piece, id: cur.id, type: cur.type, iid: cur.iid, design: cur.design }, layout.template);
      if (!next) return;
      if (next.photo && next.photo !== cur.photo && !(await this.accounts().photoPublic(owner, next.photo))) {
        return fail('Esa foto no se puede colgar: tu galería tiene que estar visible para todos.', cur);
      }
      // Después de esperar a la cuenta el mueble puede haberse movido de lugar en la lista (o ya no estar)
      const j = this.roomLayout === layout ? layout.pieces.indexOf(cur) : -1;
      if (j < 0) return fail('Ese objeto ya no está.');
      layout.pieces[j] = next;
      await this.saveLayout();
      this.broadcast({ t: 'piece', piece: next });
    } else if (msg.op === 'remove') {
      layout.pieces.splice(i, 1);
      await this.saveLayout();
      if (cur.iid) await this.accounts().furnitureReturn(owner, [cur.iid]);
      await this.saveLayout();
      this.broadcast({ t: 'piece-', id: cur.id, back: !!cur.iid });
      if (['cabina', 'consola', 'pantalla'].includes(cur.type)) await this.gearCheck();
    }
  },
};

export const accountsEditorMethods = {
  // Pone un mueble especial en la sala: deja el inventario (como los objetos en el suelo)
  async furnitureTake(userId, iid, type) {
    const item = this.sql.exec('SELECT * FROM items WHERE iid = ? AND owner_id = ?', String(iid ?? ''), userId).toArray()[0];
    if (!item || item.type !== type) return { ok: false, error: 'Ese mueble no está en tu inventario.' };
    this.sql.exec('UPDATE items SET owner_id = ?, equipped = 0 WHERE iid = ?', `room:${userId}`, item.iid);
    return { ok: true, design: item.design ? this.designInfo(item.design) : null };
  },

  // Devuelve muebles especiales puestos en la sala al inventario de su dueño
  async furnitureReturn(userId, iids) {
    for (const iid of iids ?? []) {
      this.sql.exec('UPDATE items SET owner_id = ? WHERE iid = ? AND owner_id = ?', userId, String(iid), `room:${userId}`);
    }
    return { ok: true };
  },

  // ¿Se puede colgar esta foto en la sala? Tiene que ser del dueño y su galería visible para todos
  async photoPublic(ownerId, photoId) {
    const p = this.sql.exec('SELECT owner FROM photos WHERE id = ?', String(photoId ?? '')).toArray()[0];
    return !!p && p.owner === ownerId && this.row(ownerId)?.gallery_privacy === 'todos';
  },
};
