import { CollectibleProjectError, type CollectibleDetail, type CollectibleProject } from './collectible-project.js';

const mb = 1024 * 1024;
const imageMimes = ['image/png', 'image/jpeg', 'image/webp'];
const audioMimes = ['audio/mpeg', 'audio/mp3', 'audio/webm', 'audio/ogg'];
const identifier = /^[a-zA-Z0-9_-]{1,64}$/;
const hexColor = /^#[0-9a-f]{6}$/i;

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
export function validateCollectibleMedia(value: unknown, kind: 'image' | 'audio', maxBytes: number): string {
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
    const size = imageDimensions(bytes, mime);
    if (!size || size.width < 1 || size.height < 1 || size.width > 4096 || size.height > 4096 || size.width * size.height > 16_777_216) invalid();
  }
  return mime;
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
  if (p.audio !== null) { const audio = object(p.audio,['dataUrl','mimeType','durationSeconds']); const mime = validateCollectibleMedia(audio.dataUrl,'audio',mb); if (audio.mimeType !== mime) invalid(); number(audio.durationSeconds,0.1,30); }
  const story = object(p.story,['type','frames','cartoon','strength']); enumeration(story.type,['none','zoom','wide','follow','event']); number(story.cartoon,0,100); number(story.strength,0,100);
  for (const raw of array(story.frames, 5)) {
    const frame = object(raw,['dataUrl','width','height'],['previewDataUrl']); const mime=validateCollectibleMedia(frame.dataUrl,'image',512*1024); number(frame.width,1,4096,true); number(frame.height,1,4096,true);
    const actual=imageDimensions(Buffer.from((frame.dataUrl as string).split(',')[1]!,'base64'),mime);
    if(!actual || !((actual.width===frame.width && actual.height===frame.height)
      || (mime==='image/jpeg' && actual.height===frame.width && actual.width===frame.height))) invalid();
    if(frame.previewDataUrl!==undefined) validateCollectibleMedia(frame.previewDataUrl,'image',512*1024);
    if(publish && story.type!=='none' && frame.previewDataUrl===undefined) throw new CollectibleProjectError('COLLECTIBLE_NOT_READY');
  }
  const storyMinimum = { none: 0, zoom: 0, wide: 1, follow: 2, event: 3 }[story.type as CollectibleProject['story']['type']];
  if (publish && (story.frames as unknown[]).length < storyMinimum) throw new CollectibleProjectError('COLLECTIBLE_NOT_READY');
  if (!p.derived || typeof p.derived !== 'object' || Array.isArray(p.derived)) invalid();
  for (const [gradeId, raw] of Object.entries(p.derived)) {
    if (!gradeIds.includes(gradeId)) invalid(); const asset = object(raw,['imageDataUrl','thumbnailDataUrl'],['baseDataUrl','effectMasks']);
    validateCollectibleMedia(asset.imageDataUrl,'image',mb); validateCollectibleMedia(asset.thumbnailDataUrl,'image',256*1024);
    if (asset.baseDataUrl !== undefined) validateCollectibleMedia(asset.baseDataUrl,'image',mb);
    if (asset.effectMasks !== undefined) {
      if (!asset.effectMasks || typeof asset.effectMasks !== 'object' || Array.isArray(asset.effectMasks)) invalid();
      const masks = Object.entries(asset.effectMasks); if (masks.length > 64) invalid();
      const targets = effects.filter(e => (e.gradeIds as string[]).includes(gradeId)).map(e => e.target);
      for (const [target, mask] of masks) { if (!targets.includes(target)) invalid(); validateCollectibleMedia(mask,'image',256*1024); }
    }
  }
  if (!p.rewardGrades || typeof p.rewardGrades !== 'object' || Array.isArray(p.rewardGrades)) invalid();
  const mappings = Object.entries(p.rewardGrades);
  for (const [goal, gradeId] of mappings) { if (!['1','3','5'].includes(goal) || !grades.some(g => g.id === gradeId && g.enabled === true)) invalid(); }
  const derived = p.derived as Record<string, unknown>;
  if (publish && (mappings.length === 0 || mappings.some(([, gradeId]) => !Object.hasOwn(derived, gradeId as string)))) throw new CollectibleProjectError('COLLECTIBLE_NOT_READY');
  return structuredClone(p) as CollectibleProject;
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
    parts.push(bytes.subarray(0,2)); let offset=2;
    while(offset<bytes.length) {
      const start=offset; if(bytes[offset++]!==255) invalid(); while(bytes[offset]===255) offset++;
      const marker=bytes[offset++]; if(marker===undefined) invalid();
      if(marker===0xd9) { parts.push(bytes.subarray(start,offset)); break; }
      if(marker===0x01 || (marker>=0xd0 && marker<=0xd7)) {parts.push(bytes.subarray(start,offset));continue;}
      if(offset+2>bytes.length) invalid(); const length=bytes.readUInt16BE(offset); const end=offset+length;
      if(length<2 || end>bytes.length) invalid();
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
  } else if(mime==='image/webp') {
    let offset=12;
    while(offset+8<=bytes.length) {
      const length=bytes.readUInt32LE(offset+4); const end=offset+8+length+(length%2); if(end>bytes.length) invalid();
      const type=bytes.subarray(offset,offset+4).toString();
      if(!['EXIF','XMP ','ICCP'].includes(type)) {
        const chunk=Buffer.from(bytes.subarray(offset,end)); if(type==='VP8X'&&chunk.length>8) chunk[8]=chunk[8]!&~(0x20|0x08|0x04); parts.push(chunk);
      }
      offset=end;
    }
    const header=Buffer.from(bytes.subarray(0,12)); header.writeUInt32LE(4+parts.reduce((n,p)=>n+p.length,0),4); parts.unshift(header);
  } else invalid();
  return `data:${mime};base64,${Buffer.concat(parts).toString('base64')}`;
}
