import * as THREE from 'three';
import { POSE } from './avatar.js';

// Movimiento (m/s, m/s²)
const JOG = 4.6, SPRINT = 6.8, CROUCH = 2.2;
const ACCEL = 45, DECEL = 32, AIR_ACCEL = 9, GRAVITY = 24, JUMP = 7.6;
const COYOTE = 0.12;      // segundos para saltar después de salir de un borde
const JUMP_BUFFER = 0.15; // segundos que "recuerda" el salto si lo apretaste antes de tocar el piso
const RADIUS = 0.3, STEP = 0.42;
const REACH = 2.15, MANTLE_TIME = 0.42; // trepar: altura máxima y duración
// Stamina: segundos de carrera con la barra llena, segundos para recargarla, espera antes de recargar
const SPRINT_TIME = 5, REGEN_TIME = 4, REST_DELAY = 0.8, RECOVER_AT = 0.35;
// Cámara
const FOV_3P = 70, FOV_1P = 80, FOV_MIN = 30;
export const BASE_SENS = 0.0022;
const TOUCH_SENS = 0.006;

const damp = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));
const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export class PlayerController {
  constructor({ camera, avatar, world, dom }) {
    this.camera = camera;
    this.avatar = avatar;
    this.world = world;
    this.dom = dom;
    this.enabled = false;  // false = vitrina (editor de personaje antes de entrar)
    this.showcase = false; // vitrina con el editor abierto: se apaga al empezar a moverse
    this.typing = false;   // true mientras se escribe en el chat
    this.paused = false;   // true con un panel abierto (obra, perfil, ajustes)
    this.mode = 'third';
    this.sens = 1;         // multiplicador de sensibilidad (Ajustes)

    this.pos = new THREE.Vector3(world.spawn.x + (Math.random() - 0.5) * 2, 0, world.spawn.z + (Math.random() - 0.5) * 2);
    this.vel = new THREE.Vector2(); // velocidad horizontal (x, z)
    this.velY = 0;
    this.grounded = true;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.crouchToggle = false;
    this.touchCrouch = false;
    this.sitting = null;
    this.mantle = null;
    this.landing = 0;
    this.speed = 0;
    this.turn = 0;
    this.pose = POSE.stand;
    this.stamina = 1;       // 0..1
    this.exhausted = false; // se agotó: no puede correr hasta recuperar un poco
    this.restDelay = 0;

    this.yaw = world.spawn.yaw;
    this.pitch = -0.15;
    this.bodyYaw = this.yaw + Math.PI;
    this.distance = 3.2;
    this.camDist = 3.2;
    this.zoomFov = FOV_1P;
    this.pivot = new THREE.Vector3().copy(this.pos);
    this.keys = new Set();
    this.stick = new THREE.Vector2();
    this.ray = new THREE.Raycaster();
    this.onModeChange = () => {};

    addEventListener('keydown', (e) => {
      if (this.typing || this.paused || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      this.keys.add(e.code);
      if (e.code === 'Space') { this.jumpBuffer = JUMP_BUFFER; e.preventDefault(); }
      if (e.code === 'KeyC') this.crouchToggle = !this.crouchToggle;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== dom) return;
      this.look(e.movementX, e.movementY, BASE_SENS);
    });
    dom.addEventListener('wheel', (e) => { if (this.enabled && !this.paused) this.wheel(e.deltaY); }, { passive: true });

    this.isTouch = matchMedia('(pointer: coarse)').matches;
    if (this.isTouch) this.setupTouch();
  }

  look(dx, dy, sens) {
    // En zoom la cámara se mueve más lento, como al apuntar
    const zoom = this.mode === 'first' ? this.camera.fov / FOV_1P : 1;
    this.yaw -= dx * sens * this.sens * zoom;
    this.pitch -= dy * sens * this.sens * zoom;
    const lim = this.mode === 'first' ? [-1.45, 1.45] : [-1.2, 0.85];
    this.pitch = THREE.MathUtils.clamp(this.pitch, lim[0], lim[1]);
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.zoomFov = FOV_1P;
    if (mode === 'third') { this.distance = Math.max(this.distance, 2.2); this.camDist = 0.5; }
    this.look(0, 0, 0);
    this.onModeChange(mode);
  }

  // Rueda: en 3ª persona acerca/aleja; al llegar al mínimo pasa a 1ª.
  // En 1ª persona hace zoom; al alejar del todo vuelve a 3ª.
  wheel(dy) {
    if (this.mode === 'third') {
      this.distance += dy * 0.004;
      if (this.distance < 1.1) { this.distance = 2.2; this.setMode('first'); }
      this.distance = Math.min(this.distance, 7);
    } else {
      if (dy > 0 && this.zoomFov >= FOV_1P) { this.setMode('third'); return; }
      this.zoomFov = THREE.MathUtils.clamp(this.zoomFov + dy * 0.04, FOV_MIN, FOV_1P);
    }
  }

  get crouched() {
    return (this.crouchToggle || this.touchCrouch || this.keys.has('ControlLeft') || this.keys.has('ControlRight')) && !this.sitting && !this.mantle;
  }

  jump() { this.jumpBuffer = JUMP_BUFFER; }

  sit(seat) {
    this.sitting = seat;
    this.mantle = null;
    this.vel.set(0, 0);
    this.velY = 0;
    this.pos.set(seat.x, seat.y, seat.z);
    this.bodyYaw = seat.yaw;
    this.crouchToggle = false;
  }

  stand() {
    const s = this.sitting;
    if (!s) return;
    this.sitting = null;
    // Pararse delante del asiento
    this.pos.x += Math.sin(s.yaw) * 0.75;
    this.pos.z += Math.cos(s.yaw) * 0.75;
  }

  // Joystick a la izquierda; arrastrar en cualquier otro lado para mirar
  setupTouch() {
    const zone = document.getElementById('stick');
    const knob = zone.querySelector('.knob');
    let stickId = null, lookId = null, cx = 0, cy = 0, lx = 0, ly = 0;
    const R = 50;

    zone.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      stickId = t.identifier;
      const r = zone.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      e.preventDefault();
    }, { passive: false });

    this.dom.addEventListener('touchstart', (e) => {
      if (lookId !== null) return;
      const t = e.changedTouches[0];
      lookId = t.identifier; lx = t.clientX; ly = t.clientY;
    }, { passive: true });

    addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          let dx = t.clientX - cx, dy = t.clientY - cy;
          const len = Math.hypot(dx, dy);
          if (len > R) { dx *= R / len; dy *= R / len; }
          knob.style.transform = `translate(${dx}px, ${dy}px)`;
          this.stick.set(dx / R, -dy / R);
        } else if (t.identifier === lookId && this.enabled) {
          this.look(t.clientX - lx, t.clientY - ly, TOUCH_SENS);
          lx = t.clientX; ly = t.clientY;
        }
      }
    }, { passive: true });

    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) { stickId = null; this.stick.set(0, 0); knob.style.transform = ''; }
        if (t.identifier === lookId) lookId = null;
      }
    };
    addEventListener('touchend', end);
    addEventListener('touchcancel', end);
  }

  // Empuja al jugador fuera de las cajas. Devuelve la altura del piso debajo
  // y la caja contra la que chocó (para trepar).
  collide() {
    const p = this.pos;
    let ground = 0, hit = null;
    for (let pass = 0; pass < 2; pass++) {
      for (const b of this.world.colliders) {
        // Lo bajo se pisa (escalón); lo alto empuja
        if (b.top <= p.y + STEP) {
          if (p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ) ground = Math.max(ground, b.top);
          continue;
        }
        const cx = THREE.MathUtils.clamp(p.x, b.minX, b.maxX);
        const cz = THREE.MathUtils.clamp(p.z, b.minZ, b.maxZ);
        const dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= RADIUS * RADIUS) continue;
        let nx, nz, push;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          nx = dx / d; nz = dz / d; push = RADIUS - d;
        } else {
          // Quedó adentro: sacarlo por el lado más cercano
          const opts = [[-1, 0, p.x - b.minX], [1, 0, b.maxX - p.x], [0, -1, p.z - b.minZ], [0, 1, b.maxZ - p.z]];
          opts.sort((a, c) => a[2] - c[2]);
          [nx, nz] = opts[0];
          push = opts[0][2] + RADIUS;
        }
        p.x += nx * push; p.z += nz * push;
        // Frenar la velocidad contra la pared (si no, "se pega")
        const vn = this.vel.x * nx + this.vel.y * nz;
        if (vn < 0) { this.vel.x -= vn * nx; this.vel.y -= vn * nz; }
        if (!hit || push > hit.push) hit = { box: b, nx, nz, push };
      }
    }
    return { ground, hit };
  }

  update(dt) {
    const p = this.pos;
    let ix = 0, iy = 0;
    if (this.enabled && !this.typing && !this.paused) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iy += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iy -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;
      ix += this.stick.x; iy += this.stick.y;
    }
    const len = Math.hypot(ix, iy);
    if (len > 1) { ix /= len; iy /= len; }
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const dirX = -sy * iy + cy * ix, dirZ = -cy * iy - sy * ix; // dirección deseada (largo 0..1)
    const prevYaw = this.bodyYaw;

    if (this.sitting) {
      if (len > 0.3 || this.jumpBuffer > 0) { this.jumpBuffer = 0; this.stand(); }
      else this.speed = 0;
    }

    if (this.sitting) {
      // quieto en el asiento
    } else if (this.mantle) {
      // Trepando: primero sube, después avanza sobre el borde
      const m = this.mantle;
      m.t = Math.min(1, m.t + dt / MANTLE_TIME);
      const up = 1 - (1 - Math.min(1, m.t * 1.7)) ** 2;
      const fwd = THREE.MathUtils.smoothstep(m.t, 0.35, 1);
      p.set(m.from.x + (m.to.x - m.from.x) * fwd, m.from.y + (m.to.y - m.from.y) * up, m.from.z + (m.to.z - m.from.z) * fwd);
      this.speed = 0;
      if (m.t >= 1) { this.mantle = null; this.grounded = true; this.velY = 0; this.vel.set(0, 0); }
    } else {
      const wantsRun = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.stick.length() > 0.92;
      const running = wantsRun && len > 0.3 && !this.exhausted && !this.crouched && this.stamina > 0;
      if (running && this.grounded && this.vel.length() > JOG * 0.8) {
        this.stamina = Math.max(0, this.stamina - dt / SPRINT_TIME);
        this.restDelay = REST_DELAY;
        if (this.stamina === 0) this.exhausted = true;
      } else if (!running) {
        this.restDelay -= dt;
        if (this.restDelay <= 0) this.stamina = Math.min(1, this.stamina + dt / REGEN_TIME);
        if (this.exhausted && this.stamina >= RECOVER_AT) this.exhausted = false;
      }
      const maxSpeed = this.crouched ? CROUCH : running ? SPRINT : JOG;
      const tx = dirX * maxSpeed, tz = dirZ * maxSpeed;
      // Acelerar hacia la velocidad deseada (con menos control en el aire)
      const speeding = tx * tx + tz * tz >= this.vel.lengthSq() - 0.01;
      const accel = this.grounded ? (speeding ? ACCEL : DECEL) : AIR_ACCEL;
      const ddx = tx - this.vel.x, ddz = tz - this.vel.y;
      const dl = Math.hypot(ddx, ddz), step = accel * dt;
      if (dl <= step) this.vel.set(tx, tz);
      else { this.vel.x += (ddx / dl) * step; this.vel.y += (ddz / dl) * step; }
      p.x += this.vel.x * dt;
      p.z += this.vel.y * dt;

      // Salto (con margen antes y después del borde)
      if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0) && this.enabled) {
        this.velY = JUMP;
        this.grounded = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
        this.crouchToggle = false;
      }
      this.velY -= GRAVITY * dt;
      p.y += this.velY * dt;

      const wasGrounded = this.grounded;
      const { ground, hit } = this.collide();
      if (p.y <= ground) {
        if (!wasGrounded && this.velY < -7) this.landing = Math.min(1, -this.velY / 14);
        p.y = ground;
        this.velY = 0;
        this.grounded = true;
        this.coyote = COYOTE;
      } else {
        // Bajar escalones sin "despegar"
        if (wasGrounded && this.velY <= 0 && p.y - ground < STEP) { p.y = ground; this.velY = 0; }
        else { this.grounded = false; this.coyote -= dt; }
      }

      // Trepar: empujando contra algo alcanzable, saltando o en el aire
      if (hit && hit.box.climb && len > 0.3 && !this.crouched) {
        const h = hit.box.top - p.y;
        const toward = -(dirX * hit.nx + dirZ * hit.nz) / Math.max(len, 1e-6);
        if (h > STEP && h <= REACH && toward > 0.55 && (this.jumpBuffer > 0 || !this.grounded)) {
          const b = hit.box, mx = Math.min(0.3, (b.maxX - b.minX) / 2), mz = Math.min(0.3, (b.maxZ - b.minZ) / 2);
          const to = new THREE.Vector3(
            THREE.MathUtils.clamp(p.x - hit.nx * 0.55, b.minX + mx, b.maxX - mx),
            b.top,
            THREE.MathUtils.clamp(p.z - hit.nz * 0.55, b.minZ + mz, b.maxZ - mz),
          );
          this.mantle = { from: p.clone(), to, t: 0 };
          this.bodyYaw = Math.atan2(-hit.nx, -hit.nz);
          this.vel.set(0, 0);
          this.velY = 0;
          this.jumpBuffer = 0;
        }
      }
      this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
      this.speed = this.vel.length();
    }
    this.landing = damp(this.landing, 0, 6, dt);

    // Hacia dónde mira el cuerpo
    if (this.showcase && (this.speed > 0.3 || !this.grounded)) this.showcase = false;
    const vitrina = !this.enabled || this.showcase;
    if (vitrina) this.bodyYaw += dt * 0.5; // vitrina: el personaje gira
    else if (this.sitting || this.mantle) { /* fijo */ }
    else if (this.mode === 'first') this.bodyYaw = this.yaw + Math.PI;
    else if (this.speed > 0.3) this.bodyYaw += angleDiff(this.bodyYaw, Math.atan2(this.vel.x, this.vel.y)) * Math.min(1, dt * 14);
    this.turn = damp(this.turn, angleDiff(prevYaw, this.bodyYaw) / Math.max(dt, 1e-3), 8, dt);

    this.pose = this.sitting ? POSE.sit : this.mantle ? POSE.climb : !this.grounded ? POSE.air : this.crouched ? POSE.crouch : POSE.stand;
    const av = this.avatar;
    av.root.position.copy(p);
    av.root.rotation.y = this.bodyYaw;
    av.update(dt, { speed: this.speed, pose: this.pose, turn: this.turn, landing: this.landing });
    av.root.visible = vitrina || this.mode !== 'first';

    this.updateCamera(dt);
  }

  updateCamera(dt) {
    const cam = this.camera, s = this.avatar.scale, p = this.pos;
    const low = this.pose === POSE.crouch || this.pose === POSE.sit;
    const sprintKick = THREE.MathUtils.clamp((this.speed - 5.2) / 1.5, 0, 1) * 6;
    let fov;
    if (!this.enabled || this.showcase) {
      // Cámara de vitrina para el editor de personaje
      cam.position.set(p.x - 1.9, p.y + 1.2 * s, p.z + 0.55);
      cam.lookAt(p.x, p.y + 0.95 * s, p.z + 0.5);
      fov = FOV_3P;
    } else if (this.mode === 'first') {
      cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      const bob = Math.sin(this.avatar.phase * 2) * 0.018 * Math.min(this.speed / 4.5, 1) * (this.grounded ? 1 : 0);
      const eye = (low ? 1.12 : 1.62) * s;
      this.pivot.set(p.x, damp(this.pivot.y, p.y + eye, 18, dt), p.z);
      cam.position.set(p.x, this.pivot.y + bob, p.z);
      fov = this.zoomFov + (this.zoomFov >= FOV_1P ? sprintKick : 0);
    } else {
      cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      // El punto que sigue la cámara se suaviza (más en vertical, para saltos y trepadas)
      const headY = p.y + (low ? 1.15 : 1.55) * s;
      this.pivot.x = damp(this.pivot.x, p.x, 25, dt);
      this.pivot.z = damp(this.pivot.z, p.z, 25, dt);
      this.pivot.y = damp(this.pivot.y, headY, 12, dt);
      this.camDist = damp(this.camDist, this.distance, 10, dt);
      const target = this.pivot.clone();
      const back = new THREE.Vector3(0, 0, 1).applyEuler(cam.rotation);
      const side = new THREE.Vector3(1, 0, 0).applyEuler(cam.rotation);
      target.addScaledVector(side, 0.45 * Math.min(1, this.camDist / 2)); // sobre el hombro
      let dist = this.camDist;
      this.ray.set(target, back);
      this.ray.far = dist + 0.3;
      const hitWall = this.ray.intersectObjects(this.world.blockers, false)[0];
      if (hitWall) dist = Math.max(0.4, hitWall.distance - 0.3);
      cam.position.copy(target).addScaledVector(back, dist);
      cam.position.y = THREE.MathUtils.clamp(cam.position.y, this.world.bounds.minY, this.world.bounds.maxY);
      fov = FOV_3P + sprintKick;
    }
    const nextFov = damp(cam.fov, fov, 10, dt);
    if (Math.abs(nextFov - cam.fov) > 0.01) { cam.fov = nextFov; cam.updateProjectionMatrix(); }
  }

  // Estado que se manda a los demás: [x, y, z, rotación, velocidad, pose]
  state() {
    return [this.pos.x, this.pos.y, this.pos.z, this.bodyYaw, this.speed, this.pose];
  }
}
