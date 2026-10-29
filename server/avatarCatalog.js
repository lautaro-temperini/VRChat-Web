// Catálogo de lo que se arma con MakeHuman para el personaje (decisiones del 24 y 29/10 en docs/ROADMAP.md).
// Lo leen el juego (shared.js, avatar.js) y Blender (assets-src/makehuman/build.py, por medio de
// catalogo.json: después de cambiar este archivo, correr `node scripts/catalogo.mjs`).
//
// asset: carpeta de MPFB (en clothes/ o skins/), o { masc, fem } si hay una por cuerpo.
// part (prendas): 'top' | 'bottom' | 'feet' | 'whole' — los conjuntos vienen en una sola malla y se corta
//   la parte de arriba de la de abajo; 'whole' se usa entera.
// prize: rareza si es un premio (objeto del inventario); sin prize, se elige libre en el editor.
// Rarezas de los premios PROVISORIAS (29/10), como las demás.

const MF = (masc, fem) => ({ masc, fem });

// Prendas (en el editor: arriba, abajo y calzado; los premios de calzado reemplazan al elegido).
// El orden es el de los bits de "_cover" (qué piel tapa cada una): agregar siempre al final.
export const MH_GARMENTS = {
  remera: { slot: 'top', name: 'Remera', asset: 'male_casualsuit06', part: 'top' },
  mangalarga: { slot: 'top', name: 'Manga larga', asset: 'male_casualsuit02', part: 'top' },
  camisa: { slot: 'top', name: 'Camisa', asset: 'male_casualsuit01', part: 'top' },
  campera: { slot: 'top', name: 'Campera', asset: 'male_casualsuit05', part: 'top' },
  jean: { slot: 'bottom', name: 'Jean', asset: 'male_casualsuit06', part: 'bottom' },
  short: { slot: 'bottom', name: 'Short', asset: 'female_casualsuit02', part: 'bottom' },
  calza: { slot: 'bottom', name: 'Calza', asset: 'female_sportsuit01', part: 'bottom' },
  pollera: { slot: 'bottom', name: 'Pollera', asset: 'female_elegantsuit01', part: 'bottom' },
  zapatillas: { slot: 'feet', name: 'Zapatillas', asset: 'shoes05', part: 'feet' },
  botas: { slot: 'feet', name: 'Botas', asset: MF('toigo_ankle_boots_male', 'toigo_ankle_boots_female'), part: 'feet' },
  zapatos: { slot: 'feet', name: 'Zapatos', asset: 'shoes04', part: 'feet' },
  // 29/10: lo que ya estaba instalado y los packs de la comunidad (CC0 y CC-BY, ver docs/creditos-makehuman.txt)
  camisaRayada: { slot: 'top', name: 'Camisa rayada', asset: 'male_casualsuit03', part: 'top' },
  saco: { slot: 'top', name: 'Saco', asset: 'male_elegantsuit01', part: 'top' },
  chomba: { slot: 'top', name: 'Chomba', asset: 'namuhekam_male_polo_shirt', part: 'top' },
  remeraMetida: { slot: 'top', name: 'Remera metida', asset: 'toigo_basic_tucked_t-shirt', part: 'top' },
  remeraHolgada: { slot: 'top', name: 'Remera holgada', asset: MF('elvs_crude_t-shirt_male', 'joepal_crude_t-shirt_female'), part: 'top' },
  musculosa: { slot: 'top', name: 'Musculosa', asset: 'toigo_keyhole_tank_top', part: 'top' },
  topBreteles: { slot: 'top', name: 'Top de breteles', asset: 'toigo_camisole_top', part: 'top' },
  pulover: { slot: 'top', name: 'Pulóver', asset: 'toigo_fisherman_sweater', part: 'top' },
  cuelloAlto: { slot: 'top', name: 'Top cuello alto', asset: 'toigo_turtleneck_halter_top', part: 'top' },
  corset: { slot: 'top', name: 'Corset', asset: 'toigo_bodice-style_top', part: 'top' },
  topStrapless: { slot: 'top', name: 'Top strapless', asset: 'skalldyrssuppe_tube_top_funky_colors', part: 'top' },
  pantalonVestir: { slot: 'bottom', name: 'Pantalón de vestir', asset: 'male_elegantsuit01', part: 'bottom' },
  jardinero: { slot: 'bottom', name: 'Jardinero', asset: 'male_worksuit01', part: 'whole' },
  cargo: { slot: 'bottom', name: 'Cargo', asset: 'cortu_cargo_pants', part: 'bottom' },
  shortJean: { slot: 'bottom', name: 'Short de jean', asset: 'cortu_jeans_shorts', part: 'bottom' },
  pantalonLana: { slot: 'bottom', name: 'Pantalón de lana', asset: 'toigo_wool_pants', part: 'bottom' },
  bombacha: { slot: 'bottom', name: 'Pantalón bombacha', asset: 'toigo_harem_pants', part: 'bottom' },
  minifalda: { slot: 'bottom', name: 'Minifalda', asset: 'frankyaye_mini_skirt_01', part: 'bottom' },
  minifaldaTablas: { slot: 'bottom', name: 'Minifalda tableada', asset: 'frankyaye_mini_skirt_02', part: 'bottom' },
  polleraLarga: { slot: 'bottom', name: 'Pollera larga', asset: 'toigo_long_full_skirt', part: 'bottom' },
  polleraVolado: { slot: 'bottom', name: 'Pollera con volado', asset: 'toigo_skirt_with_lace_ruffle', part: 'bottom' },
  miniEscalonada: { slot: 'bottom', name: 'Mini escalonada', asset: 'toigo_tiered_mini_skirt', part: 'bottom' },
  polleraEscalonada: { slot: 'bottom', name: 'Pollera escalonada', asset: 'toigo_tiered_skirt', part: 'bottom' },
  mocasines: { slot: 'feet', name: 'Mocasines', asset: 'shoes01', part: 'feet' },
  zapatillasUrbanas: { slot: 'feet', name: 'Zapatillas urbanas', asset: 'shoes02', part: 'feet' },
  borcegos: { slot: 'feet', name: 'Borcegos', asset: 'shoes03', part: 'feet' },
  zapatillasLona: { slot: 'feet', name: 'Zapatillas de lona', asset: 'shoes06', part: 'feet' },
  guillerminas: { slot: 'feet', name: 'Guillerminas', asset: 'cortu_t-bar', part: 'feet' },
  bucaneras: { slot: 'feet', name: 'Bucaneras', asset: 'cortu_floppy_overknee_shoes', part: 'feet' },
  botasLluvia: { slot: 'feet', name: 'Botas de lluvia', asset: 'scailman_semitransparent_water_boots', part: 'feet' },
  bicolor: { slot: 'feet', name: 'Zapatos bicolor', asset: 'callharvey3d_harvey_saddleshoes1', part: 'feet' },
  zapatillasAltas: { slot: 'feet', name: 'Zapatillas altas', asset: 'culturalibre_sneakers', part: 'feet' },
  chatitas: { slot: 'feet', name: 'Chatitas', asset: 'toigo_ballet_flats', part: 'feet' },
  chatitasMono: { slot: 'feet', name: 'Chatitas con moño', asset: 'toigo_ballet_flats_with_bows', part: 'feet' },
  chatitasFlores: { slot: 'feet', name: 'Chatitas con flores', asset: 'toigo_ballet_flats_with_flowers', part: 'feet' },
  maryJane: { slot: 'feet', name: 'Mary Jane', asset: 'dressupdoc_maryjane1', part: 'feet' },
  sandalias: { slot: 'feet', name: 'Sandalias', asset: 'dressupdoc_sandals1', part: 'feet' },
  oxford: { slot: 'feet', name: 'Oxford', asset: MF('mindfront_shoes_oxford_male', 'mindfront_shoes_oxford_female'), part: 'feet' },
  hebilla: { slot: 'feet', name: 'Zapatos con hebilla', asset: MF('mindfront_shoes_monk_strap_male', 'mindfront_shoes_monk_strap_female'), part: 'feet' },
  zapatillasComodas: { slot: 'feet', name: 'Zapatillas cómodas', asset: 'punkduck_comfortable_sneakers', part: 'feet' },
  running: { slot: 'feet', name: 'Zapatillas de correr', asset: 'punkduck_running_shoes_01', part: 'feet' },
  tenis: { slot: 'feet', name: 'Zapatillas de tenis', asset: 'punkduck_tennis_shoes', part: 'feet' },
  ciclismo: { slot: 'feet', name: 'Zapatillas de ciclismo', asset: 'punkduck_cycling_shoes', part: 'feet' },
  ojotas: { slot: 'feet', name: 'Ojotas', asset: 'elvs_male_flip_flop_sandals1', part: 'feet' },
  // Premios: calzado exótico
  botasHeroe: { slot: 'feet', name: 'Botas de superhéroe', asset: MF('culturalibre_hero_boots_1', 'culturalibre_heroine_boots_1'), part: 'feet', prize: 'raro' },
  botasHeroeAzul: { slot: 'feet', name: 'Botas de superhéroe azules', asset: MF('culturalibre_hero_boots_2', 'culturalibre_heroine_boots_2'), part: 'feet', prize: 'raro' },
  botasRayadas: { slot: 'feet', name: 'Botas rayadas', asset: 'culturalibre_hero_boots_5', part: 'feet', prize: 'raro' },
  botasGogo: { slot: 'feet', name: 'Botas gogó con plataforma', asset: 'scailman_gogo_platform_boots', part: 'feet', prize: 'exotico' },
  zapatosDuende: { slot: 'feet', name: 'Zapatos de duende', asset: 'elvs_basic_felt_elf_shoes', part: 'feet', prize: 'raro' },
  zapatillasKillBill: { slot: 'feet', name: 'Zapatillas de karateca', asset: 'punkduck_kill_bill_shoes', part: 'feet', prize: 'raro' },
};

