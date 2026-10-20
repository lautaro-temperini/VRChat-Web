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
