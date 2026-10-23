// Segunda pantalla de una sala personal, cuando el dueño elige que muestre "su propio VJ".
// Funciona como la pantalla de siempre (parte "escenario" de la consola), pero con su propia
// parte en la sala ("escenario2") y su propia pista de video ("stage2"). Se toma con E sobre
// la pantalla y se suelta igual; quien la toma no queda fijo en la consola.

export function createStage2({ net, rtc, world, toast, ui }) {
  let holder = null; // { id, name, streamId }
  let video = null;
  const $ = (id) => document.getElementById(id);

  rtc.onStage2 = (v) => { video = v; world.stage.setVideo2?.(v); };
  rtc.onStage2Ended = () => { if (holder?.id === net.id) release(); };

  function release() {
    net.send({ t: 'part', part: 'escenario2', on: false });
    rtc.stopStage('stage2');
  }

  async function take() {
    const r = await rtc.captureStage('stage2');
    if (!r.ok) return toast(r.error);
    net.send({ t: 'part', part: 'escenario2', on: true, streamId: r.streamId }); // la sala confirma (o dice que está ocupada)
  }

  // Ver en grande (como la pantalla de siempre)
  function view() {
    if (!video) return;
    const v = document.createElement('video');
    Object.assign(v, { muted: true, playsInline: true, autoplay: true, srcObject: video.srcObject });
    v.play().catch(() => {});
    $('screen-slot').replaceChildren(v);
    $('screen-who').textContent = `Visuales de ${holder?.name ?? 'alguien'}`;
    ui.openOverlay('viewing');
  }

  // Mensajes "part" de la segunda pantalla (los demás los sigue manejando main.js)
  let wrapped = false;
  function hook() {
    if (wrapped) return;
    wrapped = true;
    const prev = net.handlers.part;
    net.on('part', (m) => {
      if (m.part !== 'escenario2') return prev?.(m);
      if (m.busy || m.denied) {
        rtc.stopStage('stage2');
        if (m.busy) toast(`La segunda pantalla ya la tiene ${m.name}.`);
        return;
      }
      const mine = m.id === net.id;
      if (m.on) {
        holder = { id: m.id, name: m.name, streamId: m.streamId };
        if (mine) { rtc.startStage('stage2'); toast('Estás pasando visuales en la segunda pantalla. E sobre ella para dejar.'); }
        else rtc.setStage({ id: m.id, streamId: m.streamId }, 'stage2');
      } else {
        holder = null;
        rtc.setStage(null, 'stage2');
        if (mine) rtc.stopStage('stage2');
        world.stage.setVideo2?.(null);
      }
    });
  }

  return {
    onWelcome(m) {
      hook();
      if (rtc.stage2Stream) rtc.stopStage('stage2'); // me reconecté: ya no es mía
      holder = m.parts?.escenario2 ?? null;
      rtc.setStage(holder && holder.id !== net.id ? { id: holder.id, streamId: holder.streamId } : null, 'stage2');
    },
    use() {
      if (!holder) return take();
      if (holder.id === net.id) return release();
      view();
    },
    prompt() {
      return !holder ? 'Pasar visuales' : holder.id === net.id ? 'Dejar de pasar visuales' : 'Ver en grande';
    },
  };
}
