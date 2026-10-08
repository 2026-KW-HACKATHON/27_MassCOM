import { useLocalSearchParams } from 'expo-router';
import { CoursesRoute } from '@/screens/courses/route';
export default function CourseDetailRoute() {
  const { courseId } = useLocalSearchParams<{ courseId?: string | string[] }>();
  return <CoursesRoute courseId={typeof courseId === 'string' ? courseId : ''} />;
}
