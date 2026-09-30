import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CollectibleProjectError } from './collectible-project.js';
import { collectibleSnapshot, stripImageMetadata, validateCollectibleMedia, validateCollectibleProject } from './collectible-project-rules.js';
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

test('accepts supported audio signatures and bounds recording duration/mime rather than trusting uploads', () => {
  for (const [mime, magic] of [['audio/mpeg','494433'],['audio/ogg','4f676753'],['audio/webm','1a45dfa3']]) {
    const project = photoProject(); const dataUrl = `data:${mime};base64,${Buffer.from(magic!,'hex').toString('base64')}`;
    project.audio = { dataUrl, mimeType: mime!, durationSeconds: 5 };
    assert.equal(validateCollectibleProject(project).audio?.dataUrl,dataUrl);
    project.audio.durationSeconds = 31;
    assert.throws(() => validateCollectibleProject(project), { code: 'COLLECTIBLE_INVALID_PROJECT' });
  }
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
