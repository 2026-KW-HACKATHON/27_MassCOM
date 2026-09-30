import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CollectibleProjectError } from './collectible-project.js';
import { collectibleSnapshot, inspectWebmOpus, normalizeMp3, normalizeOggOpus, stripImageMetadata, validateCollectibleMedia, validateCollectibleProject } from './collectible-project-rules.js';
import { photoProject, tinyPng } from './collectible-project-test-support.js';

test('empty draft and source photo round trip preserve original bytes; publish requires explicit mapped finals', () => {
  const project = photoProject(); const saved = validateCollectibleProject(project, true);
  assert.notEqual(saved, project); assert.equal(saved.photo.originalDataUrl, tinyPng);
  const draft = photoProject(); draft.photo = { originalDataUrl: '', width: 0, height: 0 }; draft.derived = {}; draft.rewardGrades = {};
  assert.deepEqual(validateCollectibleProject(draft), draft);
  assert.throws(() => validateCollectibleProject(draft, true), { code: 'COLLECTIBLE_NOT_READY' });
  project.rewardGrades = {};
  assert.throws(() => validateCollectibleProject(project, true), { code: 'COLLECTIBLE_NOT_READY' });
});

test('dynamic grade names and all-off effects are accepted without invented reward mappings', () => {
  const project = photoProject(); project.grades = Array.from({ length: 16 }, (_, i) => ({ id: `grade${i}`, name: `특별 ${i}`, kind: 'special', enabled: true }));
  project.effects[0]!.gradeIds = []; project.motion[0]!.gradeIds = []; project.rewardGrades = {}; project.derived = {};
  assert.equal(validateCollectibleProject(project).grades.length, 16);
  assert.deepEqual(validateCollectibleProject(project).rewardGrades, {});
  project.grades.push({ id: 'too-many', name: '한도', kind: 'special', enabled: true });
  assert.throws(() => validateCollectibleProject(project), { code: 'COLLECTIBLE_INVALID_PROJECT' });
});

test('rejects hostile external media, disguised SVG, invalid magic, oversize bytes and noncanonical base64', () => {
  for (const media of ['https://example.com/a.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,PHN2Zz4=',tinyPng.replace('==','='),'data:image/png;base64,====']) {
    assert.throws(() => validateCollectibleMedia(media,'image',1024), CollectibleProjectError);
  }
  assert.throws(() => validateCollectibleMedia(tinyPng,'image',8), { code: 'COLLECTIBLE_MEDIA_TOO_LARGE' });
});

test('audio mime must match the media bytes and the client length is range-checked before the server recomputes it', () => {
  const project = photoProject(); project.audio = { dataUrl: `data:audio/ogg;base64,${Buffer.from('OggS').toString('base64')}`, mimeType: 'audio/webm', durationSeconds: 5 };
  assert.throws(() => validateCollectibleProject(project), { code: 'COLLECTIBLE_INVALID_PROJECT' });
  project.audio = { dataUrl: `data:audio/webm;base64,${Buffer.from([26,69,223,163]).toString('base64')}`, mimeType: 'audio/webm', durationSeconds: 31 };
  assert.throws(() => validateCollectibleProject(project), { code: 'COLLECTIBLE_INVALID_PROJECT' });
});

test('rejects unknown project metadata, references, duplicate ids, nonfinite settings, unsupported animation and disabled reward grade', () => {
  const mutations: ((p: Record<string, any>) => void)[] = [
    p => p.customerAccountId = 'forged', p => p.crop.zoom = Infinity, p => p.shape = 'svg',
    p => p.grades.push({ ...p.grades[0] }), p => p.effects[0].target = 'missing',
    p => p.effects[0].gradeIds = ['missing'], p => p.motion[0].type = 'script',
    p => p.grades[0].enabled = false, p => p.photoEdits.strokes = [{tool:'erase',points:[{x:0,y:0}],size:2,color:'#000000'}],
    p => p.grades[0].id = '__proto__',
  ];
  for (const mutate of mutations) { const project = photoProject(); mutate(project); assert.throws(() => validateCollectibleProject(project), { code: 'COLLECTIBLE_INVALID_PROJECT' }); }
});

