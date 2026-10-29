# Exporta lo que armó build.py a public/models/makehuman/ (se corre dentro de Blender).
#   GENDER = 'masc'   # o 'fem'
#   exec(open(r'E:\Proyectos\VRChat-Web\assets-src\makehuman\export.py', encoding='utf-8').read())
#
# Salida (glTF con texturas aparte, así el juego puede cambiar a las de 1K en celular):
#   body/<g>.gltf              cuerpo + ojos + cejas + pestañas (con los presets de cara y las formas de animal)
#   hair/<g>/<estilo>.gltf     cada peinado
#   hair/<g>/barba_<tipo>.gltf cada barba
#   clothes/<g>/<prenda>.gltf  cada prenda (gris para teñir; los premios con su textura)
#   acc/<g>/<id>.gltf          cada accesorio (sombreros, anteojos, máscaras, cuernos, colas, alas), con su textura
#   textures/…  y textures/1k/…  (también las 12 cejas brows_<n> y las pieles de premio skin_<id>)
# Todas las mallas usan el mismo esqueleto (mismos huesos en el mismo orden).
import os
import json
import bpy
import bmesh
import numpy as np
from bl_ext.blender_org.mpfb.services.locationservice import LocationService

G = globals().get('GENDER', 'masc')
OUT = r'E:\Proyectos\VRChat-Web\public\models\makehuman'
CAT = json.load(open(r'E:\Proyectos\VRChat-Web\assets-src\makehuman\catalogo.json', encoding='utf-8'))
TEX = os.path.join(OUT, 'textures')
TEX1K = os.path.join(TEX, '1k')
for d in (OUT, TEX, TEX1K, os.path.join(OUT, 'body'), os.path.join(OUT, 'hair', G), os.path.join(OUT, 'clothes', G), os.path.join(OUT, 'acc', G)):
    os.makedirs(d, exist_ok=True)
D = LocationService.get_user_data
SKIN = {'masc': ('young_caucasian_male', 'young_lightskinned_male_diffuse.png'),
        'fem': ('young_caucasian_female', 'young_lightskinned_female_diffuse.png')}[G]


bpy.context.scene.render.image_settings.quality = 88  # calidad de los JPG


def save_img(img, path, size, fmt):
    """Guarda una copia achicada a "size" px como PNG (con transparencia) o JPEG."""
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    c = bpy.data.images.new('tmp_export', w, h, alpha=True)
    c.pixels.foreach_set(px)
    if max(w, h) > size:
        c.scale(int(w * size / max(w, h)), int(h * size / max(w, h)))
    c.filepath_raw = path
    c.file_format = fmt
    c.save()
    bpy.data.images.remove(c)


