const REMOTE_CLEANUP_TIMEOUT_MS = 3_000;

// 원격 해제 응답이 끝나지 않아도 로컬 세션 정리는 계속한다.
export async function waitForRemoteCleanup(operation: () => Promise<unknown>, timeoutMs = REMOTE_CLEANUP_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation(),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
    ]);
  } catch {
    // 원격 해제 실패는 로컬 로그아웃을 막지 않는다.
  } finally {
    if (timer) clearTimeout(timer);
  }
}