test('story publish count follows actual mode: base zoom uses one original, wider/follow/event need 1/2/3 extra frames', () => {
  for (const [type, count] of [['wide',1],['follow',2],['event',3]] as const) {
    const p = photoProject(); p.story.type = type;
    assert.throws(() => validateCollectibleProject(p, true), { code: 'COLLECTIBLE_NOT_READY' });
    p.story.frames = Array.from({ length: count }, () => ({ dataUrl: tinyPng, previewDataUrl:tinyPng, width: 1, height: 1 }));
    assert.equal(validateCollectibleProject(p, true).story.frames.length,count);
  }
});

test('publication snapshot contains final assets, grade scoped effects and animation but no originals or source editor metadata', () => {
  const snapshot = collectibleSnapshot(photoProject(), 'project-id', 'publication-id', 'custom');
  assert.equal(snapshot.animation,'float'); assert.equal(snapshot.gradeName,'가게 특별판'); assert.equal(snapshot.effects.length,1);
  assert.deepEqual(Object.keys(snapshot).sort(), ['projectId','publicationId','gradeId','gradeName','name','shape','theme','imageDataUrl','thumbnailDataUrl','thickness','angle','animation','greeting','audio','story','effects'].sort());
  assert.equal(collectibleSnapshot(photoProject(),'p','pub','bronze').effects.length,0);
});

test('real image dimensions prevent spoofed pixel counts and oversized decode even when metadata claims a tiny photo',()=>{
  const p=photoProject();p.photo.width=2;
  assert.throws(()=>validateCollectibleProject(p),{code:'COLLECTIBLE_INVALID_PROJECT'});
  const oversized=Buffer.from(tinyPng.split(',')[1]!,'base64');oversized.writeUInt32BE(5000,16);
  assert.throws(()=>validateCollectibleMedia(`data:image/png;base64,${oversized.toString('base64')}`,'image',1024),{code:'COLLECTIBLE_INVALID_PROJECT'});
});

test('safe story preview is required at publication and camera/text metadata is removed from customer final media',()=>{
  const bytes=Buffer.from(tinyPng.split(',')[1]!,'base64');const end=bytes.indexOf(Buffer.from('IEND'))-4;
  const content=Buffer.from('camera\u0000private-location');const chunk=Buffer.alloc(content.length+12);chunk.writeUInt32BE(content.length,0);
  chunk.write('tEXt',4);content.copy(chunk,8);
  const metadataUrl=`data:image/png;base64,${Buffer.concat([bytes.subarray(0,end),chunk,bytes.subarray(end)]).toString('base64')}`;
  const p=photoProject();p.photo.originalDataUrl=metadataUrl;p.derived.custom!.imageDataUrl=metadataUrl;
  p.story.type='wide';p.story.cartoon=70;p.story.frames=[{dataUrl:metadataUrl,width:1,height:1}];
  assert.throws(()=>validateCollectibleProject(p,true),{code:'COLLECTIBLE_NOT_READY'});
  p.story.frames[0]!.previewDataUrl=tinyPng;
  validateCollectibleProject(p,true);
  const snapshot=collectibleSnapshot(p,'p','pub','custom');assert.equal(snapshot.imageDataUrl,tinyPng);
  assert.deepEqual(snapshot.story.frames,[{dataUrl:tinyPng,width:1,height:1}]);assert.equal(snapshot.story.cartoon,0);
  assert.equal(p.photo.originalDataUrl,metadataUrl);assert.equal(stripImageMetadata(metadataUrl),tinyPng);
});

test('optional sanitized effect base and target masks must refer to this grade actual effect targets',()=>{
  const p=photoProject();p.derived.custom!.baseDataUrl=tinyPng;p.derived.custom!.effectMasks={surface:tinyPng};
  const snapshot=collectibleSnapshot(validateCollectibleProject(p,true),'p','pub','custom');
  assert.equal(snapshot.baseDataUrl,tinyPng);assert.deepEqual(snapshot.effectMasks,{surface:tinyPng});
  p.derived.custom!.effectMasks={missing:tinyPng};
  assert.throws(()=>validateCollectibleProject(p),{code:'COLLECTIBLE_INVALID_PROJECT'});
});

