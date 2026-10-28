import { WALLET_APPROVAL_ACTION_CAP } from "../domain/walletApprovalCap.ts";

/**
 * Turkish and English copy for the Phantom multi-approval notice.
 * Step chips stay "{n} hesap" / "{n} accounts" and render the real chunk size.
 * The notice is shown only when there is more than one chunk.
 */

const cap = WALLET_APPROVAL_ACTION_CAP;

export const phantomChunkCopy = {
  tr: {
    chunkNoticeThreshold: `${cap}'ten fazla hesapta birden fazla onay.`,
    chunkNoticeWhy: `Phantom henüz sitemizde birçok hesabı tek cüzdan onayında kapatmaya izin vermiyor. Bu yüzden hesapları her onayda en fazla ${cap} hesaplık güvenli gruplar halinde kapatıyoruz.`,
    chunkNoticeWhyGeneric: `Hesapları her onayda en fazla ${cap} hesaplık güvenli gruplar halinde kapatıyoruz.`,
    phantomGuardHint: `Açıkken Phantom geri almada en fazla ${cap} hesap / onay ve dilimli panel kullanılır. Kapalıyken tüm cüzdanlar eski tek-akış paketlemeyi kullanır.`,
  },
  en: {
    chunkNoticeThreshold: `More than ${cap} accounts needs more than one approval.`,
    chunkNoticeWhy: `Phantom does not yet allow closing many accounts in one wallet approval on our site, so we close them in safe groups of up to ${cap} accounts per approval.`,
    chunkNoticeWhyGeneric: `We close accounts in safe groups of up to ${cap} accounts per approval.`,
  },
} as const;
