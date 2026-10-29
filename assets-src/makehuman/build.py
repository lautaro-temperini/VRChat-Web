# Arma el personaje MakeHuman para el juego (se corre dentro de Blender con MPFB 2 instalado).
# Uso desde la consola de Python de Blender (o por el MCP):
#   GENDER = 'masc'   # o 'fem'
#   exec(open(r'E:\Proyectos\VRChat-Web\assets-src\makehuman\build.py', encoding='utf-8').read())
#
# Qué se arma lo dice catalogo.json (sale de server/avatarCatalog.js con `node scripts/catalogo.mjs`).
# Resultado en la escena: el esqueleto "<g>.rig" (huesos con los nombres de Quaternius, en pose T)
# y, colgados de él, el cuerpo, ojos, cejas, pestañas, peinados, barbas, prendas ("<g>_cloth_<id>") y
# accesorios ("<g>_acc_<id>"). Cada malla trae 8 formas (shape keys) "w{0,5,10}_m{0,5,10}" relativas
# al cuerpo promedio (peso 0,5 y músculo 0,5): el juego las mezcla en forma bilineal, igual que los
# macros de MakeHuman. El cuerpo y lo que va en la cabeza traen además los presets de cara
# ("f_<zona>_<id>") y las formas de animal ("a_<id>").
# La exportación está en export.py.
import os
import json
import bpy
import bmesh
import numpy as np
from mathutils import Vector, Matrix, kdtree
from bl_ext.blender_org.mpfb.services.humanservice import HumanService
from bl_ext.blender_org.mpfb.services.targetservice import TargetService
from bl_ext.blender_org.mpfb.services.locationservice import LocationService
from bl_ext.blender_org.mpfb.entities.objectproperties import HumanObjectProperties as H

G = globals().get('GENDER', 'masc')
HERE = r'E:\Proyectos\VRChat-Web\assets-src\makehuman'
CAT = json.load(open(os.path.join(HERE, 'catalogo.json'), encoding='utf-8'))
HAIRS = {  # estilo del juego -> pelo de MakeHuman (decisiones del 24/10 en docs/ROADMAP.md)
    'corto': 'short01', 'largo': 'long01', 'rapado': 'short04', 'rulos': 'afro01',
    'coleta': 'ponytail01', 'trenza': 'braid01', 'bob': 'bob02', 'flequillo': 'short03',
    # Pack Hair 01 (CC0) y short02 del sistema (24/10)
    'despeinado': 'short02', 'melena': 'cortu_shaggy_green_hair', 'revuelto': 'cortu_short_messy_hair',
    'carre': 'cortu_straight_bangs', 'rulitos': 'cortu_strawberry_cloud_hair', 'lacio': 'culturalibre_hair_01',
    'prolijo': 'culturalibre_hair_02', 'jopo': 'culturalibre_hair_05', 'trenzadoble': 'elvs_double_mh_braid',
    'francesa': 'elvs_french_braid_variation', 'rodetetrenzado': 'elvs_reverse_french_braid_bun',
    'francesadespeinada': 'elvs_unkempt_french_braid', 'haciaatras': 'faydaen_hair_1',
    'bobdesfilado': 'littleright_bobcut_hair', 'largodesmechado': 'o4saken_long01', 'rodete': 'rehmanpolanski_hair_bun_brown',
    'vincha': 'sonntag78_blond_with_headband', 'salvaje': 'sonntag78_junglebook_hair', 'bobrecto': 'toigo_blunt_bob',
    'bobrectoflequillo': 'toigo_blunt_bob_with_bangs', 'bobadentro': 'toigo_curled_under_bob',
    'bobadentroflequillo': 'toigo_curled_under_bob_with_bangs', 'bobinvertido': 'toigo_inverted_bob',
    'bobinvertidoflequillo': 'toigo_inverted_bob_with_bangs',
}
BEARDS = {
    'tupida': 'wdg_scruffy_beard', 'completa': 'grinsegold_beard_sigmund_wip',
    'candado': 'culturalibre_faun_beard', 'bigote': 'rehmanpolanski_moustache_viking',
}
LEVELS = {0: 0.0, 5: 0.5, 10: 1.0}
COVER_BITS = 16  # bits por atributo "_cover<n>" (un float guarda enteros exactos hasta 2^24)
HEAD_SLOTS = {'hat', 'glasses', 'head', 'face', 'cuernos'}  # accesorios que siguen la forma de la cara


def asset_of(entry):
    a = entry['asset']
    return a if isinstance(a, str) else a[G]


# Prendas (orden = bits de "_cover", igual que en el juego): id -> (asset de MakeHuman, parte)
CLOTHES = {gid: (asset_of(g), g['part']) for gid, g in CAT['garments'].items()}
GARMENTS = list(CLOTHES)
# Formas extra (presets de cara y premios de animal): nombre de la shape key -> [(archivo, peso)]
MORPHS = {}
for zone, z in CAT['face'].items():
    for oid, o in z['options'].items():
        MORPHS[f'f_{zone}_{oid}'] = o['targets']
