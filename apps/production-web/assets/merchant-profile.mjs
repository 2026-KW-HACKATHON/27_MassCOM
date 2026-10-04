export function profileReadOnlyReason(reason) {
  if (reason === 'ROLE') return '가게 정보는 대표 계정만 고칠 수 있어요.';
  if (reason === 'SHARED_DEMO_STORE') return '시연용 공용 가상 점포는 고칠 수 없어요.';
  return '가게 정보를 고칠 수 없어요.';
}

// Submit only the fields owned by the merchant profile API. Empty menu rows are ignored.
export function serializeMerchantProfile({ story, businessHours, menuItems, version }) {
  const errors = { story: '', businessHours: '', menuItems: '' };
  const normalizedStory = story.trim();
  const normalizedHours = businessHours.trim();
  if (normalizedStory.length > 4000) errors.story = '소개는 4000자 이하로 적어 주세요.';
  if (normalizedHours.length > 1000) errors.businessHours = '영업시간은 1000자 이하로 적어 주세요.';
  const menuErrors = menuItems.map(() => ({ name: '', price: '' }));
  const rows = menuItems.map((item, index) => ({ name: item.name.trim(), price: item.price.trim(), index }))
    .filter(item => item.name !== '' || item.price !== '');
  if (rows.length > 30) errors.menuItems = '메뉴는 30개까지만 등록할 수 있어요.';
  const normalizedMenu = rows.map(item => {
    if (item.name.length < 1 || item.name.length > 200) {
      menuErrors[item.index].name = '메뉴 이름은 1~200자로 적어 주세요.';
      errors.menuItems = menuErrors[item.index].name;
    }
    const price = item.price.replace(/,/g, '');
    if (!/^\d+$/.test(price) || Number(price) > 1_000_000_000) {
      menuErrors[item.index].price = '가격은 0~1,000,000,000원의 숫자로 적어 주세요.';
      errors.menuItems = menuErrors[item.index].price;
    }
    return { name: item.name, priceWon: Number(price) };
  });
  return { body: { story: normalizedStory, businessHours: normalizedHours, menuItems: normalizedMenu, expectedVersion: version }, errors, menuErrors };
}
