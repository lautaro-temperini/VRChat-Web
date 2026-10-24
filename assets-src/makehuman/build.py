# Arma el personaje MakeHuman para el juego (se corre dentro de Blender con MPFB 2 instalado).
# Uso desde la consola de Python de Blender (o por el MCP):
#   GENDER = 'masc'   # o 'fem'
#   exec(open(r'E:\Proyectos\VRChat-Web\assets-src\makehuman\build.py', encoding='utf-8').read())
#
# Resultado en la escena: el esqueleto "<g>.rig" (huesos con los nombres de Quaternius, en pose T)
# y, colgados de él, el cuerpo, ojos, cejas, pestañas, los peinados y las barbas. Cada malla trae
# 8 formas (shape keys) "w{0,5,10}_m{0,5,10}" relativas al cuerpo promedio (peso 0,5 y músculo 0,5):
# el juego las mezcla en forma bilineal, igual que los macros de MakeHuman.
# La exportación está en export.py.
import os
import bpy
import bmesh
import numpy as np
from mathutils import Vector, Matrix, kdtree
from bl_ext.blender_org.mpfb.services.humanservice import HumanService
from bl_ext.blender_org.mpfb.services.targetservice import TargetService
from bl_ext.blender_org.mpfb.services.locationservice import LocationService
from bl_ext.blender_org.mpfb.entities.objectproperties import HumanObjectProperties as H

G = globals().get('GENDER', 'masc')
HAIRS = {  # estilo del juego -> pelo de MakeHuman (decisiones del 24/10 en docs/ROADMAP.md)
    'corto': 'short01', 'largo': 'long01', 'rapado': 'short04', 'rulos': 'afro01',
    'coleta': 'ponytail01', 'trenza': 'braid01', 'bob': 'bob02', 'flequillo': 'short03',
}
BEARDS = {
    'tupida': 'wdg_scruffy_beard', 'completa': 'grinsegold_beard_sigmund_wip',
    'candado': 'culturalibre_faun_beard', 'bigote': 'rehmanpolanski_moustache_viking',
}
LEVELS = {0: 0.0, 5: 0.5, 10: 1.0}


def mhclo(kind, name):
    for root, _, files in os.walk(os.path.join(LocationService.get_user_data(kind), name)):
        for f in files:
            if f.endswith('.mhclo'):
                return os.path.join(root, f)
    raise FileNotFoundError(f'{kind}/{name}')


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
eyes = os.path.join(LocationService.get_user_data('eyes'), 'low-poly', 'low-poly.mhclo')
for key, kind, path in [('eyes', 'Eyes', eyes), ('brows', 'Eyebrows', mhclo('eyebrows', 'eyebrow001')),
                        ('lashes', 'Eyelashes', mhclo('eyelashes', 'eyelashes01'))]:
    parts[key] = HumanService.add_mhclo_asset(path, body, asset_type=kind, subdiv_levels=0)
for style, name in HAIRS.items():
    parts[f'hair_{style}'] = HumanService.add_mhclo_asset(mhclo('hair', name), body, asset_type='Clothes', subdiv_levels=0)
for style, name in BEARDS.items():
    parts[f'beard_{style}'] = HumanService.add_mhclo_asset(mhclo('clothes', name), body, asset_type='Clothes', subdiv_levels=0)
for key, o in parts.items():
    o.name = f'{G}_{key}'

# ---------- 2) Las 9 formas (peso x músculo) del cuerpo ----------
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

# ---------- 3) Cuerpo: base promedio, sin geometría auxiliar, con las 8 formas ----------
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
base = states['w5_m5'][idx]
body.shape_key_add(name='Basis')
for k, st in states.items():
    if k != 'w5_m5':
        body.shape_key_add(name=k, from_mix=False).data.foreach_set('co', st[idx].ravel())

# ---------- 4) Partes: copian cómo se mueve la piel más cercana ----------
kd = kdtree.KDTree(len(base))
for i, c in enumerate(base):
    kd.insert(c, i)
kd.balance()
for o in parts.values():
    for m in list(o.modifiers):
        if m.type == 'MASK':
            o.modifiers.remove(m)
    pc = np.empty(len(o.data.vertices) * 3)
    o.data.vertices.foreach_get('co', pc)
    pc = pc.reshape(-1, 3)
    near = [[j for _, j, _ in kd.find_n(Vector(c), 4)] for c in pc]
    o.shape_key_add(name='Basis')
    for k, st in states.items():
        if k == 'w5_m5':
            continue
        delta = st[idx] - base
        d = np.array([delta[n].mean(axis=0) for n in near])
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

# Hornear la pose en la malla y en cada forma, y dejarla como reposo
for o in meshes:
    select_only(o)
    arm = next(m for m in o.modifiers if m.type == 'ARMATURE')
    kb = o.data.shape_keys.key_blocks
    names = [k.name for k in kb]
    for n in names:
        for k in kb:
            k.value = 0.0
        if n != 'Basis':
            kb[n].value = 1.0
        bpy.ops.object.modifier_apply_as_shapekey(keep_modifier=True, modifier=arm.name)
        kb[-1].name = 'T_' + n
    for n in names[1:]:
        o.active_shape_key_index = kb.find(n)
        bpy.ops.object.shape_key_remove()
    o.active_shape_key_index = kb.find('T_Basis')
    bpy.ops.object.shape_key_move(type='TOP')
    o.active_shape_key_index = kb.find('Basis')
    bpy.ops.object.shape_key_remove()
    for k in kb:
        if k.name.startswith('T_'):
            k.name = k.name[2:]
        k.relative_key = kb[0]
        k.value = 0.0
select_only(rig)
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode='OBJECT')

# ---------- 6) Huesos con los nombres de Quaternius ----------
rig.data.bones['Root'].name = 'root'
rig.data.bones['head'].name = 'Head'

print('listo:', rig.name, [o.name for o in meshes])
print('cuerpo:', len(body.data.vertices), 'vértices,', sum(len(p.vertices) - 2 for p in body.data.polygons), 'triángulos')
