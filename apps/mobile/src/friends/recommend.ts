import { DEFAULT_LINK_ORIGIN, openLinkFragment } from './link';

const maxMerchantIdLength = 128;
const controlCharacter = /[\u0000-\u001f\u007f]/;

export function merchantLink(merchantId: string, origin: string = DEFAULT_LINK_ORIGIN): string {
  return `${origin}/open#merchant=${encodeURIComponent(merchantId)}`;
}

/** The merchant id inside a merchant link (`#merchant=ID`), or undefined for anything else. */
export function parseMerchantLink(url: string): string | undefined {
  const value = openLinkFragment(url)?.merchant;
  if (!value || value.length > maxMerchantIdLength || controlCharacter.test(value)) return undefined;
  return value;
}

/**
 * The text handed to the system share sheet for "친구에게 추천": the shop name and its link only, so a recommendation never
 * tells anyone whether, when or how often the sender visited. A demo shop says so, since it does not exist.
 */
export function merchantShareMessage(
  merchant: { id: string; name: string; demo: boolean },
  origin: string = DEFAULT_LINK_ORIGIN,
): string {
  const demo = merchant.demo ? ' (시연용 가상 점포)' : '';
  return `월계 마스코트에서 '${merchant.name}${demo}' 가게를 추천해요!\n${merchantLink(merchant.id, origin)}`;
}
