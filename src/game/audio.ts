type SoundName = "shoot" | "enemy-hit" | "enemy-death" | "pickup" | "player-hit" | "dash" | "upgrade";

const lastPlayed = new Map<SoundName, number>();
let audioContext: AudioContext | null = null;

const SOUND_THROTTLE_MS: Record<SoundName, number> = {
  shoot: 45,
  "enemy-hit": 35,
  "enemy-death": 20,
  pickup: 18,
  "player-hit": 250,
  dash: 150,
  upgrade: 250,
};

export function playSound(name: SoundName): void {
  const now = performance.now();
  if (now - (lastPlayed.get(name) || 0) < SOUND_THROTTLE_MS[name]) return;
  lastPlayed.set(name, now);

  try {
    const context = getAudioContext();
    if (!context) return;
    const config = getSoundConfig(name);
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = config.type;
    oscillator.frequency.setValueAtTime(config.startFrequency, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(config.endFrequency, context.currentTime + config.duration);
    gain.gain.setValueAtTime(config.volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + config.duration);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + config.duration);
  } catch {
    // Audio should never block gameplay.
  }
}

export async function unlockAudio(): Promise<boolean> {
  try {
    const context = getAudioContext();
    if (!context) return false;
    if (context.state === "suspended") await context.resume();
    return context.state === "running";
  } catch {
    return false;
  }
}

export async function playTestSound(): Promise<boolean> {
  const unlocked = await unlockAudio();
  if (unlocked) playSound("upgrade");
  return unlocked;
}

function getAudioContext(): AudioContext | null {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  audioContext ||= new AudioCtor();
  if (audioContext.state === "suspended") void audioContext.resume();
  return audioContext;
}

function getSoundConfig(name: SoundName) {
  if (name === "shoot") return { type: "square" as OscillatorType, startFrequency: 640, endFrequency: 420, duration: 0.045, volume: 0.018 };
  if (name === "enemy-hit") return { type: "sawtooth" as OscillatorType, startFrequency: 300, endFrequency: 170, duration: 0.055, volume: 0.025 };
  if (name === "enemy-death") return { type: "triangle" as OscillatorType, startFrequency: 180, endFrequency: 70, duration: 0.14, volume: 0.05 };
  if (name === "pickup") return { type: "sine" as OscillatorType, startFrequency: 740, endFrequency: 1180, duration: 0.06, volume: 0.035 };
  if (name === "player-hit") return { type: "sawtooth" as OscillatorType, startFrequency: 160, endFrequency: 45, duration: 0.22, volume: 0.07 };
  if (name === "dash") return { type: "triangle" as OscillatorType, startFrequency: 280, endFrequency: 760, duration: 0.09, volume: 0.045 };
  return { type: "sine" as OscillatorType, startFrequency: 520, endFrequency: 1040, duration: 0.18, volume: 0.06 };
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
