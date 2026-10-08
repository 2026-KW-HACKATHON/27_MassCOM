export async function withLocationTimeout<T>(request: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([request, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('LOCATION_TIMEOUT')), milliseconds);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
