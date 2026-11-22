// 결제: 크리스탈(💎) 묶음을 진짜 돈으로 산다.
// 아직 결제 서비스가 연결되지 않았다 (PAYMENT_READY = false → 상점에서 "결제 준비 중"으로 보인다).
//
// 실제로 팔려면 (순서대로):
//   1) 사업자 등록 · 통신판매업 신고, 결제대행사(토스페이먼츠, 포트원 등) 가맹 → 클라이언트 키 / 시크릿 키
//   2) 계정(로그인)과 서버 저장: 지금은 코인·의상이 기기(localStorage)에만 있어서 지우면 사라지고 고쳐 쓸 수도 있다.
//      돈을 받은 재화는 서버의 계정 지갑에 두어야 한다.
//   3) 서버에 결제 확인 API: 결제 창이 끝나면 서버가 결제대행사에 금액·주문번호를 확인하고, 맞으면 지갑에 크리스탈을 넣는다.
//      (클라이언트가 "샀다"고 말하는 것만 믿으면 안 된다)
//   4) 환불(청약 철회) 안내, 미성년자 결제 안내, 확률형 아이템 확률 표시(뽑기 확률은 이미 화면에 있다)
// 이 파일의 purchase() 가 결제 창을 띄우고 서버 확인 결과를 돌려주도록 바꾸면 상점은 그대로 동작한다.
export const PAYMENT_READY = false;

// pack: shared/shop.js 의 GEM_PACKS 하나. 성공하면 { ok: true }, 아니면 { ok: false, reason }
export async function purchase(pack) {
  if (!PAYMENT_READY) return { ok: false, reason: 'not-ready', pack: pack.id };
  return { ok: false, reason: 'not-implemented' };
}
