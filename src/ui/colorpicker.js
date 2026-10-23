// Selector RGB completo (editor avanzado): cuadrado de saturación/brillo, barra de tono y
// código hex. Sirve con mouse y con el dedo. onChange recibe '#rrggbb' mientras arrastrás.

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function hexToHsv(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: ((h * 60) + 360) % 360, s: max ? d / max : 0, v: max };
}

function hsvToHex({ h, s, v }) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return '#' + [f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Arrastrar sobre un elemento: fn(x, y) con valores 0..1
function drag(el, fn) {
  const move = (e) => {
    const r = el.getBoundingClientRect();
    fn(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height));
  };
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    move(e);
    el.onpointermove = move;
  });
  const stop = () => { el.onpointermove = null; };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
}

export function colorPicker(value, onChange) {
  let hsv = hexToHsv(value);
  const root = document.createElement('div');
  root.className = 'rgb-picker';
  root.innerHTML = `
    <div class="rgb-sv"><span class="rgb-knob"></span></div>
    <div class="rgb-hue"><span class="rgb-knob"></span></div>
    <label class="rgb-hex">#<input maxlength="6" spellcheck="false" /></label>`;
  const sv = root.querySelector('.rgb-sv'), hue = root.querySelector('.rgb-hue');
  const svKnob = sv.firstElementChild, hueKnob = hue.firstElementChild;
  const input = root.querySelector('input');

  const paint = (fromInput) => {
    const hex = hsvToHex(hsv);
    sv.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`;
    svKnob.style.left = `${hsv.s * 100}%`;
    svKnob.style.top = `${(1 - hsv.v) * 100}%`;
    svKnob.style.background = hex;
    hueKnob.style.left = `${hsv.h / 360 * 100}%`;
    if (!fromInput) input.value = hex.slice(1);
    return hex;
  };
  const emit = () => onChange(paint());
  drag(sv, (x, y) => { hsv = { ...hsv, s: x, v: 1 - y }; emit(); });
  drag(hue, (x) => { hsv = { ...hsv, h: Math.min(x * 360, 359.9) }; emit(); });
  input.oninput = () => {
    const t = input.value.replace(/[^0-9a-f]/gi, '');
    if (t.length !== 6) return;
    hsv = hexToHsv('#' + t);
    onChange(paint(true));
  };
  paint();
  return root;
}
