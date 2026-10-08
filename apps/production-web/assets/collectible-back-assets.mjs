// 모양·등급별로 확정한 음각 뒷면. v1 파일은 교체하지 않고 새 디자인은 별도 버전으로 추가한다.
export const COLLECTIBLE_BACK_VERSION = 'v1';
export const COLLECTIBLE_BACK_SHAPES = Object.freeze(['circle', 'stamp', 'serrated']);
export const COLLECTIBLE_BACK_GRADES = Object.freeze(['bronze', 'silver', 'gold', 'prism']);
export const COLLECTIBLE_BACK_FILES = Object.freeze(COLLECTIBLE_BACK_SHAPES.flatMap(shape =>
  COLLECTIBLE_BACK_GRADES.map(grade => `${shape}-${grade}.png`)));

const shapeLabels = { circle: '원형', stamp: '우표', serrated: '톱니' };
const gradeLabels = { bronze: '브론즈', silver: '실버', gold: '골드', prism: '프리즘' };

export function fixedCollectibleBackShape(shape) {
  return shape === 'stamp' ? 'stamp' : (shape === 'serrated' || shape === 'gear') ? 'serrated' : 'circle';
}

export function fixedCollectibleBackGrade(gradeId) {
  return COLLECTIBLE_BACK_GRADES.includes(gradeId) ? gradeId : 'bronze';
}

export function fixedCollectibleBack(shape, gradeId) {
  const fixedShape = fixedCollectibleBackShape(shape);
  const fixedGrade = fixedCollectibleBackGrade(gradeId);
  return {
    shape: fixedShape, gradeId: fixedGrade,
    shapeLabel: shapeLabels[fixedShape], gradeLabel: gradeLabels[fixedGrade],
    path: `/app/assets/collectible-backs/${COLLECTIBLE_BACK_VERSION}/${fixedShape}-${fixedGrade}.png`,
  };
}
