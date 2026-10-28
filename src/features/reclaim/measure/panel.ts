import { discoverPhantomProvider, listStandardWallets, readProviderVersion, type InjectedScope } from "./discover.ts";
import { annotateEntry, createAttemptCounter, publishMeasure, type MeasureEntry } from "./log.ts";
import type { MeasureHost } from "./gates.ts";
import { planPanel } from "./panelModel.ts";
import { createMainnetProbeIo } from "./probeIo.ts";
import { runBatchCloseLadder } from "./runLadder.ts";
import { runMultiTxProbe } from "./runMultiTx.ts";

const VERSION_KEY = "sx-phantom-version";

/**
 * Mounts the gated measurement panel. Renders nothing unless
 * `?batchclosen1=1` and/or `?multitx=1` is set. Does not start a probe.
 * Does not touch the Geri Al button.
 *
 * Wire from the reclaim panel, beside the existing N1 fieldset:
 *
 *   useEffect(() => {
 *     const el = slotRef.current;
 *     if (!el) return;
 *     return attachPhantomMeasureProbes(el, {
 *       walletAddress: connection.address,
 *       walletName: connection.name,
 *       network: config.network,
 *       chain: connection.chain,
 *     });
 *   }, [connection.address, connection.name, config.network, connection.chain, search]);
 */