// Accesorios: no tapan piel. En el editor: sombrero y anteojos; premios: cabeza, cara, cuernos, cola y alas.
// slot de premio = lugar del inventario (uno por lugar, igual que los objetos de siempre); hideHair: tapa todo el pelo
export const MH_ACCESSORIES = {
  fedora: { slot: 'hat', name: 'Fedora', asset: 'fedora01' },
  fedoraLadeado: { slot: 'hat', name: 'Fedora ladeado', asset: 'fedora_cocked' },
  boina: { slot: 'hat', name: 'Gorra de canillita', asset: 'jujube_newsboy_cap' },
  cloche: { slot: 'hat', name: 'Sombrero campana', asset: 'aethelraed_unraed_cloche_hat' },
  anteojosMarco: { slot: 'glasses', name: 'Marco grueso', asset: 'spamrakuen_sagerfrogs_glasses_01' },
  anteojosCuadrados: { slot: 'glasses', name: 'Cuadrados', asset: 'spamrakuen_sagerfrogs_glasses_02' },
  anteojosGrandes: { slot: 'glasses', name: 'Grandes', asset: 'spamrakuen_sagerfrogs_glasses_03' },
  anteojosOvalados: { slot: 'glasses', name: 'Ovalados', asset: 'spamrakuen_sagerfrogs_glasses_04' },
  anteojosFinos: { slot: 'glasses', name: 'Marco fino', asset: 'spamrakuen_tbm_glasses_frames_01' },
  anteojosLectura: { slot: 'glasses', name: 'De lectura', asset: 'kwnet_at_optical_glasses' },
  anteojosBiblioteca: { slot: 'glasses', name: 'De biblioteca', asset: 'frankyaye_glasses_library_male' },
  // Premios (cabeza = mismo lugar que la gorra; cara = mismo lugar que los anteojos de sol)
  gorroNavidad: { slot: 'head', name: 'Gorro de Navidad', asset: 'joepal_xmas_cap', prize: 'basico' },
  sombreroTio: { slot: 'head', name: 'Sombrero del tío', asset: 'grinsegold_uncle_joshis_hat', prize: 'raro' },
  bolsaCabeza: { slot: 'head', name: 'Bolsa en la cabeza', asset: 'jujube_bag_on_head', prize: 'raro', hideHair: true },
  capucha: { slot: 'head', name: 'Capucha de superhéroe', asset: 'culturalibre_hero-heroine_hood_1', prize: 'raro', hideHair: true },
  capuchaOrejas: { slot: 'head', name: 'Capucha con orejas', asset: 'culturalibre_hero-heroine_hood_2', prize: 'exotico', hideHair: true },
  lentes3d: { slot: 'face', name: 'Lentes 3D', asset: 'ews_3d_glasses', prize: 'basico' },
  anteojosLeopardo: { slot: 'face', name: 'Anteojos de leopardo', asset: 'toigo_round_glasses_leopard', prize: 'raro' },
  anteojosCientifico: { slot: 'face', name: 'Anteojos de científico', asset: 'culturalibre_doc_ock_glasses', prize: 'exotico' },
  antifaz: { slot: 'face', name: 'Antifaz', asset: 'culturalibre_hero_mask_1', prize: 'raro' },
  antifazHeroina: { slot: 'face', name: 'Antifaz de heroína', asset: 'culturalibre_heroine_mask_1', prize: 'raro' },
  mascaraHeroe: { slot: 'face', name: 'Máscara de héroe', asset: 'culturalibre_hero_mask_3', prize: 'raro' },
  mascaraOjos: { slot: 'face', name: 'Máscara de ojos', asset: 'culturalibre_hero_mask_4', prize: 'raro' },
  barbijo: { slot: 'face', name: 'Barbijo', asset: 'joepal_medical_mouth_protection', prize: 'basico' },
  cuernosFauno: { slot: 'cuernos', name: 'Cuernos de fauno', asset: 'culturalibre_faun_horns', prize: 'exotico' },
  cuernosMinotauro: { slot: 'cuernos', name: 'Cuernos de minotauro', asset: 'culturalibre_minotaur_horns', prize: 'raro' },
  cuernosDragona: { slot: 'cuernos', name: 'Cuernos de dragona', asset: 'freezychan_lucoa_quetzalcoatl_horns', prize: 'exotico' },
  cuernosDemonio: { slot: 'cuernos', name: 'Cuernos de demonio', asset: 'jaldmic_houndoom_horns', prize: 'raro' },
  colaDiablo: { slot: 'cola', name: 'Cola de diablo', asset: 'culturalibre_cl_devil_tail', prize: 'raro' },
  colaTigre: { slot: 'cola', name: 'Cola de tigre', asset: 'culturalibre_tigra_tail', prize: 'raro' },
  colaGato: { slot: 'cola', name: 'Cola de gato', asset: 'elvs_cat_tail_as_clothes_1', prize: 'raro' },
  colaZorro: { slot: 'cola', name: 'Cola esponjosa', asset: 'elvs_fluffy_tail_as_clothes_1', prize: 'raro' },
  alasDragon: { slot: 'back', name: 'Alas de dragón', asset: 'elvs_static_wings2_dragon1', prize: 'exotico' },
  alasMariposa: { slot: 'back', name: 'Alas de mariposa', asset: 'elvs_static_wings3_butterfly1', prize: 'exotico' },
  alasLibelula: { slot: 'back', name: 'Alas de libélula', asset: 'elvs_static_wings1_dragonfly', prize: 'exotico' },
  alasHueso: { slot: 'back', name: 'Alas de hueso', asset: 'elvs_static_wings4_bone_wings1', prize: 'exotico' },
  alasDisfraz: { slot: 'back', name: 'Alas de disfraz', asset: 'elvs_childrens_costume_wings1', prize: 'raro' },
};

