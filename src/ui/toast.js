// Avisos flotantes arriba de la pantalla, con botones opcionales.
// toast('Texto') · toast('¿Aceptar?', { actions: [{ label, yes, onClick }], time })

export function toast(text, { actions = [], time = actions.length ? 20000 : 4000 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  const msg = document.createElement('span');
  msg.className = 'msg';
  msg.textContent = text;
  el.append(msg);
  const close = () => el.remove();
  for (const a of actions) {
    const b = document.createElement('button');
    b.textContent = a.label;
    if (a.yes) b.className = 'yes';
    b.onclick = () => { close(); a.onClick?.(); };
    el.append(b);
  }
  document.getElementById('toasts').append(el);
  setTimeout(close, time);
  return close;
}
