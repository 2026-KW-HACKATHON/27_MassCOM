import { CollectibleProjectError, type CollectibleDetail, type CollectibleProject } from './collectible-project.js';

const mb = 1024 * 1024;
const imageMimes = ['image/png', 'image/jpeg', 'image/webp'];
const audioMimes = ['audio/mpeg', 'audio/mp3', 'audio/webm', 'audio/ogg'];
const identifier = /^[a-zA-Z0-9_-]{1,64}$/;
const hexColor = /^#[0-9a-f]{6}$/i;
// The editor renders finals, bases, masks and story previews on 512 px canvases and thumbnails at 160 px; originals may be larger.
const editorSide = 512;
const thumbnailSide = 160;

function invalid(): never { throw new CollectibleProjectError('COLLECTIBLE_INVALID_PROJECT'); }
function object(value: unknown, keys: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).some(key => !keys.includes(key) && !optional.includes(key)) || keys.some(key => !(key in obj))) invalid();
  return obj;
}
function string(value: unknown, max: number, empty = false): asserts value is string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) invalid();
}
function number(value: unknown, min: number, max: number, integer = false): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) invalid();
}
function enumeration(value: unknown, options: string[]): void { if (typeof value !== 'string' || !options.includes(value)) invalid(); }
function array(value: unknown, max: number, min = 0): unknown[] { if (!Array.isArray(value) || value.length < min || value.length > max) invalid(); return value; }
function id(value: unknown): void { if (typeof value !== 'string' || !identifier.test(value) || ['__proto__','prototype','constructor'].includes(value)) invalid(); }
function color(value: unknown): void { if (typeof value !== 'string' || !hexColor.test(value)) invalid(); }
function uniqueIds(values: Record<string, unknown>[]): void { const ids = values.map(value => value.id); if (new Set(ids).size !== ids.length) invalid(); }

// Only inline supported media is accepted. No original file name, EXIF metadata, URL, or arbitrary SVG is interpreted by the server.
export function validateCollectibleMedia(value: unknown, kind: 'image' | 'audio', maxBytes: number, maxSide = 4096): string {
  if (typeof value !== 'string') invalid();
  if (value.length > Math.ceil(maxBytes / 3) * 4 + 64) throw new CollectibleProjectError('COLLECTIBLE_MEDIA_TOO_LARGE');
  const match = value.match(/^data:([a-z]+\/[a-z0-9]+);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || !(kind === 'image' ? imageMimes : audioMimes).includes(match[1]!)) invalid();
  const bytes = Buffer.from(match[2]!, 'base64');
  if (bytes.length > maxBytes) throw new CollectibleProjectError('COLLECTIBLE_MEDIA_TOO_LARGE');
  if (bytes.length === 0 || bytes.toString('base64') !== match[2]) invalid();
  const mime = match[1]!;
  const signature = mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : mime === 'image/webp' ? bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
    : mime === 'audio/ogg' ? bytes.subarray(0, 4).toString() === 'OggS'
    : mime === 'audio/webm' ? bytes.subarray(0, 4).equals(Buffer.from([26,69,223,163]))
    : bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 255 && ((bytes[1] ?? 0) & 224) === 224);
  if (!signature) invalid();
  if (kind === 'image') {
    if (mime === 'image/webp' && animatedWebp(bytes)) invalid();
    const size = imageDimensions(bytes, mime);
    if (!size || size.width < 1 || size.height < 1 || size.width > maxSide || size.height > maxSide || size.width * size.height > 16_777_216) invalid();
  }
  return mime;
}

// Animated WebP (VP8X animation flag or ANIM/ANMF chunks) would play frames the server never inspected.
function animatedWebp(bytes: Buffer): boolean {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString('latin1', offset, offset + 4);
    if (type === 'ANIM' || type === 'ANMF' || (type === 'VP8X' && offset + 8 < bytes.length && (bytes[offset + 8]! & 0x02))) return true;
    offset += 8 + bytes.readUInt32LE(offset + 4) + (bytes.readUInt32LE(offset + 4) % 2);
  }
  return false;
}

