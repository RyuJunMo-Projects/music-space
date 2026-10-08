export function setupSpaceControls(config, entrance, scene) {
  const field = document.querySelector('#space-volume');
  const button = document.querySelector('#return-lobby');
  field.value = config.audio.space.maxVolume;
  field.addEventListener('change', () => {
    const value = field.valueAsNumber;
    if (Number.isFinite(value)) config.audio.space.maxVolume = Math.max(0, Math.min(1, value));
    field.value = config.audio.space.maxVolume;
  });
  button.addEventListener('click', () => entrance.returnLobby());
  return { update() {
    field.closest('label').hidden = !config.development.showControls;
    button.hidden = !config.development.showControls || (scene.userData.space === 'lobby' && !entrance.busy);
  } };
}
