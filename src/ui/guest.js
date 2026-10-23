import { toast } from './toast.js';

// Opciones que los invitados (sin cuenta) ven pero no pueden usar.
// No se esconden ni se deshabilitan: se ven con un candado y, al tocarlas, aparece un aviso
// con un botón para crear la cuenta (en el celular no hay "hover" para explicar un botón gris).

let openRegister = () => {};
export function setRegister(fn) { openRegister = fn; }

// "Para invitar a grupos de voz tenés que crear una cuenta (es gratis)."
export function guestGate(what) {
  toast(`Para ${what} tenés que crear una cuenta (es gratis).`, { actions: [
    { label: 'Crear cuenta', yes: true, onClick: () => openRegister() },
    { label: 'Ahora no' },
  ] });
}

// Marca un botón con el candado (o se lo saca)
export function lock(el, locked) { el?.classList.toggle('locked', !!locked); }