function imageDimensions(bytes: Buffer, mime: string): {width: number; height: number} | undefined {
  if (mime === 'image/png') {
    if (bytes.length < 33 || bytes.readUInt32BE(8) !== 13 || bytes.subarray(12,16).toString() !== 'IHDR') return undefined;
    return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
  }
  if (mime === 'image/webp') {
    const type = bytes.subarray(12,16).toString();
    if (type === 'VP8X' && bytes.length >= 30) return {width:1+bytes.readUIntLE(24,3),height:1+bytes.readUIntLE(27,3)};
    if (type === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      const bits=bytes.readUInt32LE(21); return {width:1+(bits&0x3fff),height:1+((bits>>>14)&0x3fff)};
    }
    if (type === 'VP8 ' && bytes.length >= 30 && bytes.subarray(23,26).equals(Buffer.from([157,1,42]))) return {width:bytes.readUInt16LE(26)&0x3fff,height:bytes.readUInt16LE(28)&0x3fff};
    return undefined;
  }
  let offset=2;
  while (offset+4<=bytes.length) {
    if (bytes[offset++]!==255) return undefined;
    while (bytes[offset]===255) offset++;
    const marker=bytes[offset++]; if (marker===undefined || marker===0xda || marker===0xd9) return undefined;
    if (marker===0x01 || (marker>=0xd0 && marker<=0xd7)) continue;
    if (offset+2>bytes.length) return undefined;
    const length=bytes.readUInt16BE(offset); if(length<2 || offset+length>bytes.length) return undefined;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      if(length<8) return undefined; return {width:bytes.readUInt16BE(offset+5),height:bytes.readUInt16BE(offset+3)};
    }
    offset+=length;
  }
  return undefined;
}

