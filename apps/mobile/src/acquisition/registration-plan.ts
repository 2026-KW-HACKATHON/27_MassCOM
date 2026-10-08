export type RegistrationStatus = 'new' | 'duplicate' | 'owned';

export type RegistrationPlanItem = {
  id: string;
  name: string;
  kindLabel: string;
  status: RegistrationStatus;
  detail?: string;
};

export type RegistrationSlot = RegistrationPlanItem & {
  isNew: boolean;
  sequenceIndex: number | null;
  statusLabel: string;
  confirmation: string;
};

export type RegistrationPlan = {
  slots: RegistrationSlot[];
  newCount: number;
  duplicateOrOwnedCount: number;
  summary: string;
};

export function isNewRegistration(status: RegistrationStatus): boolean {
  return status === 'new';
}

export function registrationStatusLabel(status: RegistrationStatus): string {
  switch (status) {
    case 'new': return 'NEW';
    case 'duplicate': return '이미 보유';
    case 'owned': return '보유 중';
  }
}

export function registrationConfirmation(item: RegistrationPlanItem): string {
  if (item.detail) return item.detail;
  switch (item.status) {
    case 'new':
      return `이번에 얻은 ${item.kindLabel}이에요. 도감이나 내 공간에서 다시 볼 수 있어요.`;
    case 'duplicate':
      return '이미 갖고 있던 항목이에요. 보관함에서 다시 확인할 수 있어요.';
    case 'owned':
      return '이미 도감에 있는 항목이에요. 내 수집품으로 계속 남아 있어요.';
  }
}

export function buildRegistrationPlan(items: readonly RegistrationPlanItem[]): RegistrationPlan {
  let newCount = 0;
  const slots = items.map((item) => {
    const isNew = isNewRegistration(item.status);
    const sequenceIndex = isNew ? newCount++ : null;
    return {
      ...item,
      isNew,
      sequenceIndex,
      statusLabel: registrationStatusLabel(item.status),
      confirmation: registrationConfirmation(item),
    };
  });
  const duplicateOrOwnedCount = items.length - newCount;
  const summary = newCount > 0
    ? `새 수집품 ${newCount}개가 도감에 등록됐어요.`
    : `새 수집품은 없지만 보상 ${items.length}개를 확인했어요.`;
  return { slots, newCount, duplicateOrOwnedCount, summary };
}
