// Carga de modelos 3D compartida (mundo, editor de salas, personaje, obras del Museo).
// Entiende los .glb/.gltf comprimidos, que pesan bastante menos para bajar desde el celular:
//   - Draco y meshopt (geometría): Blender y gltf-transform los exportan así
//   - KTX2 / Basis (texturas): ocupan mucha menos memoria de video que un PNG o JPG
// Nada de esto viaja en la carga inicial: el código se baja la primera vez que se abre un modelo,
// y los decodificadores (wasm) recién cuando un archivo los necesita. Vite los copia solo desde
// node_modules/three (los loaders los referencian con new URL(..., import.meta.url)).
//
//   import { loadGLTF, setLoaderRenderer } from './loaders.js';
//   setLoaderRenderer(renderer);              // una vez, al crear el renderer (para KTX2)
//   const gltf = await loadGLTF(url);         // o parseGLTF(arrayBuffer)

let ktx2 = null, gltf = null, renderer = null;

// KTX2 necesita saber qué formatos comprimidos entiende la placa de video
export function setLoaderRenderer(r) {
  renderer = r;
  if (ktx2) ktx2.detectSupport(r);
}

export function gltfLoader() {
  gltf ??= Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/loaders/DRACOLoader.js'),
    import('three/addons/loaders/KTX2Loader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ]).then(([{ GLTFLoader }, { DRACOLoader }, { KTX2Loader }, { MeshoptDecoder }]) => {
    ktx2 = new KTX2Loader();
    if (renderer) ktx2.detectSupport(renderer);
    return new GLTFLoader()
      .setDRACOLoader(new DRACOLoader())
      .setKTX2Loader(ktx2)
      .setMeshoptDecoder(MeshoptDecoder);
  });
  return gltf;
}

export async function loadGLTF(url, onProgress) {
  return (await gltfLoader()).loadAsync(url, onProgress);
}

export async function parseGLTF(data, path = '') {
  return (await gltfLoader()).parseAsync(data, path);
}