def texture(src_path, name, gray=False, alpha=False, size=1024, reuse=False):
    """Copia la textura a public/…/textures (y la mitad de tamaño en textures/1k, para celular).
    gray: en gris claro para teñir. alpha: PNG con transparencia; si no, JPEG.
    reuse: si ya está exportada (la otra corrida, del otro cuerpo), no se vuelve a hacer."""
    fmt, ext = ('PNG', '.png') if alpha else ('JPEG', '.jpg')
    path = os.path.join(TEX, name + ext)
    if reuse:  # ya exportada en la corrida del otro cuerpo (en PNG o, si era opaca, en JPEG)
        for e in ('.png', '.jpg'):
            p = os.path.join(TEX, name + e)
            if os.path.exists(p) and os.path.exists(os.path.join(TEX1K, name + e)):
                out = bpy.data.images.load(p, check_existing=False)
                out.name = name + e
                return out
    if True:
        img = bpy.data.images.load(src_path, check_existing=False)
        if alpha:
            # Sin transparencia de verdad: JPEG (pesa varias veces menos)
            px = np.empty(img.size[0] * img.size[1] * 4, np.float32)
            img.pixels.foreach_get(px)
            if px[3::4].min() > 0.98:
                fmt, ext = 'JPEG', '.jpg'
                path = os.path.join(TEX, name + ext)
        if gray:
            px = np.empty(img.size[0] * img.size[1] * 4, np.float32)
            img.pixels.foreach_get(px)
            px = px.reshape(-1, 4)
            lum = px[:, :3] @ np.array([0.299, 0.587, 0.114], np.float32)
            solid = px[:, 3] > 0.5
            mean = float(lum[solid].mean()) if solid.any() else 0.5
            # Gris claro con el detalle de la textura: el juego multiplica por el color elegido
            g = np.clip(lum / max(mean, 1e-3) * 0.8, 0, 1)
            px[:, 0] = px[:, 1] = px[:, 2] = g
            img.pixels.foreach_set(px.ravel())
        save_img(img, path, size, fmt)
        save_img(img, os.path.join(TEX1K, name + ext), size // 2, fmt)
        bpy.data.images.remove(img)
    out = bpy.data.images.load(path, check_existing=False)
    out.name = name + ext
    return out


def material(name, img, alpha=False, rough=0.6, color=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    if img:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        if alpha:
            nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
            try:
                m.surface_render_method = 'BLENDED'
            except Exception:
                m.blend_method = 'BLEND'
    elif color:
        bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return m


def first_image(o):
    for m in o.data.materials:
        if m and m.use_nodes:
            for n in m.node_tree.nodes:
                if n.type == 'TEX_IMAGE' and n.image and n.image.filepath:
                    p = bpy.path.abspath(n.image.filepath)
                    if os.path.exists(p) and not any(w in p.lower() for w in ('normal', 'bump', 'displace', 'spec', 'rough', 'ao.', '_ao')):
                        return p
    return None


def mhmat_color(o):
    """Color difuso del material de MakeHuman (para los accesorios sin textura)."""
    for m in o.data.materials:
        if m and m.use_nodes:
            for n in m.node_tree.nodes:
                if n.type == 'BSDF_PRINCIPLED':
                    return tuple(n.inputs['Base Color'].default_value)[:3]
    return (0.5, 0.5, 0.5)


def assign(o, m):
    o.data.materials.clear()
    o.data.materials.append(m)


def mhmat_diffuse(folder):
    """La textura difusa de un material .mhmat (pieles)."""
    for f in os.listdir(folder):
        if f.endswith('.mhmat'):
            for line in open(os.path.join(folder, f), encoding='utf-8', errors='ignore'):
                parts = line.split(None, 1)
                if len(parts) == 2 and parts[0] == 'diffuseTexture':
                    p = os.path.join(folder, os.path.basename(parts[1].strip()))
                    if os.path.exists(p):
                        return p
    return None


rig = bpy.data.objects[f'{G}.rig']
obj = lambda k: bpy.data.objects[f'{G}_{k}']

# ---------- Materiales ----------
for img in list(bpy.data.images):  # imágenes sin uso que quedaron de corridas anteriores
    if not img.users:
        bpy.data.images.remove(img)
assign(obj('body'), material('Body', texture(os.path.join(D('skins'), *SKIN), f'{G}_skin', size=2048)))
assign(obj('eyes'), material('Eyes', texture(os.path.join(D('eyes'), 'materials', 'brown_eye.png'), 'eyes', size=512), rough=0.2))
assign(obj('brows'), material('Brows', texture(os.path.join(D('eyebrows'), 'eyebrow001', 'eyebrow001.png'), 'brows', gray=True, alpha=True, size=512), alpha=True, rough=0.9))
assign(obj('lashes'), material('Lashes', texture(os.path.join(D('eyelashes'), 'eyelashes01', 'eyelashes01.png'), 'lashes', gray=True, alpha=True, size=512), alpha=True, rough=0.9))
# Las 12 cejas (misma malla, otra textura): el juego cambia la imagen
for b in CAT['brows']:
    texture(os.path.join(D('eyebrows'), b, f'{b}.png'), f'brows_{b}', gray=True, alpha=True, size=512, reuse=True).user_clear()
# Pieles de premio (sin teñir; la UV es la misma para los dos cuerpos)
for sid, s in CAT['skins'].items():
    src = mhmat_diffuse(os.path.join(D('skins'), s['asset']))
    if src:
        texture(src, f'skin_{sid}', size=2048, reuse=True).user_clear()
    print('piel', sid, '<-', src)
for o in [o for o in bpy.data.objects if o.name.startswith(f'{G}_hair_') or o.name.startswith(f'{G}_beard_')]:
    key = o.name[len(G) + 1:]
    src = first_image(o)
    if src:
        assign(o, material(f'Hair_{key}', texture(src, key, gray=True, alpha=True), alpha=True, rough=0.8))
    print(o.name, '<-', src)
# Ropa: textura en gris con su dibujo (el juego la tiñe). El nombre del material dice qué color usa:
# Cloth_top_* (remera/buzo), Cloth_bottom_* (pantalón), Cloth_feet_* (calzado). Los premios, con su
# textura y material Acc_* (no se tiñen)
for o in [o for o in bpy.data.objects if o.name.startswith(f'{G}_cloth_')]:
    garment = o.name[len(G) + 7:]
    g = CAT['garments'][garment]
    prize = 'prize' in g
    src = first_image(o)
    if src:
        # Nombre por el conjunto de MakeHuman: las prendas del mismo conjunto la comparten, y las que tienen un
        # modelo por cuerpo no se pisan
        asset = g['asset'] if isinstance(g['asset'], str) else g['asset'][G]
        tex = texture(src, f'cloth_{asset}', gray=not prize, alpha=True, reuse=True)
        assign(o, material(f'Acc_{garment}' if prize else f'Cloth_{g["slot"]}_{garment}', tex, rough=0.85))
        if g['slot'] == 'feet':
            # Las medias (tubos que suben más allá del tobillo sin tocar el piso) llevan su propio
            # material: siempre blancas
            o.data.materials.append(material(f'Socks_{garment}', tex, rough=0.9))
            bm = bmesh.new()
            bm.from_mesh(o.data)
            seen = set()
            for v in bm.verts:
                if v in seen:
                    continue
                stack, comp = [v], []
                while stack:
                    x = stack.pop()
                    if x in seen:
                        continue
                    seen.add(x)
                    comp.append(x)
                    stack.extend(e.other_vert(x) for e in x.link_edges)
                if max(x.co.z for x in comp) > 0.15 and min(x.co.z for x in comp) > 0.015:
                    for x in comp:
                        for f in x.link_faces:
                            f.material_index = 1
            bm.to_mesh(o.data)
            bm.free()
    else:
        assign(o, material(f'Acc_{garment}' if prize else f'Cloth_{g["slot"]}_{garment}', None, rough=0.85, color=mhmat_color(o)))
    print(o.name, '<-', src)
# Accesorios: con su textura (o su color), sin teñir
for o in [o for o in bpy.data.objects if o.name.startswith(f'{G}_acc_')]:
    aid = o.name[len(G) + 5:]
    src = first_image(o)
    img = texture(src, f'acc_{aid}', alpha=True) if src else None
    m = material(f'Acc_{aid}', img, alpha=bool(img) and img.name.endswith('.png'), rough=0.5, color=mhmat_color(o))
    assign(o, m)
    print(o.name, '<-', src)


# ---------- Exportar ----------
def export(objs, path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    opts = dict(
        filepath=path, export_format='GLTF_SEPARATE', export_texture_dir=os.path.relpath(TEX, os.path.dirname(path)),
        use_selection=True, export_apply=False, export_skins=True, export_morph=True, export_morph_normal=False,
        export_animations=False, export_yup=True, export_extras=False, export_attributes=True)
    try:
        bpy.ops.export_scene.gltf(**opts, export_try_sparse_sk=True)  # formas que mueven poco: solo los vértices que cambian
    except TypeError:
        bpy.ops.export_scene.gltf(**opts)
    print('exportado', path, round(os.path.getsize(path.replace('.gltf', '.bin')) / 1e6, 2), 'MB de geometría')


export([rig, obj('body'), obj('eyes'), obj('brows'), obj('lashes')], os.path.join(OUT, 'body', f'{G}.gltf'))
for o in [o for o in bpy.data.objects if o.name.startswith(f'{G}_hair_') or o.name.startswith(f'{G}_beard_')]:
    key = o.name[len(G) + 1:]
    name = key.replace('hair_', '').replace('beard_', 'barba_')
    export([rig, o], os.path.join(OUT, 'hair', G, f'{name}.gltf'))
for o in [o for o in bpy.data.objects if o.name.startswith(f'{G}_cloth_')]:
    export([rig, o], os.path.join(OUT, 'clothes', G, f'{o.name[len(G) + 7:]}.gltf'))
for o in [o for o in bpy.data.objects if o.name.startswith(f'{G}_acc_')]:
    export([rig, o], os.path.join(OUT, 'acc', G, f'{o.name[len(G) + 5:]}.gltf'))
