import { createHash } from 'node:crypto';

// 공개 NFT 메타데이터 생성기(Issue #254, D-060). 발행 확정 때 한 번 만들어 DB에 고정하므로 결과는 입력에만 의존한다.
// 입력에 주소·시각·계정·지갑·주문 값이 아예 없어서 결과에도 들어갈 수 없다.

// 가게 그림이 없을 때 쓰는 기본 도장. 공개 사이트 정적 파일(scripts/build-public-site.mjs 목록)이다.
export const DEFAULT_STAMP_IMAGE_URL = 'https://masscom.kr/assets/mascot-stamp.png';

export type NftMetadataFacts = {
  merchantName: string;
  neighborhood: string | null;
  category: string | null;
  campaignTitle: string;
  targetVisitCount: number;
  artImage: Buffer | null;
};

export type NftMetadataSnapshot = {
  json: string;
  image: { sha256: string; bytes: Buffer } | null;
};

export function visitStepLabel(targetVisitCount: number): string {
  if (!Number.isSafeInteger(targetVisitCount) || targetVisitCount < 1) {
    throw new Error('targetVisitCount must be a positive integer');
  }
  return targetVisitCount === 1 ? '첫 방문' : `${targetVisitCount}번째 방문`;
}

// Worker 환경 변수 NFT_METADATA_ORIGIN: 메타데이터·그림을 내보내는 공개 출처(운영 https://masscom.kr, 시연 https://demo-api.masscom.kr).
// 시리즈 baseTokenURI는 `<출처>/nft-metadata/<nft_series.id>/`이고 그림은 `<출처>/nft-metadata/images/<sha256>.webp`이다.
export function parseNftMetadataOrigin(raw: string | undefined): string {
  const value = raw?.trim() ?? '';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('NFT_METADATA_ORIGIN must be an https origin such as https://masscom.kr');
  }
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  // origin과 글자 그대로 같아야 한다: 경로·끝 슬래시·쿼리·사용자 정보·대문자 호스트를 모두 거절한다.
  if ((url.protocol !== 'https:' && !local) || url.origin !== value) {
    throw new Error('NFT_METADATA_ORIGIN must be an https origin such as https://masscom.kr');
  }
  return url.origin;
}

export function buildNftMetadata(facts: NftMetadataFacts, origin: string): NftMetadataSnapshot {
  const merchantName = facts.merchantName.trim();
  const neighborhood = facts.neighborhood?.trim() || null;
  const category = facts.category?.trim() || null;
  const step = visitStepLabel(facts.targetVisitCount);
  // 주소는 열에 적힌 값이 아니라 실제 바이트의 해시로 정한다(내용 해시 주소).
  const image = facts.artImage && facts.artImage.length > 0
    ? { sha256: createHash('sha256').update(facts.artImage).digest('hex'), bytes: facts.artImage }
    : null;
  const place = neighborhood ? `${neighborhood} ${merchantName}` : merchantName;
  const attributes = [
    { trait_type: '가게 이름', value: merchantName },
    ...(neighborhood ? [{ trait_type: '동네', value: neighborhood }] : []),
    ...(category ? [{ trait_type: '업종', value: category }] : []),
    { trait_type: '방문 단계', value: step },
    { trait_type: '캠페인', value: facts.campaignTitle.trim() },
  ];
  const metadata = {
    name: `${merchantName} 방문 도장`,
    description: `${place} ${step} 도장입니다. 월계 마스코트 방문 도감이 발행한 기념 NFT이며 다른 지갑으로 보낼 수 없습니다.`,
    image: image ? `${origin}/nft-metadata/images/${image.sha256}.webp` : DEFAULT_STAMP_IMAGE_URL,
    attributes,
  };
  return { json: JSON.stringify(metadata), image };
}
