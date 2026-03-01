/**
 * Generate simple GLB prop models for the avatar prop system.
 * Writes GLB binary directly (no Three.js exporter needed).
 *
 * Usage: node scripts/generate-props.mjs
 * Output: packages/web/public/props/keyboard.glb, web/public/props/tablet.glb
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, '../packages/web/public/props');
await mkdir(OUTPUT_DIR, { recursive: true });

function buildGLB(meshes) {
  const nodes = [];
  const meshDefs = [];
  const accessors = [];
  const bufferViews = [];
  const materials = [];
  const materialMap = new Map();
  let byteOffset = 0;
  const bufferChunks = [];

  for (const mesh of meshes) {
    const colorKey = mesh.color.join(',');
    let materialIndex;
    if (materialMap.has(colorKey)) {
      materialIndex = materialMap.get(colorKey);
    } else {
      materialIndex = materials.length;
      materialMap.set(colorKey, materialIndex);
      materials.push({
        pbrMetallicRoughness: {
          baseColorFactor: [...mesh.color, 1],
          metallicFactor: 0.1,
          roughnessFactor: 0.8,
        },
      });
    }

    const [w, h, d] = mesh.size;
    const hw = w / 2, hh = h / 2, hd = d / 2;

    const positions = new Float32Array([
      -hw,-hh, hd,  hw,-hh, hd,  hw, hh, hd, -hw, hh, hd,
       hw,-hh,-hd, -hw,-hh,-hd, -hw, hh,-hd,  hw, hh,-hd,
      -hw, hh, hd,  hw, hh, hd,  hw, hh,-hd, -hw, hh,-hd,
      -hw,-hh,-hd,  hw,-hh,-hd,  hw,-hh, hd, -hw,-hh, hd,
       hw,-hh, hd,  hw,-hh,-hd,  hw, hh,-hd,  hw, hh, hd,
      -hw,-hh,-hd, -hw,-hh, hd, -hw, hh, hd, -hw, hh,-hd,
    ]);

    const normals = new Float32Array([
      0,0,1, 0,0,1, 0,0,1, 0,0,1,
      0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1,
      0,1,0, 0,1,0, 0,1,0, 0,1,0,
      0,-1,0, 0,-1,0, 0,-1,0, 0,-1,0,
      1,0,0, 1,0,0, 1,0,0, 1,0,0,
      -1,0,0, -1,0,0, -1,0,0, -1,0,0,
    ]);

    const indices = new Uint16Array([
      0,1,2, 0,2,3, 4,5,6, 4,6,7, 8,9,10, 8,10,11,
      12,13,14, 12,14,15, 16,17,18, 16,18,19, 20,21,22, 20,22,23,
    ]);

    const posView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: positions.byteLength, target: 34962 });
    bufferChunks.push(Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength));
    byteOffset += positions.byteLength;

    const normView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: normals.byteLength, target: 34962 });
    bufferChunks.push(Buffer.from(normals.buffer, normals.byteOffset, normals.byteLength));
    byteOffset += normals.byteLength;

    const idxView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: indices.byteLength, target: 34963 });
    bufferChunks.push(Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength));
    byteOffset += indices.byteLength;

    const posAccessor = accessors.length;
    accessors.push({ bufferView: posView, componentType: 5126, count: 24, type: 'VEC3', min: [-hw,-hh,-hd], max: [hw,hh,hd] });
    const normAccessor = accessors.length;
    accessors.push({ bufferView: normView, componentType: 5126, count: 24, type: 'VEC3' });
    const idxAccessor = accessors.length;
    accessors.push({ bufferView: idxView, componentType: 5123, count: 36, type: 'SCALAR' });

    const meshIndex = meshDefs.length;
    meshDefs.push({ primitives: [{ attributes: { POSITION: posAccessor, NORMAL: normAccessor }, indices: idxAccessor, material: materialIndex }] });
    nodes.push({ name: mesh.name, mesh: meshIndex, translation: mesh.position });
  }

  const gltf = {
    asset: { version: '2.0', generator: 'project-avatar-prop-gen' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes, meshes: meshDefs, accessors, bufferViews, materials,
    buffers: [{ byteLength: byteOffset }],
  };

  const jsonStr = JSON.stringify(gltf);
  const jsonPad = (4 - (jsonStr.length % 4)) % 4;
  const jsonBuf = Buffer.from(jsonStr + ' '.repeat(jsonPad), 'utf8');
  const binBuf = Buffer.concat(bufferChunks);
  const binPad = (4 - (binBuf.length % 4)) % 4;
  const binBufPadded = binPad > 0 ? Buffer.concat([binBuf, Buffer.alloc(binPad)]) : binBuf;

  const totalLength = 12 + 8 + jsonBuf.length + 8 + binBufPadded.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546C67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4E4F534A, 4);

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binBufPadded.length, 0);
  binChunkHeader.writeUInt32LE(0x004E4942, 4);

  return Buffer.concat([header, jsonChunkHeader, jsonBuf, binChunkHeader, binBufPadded]);
}

function keyboardMeshes() {
  const meshes = [];
  const dark = [0.2, 0.2, 0.2];
  const key = [0.35, 0.35, 0.35];
  meshes.push({ name: 'base', position: [0, 0.0075, 0], size: [0.44, 0.015, 0.15], color: dark });
  meshes.push({ name: 'rear', position: [0, 0.019, -0.06], size: [0.44, 0.008, 0.03], color: dark });
  const rows = [
    { count: 14, z: -0.05, w: 0.025 },
    { count: 13, z: -0.02, w: 0.025 },
    { count: 12, z:  0.01, w: 0.025 },
    { count: 11, z:  0.04, w: 0.025 },
  ];
  for (const row of rows) {
    const gap = 0.004;
    const total = row.count * (row.w + gap);
    const start = -total / 2 + row.w / 2;
    for (let i = 0; i < row.count; i++) {
      meshes.push({ name: `key_${row.z}_${i}`, position: [start + i * (row.w + gap), 0.019, row.z], size: [row.w, 0.008, 0.022], color: key });
    }
  }
  meshes.push({ name: 'spacebar', position: [0, 0.019, 0.065], size: [0.16, 0.008, 0.022], color: key });
  return meshes;
}

function tabletMeshes() {
  const meshes = [];
  meshes.push({ name: 'body', position: [0, 0.004, 0], size: [0.18, 0.008, 0.25], color: [0.15, 0.15, 0.15] });
  meshes.push({ name: 'screen', position: [0, 0.009, 0], size: [0.16, 0.002, 0.22], color: [0.07, 0.07, 0.15] });
  meshes.push({ name: 'camera', position: [-0.065, -0.0025, -0.1], size: [0.012, 0.003, 0.012], color: [0.08, 0.08, 0.08] });
  return meshes;
}

console.log('Generating prop models...');
const kbGlb = buildGLB(keyboardMeshes());
await writeFile(resolve(OUTPUT_DIR, 'keyboard.glb'), kbGlb);
console.log(`  ok keyboard.glb (${(kbGlb.length / 1024).toFixed(1)} KB)`);

const tbGlb = buildGLB(tabletMeshes());
await writeFile(resolve(OUTPUT_DIR, 'tablet.glb'), tbGlb);
console.log(`  ok tablet.glb (${(tbGlb.length / 1024).toFixed(1)} KB)`);

console.log('Done!');