// Pieles no humanas (premios): reemplazan la textura de la piel (sin teñir)
export const MH_SKINS = {
  pielGris: { name: 'Piel gris', asset: 'bobby_03_grey_skinned_person', prize: 'raro' },
  pielElfa: { name: 'Piel élfica', asset: 'bogdan666_elfskinsohlen', prize: 'raro' },
  pielManhattan: { name: 'Piel azul brillante', asset: 'culturalibre_dr_manhattan', prize: 'exotico' },
  pielTigre: { name: 'Piel de tigre', asset: 'culturalibre_tigra_skin', prize: 'exotico' },
  pielTigreBlanco: { name: 'Piel de tigre blanco', asset: 'culturalibre_tigra_white_skin', prize: 'exotico' },
  pielZombi: { name: 'Piel de zombi', asset: 'naim_abbassi_zombie_skin', prize: 'raro' },
  pielZombi2: { name: 'Piel de zombi pálida', asset: 'sohh_female_zombie_skin', prize: 'raro' },
  pielLeopardoAzul: { name: 'Piel de leopardo azul', asset: 'reizibarrientos_blue_leopard_skin', prize: 'exotico' },
  pielCaminante: { name: 'Piel helada', asset: 'reizibarrientos_white_walker_skin', prize: 'exotico' },
  pielAlienGris: { name: 'Piel de alien gris', asset: 'spreadcore_gray_alien_bio_armor_skin_1', prize: 'exotico' },
  pielAlienVerde: { name: 'Piel de alien verde', asset: 'spreadcore_green_alien_skin_1', prize: 'raro' },
  pielAlienVerde2: { name: 'Piel de alien verde oscuro', asset: 'spreadcore_green_alien_skin_2', prize: 'raro' },
  pielPelaje: { name: 'Pelaje negro', asset: 'trashhunter_black_kameri_fur', prize: 'exotico' },
  pielMandril: { name: 'Piel de mandril', asset: 'callharvey3d_baboon_people', prize: 'raro' },
  trajeVerde: { name: 'Traje de heroína verde', asset: 'xhado84_middleage_afro_female_special_suit_green', prize: 'raro' },
  trajeDorado: { name: 'Traje dorado', asset: 'xhado84_young_asian_female_body_suit_gold', prize: 'exotico' },
  trajeRojo: { name: 'Traje de heroína rojo', asset: 'xhado84_young_asian_female_special_suit_red', prize: 'raro' },
  pielBanderaTrans: { name: 'Piel bandera trans', asset: 'titleknown_trans_flag', prize: 'raro' },
};