for mid, m in CAT['morphs'].items():
    MORPHS[f'a_{mid}'] = m['targets']


def mhclo(kind, name):
    for root, _, files in os.walk(os.path.join(LocationService.get_user_data(kind), name)):
        for f in files:
            if f.endswith('.mhclo'):
                return os.path.join(root, f)
    raise FileNotFoundError(f'{kind}/{name}')


def target_path(t):
    if t.startswith('sys:'):
        return os.path.join(LocationService.get_mpfb_data('targets'), t[4:] + '.target.gz')
    return os.path.join(LocationService.get_user_data('custom'), t + '.target')


def coords(o):
    """Vértices con las shape keys mezcladas, sin modificadores."""
    saved = [(m, m.show_viewport) for m in o.modifiers]
    for m, _ in saved:
        m.show_viewport = False
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    ev = o.evaluated_get(dg)
    me = ev.to_mesh()
    a = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', a)
    ev.to_mesh_clear()
    for m, v in saved:
        m.show_viewport = v
    return a.reshape(-1, 3)


def select_only(o):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = o
    o.select_set(True)


# ---------- 1) Humano, esqueleto y partes ----------
if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

body = HumanService.create_human()
body.name = f'{G}_body'
for k, v in dict(gender=1.0 if G == 'masc' else 0.0, age=0.5, muscle=0.5, weight=0.5, height=0.5, proportions=0.5).items():
    H.set_value(k, v, entity_reference=body)
TargetService.reapply_macro_details(body)
HumanService.add_builtin_rig(body, 'game_engine')
rig = body.parent
rig.name = f'{G}.rig'

parts = {}
head_parts = set()  # partes que reciben las formas de la cara
eyes = os.path.join(LocationService.get_user_data('eyes'), 'low-poly', 'low-poly.mhclo')
for key, kind, path in [('eyes', 'Eyes', eyes), ('brows', 'Eyebrows', mhclo('eyebrows', 'eyebrow001')),
                        ('lashes', 'Eyelashes', mhclo('eyelashes', 'eyelashes01'))]:
    parts[key] = HumanService.add_mhclo_asset(path, body, asset_type=kind, subdiv_levels=0)
    head_parts.add(key)
for style, name in HAIRS.items():
    parts[f'hair_{style}'] = HumanService.add_mhclo_asset(mhclo('hair', name), body, asset_type='Clothes', subdiv_levels=0)
    head_parts.add(f'hair_{style}')
for style, name in BEARDS.items():
    parts[f'beard_{style}'] = HumanService.add_mhclo_asset(mhclo('clothes', name), body, asset_type='Clothes', subdiv_levels=0)
    head_parts.add(f'beard_{style}')
for aid, a in CAT['accessories'].items():
    parts[f'acc_{aid}'] = HumanService.add_mhclo_asset(mhclo('clothes', asset_of(a)), body, asset_type='Clothes', subdiv_levels=0)
    if a['slot'] in HEAD_SLOTS:
        head_parts.add(f'acc_{aid}')
suits = {}  # conjunto de MakeHuman -> objeto (cada uno se carga una sola vez)
for asset, _ in CLOTHES.values():
    if asset not in suits:
        suits[asset] = HumanService.add_mhclo_asset(mhclo('clothes', asset), body, asset_type='Clothes', subdiv_levels=0)
for key, o in parts.items():
    o.name = f'{G}_{key}'


def components(o):
    """Piezas sueltas de una malla: listas de índices de vértices."""
    bmc = bmesh.new()
    bmc.from_mesh(o.data)
    seen, comps = set(), []
    for v in bmc.verts:
        if v.index in seen:
            continue
        stack, comp = [v], []
        while stack:
            x = stack.pop()
            if x.index in seen:
                continue
            seen.add(x.index)
            comp.append(x.index)
            stack.extend(e.other_vert(x) for e in x.link_edges if e.other_vert(x).index not in seen)
        comps.append(comp)
    bmc.free()
    return comps


# Arriba / abajo de cada conjunto (por la altura de cada pieza, comparada con la cadera) y qué
# vértices del cuerpo tapa cada prenda (los grupos "Delete.<conjunto>" de MakeHuman)
hip_z = (rig.matrix_world @ rig.data.bones['pelvis'].head_local).z
suit_side = {}
for asset, so in suits.items():
    co = np.array([v.co for v in so.data.vertices])
    side = np.empty(len(co), object)
    feet = any(a == asset and p == 'feet' for a, p in CLOTHES.values())
    for comp in components(so):
        if feet:
            side[comp] = 'feet'
        elif co[comp, 2].min() < hip_z - 0.25 and co[comp, 2].max() > hip_z + 0.25:
            # Camisa y pantalón en una sola pieza: se corta a la altura de la cadera
            side[comp] = np.where(co[comp, 2] > hip_z, 'top', 'bottom')
        else:
            side[comp] = 'top' if co[comp, 2].mean() > hip_z else 'bottom'
    suit_side[asset] = side


