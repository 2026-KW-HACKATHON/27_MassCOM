import type { MileageGrade } from './shop-api';

// 하늘 동네 가게 친구 9종의 그림. Metro의 require()는 정적 문자열만 받아들여서(동적 require 불가) 이 표가
// apps/api/src/mileage-rules.ts의 MILEAGE_CATALOG id와 그대로 맞아야 한다 — 서버가 모르는 id가 오면(카탈로그가
// 바뀌었거나 응답이 깨졌을 때) friendArt[id]는 undefined이고, 화면은 실루엣으로 대신 보여준다(가격·이름은 그대로
// 서버 응답을 쓴다).
export const friendArt: Readonly<Record<string, number>> = {
  'cook-cat': require('../../assets/images/shop/friend-cook-cat.png'),
  'cafe-bear': require('../../assets/images/shop/friend-cafe-bear.png'),
  'walk-rabbit': require('../../assets/images/shop/friend-walk-rabbit.png'),
  'bakery-squirrel': require('../../assets/images/shop/friend-bakery-squirrel.png'),
  'flower-hedgehog': require('../../assets/images/shop/friend-flower-hedgehog.png'),
  'book-owl': require('../../assets/images/shop/friend-book-owl.png'),
  'tteok-tiger': require('../../assets/images/shop/friend-tteok-tiger.png'),
  'market-raccoon': require('../../assets/images/shop/friend-market-raccoon.png'),
  'laundry-seal': require('../../assets/images/shop/friend-laundry-seal.png'),
};

export const ticketArt: Readonly<Record<MileageGrade, number>> = {
  BRONZE: require('../../assets/images/shop/ticket-bronze.png'),
  SILVER: require('../../assets/images/shop/ticket-silver.png'),
  GOLD: require('../../assets/images/shop/ticket-gold.png'),
};

export const mileageCoinArt: number = require('../../assets/images/shop/mileage-coin.png');
