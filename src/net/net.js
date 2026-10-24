// Conexión WebSocket con la sala. Se reconecta sola si se corta.

export class Net {
  constructor(room) {
    this.room = room;
    this.ws = null;
    this.id = null;
    this.handlers = {};
    this.retry = 500;
    this.joinPayload = null;
    // "Sigo acá" para que la sala no nos saque si la pestaña queda en segundo plano
    setInterval(() => { if (this.ready) this.send({ t: 'ping' }); }, 5000);
    addEventListener('pagehide', () => this.ws?.close(1000));
  }

  on(type, fn) { this.handlers[type] = fn; return this; }
  emit(type, data) { this.handlers[type]?.(data); }

  connect(joinPayload) {
    this.joinPayload = joinPayload;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/${this.room}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 500;
      this.send({ t: 'join', ...this.joinPayload() });
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === 'welcome') this.id = msg.id;
      this.emit(msg.t, msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      // Expulsado (4002), baneado (4003), sala privada (4004) o abierto en otra pestaña (4005): no reconectar
      if (this.stopped || [4002, 4003, 4004, 4005].includes(e.code)) { this.id = null; this.emit('status', 'cerrado'); return; }
      this.id = null;
      this.emit('status', 'desconectado');
      setTimeout(() => this.connect(this.joinPayload), this.retry);
      this.retry = Math.min(this.retry * 2, 8000);
    };
  }

  stop() {
    this.stopped = true;
    this.ws?.close(1000);
  }

  get ready() { return this.ws?.readyState === WebSocket.OPEN && this.id !== null; }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