def keeps(asset, part):
    """Qué vértices del conjunto son de la prenda."""
    side = suit_side[asset]
    return np.ones(len(side), bool) if part == 'whole' else side == part


body_co = coords(body)  # con las medidas aplicadas, como la ropa
cover = np.zeros(len(body_co), np.int64)
for bit, (garment, (asset, part)) in enumerate(CLOTHES.items()):
    vg = body.vertex_groups.get(f'Delete.{asset}')
    if not vg:
        continue
    so = suits[asset]
    sco = np.array([v.co for v in so.data.vertices])
    kd_s = kdtree.KDTree(len(sco))
    for i, c in enumerate(sco):
        kd_s.insert(c, i)
    kd_s.balance()
    mine = keeps(asset, part)
    for v in body.data.vertices:
        if any(g.group == vg.index for g in v.groups):
            _, j, _ = kd_s.find(Vector(body_co[v.index]))
            if mine[j]:
                cover[v.index] |= 1 << bit
for asset, so in suits.items():  # los conjuntos siguen como cualquier parte (formas y pose T)
    so.name = f'{G}_suit_{asset}'
    parts[f'suit_{asset}'] = so

# ---------- 2) Las 9 formas (peso x músculo) y las formas extra del cuerpo ----------
states = {}
for w in (0, 5, 10):
    for m in (0, 5, 10):
        H.set_value('weight', LEVELS[w], entity_reference=body)
        H.set_value('muscle', LEVELS[m], entity_reference=body)
        TargetService.reapply_macro_details(body)
        states[f'w{w}_m{m}'] = coords(body)
H.set_value('weight', 0.5, entity_reference=body)
H.set_value('muscle', 0.5, entity_reference=body)
TargetService.reapply_macro_details(body)
extra = {}  # presets de cara y formas de animal (sobre el cuerpo promedio)
for name, targets in MORPHS.items():
    keys = [TargetService.load_target(body, target_path(t), weight=w, name=f'tmp_{name}_{i}') for i, (t, w) in enumerate(targets)]
    extra[name] = coords(body)
    for k in keys:
        body.shape_key_remove(body.data.shape_keys.key_blocks[k.name])
print('formas extra:', len(extra))

# ---------- 3) Cuerpo: base promedio, sin geometría auxiliar, con las formas ----------
select_only(body)
bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
gi = body.vertex_groups['body'].index
keep = np.zeros(len(body.data.vertices), bool)
for v in body.data.vertices:
    if any(g.group == gi and g.weight > 0 for g in v.groups):
        keep[v.index] = True
bm = bmesh.new()
bm.from_mesh(body.data)
bm.verts.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.where(~keep)[0]], context='VERTS')
bm.to_mesh(body.data)
bm.free()
for m in list(body.modifiers):
    if m.type == 'MASK':
        body.modifiers.remove(m)