export function validateCollectibleProject(value: unknown, publish = false): CollectibleProject {
  const p = object(value, ['schemaVersion','name','campaignId','theme','photo','shape','crop','photoEdits','style','baseColor','photoColor','relief','stickers','grades','effects','motion','thickness','angle','greeting','audio','story','derived','rewardGrades']);
  if (p.schemaVersion !== 1) invalid();
  string(p.name, 80); string(p.campaignId, 120, true); const theme = object(p.theme, ['name']); string(theme.name, 80);
  enumeration(p.shape, ['circle','stamp','serrated']); enumeration(p.style, ['original','incised','raised']);
  color(p.baseColor); number(p.photoColor, 0, 100); number(p.relief, 0, 100); number(p.thickness, 1, 24); number(p.angle, -180, 180);
  const photo = object(p.photo, ['originalDataUrl','width','height']);
  if (photo.originalDataUrl === '') { if (photo.width !== 0 || photo.height !== 0 || publish) throw new CollectibleProjectError(publish ? 'COLLECTIBLE_NOT_READY' : 'COLLECTIBLE_INVALID_PROJECT'); }
  else {
    const mime=validateCollectibleMedia(photo.originalDataUrl, 'image', 3 * mb); number(photo.width, 1, 4096, true); number(photo.height, 1, 4096, true);
    const actual=imageDimensions(Buffer.from((photo.originalDataUrl as string).split(',')[1]!,'base64'),mime);
    if(!actual || !((actual.width===photo.width && actual.height===photo.height)
      || (mime==='image/jpeg' && actual.height===photo.width && actual.width===photo.height))) invalid();
  }
  const crop = object(p.crop, ['x','y','zoom']); number(crop.x, -1, 1); number(crop.y, -1, 1); number(crop.zoom, 1, 8);
  const edits = object(p.photoEdits, ['brightness','contrast','merge','simplify','cartoon','strokes']);
  number(edits.brightness, -100, 100); number(edits.contrast, -100, 100);
  for (const key of ['merge','simplify','cartoon']) number(edits[key], 0, 100);
  for (const raw of array(edits.strokes, 100)) {
    const stroke = object(raw, ['tool','points','size','color']); enumeration(stroke.tool, ['clean','erase','restore','color']); color(stroke.color); number(stroke.size, 0.01, 0.2);
    for (const pointRaw of array(stroke.points, 1000, 1)) { const point = object(pointRaw, ['x','y']); number(point.x, 0, 1); number(point.y, 0, 1); }
  }
  const stickers = array(p.stickers, 30).map(raw => object(raw, ['id','kind','text','x','y','size','rotation','color','order'])); uniqueIds(stickers);
  for (const sticker of stickers) { id(sticker.id); enumeration(sticker.kind,['text','emoji']); string(sticker.text, 80); number(sticker.x,0,1); number(sticker.y,0,1); number(sticker.size,8,120); number(sticker.rotation,-180,180); color(sticker.color); number(sticker.order,0,100,true); }
  const grades = array(p.grades, 16, 1).map(raw => object(raw, ['id','name','kind','enabled'])); uniqueIds(grades);
  for (const grade of grades) { id(grade.id); string(grade.name, 40); enumeration(grade.kind, ['basic','special']); if (typeof grade.enabled !== 'boolean') invalid(); }
  const gradeIds = grades.map(grade => grade.id as string);
  const scope = (value: unknown) => { const refs = array(value, 16); if (new Set(refs).size !== refs.length || refs.some(ref => !gradeIds.includes(ref as string))) invalid(); };
  const effects = array(p.effects, 64).map(raw => object(raw,['id','type','target','gradeIds','strength','color','roughness'])); uniqueIds(effects);
  for (const effect of effects) { id(effect.id); enumeration(effect.type,['metallic','hologram','pearl','matte','glow','enamel','glass']); if (!['surface','photo','border', ...stickers.map(s => s.id)].includes(effect.target)) invalid(); scope(effect.gradeIds); number(effect.strength,0,100); number(effect.roughness,0,100); color(effect.color); }
  const motions = array(p.motion, 10).map(raw => object(raw,['id','type','gradeIds'])); uniqueIds(motions);
  for (const motion of motions) { id(motion.id); enumeration(motion.type,['still','rotate','shine','float','stamp','sparkle','pulse','confetti']); scope(motion.gradeIds); }
  string(p.greeting, 300, true);
  let mp3: { dataUrl: string; durationSeconds: number } | undefined;
  if (p.audio !== null) {
    const audio = object(p.audio,['dataUrl','mimeType','durationSeconds']); const mime = validateCollectibleMedia(audio.dataUrl,'audio',mb);
    if (audio.mimeType !== mime) invalid(); number(audio.durationSeconds,0.1,30);
    // MP3 uploads: drop ID3/APE tags and keep only whole MPEG frames; the stored length comes from the frames, not the client.
    // Browser recordings (WebM/Ogg) keep the client length, which is already bounded to 0.1–30 s above and by the 1 MiB cap.
    if (mime === 'audio/mpeg' || mime === 'audio/mp3') {
      const normalized = normalizeMp3(Buffer.from((audio.dataUrl as string).slice((audio.dataUrl as string).indexOf(',') + 1), 'base64'));
      mp3 = { dataUrl: `data:${mime};base64,${normalized.bytes.toString('base64')}`, durationSeconds: normalized.durationSeconds };
    }
  }
  const story = object(p.story,['type','frames','cartoon','strength']); enumeration(story.type,['none','zoom','wide','follow','event']); number(story.cartoon,0,100); number(story.strength,0,100);
  for (const raw of array(story.frames, 5)) {
    const frame = object(raw,['dataUrl','width','height'],['previewDataUrl']); const mime=validateCollectibleMedia(frame.dataUrl,'image',512*1024); number(frame.width,1,4096,true); number(frame.height,1,4096,true);
    const actual=imageDimensions(Buffer.from((frame.dataUrl as string).split(',')[1]!,'base64'),mime);
    if(!actual || !((actual.width===frame.width && actual.height===frame.height)
      || (mime==='image/jpeg' && actual.height===frame.width && actual.width===frame.height))) invalid();
    if(frame.previewDataUrl!==undefined) validateCollectibleMedia(frame.previewDataUrl,'image',512*1024,editorSide);
    if(publish && story.type!=='none' && frame.previewDataUrl===undefined) throw new CollectibleProjectError('COLLECTIBLE_NOT_READY');
  }
  const storyMinimum = { none: 0, zoom: 0, wide: 1, follow: 2, event: 3 }[story.type as CollectibleProject['story']['type']];
  if (publish && (story.frames as unknown[]).length < storyMinimum) throw new CollectibleProjectError('COLLECTIBLE_NOT_READY');
  if (!p.derived || typeof p.derived !== 'object' || Array.isArray(p.derived)) invalid();
  for (const [gradeId, raw] of Object.entries(p.derived)) {
    if (!gradeIds.includes(gradeId)) invalid(); const asset = object(raw,['imageDataUrl','thumbnailDataUrl'],['baseDataUrl','effectMasks']);
    validateCollectibleMedia(asset.imageDataUrl,'image',mb,editorSide); validateCollectibleMedia(asset.thumbnailDataUrl,'image',128*1024,thumbnailSide);
    if (asset.baseDataUrl !== undefined) validateCollectibleMedia(asset.baseDataUrl,'image',mb,editorSide);
    if (asset.effectMasks !== undefined) {
      if (!asset.effectMasks || typeof asset.effectMasks !== 'object' || Array.isArray(asset.effectMasks)) invalid();
      const masks = Object.entries(asset.effectMasks); if (masks.length > 64) invalid();
      const targets = effects.filter(e => (e.gradeIds as string[]).includes(gradeId)).map(e => e.target);
      for (const [target, mask] of masks) { if (!targets.includes(target)) invalid(); validateCollectibleMedia(mask,'image',256*1024,editorSide); }
    }
  }
  if (!p.rewardGrades || typeof p.rewardGrades !== 'object' || Array.isArray(p.rewardGrades)) invalid();
  const mappings = Object.entries(p.rewardGrades);
  for (const [goal, gradeId] of mappings) { if (!['1','3','5'].includes(goal) || !grades.some(g => g.id === gradeId && g.enabled === true)) invalid(); }
  const derived = p.derived as Record<string, unknown>;
  if (publish && (mappings.length === 0 || mappings.some(([, gradeId]) => !Object.hasOwn(derived, gradeId as string)))) throw new CollectibleProjectError('COLLECTIBLE_NOT_READY');
  const result = structuredClone(p) as CollectibleProject;
  if (mp3 && result.audio) { result.audio.dataUrl = mp3.dataUrl; result.audio.durationSeconds = mp3.durationSeconds; }
  // Originals are only visible to MANAGE_ART holders and copied with each project copy, but camera EXIF (GPS, device, time)
  // is not needed for editing, so every stored image keeps pixels (and JPEG orientation) only.
  if (result.photo.originalDataUrl) result.photo.originalDataUrl = stripImageMetadata(result.photo.originalDataUrl);
  for (const frame of result.story.frames) {
    frame.dataUrl = stripImageMetadata(frame.dataUrl);
    if (frame.previewDataUrl !== undefined) frame.previewDataUrl = stripImageMetadata(frame.previewDataUrl);
  }
  for (const asset of Object.values(result.derived)) {
    asset.imageDataUrl = stripImageMetadata(asset.imageDataUrl); asset.thumbnailDataUrl = stripImageMetadata(asset.thumbnailDataUrl);
    if (asset.baseDataUrl !== undefined) asset.baseDataUrl = stripImageMetadata(asset.baseDataUrl);
    if (asset.effectMasks) for (const target of Object.keys(asset.effectMasks)) asset.effectMasks[target] = stripImageMetadata(asset.effectMasks[target]!);
  }
  return result;
}

