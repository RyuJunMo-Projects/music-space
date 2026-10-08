import { config } from './config.js';
import { setupPublicUI } from './public-ui.js';

setupPublicUI(config);
const button = document.querySelector('#start-button');
let started = false;
async function boot() {
  if (started) return;
  started = true;
  window.removeEventListener('keydown', onDesktopInput);
  window.removeEventListener('pointerdown', onDesktopInput);
  document.body.classList.remove('pc-required');
  button.textContent = '공간 준비 중…';
  try {
    const { startApp } = await import('./main.js');
    startApp();
  } catch (error) {
    console.error(error);
    button.disabled = true;
    button.textContent = '공간을 준비하지 못했습니다';
    document.querySelector('#message').textContent = '연결을 확인하고 새로고침해 주세요. Chrome의 하드웨어 가속을 켠 뒤 다시 시도해 주세요.';
  }
}
function onDesktopInput(event) {
  // Browsers cannot report whether a keyboard is attached. Actual desktop input
  // permits a tablet with an external keyboard/mouse to leave the safe notice.
  if (event.isTrusted && (event.pointerType === 'mouse'
    || (event.type === 'keydown' && ['Enter', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)))) void boot();
}
if (matchMedia('(any-pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) {
  document.body.classList.add('pc-required');
  button.textContent = 'PC에서 열어 주세요';
  document.querySelector('#message').textContent = 'PC에서 열어 주세요';
  window.addEventListener('keydown', onDesktopInput);
  window.addEventListener('pointerdown', onDesktopInput);
} else await boot();
