import './styles.css';
import { Button, type ControlHints, type ControlMode } from '@vco/shared';
import { Fog, Vector3 } from 'three';
import { Horn } from './audio/Horn';
import { Character } from './actors/Character';
import { HumanFactory } from './actors/HumanModel';
import { Vehicle } from './actors/Vehicle';
import { ThirdPersonCamera } from './camera/ThirdPersonCamera';
import { detectWebGL } from './diagnostics/webgl';
import { Engine, QUALITY_LEVELS, type QualityLevel } from './engine/Engine';
import { InputState } from './input/InputState';
import { connectTv } from './net/connection';
import { AnimalSystem } from './systems/Animals';
import { DayNight } from './systems/DayNight';
import { PedestrianSystem } from './systems/Pedestrians';
import { TrafficSystem } from './systems/Traffic';
import { FullMap } from './ui/FullMap';
import { Hud } from './ui/Hud';
import { PauseMenu } from './ui/PauseMenu';
import { InteractionSystem, type Interactable } from './systems/Interactions';
import { CityWorld, isRepresentedLandmark } from './world/CityWorld';
import { buildInterior, INTERIOR_CEILING, type BuiltInterior } from './world/Interior';
import { loadMapData, type MapLandmark, type MapPoi } from './world/mapData';
import { PoiMarkers } from './world/PoiMarkers';
import { CATEGORY_COLOR, kindLabel, poiTitle } from './world/poiLabels';
import { Sky } from './world/Sky';
import type { WorldBudget } from './world/types';

const stage = document.getElementById('stage')!;
const hud = new Hud(document.getElementById('hud')!);

const webgl = detectWebGL();
console.info('[cow] WebGL', webgl);

if (!webgl.supported) {
  hud.showFatal('WebGL indisponível', [
    webgl.reason ?? 'Sem suporte.',
    'Na Android TV, atualize o Android System WebView / Chrome.',
  ]);
} else {
  start().catch((err) => {
    console.error(err);
    hud.showFatal('Falha ao carregar o mundo', [String(err)]);
  });
}

function budgetOf(q: QualityLevel): WorldBudget {
  return {
    maxNpcs: q.maxNpcs,
    maxVehicles: q.maxVehicles,
    shadows: q.shadows,
    shadowMapSize: q.shadowMapSize,
    viewRadius: q.viewRadius,
    detailRadius: q.detailRadius,
    materialTier: q.materialTier,
  };
}

