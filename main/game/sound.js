// ─── SOUND EFFECTS ────────────────────────────────────────────────────────────
// Synthesized via the Web Audio API (oscillators) instead of binary audio files,
// to keep the project asset-free and consistent with the "vanilla JS" approach.

let audioCtx = null;
let soundMuted = localStorage.getItem('chessSoundMuted') === 'true';

function getAudioContext() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
}

// Plays a single tone. `at` is a start delay in seconds from now.
function playTone(freq, duration, { type = 'sine', gain = 0.18, at = 0 } = {}) {
    if (soundMuted) return;
    const ctx = getAudioContext();
    const osc  = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = type;
    osc.frequency.value = freq;

    const startTime = ctx.currentTime + at;
    gainNode.gain.setValueAtTime(gain, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration);
}

function playMoveSound() {
    playTone(600, 0.08, { type: 'sine', gain: 0.15 });
}

function playCaptureSound() {
    playTone(260, 0.12, { type: 'square', gain: 0.14 });
}

function playCheckSound() {
    playTone(880, 0.09, { type: 'sine' });
    playTone(660, 0.12, { type: 'sine', at: 0.09 });
}

function playGameOverSound() {
    playTone(500, 0.16, { type: 'sine', at: 0 });
    playTone(380, 0.16, { type: 'sine', at: 0.14 });
    playTone(260, 0.22, { type: 'sine', at: 0.28 });
}

// `san` is the final SAN string for the move, including its +/#/x characters,
// so a single string tells us whether it was quiet, a capture, or delivered check.
function playSoundForMove(san) {
    if (!san) return;
    if (san.includes('x')) playCaptureSound();
    else playMoveSound();

    if (san.endsWith('+')) playCheckSound();
}

// ─── MUTE TOGGLE ──────────────────────────────────────────────────────────────
function setSoundButtonIcon(btn) {
    if (!btn) return;
    btn.textContent = soundMuted ? '🔇' : '🔊';
    btn.setAttribute('aria-label', soundMuted ? 'Unmute sound' : 'Mute sound');
}

function initSoundToggle() {
    const btn = document.getElementById('soundToggleButton');
    if (!btn) return;
    setSoundButtonIcon(btn);
    btn.addEventListener('click', () => {
        soundMuted = !soundMuted;
        localStorage.setItem('chessSoundMuted', String(soundMuted));
        setSoundButtonIcon(btn);
    });
}

document.addEventListener('DOMContentLoaded', initSoundToggle);
