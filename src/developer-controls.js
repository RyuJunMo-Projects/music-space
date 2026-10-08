import { footstepRanges } from './audio/lobby-footsteps.js';
import { previewRanges } from './audio/door-preview.js';
import { TapTempo } from './audio/tap-tempo.js';

export function setupDeveloperControls(settings, footsteps, doorSettings, preview, duckSettings, beatTools) {
  const panel = document.querySelector('#developer-controls');
  panel.hidden = !settings.showControls;
  const hudReadout = document.querySelector('#beat-readout');
  hudReadout.hidden = !settings.showControls;
  if (!settings.showControls) return { update() {} };
  const panelReadout = panel.querySelector('#beat-panel-readout');
  const taps = new Map();
  const applyBpm = (id, value) => {
    const track = beatTools.tracks[id];
    if (Number.isFinite(value)) track.perceivedBpm = Math.round(Math.min(220, Math.max(60, value)) * 100) / 100;
    panel.querySelector(`[data-bpm="${id}"]`).value = track.perceivedBpm.toFixed(2);
  };
  const tap = (id) => {
    const tempo = taps.get(id);
    const bpm = tempo.tap();
    if (bpm !== null) applyBpm(id, bpm);
    panel.querySelector(`[data-tap-status="${id}"]`).textContent = bpm === null
      ? '첫 탭 · 한 번 더 눌러 주세요' : `${tempo.intervals.length}/8 간격 · ${beatTools.tracks[id].perceivedBpm.toFixed(2)} BPM`;
  };
  for (const [id, track] of Object.entries(beatTools.tracks)) {
    taps.set(id, new TapTempo());
    const bpmInput = panel.querySelector(`[data-bpm="${id}"]`);
    Object.assign(bpmInput, { min: 60, max: 220, step: 0.01 });
    applyBpm(id, track.perceivedBpm);
    bpmInput.addEventListener('change', () => applyBpm(id, bpmInput.valueAsNumber));
    panel.querySelector(`[data-tap-tempo="${id}"]`).addEventListener('click', () => tap(id));
    const input = panel.querySelector(`[data-beat-offset="${id}"]`);
    Object.assign(input, { min: -30, max: 30, step: 0.01 });
    input.value = track.firstBeatOffset;
    input.addEventListener('change', () => {
      const value = input.valueAsNumber;
      if (Number.isFinite(value)) track.firstBeatOffset = Math.min(30, Math.max(-30, value));
      input.value = track.firstBeatOffset;
    });
  }
  window.addEventListener('keydown', (event) => {
    if (!settings.showControls || event.code !== 'KeyT' || event.repeat
      || event.ctrlKey || event.altKey || event.metaKey
      || event.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const entry = preview.current;
    if (!entry || entry.pending || entry.failed || entry.audio.paused || entry.audio.ended
      || preview.stopTimer !== null || document.hidden || !document.hasFocus()) return;
    event.preventDefault();
    tap(entry.id);
  });
  const pulseRanges = {
    strength: { min: 0, max: 1, step: 0.05 },
    returnSeconds: { min: 0.05, max: 1.5, step: 0.05 },
  };
  for (const [key, range] of Object.entries(pulseRanges)) {
    const input = panel.querySelector(`[data-pulse="${key}"]`);
    Object.assign(input, range);
    input.value = doorSettings.pulse[key];
    input.addEventListener('change', () => {
      const value = input.valueAsNumber;
      if (Number.isFinite(value)) doorSettings.pulse[key] = Math.min(range.max, Math.max(range.min, value));
      input.value = doorSettings.pulse[key];
    });
  }
  const clickInput = panel.querySelector('#beat-click');
  clickInput.checked = beatTools.click.enabled;
  clickInput.addEventListener('change', () => {
    beatTools.click.enabled = clickInput.checked;
    if (!clickInput.checked) beatTools.click.stop();
  });
  const distanceInput = panel.querySelector('#door-activation-distance');
  Object.assign(distanceInput, { min: 1, max: 30, step: 0.5 });
  distanceInput.value = doorSettings.activationDistance;
  distanceInput.addEventListener('change', () => {
    const value = distanceInput.valueAsNumber;
    if (Number.isFinite(value)) doorSettings.activationDistance = Math.min(30, Math.max(1, value));
    distanceInput.value = doorSettings.activationDistance;
  });
  for (const key of ['footstepDuck', 'humDuck']) {
    const input = panel.querySelector(`[data-duck="${key}"]`);
    Object.assign(input, { min: 0, max: 1, step: 0.05 });
    input.value = duckSettings[key];
    input.addEventListener('change', () => {
      const value = input.valueAsNumber;
      if (Number.isFinite(value)) duckSettings[key] = Math.min(1, Math.max(0, value));
      input.value = duckSettings[key];
    });
  }
  for (const [key, range] of Object.entries(previewRanges)) {
    const input = panel.querySelector(`[data-preview="${key}"]`);
    Object.assign(input, range);
    input.value = preview.settings[key];
    input.addEventListener('change', () => {
      preview.setParameters({ [key]: input.valueAsNumber });
      input.value = preview.settings[key];
    });
  }
  for (const [key, range] of Object.entries(footstepRanges)) {
    const input = panel.querySelector(`[data-footstep="${key}"]`);
    Object.assign(input, range);
    input.value = footsteps.settings[key];
    input.addEventListener('change', () => {
      const value = input.valueAsNumber;
      // Empty/invalid entries restore the last valid value; finite values clamp.
      footsteps.setParameters({ [key]: value });
      input.value = footsteps.settings[key];
    });
  }
  let lastReadoutAt = -Infinity;
  return {
    update(time) {
      if (time - lastReadoutAt < 100) return;
      lastReadoutAt = time;
      const entry = preview.current;
      const track = entry && beatTools.tracks[entry.id];
      const beat = beatTools.clock.active ? beatTools.clock.beatIndex : '—';
      const text = track
        ? `재생 ${entry.audio.currentTime.toFixed(2)}초 · 박 ${beat} · ${track.perceivedBpm.toFixed(2)} BPM · T 탭 템포`
        : '재생 없음 · 박 — · BPM — · 재생 중 T로 탭 템포';
      panelReadout.textContent = text;
      hudReadout.textContent = text;
    },
  };
}