const mp3Bitrates = { mpeg1: [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320], mpeg2: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160] };
const mp3SampleRates: Record<number, number[]> = { 3: [44100,48000,32000], 2: [22050,24000,16000], 0: [11025,12000,8000] };
type Mp3Frame = { length: number; samples: number; sampleRate: number; version: number };

// MPEG audio Layer III frame header (MPEG-1/2/2.5). Reserved version/layer/bitrate/sample-rate/emphasis values are rejected.
function mp3Frame(bytes: Buffer, offset: number): Mp3Frame | undefined {
  if (offset + 4 > bytes.length || bytes[offset] !== 0xff) return undefined;
  const b1 = bytes[offset + 1]!, b2 = bytes[offset + 2]!, b3 = bytes[offset + 3]!;
  const version = (b1 >> 3) & 3, layer = (b1 >> 1) & 3, bitrateIndex = b2 >> 4, rateIndex = (b2 >> 2) & 3;
  if ((b1 & 0xe0) !== 0xe0 || version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3 || (b3 & 3) === 2) return undefined;
  const bitrate = (version === 3 ? mp3Bitrates.mpeg1 : mp3Bitrates.mpeg2)[bitrateIndex]! * 1000;
  const sampleRate = mp3SampleRates[version]![rateIndex]!; const samples = version === 3 ? 1152 : 576;
  return { length: Math.floor((samples / 8) * bitrate / sampleRate) + ((b2 >> 1) & 1), samples, sampleRate, version };
}

