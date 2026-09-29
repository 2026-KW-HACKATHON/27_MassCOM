import { APP_DOWNLOAD_LINK, openLinkBase, openLinkFragment, type LinkVariant } from './link';

const maxMerchantIdLength = 128;
// Merchant ids are free-form text in the database (a UUID for registered shops, a slug for the showcase seed). The id becomes a
// route parameter, so anything that could read as a path, an escape, or an invisible character is refused rather than routed.
const forbiddenMerchantIdCharacter = /[\s\p{Cc}\p{Cf}/\\%]/u;

export function merchantLink(merchantId: string, variant: LinkVariant = 'production'): string {
  return `${openLinkBase(variant)}#merchant=${encodeURIComponent(merchantId)}`;
}

/** Whether a merchant id read from a link is safe to hand to the router as one route segment. */
export function isRoutableMerchantId(value: string): boolean {
  return value.length > 0
    && value.length <= maxMerchantIdLength
    && value !== '.'
    && value !== '..'
    && !forbiddenMerchantIdCharacter.test(value);
}

export function merchantFromFragment(fragment: Record<string, string>): string | undefined {
  const value = fragment.merchant;
  return value !== undefined && isRoutableMerchantId(value) ? value : undefined;
}

/** The merchant id inside this build's own merchant link (`#merchant=ID`), or undefined for anything else. */
export function parseMerchantLink(url: string, variant: LinkVariant): string | undefined {
  const fragment = openLinkFragment(url, variant);
  return fragment ? merchantFromFragment(fragment) : undefined;
}

/**
 * The text handed to the system share sheet for "친구에게 추천": the shop name and its link only, so a recommendation never
 * tells anyone whether, when or how often the sender visited. A demo shop says so, since it does not exist. The showcase build
 * has no https host of its own yet, so it names the shop and the public download link and carries no shop link.
 */
export function merchantShareMessage(
  merchant: { id: string; name: string; demo: boolean },
  variant: LinkVariant = 'production',
): string {
  const demo = merchant.demo ? ' (시연용 가상 점포)' : '';
  const intro = `월계 마스코트에서 '${merchant.name}${demo}' 가게를 추천해요!`;
  return variant === 'showcase'
    ? `${intro}\n앱 받기: ${APP_DOWNLOAD_LINK}`
    : `${intro}\n${merchantLink(merchant.id, variant)}`;
}
