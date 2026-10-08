export function setupDoorInteraction(canvas, camera, player, doorways, onEnter, blocked, pick = () => doorways.pick(camera)) {
  const hint = document.querySelector('#door-hint');
  const crosshair = document.querySelector('.crosshair');
  document.querySelector('#door-notice').hidden = true;
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !player.locked || blocked()) return;
    const door = pick();
    if (door) onEnter(door);
  });
  return { update() {
    const door = player.locked && !blocked() ? pick() : null;
    hint.hidden = !door;
    hint.textContent = door ? `${door.label} · 클릭` : '';
    crosshair.classList.toggle('on-door', Boolean(door));
  } };
}