test('JPEG segment dimension guard permits EXIF orientation swaps and publication removes APP metadata plus trailing bytes',()=>{
  const exif=Buffer.from('Exif\u0000private-location');const app=Buffer.alloc(exif.length+4);app[0]=255;app[1]=225;app.writeUInt16BE(exif.length+2,2);exif.copy(app,4);
  const header=Buffer.from([255,216]);const frame=Buffer.from([255,192,0,11,8,0,1,0,2,1,1,17,0]);
  const scan=Buffer.from([255,218,0,8,1,1,0,0,63,0,1,2,255,0,3,255,217]);
  const bytes=Buffer.concat([header,app,frame,scan,Buffer.from('private-after-end')]);const url=`data:image/jpeg;base64,${bytes.toString('base64')}`;
  const p=photoProject();p.photo={originalDataUrl:url,width:1,height:2};assert.equal(validateCollectibleProject(p).photo.height,2);
  assert.deepEqual(Buffer.from(stripImageMetadata(url).split(',')[1]!,'base64'),Buffer.concat([header,frame,scan]));
});

test('WebP extended dimensions are bounded and EXIF chunk flags are removed while encoded front bytes remain',()=>{
  const vp8x=Buffer.alloc(18);vp8x.write('VP8X',0);vp8x.writeUInt32LE(10,4);vp8x[8]=0x08;vp8x.writeUIntLE(2,12,3);vp8x.writeUIntLE(3,15,3);
  const exif=Buffer.alloc(12);exif.write('EXIF',0);exif.writeUInt32LE(4,4);exif.write('meta',8);
  const header=Buffer.alloc(12);header.write('RIFF',0);header.writeUInt32LE(4+vp8x.length+exif.length,4);header.write('WEBP',8);
  const url=`data:image/webp;base64,${Buffer.concat([header,vp8x,exif]).toString('base64')}`;
  const p=photoProject();p.photo={originalDataUrl:url,width:3,height:4};validateCollectibleProject(p);
  const final=Buffer.from(stripImageMetadata(url).split(',')[1]!,'base64');assert.equal(final.includes(Buffer.from('EXIF')),false);assert.equal(final[20],0);
  vp8x.writeUIntLE(5000,12,3);const huge=`data:image/webp;base64,${Buffer.concat([header,vp8x,exif]).toString('base64')}`;
  assert.throws(()=>validateCollectibleMedia(huge,'image',1024),{code:'COLLECTIBLE_INVALID_PROJECT'});
});

// MPEG-1 Layer III, 128 kbps, 44.1 kHz, no padding: 417-byte frames of 1152 samples.
function mp3Frames(count: number): Buffer {
  const frame = Buffer.alloc(417); frame.set([0xff, 0xfb, 0x90, 0x00]);
  return Buffer.concat(Array.from({ length: count }, () => frame));
}
function id3v2(text: string): Buffer {
  const frame = Buffer.concat([Buffer.from('TIT2'), Buffer.from([0, 0, 0, Buffer.byteLength(text) + 1, 0, 0, 3]), Buffer.from(text)]);
  const size = frame.length;
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]), frame]);
}
const mp3Url = (bytes: Buffer) => `data:audio/mpeg;base64,${bytes.toString('base64')}`;

test('MP3 upload is stored without ID3v2, ID3v1 or APE tags and with the length counted from its frames', () => {
  const frames = mp3Frames(100);
  const id3v1 = Buffer.alloc(128); id3v1.write('TAG사장님 메모', 'utf8');
  const ape = Buffer.alloc(32); ape.write('APETAGEX'); ape.writeUInt32LE(2000, 8); ape.writeUInt32LE(32, 12);
  const tagged = Buffer.concat([id3v2('사장님 이름 010-0000-0000'), frames, ape, id3v1]);
  const normalized = normalizeMp3(tagged);
  assert.deepEqual(normalized.bytes, frames);
  assert.equal(normalized.durationSeconds, Math.round(100 * 1152 / 44100 * 100) / 100);
  const project = photoProject(); project.audio = { dataUrl: mp3Url(tagged), mimeType: 'audio/mpeg', durationSeconds: 29 };
  const saved = validateCollectibleProject(project);
  assert.equal(saved.audio!.dataUrl, mp3Url(frames)); assert.equal(saved.audio!.durationSeconds, normalized.durationSeconds);
  assert.equal(Buffer.from(saved.audio!.dataUrl.split(',')[1]!, 'base64').includes(Buffer.from('사장님')), false);
  // A cut-off last frame is dropped rather than stored.
  assert.deepEqual(normalizeMp3(Buffer.concat([frames, frames.subarray(0, 200)])).bytes, frames);
});

