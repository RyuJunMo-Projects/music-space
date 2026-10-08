// Decode once per audio owner. Sources and credits stay in config.js.
export async function loadSfxBuffer(context, file, signal) {
  if (!file) throw new Error('Sound file not configured');
  const response = await fetch(file, { signal });
  if (!response.ok) throw new Error(`Sound file unavailable (${response.status}): ${file}`);
  return context.decodeAudioData(await response.arrayBuffer());
}

// Bake the tail/head overlap into one buffer. Web Audio loops it sample-accurately
// without timers, extra sources per cycle, or a silent gap between two players.
export function crossfadeLoopBuffer(context, buffer, seconds) {
  const overlap = Math.min(Math.floor(buffer.length / 3), Math.round(buffer.sampleRate * seconds));
  if (overlap < 2) return buffer;
  const length = buffer.length - overlap;
  const loop = context.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const original = buffer.getChannelData(channel);
    const samples = loop.getChannelData(channel);
    samples.set(original.subarray(overlap, buffer.length - overlap));
    const start = length - overlap;
    for (let i = 0; i < overlap; i++) {
      const mix = i / (overlap - 1);
      samples[start + i] = original[buffer.length - overlap + i] * (1 - mix) + original[i] * mix;
    }
  }
  return loop;
}