// Removes leading ID3v2 tags (syncsafe size, optional footer), a trailing ID3v1 "TAG" block and a trailing APEv2 tag, then
// requires the rest to be consecutive Layer III frames with one version/sample rate. A cut-off last frame is dropped.
// Anything else (HTML, a second container, junk between frames) is rejected. Returns the frames and their play length.
export function normalizeMp3(bytes: Buffer): { bytes: Buffer; durationSeconds: number } {
  let start = 0, end = bytes.length;
  while (end - start >= 10 && bytes.toString('latin1', start, start + 3) === 'ID3') {
    const size = bytes.subarray(start + 6, start + 10);
    if (size.some(byte => byte & 0x80)) invalid();
    start += 10 + ((size[0]! << 21) | (size[1]! << 14) | (size[2]! << 7) | size[3]!) + ((bytes[start + 5]! & 0x10) ? 10 : 0);
    if (start > end) invalid();
  }
  if (end - start >= 128 && bytes.toString('latin1', end - 128, end - 125) === 'TAG') end -= 128;
  if (end - start >= 32 && bytes.toString('latin1', end - 32, end - 24) === 'APETAGEX') {
    const total = bytes.readUInt32LE(end - 20) + ((bytes.readUInt32LE(end - 12) & 0x80000000) ? 32 : 0);
    if (total < 32 || total > end - start) invalid();
    end -= total;
  }
  let offset = start, samples = 0; let first: Mp3Frame | undefined;
  while (offset < end) {
    const frame = mp3Frame(bytes.subarray(0, end), offset);
    if (!frame || (first && (frame.version !== first.version || frame.sampleRate !== first.sampleRate))) invalid();
    first ??= frame;
    if (offset + frame.length > end) break;
    offset += frame.length; samples += frame.samples;
  }
  if (!first || samples === 0) invalid();
  const durationSeconds = Math.round((samples / first.sampleRate) * 100) / 100;
  // Frame counts include encoder delay/padding that players trim, so allow half a second before calling it too long.
  if (durationSeconds > 30.5) throw new CollectibleProjectError('COLLECTIBLE_MEDIA_TOO_LARGE');
  return { bytes: Buffer.from(bytes.subarray(start, offset)), durationSeconds: Math.max(0.1, Math.min(30, durationSeconds)) };
}

export function collectibleSnapshot(project: CollectibleProject, projectId: string, publicationId: string, gradeId: string): CollectibleDetail {
  const grade = project.grades.find(g => g.id === gradeId && g.enabled);
  const asset = project.derived[gradeId];
  if (!grade || !asset) throw new CollectibleProjectError('COLLECTIBLE_NOT_READY');
  const safeAsset = {
    imageDataUrl: stripImageMetadata(asset.imageDataUrl), thumbnailDataUrl: stripImageMetadata(asset.thumbnailDataUrl),
    ...(asset.baseDataUrl ? {baseDataUrl:stripImageMetadata(asset.baseDataUrl)} : {}),
    ...(asset.effectMasks ? {effectMasks:Object.fromEntries(Object.entries(asset.effectMasks).map(([key,url])=>[key,stripImageMetadata(url)]))} : {}),
  };
  const story = { type: project.story.type, cartoon: 0, strength: project.story.strength,
    frames: project.story.type==='none' ? [] : project.story.frames.map(frame => {
      if(!frame.previewDataUrl) throw new CollectibleProjectError('COLLECTIBLE_NOT_READY');
      const mime = frame.previewDataUrl.slice(5,frame.previewDataUrl.indexOf(';'));
      const dimensions=imageDimensions(Buffer.from(frame.previewDataUrl.split(',')[1]!,'base64'),mime)!;
      return {dataUrl:stripImageMetadata(frame.previewDataUrl),...dimensions};
    }),
  };
  return {
    projectId, publicationId, gradeId, gradeName: grade.name, name: project.name, shape: project.shape,
    theme: { name: project.theme.name }, ...safeAsset, thickness: project.thickness, angle: project.angle,
    animation: project.motion.find(m => m.gradeIds.includes(gradeId))?.type ?? 'still', greeting: project.greeting,
    audio: structuredClone(project.audio), story,
    effects: project.effects.filter(effect => effect.gradeIds.includes(gradeId)).map(({type,target,strength,color,roughness}) => ({type,target,strength,color,roughness})),
  };
}

// Reads the Orientation (0x0112) of IFD0 from an APP1 "Exif\0\0" payload; any malformed or missing value returns undefined.
function exifOrientation(payload: Buffer): number | undefined {
  if(payload.length<14 || payload.toString('latin1',0,6)!=='Exif\0\0') return undefined;
  const tiff=payload.subarray(6); const order=tiff.toString('latin1',0,2);
  if(order!=='II' && order!=='MM') return undefined;
  const u16=(at:number)=>order==='II'?tiff.readUInt16LE(at):tiff.readUInt16BE(at);
  const u32=(at:number)=>order==='II'?tiff.readUInt32LE(at):tiff.readUInt32BE(at);
  if(u16(2)!==42) return undefined;
  const ifd=u32(4); if(ifd+2>tiff.length) return undefined;
  const count=u16(ifd);
  for(let index=0;index<count;index++) {
    const entry=ifd+2+index*12; if(entry+12>tiff.length) return undefined;
    if(u16(entry)===0x0112 && u16(entry+2)===3) return u16(entry+8);
  }
  return undefined;
}