test('MP3 upload rejects an ID3 tag hiding HTML, junk between frames, reserved headers and audio longer than 30 seconds', () => {
  const html = Buffer.from('<html><script>alert(1)</script></html>');
  for (const bad of [
    Buffer.concat([id3v2('title'), html]), Buffer.concat([Buffer.from('ID3'), html]), html,
    Buffer.concat([mp3Frames(2), html, mp3Frames(2)]),
    Buffer.from([0xff, 0xfb, 0xf0, 0x00, ...Buffer.alloc(413)]), // bitrate index 15 is reserved
    Buffer.from([0xff, 0xfd, 0x90, 0x00, ...Buffer.alloc(413)]), // Layer II is not MP3
  ]) {
    const project = photoProject(); project.audio = { dataUrl: mp3Url(bad), mimeType: 'audio/mpeg', durationSeconds: 5 };
    assert.throws(() => validateCollectibleProject(project), { code: 'COLLECTIBLE_INVALID_PROJECT' });
  }
  const long = photoProject(); long.audio = { dataUrl: mp3Url(mp3Frames(1250)), mimeType: 'audio/mpeg', durationSeconds: 5 };
  assert.throws(() => validateCollectibleProject(long), { code: 'COLLECTIBLE_MEDIA_TOO_LARGE' });
});

function jpegWithExif(orientation: number, secret: string): { url: string; header: Buffer; frame: Buffer; scan: Buffer } {
  // IFD0 (big-endian): Orientation, then an ASCII tag carrying private text (like GPS/device metadata).
  const tiff = Buffer.alloc(8 + 2 + 24 + 4); tiff.write('MM', 0); tiff.writeUInt16BE(42, 2); tiff.writeUInt32BE(8, 4); tiff.writeUInt16BE(2, 8);
  tiff.writeUInt16BE(0x0112, 10); tiff.writeUInt16BE(3, 12); tiff.writeUInt32BE(1, 14); tiff.writeUInt16BE(orientation, 18);
  tiff.writeUInt16BE(0x010f, 22); tiff.writeUInt16BE(2, 24); tiff.writeUInt32BE(Buffer.byteLength(secret), 26); tiff.writeUInt32BE(tiff.length, 30);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff, Buffer.from(secret)]);
  const app = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(payload.length + 2) >> 8, (payload.length + 2) & 255]), payload]);
  const header = Buffer.from([255, 216]); const frame = Buffer.from([255, 192, 0, 11, 8, 0, 1, 0, 2, 1, 1, 17, 0]);
  const scan = Buffer.from([255, 218, 0, 8, 1, 1, 0, 0, 63, 0, 1, 2, 255, 0, 3, 255, 217]);
  return { url: `data:image/jpeg;base64,${Buffer.concat([header, app, frame, scan]).toString('base64')}`, header, frame, scan };
}

