import * as THREE from 'three';

// Texturas generadas por código. Más adelante se reemplazan por fotos,
// texturas PBR o las obras que suban los usuarios.

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Piso de tablas de madera con veta
export function woodFloor() {
  const [c, g] = canvas(1024, 1024);
  const rand = rng(7);
  const rows = 8, rowH = 1024 / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rand() * 400;
    while (x < 1024) {
      const len = 260 + rand() * 300;
      const l = 30 + rand() * 9, hue = 26 + rand() * 6;
      g.fillStyle = `hsl(${hue} 42% ${l}%)`;
      g.fillRect(x, r * rowH, len, rowH);
      // veta
      g.globalAlpha = 0.18;
      for (let i = 0; i < 14; i++) {
        const y0 = r * rowH + rand() * rowH, amp = 1 + rand() * 3, f = 0.01 + rand() * 0.02;
        g.strokeStyle = rand() > 0.5 ? '#2a170b' : '#8a5a33';
        g.lineWidth = 0.6 + rand() * 1.4;
        g.beginPath();
        for (let px = x; px < x + len; px += 6) g.lineTo(px, y0 + Math.sin(px * f) * amp);
        g.stroke();
      }
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(x, r * rowH, 2, rowH);
      x += len;
    }
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(0, r * rowH, 1024, 2);
  }
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Ruido suave para paredes (yeso)
export function plasterBump() {
  const [c, g] = canvas(256, 256);
  const img = g.createImageData(256, 256);
  const rand = rng(3);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 120 + rand() * 30;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = toTexture(c, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Mancha de luz cálida para simular el foco sobre cada cuadro
export function lightPool() {
  const [c, g] = canvas(256, 256);
  const grad = g.createRadialGradient(128, 90, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,236,205,0.9)');
  grad.addColorStop(0.45, 'rgba(255,226,190,0.35)');
  grad.addColorStop(1, 'rgba(255,220,180,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return toTexture(c);
}

const PALETTES = [
  ['#1d3557', '#e63946', '#f1faee', '#a8dadc', '#457b9d'],
  ['#2b2d42', '#ef8354', '#bfc0c0', '#ffffff', '#4f5d75'],
  ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'],
  ['#0b090a', '#660708', '#a4161a', '#e5383b', '#f5f3f4'],
  ['#3d405b', '#e07a5f', '#f4f1de', '#81b29a', '#f2cc8f'],
  ['#03045e', '#0077b6', '#00b4d8', '#90e0ef', '#caf0f8'],
];

// Cuadros generativos en cinco estilos distintos
export function painting(seed, w, h) {
  const px = 512;
  const [c, g] = canvas(px, Math.round(px * (h / w)));
  const W = c.width, H = c.height;
  const rand = rng(seed * 9973 + 11);
  const pal = PALETTES[seed % PALETTES.length];
  const pick = () => pal[Math.floor(rand() * pal.length)];
  const style = seed % 5;

  g.fillStyle = pal[style === 3 ? 4 : 0];
  g.fillRect(0, 0, W, H);

  if (style === 0) {
    // Campos de color
    let y = H * 0.06;
    const n = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const bh = (H * 0.88) / n - H * 0.03;
      g.fillStyle = pal[1 + i];
      g.filter = 'blur(6px)';
      g.fillRect(W * 0.08, y, W * 0.84, bh);
      g.filter = 'none';
      y += bh + H * 0.03;
    }
  } else if (style === 1) {
    // Círculos y líneas
    for (let i = 0; i < 14; i++) {
      g.beginPath();
      g.arc(rand() * W, rand() * H, 10 + rand() * W * 0.18, 0, Math.PI * 2);
      g.fillStyle = pick();
      g.globalAlpha = 0.65 + rand() * 0.35;
      g.fill();
    }
    g.globalAlpha = 1;
    g.strokeStyle = '#111';
    for (let i = 0; i < 6; i++) {
      g.lineWidth = 1 + rand() * 5;
      g.beginPath();
      g.moveTo(rand() * W, rand() * H);
      g.lineTo(rand() * W, rand() * H);
      g.stroke();
    }
  } else if (style === 2) {
    // Paisaje al atardecer
    const sky = g.createLinearGradient(0, 0, 0, H * 0.65);
    sky.addColorStop(0, pal[0]); sky.addColorStop(1, pal[3]);
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.fillStyle = pal[2];
    g.beginPath(); g.arc(W * (0.3 + rand() * 0.4), H * 0.5, W * 0.12, 0, Math.PI * 2); g.fill();
    for (let l = 0; l < 4; l++) {
      g.fillStyle = l % 2 ? pal[4] : pal[1];
      g.globalAlpha = 0.5 + l * 0.15;
      g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) {
        g.lineTo(x, H * (0.55 + l * 0.1) + Math.sin(x * 0.012 + l * 2 + rand()) * H * 0.05);
      }
      g.lineTo(W, H); g.fill();
    }
    g.globalAlpha = 1;
  } else if (style === 3) {
    // Grilla geométrica
    const split = (x, y, w2, h2, d) => {
      if (d > 3 || (d > 1 && rand() < 0.3)) {
        g.fillStyle = rand() < 0.6 ? '#f4f1ea' : pick();
        g.fillRect(x, y, w2, h2);
        g.strokeStyle = '#111'; g.lineWidth = 7;
        g.strokeRect(x, y, w2, h2);
        return;
      }
      const t = 0.3 + rand() * 0.4;
      if (w2 > h2) { split(x, y, w2 * t, h2, d + 1); split(x + w2 * t, y, w2 * (1 - t), h2, d + 1); }
      else { split(x, y, w2, h2 * t, d + 1); split(x, y + h2 * t, w2, h2 * (1 - t), d + 1); }
    };
    split(0, 0, W, H, 0);
  } else {
    // Trazos que fluyen
    g.lineCap = 'round';
    for (let i = 0; i < 90; i++) {
      let x = rand() * W, y = rand() * H;
      g.strokeStyle = pick();
      g.globalAlpha = 0.5;
      g.lineWidth = 1 + rand() * 4;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 40; k++) {
        const a = Math.sin(x * 0.01 + seed) * 2 + Math.cos(y * 0.012) * 2;
        x += Math.cos(a) * 6; y += Math.sin(a) * 6;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  // Textura de tela/óleo
  g.globalAlpha = 0.06;
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = rand() > 0.5 ? '#000' : '#fff';
    g.fillRect(rand() * W, rand() * H, 2, 2);
  }
  g.globalAlpha = 1;
  return toTexture(c);
}

// Cartelito con título debajo de cada obra
export function plaque(title, subtitle) {
  const [c, g] = canvas(256, 96);
  g.fillStyle = '#f7f5f0'; g.fillRect(0, 0, 256, 96);
  g.fillStyle = '#1b1b1b';
  g.font = '600 26px Georgia, serif';
  g.fillText(title, 16, 40);
  g.fillStyle = '#666';
  g.font = '18px Georgia, serif';
  g.fillText(subtitle, 16, 72);
  return toTexture(c);
}

// Alfombra con guarda
export function rug() {
  const [c, g] = canvas(512, 1024);
  g.fillStyle = '#6e1f24'; g.fillRect(0, 0, 512, 1024);
  g.strokeStyle = '#d9b26a'; g.lineWidth = 14; g.strokeRect(30, 30, 452, 964);
  g.strokeStyle = '#2a0e10'; g.lineWidth = 6; g.strokeRect(58, 58, 396, 908);
  g.fillStyle = '#8a2c31';
  for (let y = 140; y < 900; y += 120) {
    g.save(); g.translate(256, y); g.rotate(Math.PI / 4);
    g.fillRect(-38, -38, 76, 76);
    g.restore();
  }
  g.fillStyle = '#d9b26a';
  for (let y = 140; y < 900; y += 120) { g.beginPath(); g.arc(256, y, 9, 0, Math.PI * 2); g.fill(); }
  const rand = rng(5);
  g.globalAlpha = 0.08;
  for (let i = 0; i < 6000; i++) { g.fillStyle = rand() > 0.5 ? '#000' : '#fff'; g.fillRect(rand() * 512, rand() * 1024, 2, 2); }
  return toTexture(c);
}

// Cartel con texto grande
export function sign(text, color = '#ffffff', bg = 'rgba(0,0,0,0)') {
  const [c, g] = canvas(1024, 256);
  g.fillStyle = bg; g.fillRect(0, 0, 1024, 256);
  g.fillStyle = color;
  g.font = '700 120px "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 512, 132);
  return toTexture(c);
}

// Cartel de la cabina con el DJ y el track (el texto largo se achica para que entre)
export function djSign(title, sub = '') {
  const [c, g] = canvas(1024, 256);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const fit = (text, weight, size, y, color) => {
    g.font = `${weight} ${size}px "Segoe UI", Arial, sans-serif`;
    const w = g.measureText(text).width;
    if (w > 980) g.font = `${weight} ${Math.floor(size * 980 / w)}px "Segoe UI", Arial, sans-serif`;
    g.fillStyle = color;
    g.fillText(text, 512, y);
  };
  fit(title, 700, sub ? 92 : 110, sub ? 86 : 132, '#ffffff');
  if (sub) fit(sub, 600, 58, 190, '#ff7af0');
  return toTexture(c);
}

// Cartel de la consola de artistas: quién tiene las luces y las pantallas
export function artistsSign({ luces, escenario } = {}) {
  const [c, g] = canvas(1024, 256);
  g.fillStyle = 'rgba(7,6,15,0.75)'; g.fillRect(0, 0, 1024, 256);
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.font = '700 46px "Segoe UI", Arial, sans-serif';
  g.fillStyle = '#19d3ff';
  g.fillText('CONSOLA DE ARTISTAS · E', 36, 48);
  const row = (label, who, y) => {
    g.font = '600 40px "Segoe UI", Arial, sans-serif';
    g.fillStyle = who ? '#ffffff' : 'rgba(255,255,255,0.45)';
    const text = `${label}: ${who ?? 'libre'}`;
    const w = g.measureText(text).width;
    if (w > 950) g.font = `600 ${Math.floor(40 * 950 / w)}px "Segoe UI", Arial, sans-serif`;
    g.fillText(text, 36, y);
  };
  row('Luces', luces, 128);
  row('Pantalla', escenario, 196);
  return toTexture(c);
}

// Cemento pulido: gris con manchas suaves, poros y alguna fisura fina. Empalma en los bordes
// (todo se dibuja también corrido un ancho/alto), así no se notan las uniones al repetirla.
export function concrete() {
  const S = 1024;
  const [c, g] = canvas(S, S);
  const rand = rng(11);
  const wrap = (draw) => { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { g.save(); g.translate(dx, dy); draw(); g.restore(); } };
  g.fillStyle = '#8b8b8a';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) {
    const x = rand() * S, y = rand() * S, r = 120 + rand() * 300;
    const v = rand() > 0.5 ? 255 : 20, a = 0.025 + rand() * 0.035;
    wrap(() => {
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(${v},${v},${v},${a})`);
      grd.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
  for (let i = 0; i < 9000; i++) {
    const v = rand() > 0.5 ? 190 : 70;
    g.fillStyle = `rgba(${v},${v},${v},${0.06 + rand() * 0.1})`;
    const sz = 0.6 + rand() * 1.6;
    g.fillRect(rand() * S, rand() * S, sz, sz);
  }
  g.strokeStyle = 'rgba(40,40,40,0.14)';
  g.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const pts = [[rand() * S, rand() * S]];
    for (let k = 0; k < 14; k++) { const [x, y] = pts[pts.length - 1]; pts.push([x + (rand() - 0.5) * 60, y + (rand() - 0.3) * 40]); }
    wrap(() => { g.beginPath(); g.moveTo(...pts[0]); for (const p of pts) g.lineTo(...p); g.stroke(); });
  }
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Collage para las paredes del baño: recortes de colores, "fotos", palabras y cinta
export function collage(seed = 3) {
  const [c, g] = canvas(1024, 1024);
  const rand = rng(seed);
  g.fillStyle = '#efe6d6';
  g.fillRect(0, 0, 1024, 1024);
  const colors = ['#e63946', '#ffd23f', '#3a7bd5', '#2a9d8f', '#ff6fb5', '#1d1d22', '#f4a261', '#8a4be2', '#ffffff'];
  const words = ['ARTE', 'NOCHE', 'BAILÁ', 'SALÓN', 'AMOR', 'RUIDO', 'FIESTA', 'MUSEO', 'LUZ', 'VOS', '¿Y AHORA?', 'XX', 'CHAU', 'HOLA', 'POP', 'ON AIR'];
  const piece = (draw) => {
    const x = rand() * 1024, y = rand() * 1024, w = 90 + rand() * 260, h = 70 + rand() * 220;
    g.save();
    g.translate(x, y);
    g.rotate((rand() - 0.5) * 0.7);
    g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 8; g.shadowOffsetY = 3;
    draw(w, h);
    g.restore();
  };
  for (let i = 0; i < 90; i++) {
    const kind = rand();
    piece((w, h) => {
      if (kind < 0.45) {
        // Recorte de color con rayas o lunares
        g.fillStyle = colors[Math.floor(rand() * colors.length)];
        g.fillRect(-w / 2, -h / 2, w, h);
        g.shadowColor = 'transparent';
        g.fillStyle = colors[Math.floor(rand() * colors.length)];
        if (rand() > 0.5) for (let k = -w / 2; k < w / 2; k += 18) g.fillRect(k, -h / 2, 7, h);
        else for (let k = 0; k < 12; k++) { g.beginPath(); g.arc((rand() - 0.5) * w, (rand() - 0.5) * h, 6 + rand() * 10, 0, Math.PI * 2); g.fill(); }
      } else if (kind < 0.75) {
        // "Foto": cielo y suelo con un sol, con borde blanco
        g.fillStyle = '#fff';
        g.fillRect(-w / 2 - 8, -h / 2 - 8, w + 16, h + 26);
        g.shadowColor = 'transparent';
        const sky = g.createLinearGradient(0, -h / 2, 0, h / 2);
        sky.addColorStop(0, `hsl(${rand() * 360} 60% 60%)`);
        sky.addColorStop(1, `hsl(${rand() * 360} 50% 30%)`);
        g.fillStyle = sky;
        g.fillRect(-w / 2, -h / 2, w, h);
        g.fillStyle = `hsl(${rand() * 360} 80% 70%)`;
        g.beginPath(); g.arc((rand() - 0.5) * w * 0.6, -h * 0.15, Math.min(w, h) * 0.15, 0, Math.PI * 2); g.fill();
      } else {
        // Palabra recortada de revista
        const word = words[Math.floor(rand() * words.length)];
        g.font = `900 ${40 + rand() * 50}px "Arial Black", Impact, sans-serif`;
        const tw = g.measureText(word).width;
        g.fillStyle = colors[Math.floor(rand() * colors.length)];
        g.fillRect(-tw / 2 - 10, -40, tw + 20, 80);
        g.shadowColor = 'transparent';
        g.fillStyle = rand() > 0.5 ? '#111' : '#fff';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(word, 0, 2);
      }
    });
    // Cinta
    if (rand() > 0.6) {
      g.save();
      g.translate(rand() * 1024, rand() * 1024);
      g.rotate((rand() - 0.5) * 1.2);
      g.fillStyle = 'rgba(255,245,200,0.55)';
      g.fillRect(-35, -10, 70, 20);
      g.restore();
    }
  }
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Cartelito del DJ en el frente de la cabina (nombre y track); vacío si no hay DJ
export function boothSign(name, track) {
  const [c, g] = canvas(1024, 256);
  g.fillStyle = '#050508'; g.fillRect(0, 0, 1024, 256);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const fit = (text, size, y, color) => {
    g.font = `800 ${size}px "Segoe UI", Arial, sans-serif`;
    const w = g.measureText(text).width;
    if (w > 960) g.font = `800 ${Math.floor(size * 960 / w)}px "Segoe UI", Arial, sans-serif`;
    g.fillStyle = color;
    g.fillText(text, 512, y);
  };
  fit(`DJ ${name}`, 96, track ? 84 : 128, '#ffffff');
  if (track) fit(`♪ ${track}`, 62, 188, '#ff7af0');
  return toTexture(c);
}