async function start(): Promise<void> {
  let engine: Engine;
  try {
    engine = new Engine(stage);
  } catch (err) {
    hud.showFatal('Falha ao iniciar o renderizador 3D', [String(err)]);
    return;
  }
  hud.setGpu(webgl, engine.isWebGL2);

  if (/Android/i.test(navigator.userAgent) && /TV|SmartTV|Philips|AFT|BRAVIA/i.test(navigator.userAgent)) {
    engine.setQuality(1);
  }

  hud.setLoading('Carregando ruas e prédios (OpenStreetMap)…');
  const factory = new HumanFactory();
  const [data] = await Promise.all([loadMapData(), factory.init()]);
  console.info('[cow] mapa', data.meta.name, data.meta.counts, 'OSM', data.meta.osmTimestamp);

  const fog = new Fog('#c2d8ee', 40, engine.quality.viewRadius);
  engine.scene.fog = fog;
  const world = new CityWorld(engine.scene, data, budgetOf(engine.quality), engine.renderer.capabilities.getMaxAnisotropy());
  const sky = new Sky();
  sky.setClouds(engine.quality.clouds);
  engine.scene.add(sky.mesh);
  hud.setMinimap(world.minimap);

  // Spawn: Praça Tiradentes (centroide do OSM), afastado de prédios.
  const praca = data.landmarks.find((l) => l.name === 'Praça Tiradentes') ?? { x: 0, z: 0 };
  const spawn = { x: praca.x, z: praca.z };
  world.collision.resolveCircle(spawn, 1.5);

  const character = new Character(factory.createPlayer());
  character.position.set(spawn.x, 0, spawn.z);
  engine.scene.add(character.root);

  const carSpot = world.roadPointNear(spawn.x, spawn.z);
  const playerCar = new Vehicle('#b02a2a', carSpot?.x ?? spawn.x + 4, carSpot?.z ?? spawn.z);
  if (carSpot) {
    playerCar.root.rotation.y = carSpot.yaw;
    // estaciona junto ao meio-fio da direita
    const off = carSpot.road.width / 2 - 1.2;
    playerCar.root.position.x += Math.cos(carSpot.yaw) * off;
    playerCar.root.position.z -= Math.sin(carSpot.yaw) * off;
  }
  engine.scene.add(playerCar.root);
  /** Carros que o jogador já usou ficam estacionados onde ele deixou. */
  const ownedVehicles: Vehicle[] = [playerCar];

  const q = engine.quality;
  const pedestrians = new PedestrianSystem(world.walkLines, factory, q.maxNpcs);
  const traffic = new TrafficSystem(world.roads, Math.max(0, q.maxVehicles - 1));
  const animals = new AnimalSystem(world.walkLines, world.plazaAreas, q.maxAnimals);
  engine.scene.add(pedestrians.root, traffic.root, animals.root);

  const camera = new ThirdPersonCamera(engine.camera, world.collision);
  camera.snap(character.position, character.yaw);

  const dayNight = new DayNight(engine.scene, sky, world, fog);

  hud.setLoading('Montando o Centro de Curitiba…');
  world.warmup(spawn.x, spawn.z);
  dayNight.update(0);

  let mode: ControlMode = 'on_foot';
  let activeVehicle: Vehicle | null = null;

  const input = new InputState(() => {
    if (mode === 'on_foot' && !pause.isOpen) character.jump();
  }, stage);

  const socket = connectTv({
    onServerState: (state, detail) => {
      hud.setServerState(state, detail);
      if (state !== 'connected') input.resetRemote();
    },
    onSession: (info) => hud.setSession(info),
    onStatus: (status) => {
      hud.setStatus(status);
      if (!status.controllerConnected) input.resetRemote();
      sentHints = '';
    },
    onInput: (d) => input.applyRemote(d),
    onEvent: (event) => {
      if (event.type === 'action' && event.pressed && mode === 'on_foot' && !pause.isOpen) character.jump();
    },
  });

  const publishMode = (next: ControlMode) => {
    mode = next;
    hud.setMode(next);
    camera.mode = next === 'driving' ? 'vehicle' : 'foot';
    socket.emit('tv:control-mode', next);
  };
  publishMode('on_foot');
  socket.on('connect', () => {
    socket.emit('tv:control-mode', mode);
    sentHints = '';
  });

  const hudRoot = document.getElementById('hud')!;
  const horn = new Horn();
  let hornWarned = false;
  const fullMap = new FullMap(hudRoot, world.minimap, world.bounds);
  const pause = new PauseMenu(hudRoot, [
    { label: () => 'Continuar', select: () => pause.close() },
    { label: () => `Qualidade gráfica: <b>${engine.quality.name}</b>`, select: () => cycleQuality() },
    {
      label: () => 'Mapa da região',
      select: () => {
        pause.close();
        if (!fullMap.isOpen) fullMap.toggle();
      },
    },
  ]);

  // ---- interações contextuais (□): estabelecimentos, obras e marcos do OSM ----
  const interactions = new InteractionSystem();
  const pois = data.pois ?? [];
  const markerPoints: { x: number; z: number; color: string }[] = [];
  for (const poi of pois) {
    const color = CATEGORY_COLOR[poi.cat];
    if (poi.b) {
      const x = poi.x + (poi.nx ?? 0) * 0.8;
      const z = poi.z + (poi.nz ?? 0) * 0.8;
      interactions.add({ id: poi.id, x, z, radius: 2.4, verb: 'Entrar', title: poiTitle(poi), color, run: () => enterInterior(poi) });
      markerPoints.push({ x, z, color });
    } else {
      const verb = poi.cat === 'artwork' ? 'Ver obra' : 'Informações';
      interactions.add({ id: poi.id, x: poi.x, z: poi.z, radius: 3.5, verb, title: poiTitle(poi), color, run: () => showPoiInfo(poi) });
      markerPoints.push({ x: poi.x, z: poi.z, color });
    }
  }
  for (const l of data.landmarks) {
    const dup = pois.some((p) => p.name === l.name && Math.hypot(p.x - l.x, p.z - l.z) < 25);
    if (dup) continue;
    interactions.add({ id: l.id, x: l.x, z: l.z, radius: l.historic ? 4.5 : 9, verb: 'Informações', title: l.name, color: '#ffc24d', run: () => showLandmarkInfo(l) });
  }
  const markers = new PoiMarkers(markerPoints);
  engine.scene.add(markers.root);
  hud.setPois(markerPoints);
  fullMap.setPois(markerPoints);

  let target: Interactable | null = null;
  const doorFocus = new Vector3();
  let infoAnchor: { x: number; z: number } | null = null;

  function showPoiInfo(poi: MapPoi): void {
    const lines = [kindLabel(poi)];
    if (poi.cuisine) lines.push(`Cozinha (OSM): ${poi.cuisine.replace(/;/g, ', ')}`);
    if (poi.artist) lines.push(`Autor(a): ${poi.artist}`);
    if (poi.hours) lines.push(`Horário (OSM): ${poi.hours}`);
    hud.showInfo(poiTitle(poi), lines, 'Dados: © OpenStreetMap contributors');
    infoAnchor = { x: character.position.x, z: character.position.z };
  }

  const HISTORIC_PT: Record<string, string> = {
    memorial: 'Memorial',
    monument: 'Monumento',
    building: 'Edificação histórica',
    church: 'Igreja histórica',
    city_gate: 'Portal',
    yes: 'Patrimônio histórico',
  };
  const LANDMARK_KIND_PT: Record<NonNullable<MapLandmark['kind']>, string> = {
    church: 'Igreja',
    townhall: 'Paço municipal (marcação OSM)',
    square: 'Praça / largo',
  };
  function showLandmarkInfo(l: MapLandmark): void {
    const kind = l.historic ? HISTORIC_PT[l.historic] ?? 'Patrimônio histórico' : l.kind ? LANDMARK_KIND_PT[l.kind] : 'Ponto de referência';
    const lines = [kind];
    lines.push('Fonte: OpenStreetMap');
    const note = isRepresentedLandmark(l.name) ? 'O modelo 3D é uma representação simplificada, não uma réplica.' : '';
    hud.showInfo(l.name, lines, note);
    infoAnchor = { x: character.position.x, z: character.position.z };
  }

  // ---- interiores ----
  let inside: { poi: MapPoi; built: BuiltInterior; hidden: { visible: boolean }[] } | null = null;

  function enterInterior(poi: MapPoi): void {
    if (mode !== 'on_foot' || inside) return;
    const built = buildInterior(poi, (s) => factory.createNpc(s));
    const hidden = engine.scene.children.filter((o) => o.visible && o !== character.root);
    for (const o of hidden) o.visible = false;
    engine.scene.add(built.group);
    engine.scene.fog = null;
    inside = { poi, built, hidden };
    refreshEnvironment();
    hud.hideInfo();
    character.crouched = false;
    character.velocity.set(0, 0, 0);
    character.position.set(built.spawn.x, 0, built.spawn.z);
    character.root.rotation.y = built.spawn.yaw;
    camera.collision = built.collision;
    camera.indoorCeiling = INTERIOR_CEILING;
    camera.pitch = 0.12;
    camera.snap(character.position, built.spawn.yaw);
    interactions.addTemporary({ id: 'exit', x: built.exit.x, z: built.exit.z, radius: 2, verb: 'Sair', title: 'Voltar para a rua', run: exitInterior });
    hud.setInteriorNote(`${poiTitle(poi)} · interior representativo (o OpenStreetMap não descreve interiores)`);
  }

  function exitInterior(): void {
    if (!inside) return;
    const { poi, built, hidden } = inside;
    built.dispose();
    for (const o of hidden) o.visible = true;
    engine.scene.fog = fog;
    inside = null;
    refreshEnvironment();
    interactions.clearTemporary();
    hud.setInteriorNote(null);
    const nx = poi.nx ?? 0;
    const nz = poi.nz ?? 1;
    const p = { x: poi.x + nx * 1.3, z: poi.z + nz * 1.3 };
    world.collision.resolveCircle(p, 0.4);
    character.velocity.set(0, 0, 0);
    character.position.set(p.x, 0, p.z);
    const yaw = Math.atan2(-nx, -nz);
    character.root.rotation.y = yaw;
    camera.collision = world.collision;
    camera.indoorCeiling = null;
    camera.snap(character.position, yaw);
  }

  /** Função atual de cada botão do layout moderno; botão sem função não aparece. */
  let sentHints = '';
  function currentHints(): ControlHints {
    if (pause.isOpen) return { Cross: 'Confirmar', Circle: 'Voltar', Options: 'Continuar' };
    const common: ControlHints = { Options: 'Pausa', TouchPad: fullMap.isOpen ? 'Fechar mapa' : 'Mapa' };
    if (mode === 'driving') {
      return { ...common, R2: 'Acelerar', L2: 'Frear / Ré', Cross: 'Freio de mão', Circle: 'Câmera', Square: 'Buzina', Triangle: 'Sair', R3: 'Centralizar' };
    }
    const hints: ControlHints = {
      ...common,
      Cross: character.crouched ? 'Levantar' : 'Pular',
      Circle: character.isExhausted ? 'Sem fôlego' : 'Correr',
      L3: character.crouched ? 'Levantar' : 'Agachar',
      R3: 'Centralizar',
    };
    if (!inside && findNearVehicle()) hints.Triangle = 'Entrar';
    if (hud.infoOpen) hints.Square = 'Fechar';
    else if (target) hints.Square = target.verb;
    return hints;
  }
  function publishHints(): void {
    const json = JSON.stringify(currentHints());
    if (json === sentHints) return;
    sentHints = json;
    socket.emit('tv:control-hints', JSON.parse(json) as ControlHints);
  }

  function findNearVehicle(): Vehicle | null {
    let near: Vehicle | null = null;
    let best = 3.8;
    for (const v of ownedVehicles) {
      const d = Math.hypot(v.position.x - character.position.x, v.position.z - character.position.z);
      if (d < best) (best = d), (near = v);
    }
    return near ?? traffic.nearestFree(character.position.x, character.position.z, 3.8);
  }

  function tryEnterExit(): void {
    if (mode === 'driving' && activeVehicle) {
      const v = activeVehicle;
      // desce pela porta do motorista (lado esquerdo do carro)
      const side = { x: v.position.x - Math.cos(v.yaw) * 1.6, z: v.position.z + Math.sin(v.yaw) * 1.6 };
      world.collision.resolveCircle(side, 0.5);
      character.onFoot = true;
      character.position.set(side.x, 0, side.z);
      character.velocity.set(0, 0, 0);
      v.speed = 0;
      v.occupied = false;
      activeVehicle = null;
      camera.snap(character.position, camera.yaw);
      publishMode('on_foot');
      hud.showToast('Saiu do veículo', 'ok');
      return;
    }
    const near = findNearVehicle();
    if (!near) {
      hud.showToast('Nenhum veículo perto', 'warn');
      return;
    }
    if (!ownedVehicles.includes(near)) {
      ownedVehicles.push(near);
      traffic.root.remove(near.root);
      engine.scene.add(near.root);
    }
    character.onFoot = false;
    near.occupied = true;
    activeVehicle = near;
    publishMode('driving');
    hud.showToast('Entrou no veículo', 'ok');
  }

  // Reflexo/luz do céu nos materiais PBR (só no nível Alta), recalculado conforme o dia passa.
  const skyEnv = sky.createEnvironment(engine.renderer);
  let envAcc = 0;
  function refreshEnvironment(): void {
    envAcc = 0;
    const on = engine.quality.materialTier === 'pbr' && !inside;
    engine.scene.environment = on ? skyEnv.update() : null;
    dayNight.ambientScale = on ? 0.4 : 1;
  }

  const applyQuality = (quality: QualityLevel) => {
    refreshEnvironment();
    world.setBudget(budgetOf(quality));
    pedestrians.setMax(quality.maxNpcs);
    traffic.setMax(Math.max(0, quality.maxVehicles - 1));
    animals.setMax(quality.maxAnimals);
    sky.setClouds(quality.clouds);
    fog.far = quality.viewRadius;
    fog.near = Math.min(60, quality.viewRadius * 0.3);
  };
  applyQuality(engine.quality);

  engine.onFirstFrame = () => {
    document.body.dataset.rendered = 'true';
    hud.setLoading(null);
    console.info('[cow] primeiro quadro', engine.drawingBufferSize);
  };
  engine.onStats = (stats, quality) => {
    const t = world.loadedTiles;
    hud.extraStats =
      `Blocos   ${t.near} perto · ${t.far} longe / ${t.total}\n` +
      `Atores   ${pedestrians.count} ped · ${traffic.count} carros · ${animals.count} animais`;
    hud.setStats(stats, quality, engine.drawingBufferSize);
  };
  engine.onQualityChange = (quality) => {
    applyQuality(quality);
    hud.showToast(`Qualidade: ${quality.name}`, 'warn');
  };

  const cycleQuality = () => engine.setQuality((engine.qualityIndex + 1) % QUALITY_LEVELS.length);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyQ') cycleQuality();
  });
  document.getElementById('hud')!.addEventListener('vco:cycle-quality', cycleQuality);

  let hudAcc = 0;
  let placeAcc = 1;
  let hintAcc = 0;
  let rumbleCooldown = 0;
  let elapsed = 0;
  engine.start((dt) => {
    const pressed = input.takePressed();
    const menuMove = input.takeMenuMove();
    hintAcc += dt;
    if (hintAcc > 0.25) {
      hintAcc = 0;
      publishHints();
    }

    if (pressed & Button.Options) {
      if (pause.isOpen) pause.close();
      else {
        fullMap.close();
        pause.open();
      }
      horn.set(false);
      publishHints();
    }
    if (pause.isOpen) {
      // simulação congelada: só o menu responde
      if (menuMove) pause.move(menuMove);
      if (pressed & Button.Cross) pause.select();
      if (pressed & Button.Circle) pause.close();
      input.consumeInteract();
      input.consumeJump();
      return;
    }
    if (pressed & Button.TouchPad) {
      fullMap.toggle();
      publishHints();
    }

    elapsed += dt;
    dayNight.update(dt);
    envAcc += dt;
    if (envAcc > 10 && engine.scene.environment) refreshEnvironment();
    const night = dayNight.isNight;
    traffic.setNight(night);
    for (const v of ownedVehicles) v.setNightLights(night);

    if (input.consumeInteract() && !inside) tryEnterExit();
    if (pressed & Button.Triangle && !inside) tryEnterExit();
    const jump = input.consumeJump() || (pressed & Button.Cross) !== 0;
    if (jump && mode === 'on_foot') character.jump();
    if (pressed & Button.L3 && mode === 'on_foot') character.toggleCrouch();
    if (pressed & Button.R3) camera.recenter(mode === 'driving' && activeVehicle ? activeVehicle.yaw : character.yaw);
    camera.footPivot = character.crouched ? 1.35 : 1.9;
    const look = input.readLook(dt);

    const honking = mode === 'driving' && (input.held(Button.Square) || input.held(Button.Horn));
    horn.set(honking);
    if (honking && horn.blocked && !hornWarned) {
      hornWarned = true;
      hud.showToast('Som bloqueado pelo navegador da TV: aperte OK no controle remoto da TV uma vez', 'warn');
    }

    let focus = character.position;
    let focusYaw = character.yaw;
    if (mode === 'driving' && activeVehicle) {
      const drive = input.readDrive();
      if (pressed & Button.Circle) hud.showToast(camera.cycleVehicleView(), 'idle');
      const impact = activeVehicle.update(dt, drive.steer, drive.throttle, world.collision, drive.handbrake);
      rumbleCooldown -= dt;
      if (impact > 1.5 && rumbleCooldown <= 0) {
        rumbleCooldown = 0.4;
        socket.emit('tv:rumble', Math.min(400, Math.round(40 + impact * 25)));
      }
      character.position.copy(activeVehicle.position);
      focus = activeVehicle.position;
      focusYaw = activeVehicle.yaw;
      camera.update(dt, focus, activeVehicle.speed, focusYaw, look.x, look.y);
      hud.setSpeed(activeVehicle.speed);
    } else {
      const foot = input.readFoot();
      character.update(dt, foot.x, foot.y, foot.run, camera.yaw, inside ? inside.built.collision : world.collision);
      camera.update(dt, focus, character.speed, focusYaw, look.x, look.y);
      hud.setSpeed(character.speed);
    }
    hud.setFoot(mode === 'on_foot', character.stamina, character.isExhausted, character.crouched);

    // □: interação contextual mais próxima (a pé)
    target = mode === 'on_foot' ? interactions.nearest(character.position.x, character.position.z, character.yaw, !!inside) : null;
    if (pressed & Button.Square && mode === 'on_foot') {
      if (hud.infoOpen) hud.hideInfo();
      else target?.run();
      publishHints();
    }
    if (hud.infoOpen && (pressed & Button.Circle || !infoAnchor || Math.hypot(character.position.x - infoAnchor.x, character.position.z - infoAnchor.z) > 5)) {
      hud.hideInfo();
    }
    hud.setPrompt(target && !hud.infoOpen ? `${target.verb} · ${target.title}` : null);

    if (inside) {
      inside.built.update(dt);
      // no minimapa/HUD o jogador aparece na porta do estabelecimento
      focus = doorFocus.set(inside.poi.x, 0, inside.poi.z);
    } else {
      markers.update(dt, target);
      world.update(focus.x, focus.z);
      world.followSun(focus);
      sky.update(engine.camera.position, elapsed);
      const radius = engine.quality.viewRadius * 0.55;
      const avoid = [{ x: character.position.x, z: character.position.z }, ...ownedVehicles.map((v) => ({ x: v.position.x, z: v.position.z }))];
      traffic.update(dt, focus, avoid, radius);
      pedestrians.update(dt, focus, radius * 0.7);
      animals.update(dt, focus, radius * 0.6);
    }

    hudAcc += dt;
    if (hudAcc > 0.1) {
      hud.drawMinimap(focus.x, focus.z, focusYaw, camera.yaw);
      fullMap.draw(focus.x, focus.z, focusYaw);
      hudAcc = 0;
    }
    placeAcc += dt;
    if (placeAcc > 0.5) {
      placeAcc = 0;
      const street = world.nearestStreetName(focus.x, focus.z);
      const lm = world.nearestLandmark(focus.x, focus.z);
      hud.setPlace(street, lm?.name ?? null, lm && isRepresentedLandmark(lm.name) ? 'modelo 3D representativo' : null);
      hud.setClock(dayNight.clock);
    }
  });

  (window as unknown as Record<string, unknown>).__cow = { engine, world, character, playerCar, input, camera, dayNight, traffic, pedestrians, animals, pause, fullMap, horn, interactions, enterInterior, exitInterior, pois, getInside: () => inside };
}
