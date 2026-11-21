export type Layout = 'modern' | 'classic';

export interface ControllerSettings {
  layout: Layout;
  /** zona morta 0..0.4 */
  deadzoneLeft: number;
  deadzoneRight: number;
  /** sensibilidade 0.5..2 (curva de resposta: >1 responde mais cedo) */
  sensitivityLeft: number;
  sensitivityRight: number;
  invertCameraY: boolean;
  vibration: boolean;
}

const KEY = 'vco:controller-settings';

const DEFAULTS: ControllerSettings = {
  layout: 'modern',
  deadzoneLeft: 0.12,
  deadzoneRight: 0.1,
  sensitivityLeft: 1,
  sensitivityRight: 1.15,
  invertCameraY: false,
  vibration: true,
};

function load(): ControllerSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ControllerSettings>) };
  } catch {
    /* storage indisponível */
  }
  return { ...DEFAULTS };
}

/** Preferências do controle, persistidas no celular. */
export const settings: ControllerSettings = load();

export function saveSettings(patch: Partial<ControllerSettings>): void {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage indisponível */
  }
}

export function resetSettings(): void {
  saveSettings({ ...DEFAULTS, layout: settings.layout });
}