export function attachPhantomMeasureProbes(root: HTMLElement, host: MeasureHost): () => void {
  let dead = false;
  let running = false;
  let last: MeasureEntry | null = null;
  const storage = window.sessionStorage;
  const attemptFor = createAttemptCounter(storage);
  const io = createMainnetProbeIo(window.location.origin);

  const draw = () => {
    if (dead) return;
    root.replaceChildren();
    const plan = planPanel(window.location.search, host);
    if (!plan.visible) return;

    const field = document.createElement("fieldset");
    field.style.marginTop = "18px";
    field.style.padding = "16px";
    field.style.border = "1px solid currentColor";
    field.style.borderRadius = "12px";
    field.disabled = running;

    const legend = document.createElement("legend");
    legend.textContent = "Phantom ölçüm — BatchClose (gated)";
    field.append(legend);

    for (const warning of plan.warnings) {
      const p = document.createElement("p");
      p.className = "sx-rp-note";
      p.textContent = warning;
      field.append(p);
    }

    if (plan.countLinks.length > 0) {
      field.append(linkRow("N (önerilen sıra zorlanmaz): ", plan.countLinks.map((link) => ({
        href: link.href,
        label: String(link.count),
        mark: link.suggested,
      }))));
    }
    if (plan.splitLinks.length > 0) {
      field.append(linkRow("İki işlem: ", plan.splitLinks.map((link) => ({
        href: link.href,
        label: link.label,
        mark: link.split === 5,
      }))));
    }

    const version = document.createElement("input");
    version.type = "text";
    version.placeholder = "Phantom sürümü (Settings)";
    version.value = storage.getItem(VERSION_KEY) ?? "";
    version.style.marginTop = "8px";
    version.addEventListener("change", () => storage.setItem(VERSION_KEY, version.value.trim()));
    field.append(version);

    for (const button of plan.buttons) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "sx-btn";
      el.textContent = button.label;
      el.disabled = button.disabled || running;
      el.style.marginRight = "8px";
      el.style.marginTop = "10px";
      if (button.danger) el.style.outline = "2px solid #ff3d7a";
      el.addEventListener("click", () => {
        void run(button.id);
      });
      field.append(el);
    }

    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.className = "sx-rp-note";
    status.style.marginTop = "12px";
    status.style.overflowWrap = "anywhere";
    status.textContent = last
      ? `attempt ${last.attempt} ${last.api} ${last.result} — ${last.note ?? ""}`
      : "Henüz deneme yok. Konsolda [solrepay:measure] nesnesini kopyala.";
    field.append(status);

    if (last) field.append(annotationForm(last));
    root.append(field);
  };

  const run = async (id: "control" | "sas" | "multitx") => {
    if (running || dead) return;
    running = true;
    draw();
    const scope = window as InjectedScope & Window;
    const provider = discoverPhantomProvider(scope);
    const version =
      readProviderVersion(provider) ??
      (storage.getItem(VERSION_KEY) || null);
    try {
      if (id === "multitx") {
        const parsed = new URLSearchParams(window.location.search).get("split");
        last = await runMultiTxProbe({
          split: Number(parsed ?? 0),
          attempt: attemptFor("multitx"),
          host,
          io,
          provider,
          wallets: listStandardWallets(scope),
          phantomVersion: version,
        });
      } else {
        const count = Number(new URLSearchParams(window.location.search).get("count") ?? "1");
        last = await runBatchCloseLadder({
          api: id === "sas" ? "signAndSendTransaction" : "signTransaction",
          count,
          attempt: attemptFor(id),
          host,
          io,
          provider,
          phantomVersion: version,
        });
      }
    } catch (error) {
      console.warn("[solrepay:measure] probe threw", error);
    } finally {
      running = false;
      if (!dead) draw();
    }
  };

  const annotationForm = (entry: MeasureEntry) => {
    const wrap = document.createElement("div");
    wrap.style.marginTop = "12px";
    const screen = labeledInput(wrap, "Ekran metni", entry.screenText ?? "");
    const sim = labeledSelect(wrap, "Simülasyon göründü mü?", [
      ["", "bilinmiyor"],
      ["yes", "evet"],
      ["no", "hayır"],
    ]);
    const screens = labeledInput(wrap, "Onay ekranı sayısı", entry.approvalScreens?.toString() ?? "");
    const presentation = labeledSelect(wrap, "Gösterim", [
      ["", "bilinmiyor"],
      ["batch", "tek liste / batch"],
      ["one-by-one", "tek tek"],
      ["unknown", "emin değilim"],
    ]);
    const result = labeledSelect(wrap, "Sonuç notu", [
      ["", "sonucu değiştirme"],
      ["OK", "normal onay ekranıydı → OK"],
      ["RED", "İstek engellendi → RED"],
    ]);

    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(entry, null, 2);
    pre.style.whiteSpace = "pre-wrap";
    pre.style.overflowWrap = "anywhere";

    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "JSON kopyala";
    copy.addEventListener("click", () => {
      const text = pre.textContent ?? "";
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(text).catch(() => undefined);
      }
    });

    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Notu loga yaz";
    save.style.marginLeft = "8px";
    save.addEventListener("click", () => {
      const screensRaw = screens.value.trim();
      const approvalScreens = screensRaw === "" ? null : Number(screensRaw);
      const picked = result.value === "OK" || result.value === "RED" ? result.value : undefined;
      const simVisible = sim.value === "yes" ? true : sim.value === "no" ? false : null;
      const presentationValue =
        presentation.value === "batch" || presentation.value === "one-by-one" || presentation.value === "unknown"
          ? presentation.value
          : null;
      last = publishMeasure(
        annotateEntry(entry, {
          screenText: screen.value.trim() || null,
          simVisible,
          approvalScreens: approvalScreens != null && Number.isInteger(approvalScreens) ? approvalScreens : null,
          presentation: presentationValue,
          phantomVersion: storage.getItem(VERSION_KEY),
          result: picked,
        }),
      );
      draw();
    });

    wrap.append(pre, copy, save);
    return wrap;
  };

  draw();
  const onPop = () => {
    last = null;
    draw();
  };
  window.addEventListener("popstate", onPop);
  return () => {
    dead = true;
    window.removeEventListener("popstate", onPop);
    root.replaceChildren();
  };
}

function linkRow(
  caption: string,
  links: { href: string; label: string; mark: boolean }[],
): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "sx-rp-note";
  p.append(caption);
  links.forEach((link, index) => {
    if (index > 0) p.append(" ");
    const a = document.createElement("a");
    a.href = link.href;
    a.textContent = link.mark ? `${link.label}*` : link.label;
    p.append(a);
  });
  return p;
}

function labeledInput(parent: HTMLElement, label: string, value: string): HTMLInputElement {
  const wrap = document.createElement("label");
  wrap.style.display = "block";
  wrap.style.marginTop = "8px";
  wrap.append(`${label} `);
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  wrap.append(input);
  parent.append(wrap);
  return input;
}

function labeledSelect(parent: HTMLElement, label: string, options: [string, string][]): HTMLSelectElement {
  const wrap = document.createElement("label");
  wrap.style.display = "block";
  wrap.style.marginTop = "8px";
  wrap.append(`${label} `);
  const select = document.createElement("select");
  for (const [value, text] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    select.append(option);
  }
  wrap.append(select);
  parent.append(wrap);
  return select;
}
