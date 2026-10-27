// Fichas de las obras de la sala principal. Más adelante salen de la base de datos
// (y las de las salas de usuarios, de lo que cada uno sube).

const STYLES = [
  {
    titles: ['Horizonte suspendido', 'Tres silencios', 'Bruma de verano', 'Campo abierto'],
    technique: 'Campos de color · arte generativo',
    description: 'Grandes bandas de color que se funden entre sí. La idea es que el ojo descanse y la obra se sienta más que se mire.',
    link: 'https://es.wikipedia.org/wiki/Campo_de_color',
  },
  {
    titles: ['Concierto de círculos', 'Órbitas', 'Ruido blanco', 'Composición VIII bis'],
    technique: 'Abstracción geométrica · arte generativo',
    description: 'Círculos y trazos que chocan como instrumentos de una orquesta. Homenaje a la pintura que quería sonar como la música.',
    link: 'https://es.wikipedia.org/wiki/Vasili_Kandinski',
  },
  {
    titles: ['Atardecer en capas', 'Cerros de papel', 'Último sol', 'Valle en calma'],
    technique: 'Paisaje · arte generativo',
    description: 'Un paisaje reducido a su mínima expresión: cielo, sol y montañas superpuestas como recortes de papel.',
    link: 'https://es.wikipedia.org/wiki/Pintura_de_paisaje',
  },
  {
    titles: ['Ciudad en planta', 'Grilla nº 3', 'Ritmo ortogonal', 'Plano de un sueño'],
    technique: 'Neoplasticismo · arte generativo',
    description: 'Rectángulos, líneas negras y colores primarios. Cada vez que se genera la grilla se divide distinto.',
    link: 'https://es.wikipedia.org/wiki/Piet_Mondrian',
  },
  {
    titles: ['Corrientes', 'Viento sobre el agua', 'Hilos', 'Marea'],
    technique: 'Campos de flujo · arte generativo',
    description: 'Cientos de líneas que siguen un campo de fuerzas invisible. Es código que dibuja como si fuera el viento.',
    link: 'https://es.wikipedia.org/wiki/Arte_generativo',
  },
];

export function artworkInfo(id) {
  const style = STYLES[id % STYLES.length];
  return {
    id,
    title: style.titles[Math.floor(id / STYLES.length) % style.titles.length],
    author: 'Colectivo Galería',
    year: 2026,
    technique: style.technique,
    description: style.description,
    link: style.link,
  };
}

export const SCULPTURES = {
  knot: { title: 'Nudo infinito', author: 'Colectivo Galería', year: 2026, technique: 'Bronce dorado (virtual)', description: 'Un nudo matemático que nunca se corta: una sola línea que se cruza a sí misma una y otra vez.', link: 'https://es.wikipedia.org/wiki/Teor%C3%ADa_de_nudos' },
  ico: { title: 'Poliedro blanco', author: 'Colectivo Galería', year: 2026, technique: 'Mármol (virtual)', description: 'Un icosaedro: veinte caras triangulares iguales. Uno de los cinco sólidos platónicos.', link: 'https://es.wikipedia.org/wiki/Icosaedro' },
  vase: { title: 'Vasija de cobre', author: 'Colectivo Galería', year: 2026, technique: 'Cobre (virtual)', description: 'Forma de torno, como las vasijas de barro: un perfil que gira sobre su eje.', link: 'https://es.wikipedia.org/wiki/Alfarer%C3%ADa' },
  sphere: { title: 'Espejo', author: 'Colectivo Galería', year: 2026, technique: 'Acero pulido (virtual)', description: 'Una esfera que refleja la sala entera. Acercate y vas a ver tu reflejo.', link: 'https://es.wikipedia.org/wiki/Cloud_Gate' },
  column: { title: 'Columna torcida', author: 'Colectivo Galería', year: 2026, technique: 'Laca negra (virtual)', description: 'La pieza central: una columna que gira sobre sí misma, como si el museo bailara.', link: 'https://es.wikipedia.org/wiki/Escultura_abstracta' },
};

// Títulos de todas las obras fijas del Museo (el servidor los usa para validar "miré una obra")
export const FIXED_TITLES = new Set([...STYLES.flatMap((s) => s.titles), ...Object.values(SCULPTURES).map((s) => s.title)]);
