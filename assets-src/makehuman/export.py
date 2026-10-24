# Exporta lo que armó build.py a public/models/makehuman/ (se corre dentro de Blender).
#   GENDER = 'masc'   # o 'fem'
#   exec(open(r'E:\Proyectos\VRChat-Web\assets-src\makehuman\export.py', encoding='utf-8').read())
#
# Salida (glTF con texturas aparte, así el juego puede cambiar a las de 1K en celular):
#   body/<g>.gltf             cuerpo + ojos + cejas + pestañas
#   hair/<g>/<estilo>.gltf    cada peinado
#   hair/<g>/barba_<tipo>.gltf cada barba
#   textures/…  y textures/1k/…
# Todas las mallas usan el mismo esqueleto (mismos huesos en el mismo orden).
import os
import bpy
import numpy as np
from bl_ext.blender_org.mpfb.services.locationservice import LocationService

G = globals().get('GENDER', 'masc')
OUT = r'E:\Proyectos\VRChat-Web\public\models\makehuman'
TEX = os.path.join(OUT, 'textures')
TEX1K = os.path.join(TEX, '1k')
for d in (OUT, TEX, TEX1K, os.path.join(OUT, 'body'), os.path.join(OUT, 'hair', G)):
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
        c.scale(size, size)
    c.filepath_raw = path
    c.file_format = fmt
    c.save()
    bpy.data.images.remove(c)


def texture(src_path, name, gray=False, alpha=False, size=1024):
    """Copia la textura a public/…/textures (y la mitad de tamaño en textures/1k, para celular).
    gray: pelo en gris claro para teñir. alpha: PNG con transparencia; si no, JPEG."""
    fmt, ext = ('PNG', '.png') if alpha else ('JPEG', '.jpg')
    img = bpy.data.images.load(src_path, check_existing=False)
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
    path = os.path.join(TEX, name + ext)
    save_img(img, path, size, fmt)
    save_img(img, os.path.join(TEX1K, name + ext), size // 2, fmt)
    bpy.data.images.remove(img)
    out = bpy.data.images.load(path, check_existing=False)
    out.name = name + ext
    return out


def material(name, img, alpha=False, rough=0.6):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    if alpha:
        nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            m.blend_method = 'BLEND'
    bsdf.inputs['Roughness'].default_value = rough
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return m


def first_image(o):
    for m in o.data.materials:
        if m and m.use_nodes:
            for n in m.node_tree.nodes:
                if n.type == 'TEX_IMAGE' and n.image and n.image.filepath:
                    p = bpy.path.abspath(n.image.filepath)
                    if os.path.exists(p) and 'normal' not in p.lower() and 'bump' not in p.lower():
                        return p
    return None


def assign(o, m):
    o.data.materials.clear()
    o.data.materials.append(m)


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
for o in [o for o in bpy.data.objects if o.name.startswith(f'{G}_hair_') or o.name.startswith(f'{G}_beard_')]:
    key = o.name[len(G) + 1:]
    src = first_image(o)
    if src:
        assign(o, material(f'Hair_{key}', texture(src, key, gray=True, alpha=True), alpha=True, rough=0.8))
    print(o.name, '<-', src)


# ---------- Exportar ----------
def export(objs, path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLTF_SEPARATE', export_texture_dir=os.path.relpath(TEX, os.path.dirname(path)),
        use_selection=True, export_apply=False, export_skins=True, export_morph=True, export_morph_normal=False,
        export_animations=False, export_yup=True, export_extras=False)
    print('exportado', path, round(os.path.getsize(path.replace('.gltf', '.bin')) / 1e6, 2), 'MB de geometría')


export([rig, obj('body'), obj('eyes'), obj('brows'), obj('lashes')], os.path.join(OUT, 'body', f'{G}.gltf'))
for o in [o for o in bpy.data.objects if o.name.startswith(f'{G}_hair_') or o.name.startswith(f'{G}_beard_')]:
    key = o.name[len(G) + 1:]
    name = key.replace('hair_', '').replace('beard_', 'barba_')
    export([rig, o], os.path.join(OUT, 'hair', G, f'{name}.gltf'))
