// Vencimiento de las sesiones (decisión del usuario): a los 30 días sin usar la cuenta hay que volver a
// entrar. Quien juega seguido no lo nota: cada uso corre la fecha (se guarda como mucho una vez por hora).

export const SESSION_IDLE = 30 * 24 * 3_600_000;
const SEEN_EVERY = 3_600_000;

// 'expired' (borrarla), 'refresh' (válida; guardar el uso de ahora) u 'ok'
export function sessionState(created, lastSeen, now = Date.now()) {
  const last = Number(lastSeen ?? created) || 0;
  if (now - last > SESSION_IDLE) return 'expired';
  return now - last > SEEN_EVERY ? 'refresh' : 'ok';
}
