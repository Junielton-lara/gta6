export interface MenuItem {
  label: () => string;
  select: () => void;
}

/** Menu de pausa navegável pelo analógico/setas; ✕/Enter confirma, ○/Options/Esc fecha. */
export class PauseMenu {
  private readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private index = 0;
  isOpen = false;

  constructor(parent: HTMLElement, private readonly items: MenuItem[]) {
    this.el = document.createElement('div');
    this.el.className = 'pause hidden';
    this.el.innerHTML = `
      <div class="pause-card">
        <h2>Pausado</h2>
        <ul></ul>
        <p class="pause-help">Analógico ↑↓ escolher · ✕ confirmar · ○ ou ≡ voltar ao jogo</p>
      </div>`;
    this.list = this.el.querySelector('ul')!;
    parent.appendChild(this.el);
  }

  open(): void {
    this.isOpen = true;
    this.index = 0;
    this.el.classList.remove('hidden');
    this.render();
  }

  close(): void {
    this.isOpen = false;
    this.el.classList.add('hidden');
  }

  move(dir: number): void {
    this.index = (this.index + dir + this.items.length) % this.items.length;
    this.render();
  }

  select(): void {
    this.items[this.index]?.select();
    if (this.isOpen) this.render();
  }

  private render(): void {
    this.list.innerHTML = this.items
      .map((item, i) => `<li class="${i === this.index ? 'active' : ''}">${item.label()}</li>`)
      .join('');
  }
}
