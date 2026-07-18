// Add a small deterministic noise floor to 16-bit PCM WAV fixtures. This is
// intentionally dependency-free and exists only to regenerate smoke assets.
import { readFile, writeFile } from 'node:fs/promises';

function findChunk(buffer, target) {
    let offset = 12;
    while (offset + 8 <= buffer.length) {
        const id = buffer.toString('ascii', offset, offset + 4);
        const size = buffer.readUInt32LE(offset + 4);
        if (id === target) return { offset: offset + 8, size };
        offset += 8 + size + (size % 2);
    }
    return null;
}

function nextNoise(state) {
    const next = (state * 1664525 + 1013904223) >>> 0;
    return { state: next, value: (next / 0xffffffff) * 2 - 1 };
}

for (const path of process.argv.slice(2)) {
    const buffer = await readFile(path);
    const format = findChunk(buffer, 'fmt ');
    const data = findChunk(buffer, 'data');
    if (!format || !data || buffer.readUInt16LE(format.offset) !== 1 || buffer.readUInt16LE(format.offset + 14) !== 16) {
        throw new Error(`${path} is not a 16-bit PCM WAV file.`);
    }
    let state = 1000;
    for (let offset = data.offset; offset + 1 < data.offset + data.size; offset += 2) {
        const noise = nextNoise(state);
        state = noise.state;
        const sample = buffer.readInt16LE(offset);
        const mixed = Math.max(-32768, Math.min(32767, sample + Math.round(noise.value * 170)));
        buffer.writeInt16LE(mixed, offset);
    }
    await writeFile(path, buffer);
}
