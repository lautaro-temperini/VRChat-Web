import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Avatar, POSE } from '../player/avatar.js';

// Otro jugador en la sala. Recibe posiciones ~10 veces por segundo
// y las suaviza para que el movimiento se vea continuo.

export class RemotePlayer {
  constructor(scene, { id, userId, name, look, equip, s, afk, mic, mod, silenced }) {
    this.id = id;
    this.userId = userId;
    this.mod = !!mod;           // moderador de esta sala
    this.silenced = !!silenced; // silenciado por un moderador
    this.scene = scene;
    this.avatar = new Avatar(look, equip);
    this.target = new THREE.Vector3();
    this.yaw = 0;
    this.targetYaw = 0;
    this.speed = 0;
    this.pose = POSE.stand;
    this.turn = 0;

    this.tag = document.createElement('div');
    this.tag.className = 'nametag';
    this.bubble = document.createElement('div');
    this.bubble.className = 'bubble';
    this.nameEl = document.createElement('span');
    this.nameEl.className = 'name';
    this.afkEl = document.createElement('span');
    this.afkEl.className = 'afk-badge';
    this.afkEl.textContent = 'AFK';
    this.micEl = document.createElement('span');
    this.micEl.className = 'mic-icon';
    const row = document.createElement('div');
    row.className = 'tagrow';
    row.append(this.micEl, this.nameEl);
    this.tag.append(this.bubble, row, this.afkEl);
    this.label = new CSS2DObject(this.tag);
    this.label.position.y = 2.0;
    this.avatar.root.add(this.label);
    this.setName(name);
    this.setAfk(afk);
    this.setMic(mic);

    if (s) {
      this.setState(s);
      this.avatar.root.position.copy(this.target);
      this.yaw = this.targetYaw;
    }
    scene.add(this.avatar.root);
    // Para que la E / el click lo detecten
    const item = { kind: 'player', prompt: 'Ver perfil', player: this };
    this.avatar.root.traverse((o) => { o.userData.interact = item; });
  }

  setName(name) { this.name = name; this.nameEl.textContent = name; }
  setLook(look, equip) { this.avatar.setLook(look); if (equip) this.avatar.setEquip(equip); }
  setMic(v = 'off') { this.mic = v; this.tag.dataset.mic = v; }
  setSpeaking(on) {
    if (on === this.speaking) return;
    this.speaking = on;
    this.avatar.talking = on;
    this.tag.classList.toggle('speaking', on);
  }
  // Desde dónde suena su voz (la boca, más o menos)
  mouth() { return this.avatar.root.position.clone().setY(this.avatar.root.position.y + 1.55 * this.avatar.scale); }
  setAfk(v) { this.afk = !!v; this.tag.classList.toggle('is-afk', this.afk); }

  setState([x, y, z, yaw, speed, pose = POSE.stand]) {
    this.target.set(x, y, z);
    this.targetYaw = yaw;
    this.speed = Math.max(0, speed);
    this.pose = pose;
  }

  say(text) {
    this.bubble.textContent = text;
    this.bubble.classList.add('show');
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = setTimeout(() => this.bubble.classList.remove('show'), 6000);
  }

  update(dt) {
    const root = this.avatar.root;
    const k = 1 - Math.exp(-dt * 12);
    if (root.position.distanceToSquared(this.target) > 25) root.position.copy(this.target); // teletransporte
    else root.position.lerp(this.target, k);
    let d = this.targetYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * k;
    this.turn += (d * 12 - this.turn) * Math.min(1, dt * 8);
    root.rotation.y = this.yaw;
    this.avatar.update(dt, { speed: this.speed, pose: this.pose, turn: this.turn });
  }

  dispose() {
    clearTimeout(this.bubbleTimer);
    this.avatar.root.remove(this.label);
    this.tag.remove();
    this.scene.remove(this.avatar.root);
    this.avatar.dispose();
  }
}
