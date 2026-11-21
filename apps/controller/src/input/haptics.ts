import { settings } from '../settings';

/** Vibração curta respeitando a preferência do usuário (ignorada onde não há suporte). */
export function vibrate(pattern: number | number[]): void {
  if (!settings.vibration) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* sem suporte */
  }
}