// Metadata can identify a camera, photographer or location even when the pixels are a final cropped export.
// Keep the lossless encoded image chunks and remove metadata before placing media in a customer snapshot.
export function stripImageMetadata(dataUrl: string): string {
  const comma=dataUrl.indexOf(','); const mime=dataUrl.slice(5,dataUrl.indexOf(';'));
  const bytes=Buffer.from(dataUrl.slice(comma+1),'base64'); const parts: Buffer[]=[];
  if(mime==='image/png') {
    parts.push(bytes.subarray(0,8)); let offset=8;
    while(offset+12<=bytes.length) {
      const length=bytes.readUInt32BE(offset); const end=offset+length+12; if(end>bytes.length) invalid();
      const type=bytes.subarray(offset+4,offset+8).toString();
      if(['IHDR','PLTE','IDAT','IEND','tRNS'].includes(type)) parts.push(bytes.subarray(offset,end));
      offset=end; if(type==='IEND') break;
    }
  } else if(mime==='image/jpeg') {
    parts.push(bytes.subarray(0,2)); let offset=2; let orientation=1;
    while(offset<bytes.length) {
      const start=offset; if(bytes[offset++]!==255) invalid(); while(bytes[offset]===255) offset++;
      const marker=bytes[offset++]; if(marker===undefined) invalid();
      if(marker===0xd9) { parts.push(bytes.subarray(start,offset)); break; }
      if(marker===0x01 || (marker>=0xd0 && marker<=0xd7)) {parts.push(bytes.subarray(start,offset));continue;}
      if(offset+2>bytes.length) invalid(); const length=bytes.readUInt16BE(offset); const end=offset+length;
      if(length<2 || end>bytes.length) invalid();
      if(marker===0xe1) orientation=exifOrientation(bytes.subarray(offset+2,end)) ?? orientation;
      if(!((marker>=0xe0&&marker<=0xef)||marker===0xfe)) parts.push(bytes.subarray(start,end)); offset=end;
      if(marker===0xda) {
        // Keep stuffed entropy bytes and restart markers; return to segment parsing between progressive scans.
        const scanStart=offset;
        while(offset<bytes.length) {
          if(bytes[offset]!==255) {offset++;continue;}
          const next=bytes[offset+1];
          if(next===0 || (next!==undefined&&next>=0xd0&&next<=0xd7)) {offset+=2;continue;}
          if(next===255) {offset++;continue;}
          break;
        }
        parts.push(bytes.subarray(scanStart,offset));
      }
    }
    // Browsers rotate photos by the EXIF Orientation tag, and the saved width/height follow that rotation. Keep only that tag.
    if(orientation>=2&&orientation<=8) parts.splice(1,0,Buffer.from([0xff,0xe1,0,34,...Buffer.from('Exif\0\0','latin1'),
      0x4d,0x4d,0,0x2a,0,0,0,8, 0,1, 0x01,0x12,0,3,0,0,0,1,0,orientation,0,0, 0,0,0,0]));
  } else if(mime==='image/webp') {
    let offset=12;
    while(offset+8<=bytes.length) {
      const length=bytes.readUInt32LE(offset+4); const end=offset+8+length+(length%2); if(end>bytes.length) invalid();
      const type=bytes.subarray(offset,offset+4).toString();
      // Allow list: only image data chunks survive (EXIF, XMP, ICC profile and unknown chunks are dropped).
      if(['VP8X','VP8 ','VP8L','ALPH'].includes(type)) {
        const chunk=Buffer.from(bytes.subarray(offset,end)); if(type==='VP8X'&&chunk.length>8) chunk[8]=chunk[8]!&~(0x20|0x08|0x04); parts.push(chunk);
      }
      offset=end;
    }
    const header=Buffer.from(bytes.subarray(0,12)); header.writeUInt32LE(4+parts.reduce((n,p)=>n+p.length,0),4); parts.unshift(header);
  } else invalid();
  return `data:${mime};base64,${Buffer.concat(parts).toString('base64')}`;
}