// Formas (shape keys del cuerpo). La cara se arma con presets por zona (decisión 26/10: presets, sin deslizadores);
// las formas de animal son premios. targets: [archivo, peso] — 'sys:' = de MPFB, si no, de data/custom.
const LR = (name, w = 1) => [[`sys:eyes/l-eye-${name}`, w], [`sys:eyes/r-eye-${name}`, w]];
const LRc = (name, w = 1) => [[`sys:cheek/l-${name}`, w], [`sys:cheek/r-${name}`, w]];
const LRe = (name, w = 1) => [[`sys:ears/l-ear-${name}`, w], [`sys:ears/r-ear-${name}`, w]];
export const MH_FACE = {
  cara: {
    name: 'Forma de cara',
    options: {
      redonda: { name: 'Redonda', targets: [['sys:head/head-round', 1], ...LRc('cheek-volume-incr', 0.4)] },
      gota: { name: 'En gota', targets: [['sys:head/head-triangular', 1], ['cheek/elvs_jowls_1', 0.5]] },
      ovalada: { name: 'Ovalada', targets: [['sys:head/head-oval', 1]] },
      cuadrada: { name: 'Cuadrada', targets: [['sys:head/head-square', 1], ['sys:chin/chin-width-incr', 0.4]] },
      corazon: { name: 'Corazón', targets: [['sys:head/head-invertedtriangular', 1], ['sys:chin/chin-triangle', 0.6]] },
      diamante: { name: 'Diamante', targets: [['sys:head/head-diamond', 1]] },
      alargada: { name: 'Alargada', targets: [['sys:head/head-rectangular', 1], ['sys:head/head-scale-vert-incr', 0.4]] },
    },
  },
  ojos: {
    name: 'Ojos',
    options: {
      rasgados: { name: 'Rasgados', targets: [...LR('epicanthus-in'), ...LR('eyefold-down', 0.6), ...LR('height2-decr', 0.6)] },
      almendrados: { name: 'Almendrados', targets: [...LR('corner1-up', 0.7), ...LR('corner2-up', 0.5)] },
      grandes: { name: 'Grandes', targets: [...LR('scale-incr', 0.7), ...LR('height2-incr', 0.5)] },
      caidos: { name: 'Caídos', targets: [...LR('corner1-down', 0.8), ...LR('corner2-down', 0.6)] },
    },
  },
  nariz: {
    name: 'Nariz',
    options: {
      ancha: { name: 'Ancha', targets: [['nose/elvs_nose_widening_1', 1], ['sys:nose/nose-flaring-incr', 0.5]] },
      fina: { name: 'Fina', targets: [['sys:nose/nose-width2-decr', 0.8], ['sys:nose/nose-flaring-decr', 0.6], ['nose/jujube_nostril_shrink', 0.6]] },
      griega: { name: 'Griega', targets: [['nose/jujube_greek_statue_nose', 1]] },
      bulbosa: { name: 'Redondeada', targets: [['nose/elvs_bulbous_nose_1', 1]] },
      respingada: { name: 'Respingada', targets: [['sys:nose/nose-point-up', 0.8], ['nose/jujube_nostril_up', 0.6]] },
      aguilena: { name: 'Aguileña', targets: [['sys:nose/nose-hump-incr', 1], ['sys:nose/nose-point-down', 0.5]] },
    },
  },
  mejillas: {
    name: 'Mejillas',
    options: {
      cachetonas: { name: 'Cachetonas', targets: [['cheek/elvs_chipmunk_cheeks_low_1', 1]] },
      pomulos: { name: 'Pómulos altos', targets: [['cheek/elvs_high_chubby_cheekbones_1', 1]] },
      hundidas: { name: 'Hundidas', targets: [['cheek/elvs_sunken_cheeks_1', 1]] },
    },
  },
  orejas: {
    name: 'Orejas',
    options: {
      despegadas: { name: 'Despegadas', targets: [['ears/elvs_flap_ears_2', 1]] },
      chicas: { name: 'Chicas', targets: LRe('scale-decr', 0.8) },
      grandes: { name: 'Grandes', targets: LRe('scale-incr', 0.8) },
    },
  },
};