test('stored JPEG originals drop EXIF text but keep the orientation the browser used for the saved width and height', () => {
  const rotated = jpegWithExif(6, 'GPS 37.61N 127.06E Galaxy');
  const p = photoProject(); p.photo = { originalDataUrl: rotated.url, width: 1, height: 2 };
  const saved = Buffer.from(validateCollectibleProject(p).photo.originalDataUrl.split(',')[1]!, 'base64');
  assert.equal(saved.includes(Buffer.from('GPS')), false); assert.equal(saved.includes(Buffer.from('Galaxy')), false);
  const orientationOnly = Buffer.from([0xff, 0xe1, 0, 34, ...Buffer.from('Exif\0\0', 'latin1'), 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(saved, Buffer.concat([rotated.header, orientationOnly, rotated.frame, rotated.scan]));
  const upright = jpegWithExif(1, 'GPS 37.61N');
  const q = photoProject(); q.photo = { originalDataUrl: upright.url, width: 2, height: 1 };
  assert.deepEqual(Buffer.from(validateCollectibleProject(q).photo.originalDataUrl.split(',')[1]!, 'base64'), Buffer.concat([upright.header, upright.frame, upright.scan]));
  // Story originals are stripped the same way.
  const r = photoProject(); r.story = { type: 'wide', frames: [{ dataUrl: upright.url, width: 2, height: 1 }], cartoon: 0, strength: 50 };
  assert.equal(Buffer.from(validateCollectibleProject(r).story.frames[0]!.dataUrl.split(',')[1]!, 'base64').includes(Buffer.from('GPS')), false);
});

function webp(chunks: Buffer[]): string {
  const header = Buffer.alloc(12); header.write('RIFF', 0); header.writeUInt32LE(4 + chunks.reduce((n, c) => n + c.length, 0), 4); header.write('WEBP', 8);
  return `data:image/webp;base64,${Buffer.concat([header, ...chunks]).toString('base64')}`;
}
function chunk(type: string, data: Buffer): Buffer { const head = Buffer.alloc(8); head.write(type, 0); head.writeUInt32LE(data.length, 4); return Buffer.concat([head, data, Buffer.alloc(data.length % 2)]); }

test('stored WebP keeps only image chunks, and animated WebP is rejected', () => {
  const vp8x = Buffer.alloc(10); vp8x[0] = 0x08 | 0x04 | 0x20 | 0x10; vp8x.writeUIntLE(2, 4, 3); vp8x.writeUIntLE(3, 7, 3);
  const url = webp([chunk('VP8X', vp8x), chunk('ICCP', Buffer.from('profile')), chunk('ALPH', Buffer.from('al')), chunk('EXIF', Buffer.from('GPS')), chunk('XMP ', Buffer.from('<x/>')), chunk('ZZZZ', Buffer.from('owner memo'))]);
  const p = photoProject(); p.photo = { originalDataUrl: url, width: 3, height: 4 };
  const saved = Buffer.from(validateCollectibleProject(p).photo.originalDataUrl.split(',')[1]!, 'base64');
  for (const text of ['GPS', 'profile', '<x/>', 'owner memo']) assert.equal(saved.includes(Buffer.from(text)), false, text);
  assert.equal(saved.includes(Buffer.from('ALPH')), true); assert.equal(saved[20], 0x10); assert.equal(saved.readUInt32LE(4), saved.length - 8);
  const animatedFlag = Buffer.from(vp8x); animatedFlag[0] = 0x02;
  assert.throws(() => validateCollectibleMedia(webp([chunk('VP8X', animatedFlag)]), 'image', 1024), { code: 'COLLECTIBLE_INVALID_PROJECT' });
  const plain = Buffer.from(vp8x); plain[0] = 0;
  assert.throws(() => validateCollectibleMedia(webp([chunk('VP8X', plain), chunk('ANIM', Buffer.alloc(6))]), 'image', 1024), { code: 'COLLECTIBLE_INVALID_PROJECT' });
});

test('stored PNG originals drop text and other ancillary chunks', () => {
  const png = Buffer.from(tinyPng.split(',')[1]!, 'base64');
  const text = Buffer.concat([Buffer.from([0, 0, 0, 12]), Buffer.from('tEXtAuthor\0Owner'), Buffer.alloc(4)]);
  const tagged = Buffer.concat([png.subarray(0, 33), text, png.subarray(33)]);
  const p = photoProject(); p.photo = { originalDataUrl: `data:image/png;base64,${tagged.toString('base64')}`, width: 1, height: 1 };
  assert.equal(validateCollectibleProject(p).photo.originalDataUrl, tinyPng);
});

test('derived images are capped at the editor canvas sizes while originals may stay large', () => {
  const sized = (width: number, height: number) => {
    const png = Buffer.from(tinyPng.split(',')[1]!, 'base64'); png.writeUInt32BE(width, 16); png.writeUInt32BE(height, 20);
    return `data:image/png;base64,${png.toString('base64')}`;
  };
  const ok = photoProject(); ok.photo = { originalDataUrl: sized(4000, 3000), width: 4000, height: 3000 };
  ok.derived.bronze = { imageDataUrl: sized(512, 512), thumbnailDataUrl: sized(160, 160), baseDataUrl: sized(512, 512) };
  ok.story = { type: 'wide', frames: [{ dataUrl: sized(2000, 1000), width: 2000, height: 1000, previewDataUrl: sized(512, 320) }], cartoon: 0, strength: 50 };
  validateCollectibleProject(ok, true);
  const mutations: ((p: ReturnType<typeof photoProject>) => void)[] = [
    p => { p.derived.bronze!.imageDataUrl = sized(513, 512); },
    p => { p.derived.bronze!.thumbnailDataUrl = sized(161, 160); },
    p => { p.derived.bronze = { ...p.derived.bronze!, baseDataUrl: sized(512, 1024) }; },
    p => { p.story = { type: 'wide', frames: [{ dataUrl: sized(2000, 1000), width: 2000, height: 1000, previewDataUrl: sized(1024, 640) }], cartoon: 0, strength: 50 }; },
  ];
  for (const mutate of mutations) { const p = photoProject(); mutate(p); assert.throws(() => validateCollectibleProject(p), { code: 'COLLECTIBLE_INVALID_PROJECT' }); }
});

// Independent Ogg page builder (CRC-32 poly 0x04C11DB7, checksum field zeroed) for recorder-shaped Opus streams.
function crc32Ogg(page: Buffer): number {
  let crc = 0;
  for (const byte of page) { crc ^= byte << 24; for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1; crc >>>= 0; }
  return crc;
}
function oggPageOf(flags: number, granule: bigint, sequence: number, packet: Buffer, serial = 0x1234): Buffer {
  const lacing: number[] = []; let left = packet.length; while (left >= 255) { lacing.push(255); left -= 255; } lacing.push(left);
  const header = Buffer.alloc(27); header.write('OggS'); header[5] = flags; header.writeBigInt64LE(granule, 6); header.writeUInt32LE(serial, 14);
  header.writeUInt32LE(sequence, 18); header[26] = lacing.length;
  const page = Buffer.concat([header, Buffer.from(lacing), packet]); page.writeUInt32LE(crc32Ogg(page), 22); return page;
}
function opusOgg(seconds: number, comment = 'ARTIST=사장님 010-1234-5678'): Buffer {
  const head = Buffer.alloc(19); head.write('OpusHead'); head[8] = 1; head[9] = 1; head.writeUInt16LE(312, 10); head.writeUInt32LE(48000, 12);
  const vendor = Buffer.from('Mozilla'); const note = Buffer.from(comment);
  const tags = Buffer.concat([Buffer.from('OpusTags'), Buffer.from([vendor.length, 0, 0, 0]), vendor, Buffer.from([1, 0, 0, 0]), Buffer.from([note.length, 0, 0, 0]), note]);
  const audio = [1, 2, 3].map(step => oggPageOf(step === 3 ? 4 : 0, BigInt(Math.round(seconds * 48000 * step / 3) + 312), step + 1, Buffer.alloc(300, step)));
  return Buffer.concat([oggPageOf(2, 0n, 0, head), oggPageOf(0, 0n, 1, tags), ...audio]);
}

test('Ogg Opus recordings get empty OpusTags and a length from the last granule position, not from the client', () => {
  const recorded = opusOgg(5);
  const normalized = normalizeOggOpus(recorded);
  assert.equal(normalized.durationSeconds, 5);
  assert.equal(normalized.bytes.includes(Buffer.from('사장님')), false); assert.equal(normalized.bytes.includes(Buffer.from('Mozilla')), false);
  assert.deepEqual(normalizeOggOpus(normalized.bytes).bytes, normalized.bytes); // the rewritten page has a valid checksum
  const project = photoProject(); project.audio = { dataUrl: `data:audio/ogg;base64,${opusOgg(20).toString('base64')}`, mimeType: 'audio/ogg', durationSeconds: 2 };
  assert.equal(validateCollectibleProject(project).audio!.durationSeconds, 20);
  assert.throws(() => normalizeOggOpus(opusOgg(31)), { code: 'COLLECTIBLE_MEDIA_TOO_LARGE' });
  const corrupt = Buffer.from(recorded); corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1;
  const vorbis = Buffer.from(recorded); vorbis.write('OpusHeaX', 28);
  const chained = Buffer.concat([recorded, oggPageOf(2, 0n, 0, Buffer.alloc(19), 0x9999)]);
  for (const bad of [Buffer.concat([recorded, Buffer.from('<html>')]), corrupt, vorbis, chained, recorded.subarray(0, 60)]) {
    assert.throws(() => normalizeOggOpus(bad), { code: 'COLLECTIBLE_INVALID_PROJECT' });
  }
});

const ebml = (id: number[], payload: Buffer | string, unknown = false) => {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const size = Buffer.alloc(8); size[0] = 1; if (unknown) size.fill(0xff, 1); else size.writeUIntBE(body.length, 2, 6);
  return Buffer.concat([Buffer.from(id), size, body]);
};
const uintBytes = (value: number) => { const out = Buffer.alloc(4); out.writeUInt32BE(value); return out; };
function opusWebm({ lastCluster = 4980, info = [] as Buffer[], extra = [] as Buffer[], codec = 'A_OPUS', unknownClusters = true } = {}): Buffer {
  const header = ebml([0x1a, 0x45, 0xdf, 0xa3], ebml([0x42, 0x82], 'webm'));
  const infoElement = ebml([0x15, 0x49, 0xa9, 0x66], Buffer.concat([ebml([0x2a, 0xd7, 0xb1], uintBytes(1_000_000)), ebml([0x4d, 0x80], 'Chrome'), ...info]));
  const tracks = ebml([0x16, 0x54, 0xae, 0x6b], ebml([0xae], Buffer.concat([ebml([0xd7], Buffer.from([1])), ebml([0x83], Buffer.from([2])), ebml([0x86], codec)])));
  const block = (relative: number) => ebml([0xa3], Buffer.from([0x81, (relative >> 8) & 0xff, relative & 0xff, 0x80, 1, 2, 3]));
  const cluster = (timecode: number, blocks: number[]) => ebml([0x1f, 0x43, 0xb6, 0x75], Buffer.concat([ebml([0xe7], uintBytes(timecode)), ...blocks.map(block)]), unknownClusters);
  return Buffer.concat([header, ebml([0x18, 0x53, 0x80, 0x67], Buffer.concat([infoElement, tracks, cluster(0, [0, 20, 40]), cluster(lastCluster, [0, 20]), ...extra]), true)]);
}

test('WebM Opus recordings take their length from the cluster/block times and reject tag, title and non-Opus content', () => {
  assert.equal(inspectWebmOpus(opusWebm()).durationSeconds, 5);
  assert.equal(inspectWebmOpus(opusWebm({ unknownClusters: false })).durationSeconds, 5);
  const project = photoProject(); project.audio = { dataUrl: `data:audio/webm;base64,${opusWebm({ lastCluster: 19980 }).toString('base64')}`, mimeType: 'audio/webm', durationSeconds: 1 };
  assert.equal(validateCollectibleProject(project).audio!.durationSeconds, 20);
  assert.throws(() => inspectWebmOpus(opusWebm({ lastCluster: 31000 })), { code: 'COLLECTIBLE_MEDIA_TOO_LARGE' });
  const long = Buffer.alloc(8); long.writeDoubleBE(40000);
  assert.throws(() => inspectWebmOpus(opusWebm({ info: [ebml([0x44, 0x89], long)] })), { code: 'COLLECTIBLE_MEDIA_TOO_LARGE' });
  for (const bad of [
    opusWebm({ info: [ebml([0x7b, 0xa9], '사장님 녹음')] }),
    opusWebm({ extra: [ebml([0x12, 0x54, 0xc3, 0x67], ebml([0x73, 0x73], 'owner'))] }),
    opusWebm({ extra: [ebml([0x19, 0x41, 0xa4, 0x69], 'cover.jpg')] }),
    opusWebm({ codec: 'A_VORBIS' }),
    opusWebm({ extra: [ebml([0x1f, 0x43, 0xb6, 0x75], Buffer.concat([ebml([0xe7], uintBytes(5000)), ebml([0x45, 0xa3], '숨긴 글')]))] }),
    Buffer.concat([Buffer.from('<html>'), opusWebm()]),
  ]) assert.throws(() => inspectWebmOpus(bad), { code: 'COLLECTIBLE_INVALID_PROJECT' });
});

test('JPEG stripping keeps only image segments and a thumbnail-free JFIF header', () => {
  const segment = (marker: number, payload: Buffer | string) => {
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    return Buffer.concat([Buffer.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
  };
  const jfifWithThumbnail = Buffer.concat([Buffer.from('JFIF\0', 'latin1'), Buffer.from([1, 2, 1, 0, 72, 0, 72, 1, 1]), Buffer.from('THUMBPIXEL')]);
  const dqt = segment(0xdb, Buffer.alloc(65)); const dht = segment(0xc4, Buffer.alloc(20, 1)); const dri = segment(0xdd, Buffer.from([0, 4]));
  const sof = Buffer.from([255, 192, 0, 11, 8, 0, 1, 0, 2, 1, 1, 17, 0]);
  const scan = Buffer.from([255, 218, 0, 8, 1, 1, 0, 0, 63, 0, 1, 2, 255, 0, 3, 255, 208, 4, 255, 217]);
  const bytes = Buffer.concat([Buffer.from([255, 216]), segment(0xe0, jfifWithThumbnail), segment(0xfe, '사장님 메모'), segment(0xed, 'Photoshop IPTC'),
    segment(0xe2, 'ICC_PROFILE\0profile'), dqt, segment(0xf0, 'JPG0 reserved'), dht, dri, sof, segment(0xdc, Buffer.from([0, 1])), scan]);
  const url = `data:image/jpeg;base64,${bytes.toString('base64')}`;
  const minimalJfif = segment(0xe0, Buffer.concat([Buffer.from('JFIF\0', 'latin1'), Buffer.from([1, 2, 1, 0, 72, 0, 72, 0, 0])]));
  assert.deepEqual(Buffer.from(stripImageMetadata(url).split(',')[1]!, 'base64'), Buffer.concat([Buffer.from([255, 216]), minimalJfif, dqt, dht, dri, sof, scan]));
});

test('rejects lone UTF-16 surrogates in every string field but keeps valid pairs, so jsonb storage cannot 500', () => {
  const lone = ['\ud800', 'a\udc00b', '\ud83d', '\ude00\ud83d'];
  for (const text of lone) {
    const named = photoProject(); named.name = `이름${text}`;
    assert.throws(() => validateCollectibleProject(named), { code: 'COLLECTIBLE_INVALID_PROJECT' }, `name ${JSON.stringify(text)}`);
    const greeting = photoProject(); greeting.greeting = text;
    assert.throws(() => validateCollectibleProject(greeting), { code: 'COLLECTIBLE_INVALID_PROJECT' }, `greeting ${JSON.stringify(text)}`);
    const theme = photoProject(); theme.theme.name = text;
    assert.throws(() => validateCollectibleProject(theme), { code: 'COLLECTIBLE_INVALID_PROJECT' }, `theme ${JSON.stringify(text)}`);
    const sticker = photoProject(); sticker.stickers = [{ id: 'emoji', kind: 'emoji', text: `☕${text}`, x: .5, y: .5, size: 40, rotation: 0, color: '#ffffff', order: 0 }];
    assert.throws(() => validateCollectibleProject(sticker), { code: 'COLLECTIBLE_INVALID_PROJECT' }, `sticker ${JSON.stringify(text)}`);
    const grade = photoProject(); grade.grades[0]!.name = text;
    assert.throws(() => validateCollectibleProject(grade), { code: 'COLLECTIBLE_INVALID_PROJECT' }, `grade ${JSON.stringify(text)}`);
  }
  const pairs = photoProject(); pairs.name = '커피 ☕ 😀 가게 𝒜'; pairs.greeting = '어서 오세요 👋'; pairs.stickers = [{ id: 'emoji', kind: 'emoji', text: '😀', x: .5, y: .5, size: 40, rotation: 0, color: '#ffffff', order: 0 }];
  const saved = validateCollectibleProject(pairs);
  assert.equal(saved.name, '커피 ☕ 😀 가게 𝒜');
  assert.equal(saved.stickers[0]!.text, '😀');
  // 저장본은 jsonb가 받는 well-formed JSON이다.
  assert.equal(JSON.stringify(saved).includes('\\ud8'), false);
});
