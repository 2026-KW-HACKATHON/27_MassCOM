import type { Course, CourseSituation } from './course-api';

const situations: Record<CourseSituation, string> = {
  AFTER_MEAL: '식사 후 들르기 좋은 곳',
  TAKEOUT: '포장해서 가져가기 좋은 곳',
  OTHER: '함께 들러볼 만한 곳',
};

export function courseChipText(course: { situation: CourseSituation; done: number; total: number }): string {
  return `'${situations[course.situation]}' 코스 ${course.done}/${course.total}`;
}

export function merchantCourseChip(courses: Course[], merchantId: string): string | undefined {
  const course = courses.find(item => item.status === 'ACTIVE' && item.steps.some(step => step.merchantId === merchantId));
  return course ? `'${course.situationLabel}' 코스의 한 곳이에요` : undefined;
}

export function courseStateText(course: Pick<Course, 'state' | 'done' | 'total'>): string {
  if (course.state === 'STALE') return '방문 취소 등으로 단계가 다시 미완료예요. 장면을 열 수 없어요.';
  if (course.state === 'UNLOCKED') return '장면을 열었어요.';
  if (course.state === 'READY') return '모든 단계를 마쳤어요. 장면을 열 수 있어요.';
  return `${course.done}/${course.total}단계 완료`;
}
