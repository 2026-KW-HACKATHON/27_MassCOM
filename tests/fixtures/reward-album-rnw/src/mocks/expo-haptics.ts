export const NotificationFeedbackType = { Success: 'success' } as const;
export const ImpactFeedbackStyle = { Light: 'light' } as const;

export async function notificationAsync(): Promise<void> {}
export async function impactAsync(): Promise<void> {}
