import './styles.css';
import { detectWebGL } from './diagnostics/webgl';
import { Engine, QUALITY_LEVELS } from './engine/Engine';
import { InputState } from './input/InputState';
import { connectTv } from './net/connection';
import { FollowCamera } from './scene/FollowCamera';
import { Player } from './scene/Player';
import { buildWorld } from './scene/world';
import { Hud } from './ui/Hud';

const stage = document.getElementById('stage')!;
const hud = new Hud(document.getElementById('hud')!);

const webgl = detectWebGL();
console.info('[vco] WebGL', webgl);

if (!webgl.supported) {
  hud.showFatal('WebGL indisponível', [
    webgl.reason ?? 'Sem suporte.',
    'Na Android TV, instale/atualize o "Android System WebView" ou use o Chrome/TV Bro atualizado.',
    'Verifique se a aceleração de hardware do navegador está ativada.',
  ]);
} else {
  start();
}

function start() {
  let engine: Engine;
  try {
    engine = new Engine(stage);
  } catch (err) {
    hud.showFatal('Falha ao iniciar o renderizador 3D', [String(err)]);
    return;
  }
  hud.setGpu(webgl, engine.isWebGL2);

  // Android TV / WebView fraco: começa em qualidade média para evitar stutter inicial.
  if (/Android/i.test(navigator.userAgent) && /TV|SmartTV|Philips|AFT|BRAVIA/i.test(navigator.userAgent)) {
    engine.setQuality(1);
  }

  const world = buildWorld(engine.scene);
  const player = new Player();
  engine.scene.add(player.root);
  const followCamera = new FollowCamera(engine.camera);
  followCamera.snap(player.position, player.yaw);

  const input = new InputState(() => player.jump());

  connectTv({
    onServerState: (state, detail) => {
      hud.setServerState(state, detail);
      if (state !== 'connected') input.resetRemote();
    },
    onSession: (info) => hud.setSession(info),
    onStatus: (status) => {
      hud.setStatus(status);
      if (!status.controllerConnected) input.resetRemote();
    },
    onInput: (data) => input.applyRemote(data),
    onEvent: (event) => {
      if (event.type === 'action' && event.pressed) player.jump();
    },
  });

  engine.onFirstFrame = () => {
    document.body.dataset.rendered = 'true';
    console.info('[vco] primeiro quadro renderizado', engine.drawingBufferSize);
  };
  engine.onStats = (stats, quality) => hud.setStats(stats, quality, engine.drawingBufferSize);
  engine.onQualityChange = (quality) => hud.showToast(`Qualidade ajustada para ${quality.name} (FPS baixo)`, 'warn');

  const cycleQuality = () => engine.setQuality((engine.qualityIndex + 1) % QUALITY_LEVELS.length);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyQ') cycleQuality();
  });
  document.getElementById('hud')!.addEventListener('vco:cycle-quality', cycleQuality);

  engine.start((dt) => {
    const drive = input.read();
    player.update(dt, drive.steer, drive.throttle, followCamera.yaw, world.obstacles);
    followCamera.update(dt, player.position, player.speed, player.yaw);
    world.followSun(player.position);
    hud.setSpeed(player.speed);
  });

  // Exposto para testes automatizados e depuração no console.
  (window as unknown as Record<string, unknown>).__vco = { engine, player, input };
}
