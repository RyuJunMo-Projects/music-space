import * as THREE from '../vendor/three/three.module.min.js';
import { config } from './config.js';
import { Player } from './player.js';
import { createLobby } from './lobby.js';
import { LobbyAmbience } from './audio/lobby-ambience.js';
import { LobbyFootsteps } from './audio/lobby-footsteps.js';
import { DoorPreview } from './audio/door-preview.js';
import { BeatClock } from './audio/beat-clock.js';
import { BeatClick } from './audio/beat-click.js';
import { setupDeveloperControls } from './developer-controls.js';
import { createDoorways, doorPulseEnvelope } from './doors.js';
import { setupDoorInteraction } from './door-interaction.js';
import { EntranceTransition } from './entrance-transition.js';
import { ExitGateInteraction } from './exit-gate.js';
import { setupSpaceControls } from './space-controls.js';
import { OutrunBars, setupOutrunBarControls } from './spaces/outrun-bars.js';
import { OutrunObjects, setupObjectControls } from './spaces/outrun-objects.js';
import { loopReactionSettings, setupLoopControls } from './audio/track-loop.js';
import { CyberpunkBars } from './spaces/cyberpunk-bars.js';
import { BeachBars, createSharedBeachBarControls } from './spaces/beach-bars.js';
import { CyberpunkCameraSway } from './spaces/cyberpunk-camera-sway.js';
import { CyberpunkObjects } from './spaces/cyberpunk-objects.js';
import { BeachObjects, createSharedBeachObjectControls } from './spaces/beach-objects.js';

