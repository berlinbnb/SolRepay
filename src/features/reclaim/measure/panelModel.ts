import { CONTROL_COUNTS, MULTI_SPLITS, SUGGESTED_COUNT_ORDER } from "./constants.ts";
import { hostBlockReason, readMeasureGates, withCount, withSplit, type MeasureHost } from "./gates.ts";

export type PanelButton = {
  id: "control" | "sas" | "multitx";
  label: string;
  disabled: boolean;
  danger: boolean;
};

export type PanelPlan = {
  visible: boolean;
  autoRun: false;
  warnings: string[];
  countLinks: { count: number; href: string; suggested: boolean }[];
  splitLinks: { split: number; href: string; label: string }[];
  buttons: PanelButton[];
};

export function planPanel(search: string, host: MeasureHost): PanelPlan {
  const gates = readMeasureGates(search);
  const visible = gates.n1Requested || gates.multiRequested;
  if (!visible) {
    return { visible: false, autoRun: false, warnings: [], countLinks: [], splitLinks: [], buttons: [] };
  }

  const warnings: string[] = [
    "Bu ölçüm Geri Al'ı ve production CAP'i değiştirmez. BatchClose ana geri alma yoluna eklenmez.",
  ];
  const blocked = gates.blockedByOtherGate;
  if (blocked) {
    warnings.push(`Bu kapı kapalı: URL'de ${blocked} var. Diğer probeyi kapatıp yenile.`);
  }
  const hostReason = hostBlockReason(host);
  if (hostReason) warnings.push(hostReason);
  if (gates.invalidN1Count) {
    warnings.push(`count CONTROL_COUNTS içinde değil (${CONTROL_COUNTS.join(", ")}).`);
  }
  if (gates.invalidMultiSplit) {
    warnings.push("multitx split yalnız 5, 13 veya 25 (5+5, 13+13, 25+25).");
  }

  const runnable = !blocked && !hostReason;
  const buttons: PanelButton[] = [];
  if (gates.n1Requested) {
    const n = gates.n1Count;
    const enabled = runnable && n != null;
    warnings.push(
      "signAndSendTransaction onaylanırsa Phantom işlemi yayınlar ve hesaplar kapanabilir. Normal onay ekranında İptal'e basın. «İstek engellendi» RED'dir.",
    );
    buttons.push({
      id: "control",
      label: n == null ? "signTransaction kontrol" : `N=${n} signTransaction kontrol — gönderilmez`,
      disabled: !enabled,
      danger: false,
    });
    buttons.push({
      id: "sas",
      label: n == null ? "signAndSendTransaction" : `N=${n} signAndSend — ONAYLAMA (onay yayınlar)`,
      disabled: !enabled,
      danger: true,
    });
  }
  if (gates.multiRequested) {
    warnings.push(
      "İki işlem signAllTransactions veya Wallet Standard signTransaction ile istenir. İkisi de göndermez. signAndSendAllTransactions kullanılmaz.",
    );
    const split = gates.multiSplit;
    buttons.push({
      id: "multitx",
      label: split == null ? "İki işlem — gönderilmez" : `${split}+${split} tek onay yüzeyi — gönderilmez`,
      disabled: !(runnable && split != null),
      danger: false,
    });
  }

  return {
    visible: true,
    autoRun: false,
    warnings,
    countLinks: gates.n1Requested
      ? CONTROL_COUNTS.map((count) => ({
          count,
          href: withCount(search, count),
          suggested: (SUGGESTED_COUNT_ORDER as readonly number[]).includes(count),
        }))
      : [],
    splitLinks: gates.multiRequested
      ? MULTI_SPLITS.map((split) => ({
          split,
          href: withSplit(search, split),
          label: `${split}+${split}`,
        }))
      : [],
    buttons,
  };
}