idx = np.where(keep)[0]
# Qué prendas tapan cada vértice (bits en el orden de GARMENTS, de a 16 por atributo): el juego esconde esa piel
for n in range((len(GARMENTS) + COVER_BITS - 1) // COVER_BITS):
    bits = (cover[idx] >> (n * COVER_BITS)) & ((1 << COVER_BITS) - 1)
    body.data.attributes.new(f'_cover{n}', 'FLOAT', 'POINT').data.foreach_set('value', bits.astype(np.float32))
base = states['w5_m5'][idx]
body.shape_key_add(name='Basis')
for k, st in states.items():
    if k != 'w5_m5':
        body.shape_key_add(name=k, from_mix=False).data.foreach_set('co', st[idx].ravel())
for k, st in extra.items():
    body.shape_key_add(name=k, from_mix=False).data.foreach_set('co', st[idx].ravel())

# ---------- 4) Partes: copian cómo se mueve la piel más cercana ----------
kd = kdtree.KDTree(len(base))
for i, c in enumerate(base):
    kd.insert(c, i)
kd.balance()
for key, o in parts.items():
    for m in list(o.modifiers):
        if m.type == 'MASK':
            o.modifiers.remove(m)
    pc = np.empty(len(o.data.vertices) * 3)
    o.data.vertices.foreach_get('co', pc)
    pc = pc.reshape(-1, 3)
    near = np.array([[j for _, j, _ in kd.find_n(Vector(c), 4)] for c in pc])
    o.shape_key_add(name='Basis')
    shapes = dict(states)
    if key in head_parts:
        shapes.update(extra)
    for k, st in shapes.items():
        if k == 'w5_m5':
            continue
        delta = st[idx] - base
        d = delta[near].mean(axis=1)
        if not np.abs(d).max() > 1e-5:
            continue  # esta forma no mueve esta parte: no se guarda
        o.shape_key_add(name=k, from_mix=False).data.foreach_set('co', (pc + d).ravel())

# ---------- 5) Pose T: brazos horizontales, piernas rectas ----------
meshes = [body] + list(parts.values())
select_only(rig)
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.pose.transforms_clear()


def align(name, target):
    pb = rig.pose.bones[name]
    bpy.context.view_layer.update()
    M = rig.matrix_world @ pb.matrix
    head = M.translation.copy()
    cur = (rig.matrix_world @ pb.tail) - head
    R = cur.normalized().rotation_difference(target.normalized()).to_matrix().to_4x4()
    pb.matrix = rig.matrix_world.inverted() @ (Matrix.Translation(head) @ R @ Matrix.Translation(-head) @ M)
    bpy.context.view_layer.update()


for s, x in (('l', 1), ('r', -1)):
    for b in ('upperarm', 'lowerarm', 'hand'):
        align(f'{b}_{s}', Vector((x, 0, 0)))
    for b in ('thigh', 'calf'):
        align(f'{b}_{s}', Vector((0, 0, -1)))
bpy.ops.object.mode_set(mode='OBJECT')
bpy.context.view_layer.update()


def pose_matrices(o):
    """Por vértice, la matriz de la pose (piel lineal: suma de las matrices de sus huesos por el peso)."""
    arm = next(m for m in o.modifiers if m.type == 'ARMATURE')
    ob_to_arm = rig.matrix_world.inverted() @ o.matrix_world
    bone_m = {}
    for pb in rig.pose.bones:
        bone_m[pb.name] = np.array(ob_to_arm.inverted() @ pb.matrix @ pb.bone.matrix_local.inverted() @ ob_to_arm)
    names = {g.index: g.name for g in o.vertex_groups}
    n = len(o.data.vertices)
    out = np.zeros((n, 4, 4))
    tot = np.zeros(n)
    for v in o.data.vertices:
        for g in v.groups:
            bm_ = bone_m.get(names.get(g.group))
            if bm_ is not None and g.weight > 0:
                out[v.index] += g.weight * bm_
                tot[v.index] += g.weight
    none = tot <= 0
    out[~none] /= tot[~none, None, None]
    out[none] = np.eye(4)
    return arm, out


# Hornear la pose en la malla y en cada forma (la piel es lineal: misma matriz por vértice para todas
# las formas), y dejarla como reposo
for o in meshes:
    arm, M = pose_matrices(o)
    for kb in o.data.shape_keys.key_blocks:
        co = np.empty(len(kb.data) * 3)
        kb.data.foreach_get('co', co)
        co = co.reshape(-1, 3)
        h = np.concatenate([co, np.ones((len(co), 1))], axis=1)
        kb.data.foreach_set('co', np.einsum('nij,nj->ni', M, h)[:, :3].ravel())
    base_co = np.empty(len(o.data.vertices) * 3)
    o.data.shape_keys.key_blocks[0].data.foreach_get('co', base_co)
    o.data.vertices.foreach_set('co', base_co)
    o.data.update()
select_only(rig)
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode='OBJECT')

# ---------- 6) Huesos con los nombres de Quaternius ----------
rig.data.bones['Root'].name = 'root'
rig.data.bones['head'].name = 'Head'

# ---------- 7) Cada prenda en su propia malla (se copia el conjunto y se borra el resto) ----------
for garment, (asset, part) in CLOTHES.items():
    so = suits[asset]
    keep_v = keeps(asset, part)
    go = so.copy()
    go.data = so.data.copy()
    go.name = f'{G}_cloth_{garment}'
    bpy.context.collection.objects.link(go)
    bmg = bmesh.new()
    bmg.from_mesh(go.data)
    bmg.verts.ensure_lookup_table()
    bmesh.ops.delete(bmg, geom=[bmg.verts[i] for i in np.where(~keep_v)[0]], context='VERTS')
    bmg.to_mesh(go.data)
    bmg.free()
    meshes.append(go)
for so in suits.values():
    meshes.remove(so)
    bpy.data.objects.remove(so, do_unlink=True)

for o in meshes:  # todas las formas apagadas (el juego las prende)
    for k in o.data.shape_keys.key_blocks:
        k.value = 0.0
print('listo:', rig.name, len(meshes), 'mallas')
print('cuerpo:', len(body.data.vertices), 'vértices,', sum(len(p.vertices) - 2 for p in body.data.polygons), 'triángulos,',
      len(body.data.shape_keys.key_blocks) - 1, 'formas')
