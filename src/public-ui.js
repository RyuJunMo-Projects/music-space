// This UI also works before WebGL starts, including on touch-only devices.
export function setupPublicUI(config) {
  config.development.showControls = new URLSearchParams(location.search).get('dev') === '1';
  document.querySelector('.stage').hidden = !config.development.showControls;

  const dialog = document.querySelector('#credits-dialog');
  // 원문 대조 전 — 주인이 NCS 곡 페이지와 확인할 목록:
  // Phoenix: Song / Music provided by NoCopyrightSounds / Free Download/Stream.
  // Phoenix: Watch: http://youtu.be/yH88qRmgkGI (11-B 지정 주소, 원문 Watch 줄 유무 미확인).
  // Cyberpunk: Song / Music provided by NoCopyrightSounds / Free Download/Stream / Watch.
  // Tropic Love: Watch: http://youtu.be/u6RJv7f__Mg (SPEC 5-1 캡처 주소 재대조).
  // All credit URLs remain plain text; opening this window never starts audio.
  document.querySelector('#track-credits').textContent = Object.values(config.audio.tracks)
    .map(track => track.credit).join('\n\n');
  // 11-A can replace these configuration credits when sound files are supplied.
  document.querySelector('#ambience-credit').textContent = `${config.audio.lobby.credit}\n${config.audio.footsteps.credit}`;
  document.querySelector('#open-credits').addEventListener('click', () => dialog.showModal());
  document.querySelector('#close-credits').addEventListener('click', () => dialog.close());
}
