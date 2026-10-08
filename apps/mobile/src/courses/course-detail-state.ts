import { CourseApiError } from './course-api';

export function clearedCourseDetail(error: unknown): { courses: undefined; sceneOpen: false } | undefined {
  return error instanceof CourseApiError && (error.status === 404 || error.status === 410)
    ? { courses: undefined, sceneOpen: false }
    : undefined;
}