export function startApp() {
  const canvas = document.querySelector('#world');
  const overlay = document.querySelector('#start-screen');
  const button = document.querySelector('#start-button');
  const hud = document.querySelector('#hud');
  const message = document.querySelector('#message');
  const audioLoading = document.querySelector('#audio-loading');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 220);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, config.renderer.maxPixelRatio));
  renderer.setSize(innerWidth, innerHeight);

  const lobby = createLobby(scene, config.lobby);
  const doorways = createDoorways(scene, config.doors, config.player.startPosition);
  const ambience = new LobbyAmbience(config.audio.lobby);
  const footsteps = new LobbyFootsteps(config.audio.footsteps);
  const preview = new DoorPreview(config.audio.tracks, config.audio.preview, config.audio.loop);
  const beatClock = new BeatClock();
  const beatClick = new BeatClick();
  const developerControls = setupDeveloperControls(config.development, footsteps, config.doors, preview, config.audio.ducking,
    { tracks: config.audio.tracks, click: beatClick, clock: beatClock });
  const stopPulses = () => {
    beatClock.reset();
    doorways.setPulse(null, 0, 0);
    beatClick.stop();
  };
  const updateDucking = () => {
    if (preview.spaceId) return; // Keep the current duck level during the hum fade.
    const amount = preview.proximity ** 2;
    footsteps.setDuck(1 - amount * config.audio.ducking.footstepDuck);
    ambience.setDuck(1 - amount * config.audio.ducking.humDuck);
  };
  const showLockError = () => {
    message.textContent = '마우스 시점 잠금을 시작하지 못했습니다. 잠시 후 시작 버튼을 다시 눌러 주세요. Chrome의 일반 탭에서 실행해 주세요.';
  };
  const player = new Player(camera, canvas, config.player, (locked) => {
    overlay.hidden = locked;
    hud.hidden = !locked;
    ambience.setActive(locked && !document.hidden && document.hasFocus() && !preview.spaceId);
    if (!locked) {
      entrance.pause();
      footsteps.stop();
      preview.pause();
      updateDucking();
      stopPulses();
      button.textContent = '클릭해서 계속하기 ↗';
      message.textContent = '잠시 멈췄습니다. 다시 클릭하면 현재 위치에서 이어집니다.';
      button.focus();
    }
  }, config.spaces, () => scene.userData.space);

  const entrance = new EntranceTransition({ scene, camera, player, lobby, doorways, config, preview, ambience, footsteps, stopPulses });
  const exitGateInteraction = new ExitGateInteraction(config.exit);
  const spaceControls = setupSpaceControls(config, entrance, scene);
  const outrunBars = new OutrunBars(loopReactionSettings(config.spaces.outrun.bars, preview), config.doors.pulse);
  const outrunObjects = new OutrunObjects(config.spaces.outrun.objects, config.doors.pulse);
  const cyberpunkBars = new CyberpunkBars(loopReactionSettings(config.spaces.cyberpunk.bars, preview), config.doors.pulse);
  const cyberpunkSway = new CyberpunkCameraSway(config.spaces.cyberpunk.cameraSway);
  const cyberpunkObjects = new CyberpunkObjects(config.spaces.cyberpunk.objects, config.doors.pulse,
    config.spaces.cyberpunk.bars, config.spaces.cyberpunk.start);
  const beachBars = new BeachBars(loopReactionSettings(config.spaces.beach.bars, preview));
  const beachObjects = new BeachObjects(config.spaces.beach.objects, config.spaces.beach.bars, config.spaces.beach.start);
  const barControls = createSharedBeachBarControls(config.spaces.outrun.bars, config.spaces.cyberpunk.bars, config.spaces.beach.bars, () => scene.userData.space);
  const objectControls = createSharedBeachObjectControls(config.spaces.outrun.objects, config.spaces.cyberpunk.objects, config.spaces.beach.objects, () => scene.userData.space);
  setupOutrunBarControls(config.development, barControls.settings);
  setupObjectControls(config.development, objectControls.settings);
  setupLoopControls(config.development, config.audio.loop);
  const pickDoor = () => scene.userData.space === 'lobby' ? doorways.pick(camera) : exitGateInteraction.pick(camera, entrance.space);
  const doorInteraction = setupDoorInteraction(canvas, camera, player, doorways,
    target => target.isExit ? entrance.beginReturn(target) : entrance.begin(target), () => entrance.busy,
    () => cyberpunkSway.withCamera(camera, pickDoor));
  button.disabled = false;
  button.innerHTML = '클릭해서 시작 <span aria-hidden="true">↗</span>';
  button.addEventListener('click', () => {
    void preview.unlock();
    // Both requests start in the user gesture; neither blocks the other.
    ambience.unlock().then(() => {
      footsteps.attach(ambience.context);
      document.querySelector('#audio-notice').hidden = true;
    }).catch(error => {
      console.warn('Lobby ambience unavailable:', error);
      document.querySelector('#audio-notice').hidden = false;
    });
    player.lock().catch(showLockError);
  });
  const stopAudio = () => {
    entrance.pause();
    ambience.setActive(false);
    footsteps.stop();
    preview.pause();
    updateDucking();
    stopPulses();
  };
  window.addEventListener('blur', stopAudio);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAudio(); });
  window.addEventListener('pagehide', stopAudio);
  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, config.renderer.maxPixelRatio));
    renderer.setSize(innerWidth, innerHeight);
    entrance.light.resize(innerWidth, innerHeight);
  });
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    renderer.setAnimationLoop(null);
    stopAudio();
    if (player.locked) document.exitPointerLock();
    overlay.hidden = false;
    hud.hidden = true;
    button.disabled = true;
    message.textContent = '그래픽 연결이 끊겼습니다. 페이지를 새로고침해 주세요.';
  });

  let previousTime = performance.now();
  renderer.setAnimationLoop((time) => {
    // Clamp long frames so returning from another tab cannot teleport the player.
    const delta = Math.min(Math.max((time - previousTime) / 1000, 0), 0.05);
    previousTime = time;
    entrance.update(delta);
    const previousX = camera.position.x;
    const previousZ = camera.position.z;
    player.update(delta);
    const moved = Math.hypot(camera.position.x - previousX, camera.position.z - previousZ) > 0.00001;
    preview.update(camera.position, doorways.doors, config.doors.activationDistance,
      player.locked && !document.hidden && document.hasFocus() && (preview.spaceId || scene.userData.space === 'lobby'));
    updateDucking();
    footsteps.update(moved && player.locked && !document.hidden && document.hasFocus(), preview.spaceId || scene.userData.space);
    lobby.update(player.locked ? delta : 0, camera);
    doorways.update(player.locked ? delta : 0);
    const entry = preview.current;
    audioLoading.hidden = !(player.locked && entry && !entry.failed
      && (entry.pending || (!entry.audio.paused && !entry.audio.ended && entry.audio.readyState < 3)));
    // Gate on the existing playback state; never change preview timing or gains.
    const pulseActive = player.locked && !document.hidden && document.hasFocus()
      && !preview.spaceId && scene.userData.space === 'lobby' && preview.context?.state === 'running'
      && entry && !entry.pending && !entry.failed && !entry.ended
      && preview.stopTimer === null && preview.proximity > 0
      && entry.target > 0 && entry.fade.gain.value >= 0.999 && preview.getLoopGain() >= 0.999;
    if (pulseActive) {
      beatClock.update(preview.getAudio(entry.id), config.audio.tracks[entry.id]);
      doorways.setPulse(entry.id, doorPulseEnvelope(beatClock, config.doors.pulse), preview.proximity);
      if (config.development.showControls && beatClock.beatChanged) beatClick.play(preview.context);
    } else stopPulses();
    const outrunActive = scene.userData.space === 'outrun' && player.locked
      && !document.hidden && document.hasFocus() && preview.ready && preview.context?.state === 'running'
      && preview.spaceId === 'outrun' && !preview.spacePaused && preview.spacePauseTimer === null
      && (entrance.phase === 'reveal' || entrance.phase === 'idle')
      && entry?.id === 'outrun' && !entry.pending && !entry.failed && !entry.ended
      && preview.stopTimer === null && entry.target > 0 && entry.fade.gain.value >= 0.999
      && entry.output.gain.value >= entry.target - 0.005;
    outrunBars.update(scene.userData.space === 'outrun' ? entrance.space : null,
      preview.getAudio('outrun'), config.audio.tracks.outrun, outrunActive, delta);
    outrunObjects.update(scene.userData.space === 'outrun' ? entrance.space : null,
      config.audio.tracks.outrun, preview.getLoopGain(), delta);
    const cyberpunkActive = scene.userData.space === 'cyberpunk' && entrance.active && entrance.phase === 'idle'
      && preview.ready && preview.context?.state === 'running' && preview.spaceId === 'cyberpunk'
      && !preview.spacePaused && preview.spacePauseTimer === null
      && entry?.id === 'cyberpunk' && !entry.pending && !entry.failed && !entry.ended
      && preview.stopTimer === null && entry.target > 0 && entry.fade.gain.value >= 0.999
      && entry.output.gain.value >= entry.target - 0.005;
    cyberpunkBars.update(scene.userData.space === 'cyberpunk' ? entrance.space : null,
      preview.getAudio('cyberpunk'), config.audio.tracks.cyberpunk, cyberpunkActive);
    cyberpunkObjects.update(scene.userData.space === 'cyberpunk' ? entrance.space : null,
      config.audio.tracks.cyberpunk, preview.getLoopGain());
    const beachActive = scene.userData.space === 'beach' && entrance.active && entrance.phase === 'idle'
      && preview.ready && preview.context?.state === 'running' && preview.spaceId === 'beach'
      && !preview.spacePaused && preview.spacePauseTimer === null
      && entry?.id === 'beach' && !entry.pending && !entry.failed && !entry.ended
      && preview.stopTimer === null && entry.target > 0 && entry.fade.gain.value >= 0.999
      && entry.output.gain.value >= entry.target - 0.005;
    beachBars.update(scene.userData.space === 'beach' ? entrance.space : null,
      preview.getAudio('beach'), config.audio.tracks.beach, beachActive);
    beachObjects.update(scene.userData.space === 'beach' ? entrance.space : null,
      config.audio.tracks.beach, preview.getLoopGain());
    cyberpunkSway.update(scene.userData.space === 'cyberpunk', entrance.active, entrance.phase === 'idle', delta);
    barControls.update();
    objectControls.update();
    developerControls.update(time);
    spaceControls.update();
    exitGateInteraction.update(entrance.active ? delta : 0, entrance.space);
    doorInteraction.update(time);
    cyberpunkSway.apply(camera);
    try { renderer.render(scene, camera); } finally { cyberpunkSway.restore(camera); }
    entrance.light.render(renderer);
  });
}