// Premios con forma: orejas y hocicos de animal (slot del inventario: orejas u hocico)
export const MH_MORPHS = {
  orejasDuende: { slot: 'orejas', name: 'Orejas de duende', targets: [...LRe('shape-pointed'), ...LRe('scale-vert-incr', 0.6)], prize: 'raro' },
  orejasGata: { slot: 'orejas', name: 'Orejas de gata', targets: [['animal/titleknown_catgirl_ears', 1]], prize: 'raro' },
  orejasConejo: { slot: 'orejas', name: 'Orejas de conejo', targets: [['animal/jaldmic_bunny_rabbit_ears_v2', 1]], prize: 'exotico' },
  orejasPerro: { slot: 'orejas', name: 'Orejas de perro', targets: [['animal/jaldmic_canine_ears_v2', 1]], prize: 'raro' },
  orejasCaidas: { slot: 'orejas', name: 'Orejas caídas', targets: [['animal/jaldmic_dropped_ears', 1]], prize: 'raro' },
  orejasFelinas: { slot: 'orejas', name: 'Orejas felinas', targets: [['animal/jaldmic_feline_ears_v2', 1]], prize: 'raro' },
  hocicoFelino: { slot: 'hocico', name: 'Hocico felino', targets: [['animal/jaldmic_furry_mouth_feline_v4', 1]], prize: 'exotico' },
  hocicoReptil: { slot: 'hocico', name: 'Hocico de reptil', targets: [['animal/jaldmic_furry_mouth_reptile', 1]], prize: 'exotico' },
  hocicoPerro: { slot: 'hocico', name: 'Hocico de perro', targets: [['animal/jaldmic_furrymouth_canine_v4', 1]], prize: 'exotico' },
  bocaTiburon: { slot: 'hocico', name: 'Boca de tiburón', targets: [['animal/jaldmic_shark_mouth', 1]], prize: 'exotico' },
  narizChancho: { slot: 'hocico', name: 'Nariz de chancho', targets: [['animal/elvs_piggy_nose1', 1]], prize: 'raro' },
  caraFauno: { slot: 'hocico', name: 'Cara de fauno', targets: [['animal/culturalibre_faun_face', 1]], prize: 'exotico' },
};

// Ojos de fantasía (premios): se hacen en el sombreador de los ojos, sin modelos. slit: pupila rasgada; glow: brillo
export const MH_EYES = {
  ojosReptil: { name: 'Ojos de reptil', color: '#c8d82a', slit: true, glow: 0, prize: 'exotico' },
  ojosGato: { name: 'Ojos de gato', color: '#f0a020', slit: true, glow: 0, prize: 'raro' },
  ojosDemonio: { name: 'Ojos de demonio', color: '#ff2a2a', slit: true, glow: 0.6, prize: 'exotico' },
  ojosBrillantes: { name: 'Ojos brillantes', color: '#39e6ff', slit: false, glow: 0.9, prize: 'exotico' },
  ojosHielo: { name: 'Ojos de hielo', color: '#d6f6ff', slit: false, glow: 0.35, prize: 'raro' },
};

// Cejas: 12 formas (misma malla, cambia la textura)
export const MH_BROWS = Array.from({ length: 12 }, (_, i) => `eyebrow${String(i + 1).padStart(3, '0')}`);

// Nombre de la forma (shape key) de cada preset de cara y de cada premio con forma
export const faceKey = (zone, id) => `f_${zone}_${id}`;
export const morphKey = (id) => `a_${id}`;
