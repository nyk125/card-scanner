(function () {
  const $ = (id) => document.getElementById(id);
  const FIELDS = ["firstName", "middleName", "lastName", "suffix", "company", "title", "website", "street", "city", "state", "zip", "country"];
  let current = null;      // parsed contact being reviewed (prefix kept here)
  let worker = null;
  let previewUrl = null;

  // ---------- storage (optional convenience) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  // ---------- views ----------
  function show(view) {
    $("start").hidden = view !== "start";
    $("working").hidden = view !== "working";
    $("contactForm").hidden = view !== "review";
    $("savebar").hidden = view !== "review";
    $("recentBox").hidden = view !== "start" || !store.get("recent", []).length;
    if (view !== "review") $("addedBox").hidden = true;
    $("errorBox").hidden = true;
  }
  function showError(msg) {
    show("start");
    $("errorBox").textContent = msg;
    $("errorBox").hidden = false;
  }
  function progress(text, pct) {
    $("statusText").textContent = text;
    if (pct != null) $("barFill").style.width = Math.round(pct * 100) + "%";
  }

  // ---------- image prep ----------
  async function loadImage(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { img, url };
  }
  // Scale to a size Tesseract likes, grayscale, stretch contrast.
  function prepCanvas(img) {
    const maxSide = 2000;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h); const px = d.data;
    let min = 255, max = 0; const gray = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      gray[j] = g; if (g < min) min = g; if (g > max) max = g;
    }
    const range = Math.max(1, max - min);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      const v = ((gray[j] - min) / range) * 255;
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    ctx.putImageData(d, 0, 0);
    return c;
  }
  function photoThumb(img) {
    const s = Math.min(1, 480 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.75);
  }

  // ---------- OCR ----------
  async function getWorker() {
    if (worker) return worker;
    if (!window.Tesseract) throw new Error("offline-first");
    if (!store.get("ocrReady", false)) $("firstRun").hidden = false;
    const base = new URL("ocr/", location.href).href;
    worker = await Tesseract.createWorker("eng", 1, {   // 1 = LSTM engine
      workerPath: base + "worker.min.js",
      corePath: base,
      langPath: base,
      logger: (m) => {
        if (m.status === "recognizing text") progress("Reading card…", 0.3 + m.progress * 0.7);
        else if (/load|download|initializ/i.test(m.status)) progress("Getting the text reader ready…", (m.progress || 0) * 0.3);
      },
    });
    store.set("ocrReady", true);
    return worker;
  }
  async function readLines(canvas) {
    const w = await getWorker();
    const toLines = (data) => (data.lines || []).map((l) => ({
      text: l.text.trim(), height: l.bbox.y1 - l.bbox.y0, conf: l.confidence,
    })).filter((l) => l.text && l.conf > 30);
    await w.setParameters({ tessedit_pageseg_mode: "3" });
    let { data } = await w.recognize(canvas);
    let lines = toLines(data);
    if (lines.length < 3) {           // scattered layouts: try sparse-text mode
      await w.setParameters({ tessedit_pageseg_mode: "11" });
      ({ data } = await w.recognize(canvas));
      const sparse = toLines(data);
      if (sparse.length > lines.length) lines = sparse;
    }
    return lines;
  }

  async function handleFile(file) {
    if (!file) return;
    show("working");
    $("firstRun").hidden = true;
    progress("Reading card…", 0.02);
    try {
      const { img, url } = await loadImage(file);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = url;
      $("preview").src = url; $("formPreview").src = url;
      const lines = await readLines(prepCanvas(img));
      $("rawText").textContent = lines.map((l) => l.text).join("\n");
      if (!lines.length) {
        showError("No text was found on that photo. Try again with more light and the card filling most of the frame.");
        return;
      }
      current = CardParser.parse(lines);
      current.thumb = photoThumb(img);
      fillForm(current);
      show("review");
      window.scrollTo({ top: 0 });
    } catch (e) {
      console.error(e);
      showError(e && e.message === "offline-first"
        ? "The text reader hasn't downloaded yet. Connect to the internet for your first scan."
        : "Something went wrong reading that photo. Please try again.");
    } finally {
      $("camera").value = ""; $("library").value = "";
    }
  }

  // ---------- form ----------
  function phoneRow(p = { label: "work", number: "" }) {
    const row = document.createElement("div"); row.className = "phone";
    const sel = document.createElement("select"); sel.setAttribute("aria-label", "Phone type");
    for (const [v, t] of [["mobile", "Mobile"], ["work", "Work"], ["fax", "Fax"]]) {
      const o = document.createElement("option"); o.value = v; o.textContent = t; if (v === p.label) o.selected = true; sel.append(o);
    }
    const inp = document.createElement("input"); inp.type = "tel"; inp.value = p.number; inp.setAttribute("aria-label", "Phone number");
    const del = document.createElement("button"); del.type = "button"; del.className = "icon-btn"; del.textContent = "×";
    del.setAttribute("aria-label", "Remove phone"); del.onclick = () => row.remove();
    row.append(sel, inp, del); return row;
  }
  function emailRow(v = "") {
    const row = document.createElement("div"); row.className = "phone"; row.style.gridTemplateColumns = "1fr 40px";
    const inp = document.createElement("input"); inp.type = "email"; inp.value = v; inp.autocapitalize = "off";
    inp.spellcheck = false; inp.setAttribute("aria-label", "Email");
    const del = document.createElement("button"); del.type = "button"; del.className = "icon-btn"; del.textContent = "×";
    del.setAttribute("aria-label", "Remove email"); del.onclick = () => row.remove();
    row.append(inp, del); return row;
  }
  function fillForm(c) {
    for (const f of FIELDS) $(f).value = c[f] || "";
    $("phones").replaceChildren(...(c.phones.length ? c.phones : [{ label: "mobile", number: "" }]).map(phoneRow));
    $("emails").replaceChildren(...(c.emails.length ? c.emails : [""]).map(emailRow));
  }
  function readForm() {
    const c = { prefix: current ? current.prefix : "" };
    for (const f of FIELDS) c[f] = $(f).value.trim();
    c.phones = [...$("phones").children].map((r) => ({ label: r.querySelector("select").value, number: r.querySelector("input").value.trim() })).filter((p) => p.number);
    c.emails = [...$("emails").children].map((r) => r.querySelector("input").value.trim()).filter(Boolean);
    return c;
  }

  // ---------- saving ----------
  function b64url(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = ""; bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fileName(c) {
    return ((c.firstName + " " + c.lastName).trim() || c.company || "contact").replace(/[^\p{L}\p{N} .-]/gu, "") + ".vcf";
  }
  // Opens the contact so iOS shows its "Create New Contact" screen.
  function openVCard(vcf, c) {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      // The service worker answers this URL with a real vCard file.
      location.href = "contact.vcf?d=" + b64url(vcf) + "&n=" + encodeURIComponent(fileName(c));
    } else {
      location.href = "data:text/vcard;charset=utf-8," + encodeURIComponent(vcf);
    }
  }
  async function shareVCard(vcf, c) {
    const file = new File([vcf], fileName(c), { type: "text/vcard" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch { /* cancelled */ }
    } else {
      openVCard(vcf, c);
    }
  }

  function remember(c) {
    const list = store.get("recent", []);
    const entry = { ...c, savedAt: Date.now() };
    const key = (x) => [x.firstName, x.lastName, x.company].join("|").toLowerCase();
    const next = [entry, ...list.filter((x) => key(x) !== key(entry))].slice(0, 20);
    store.set("recent", next);
    renderRecent();
  }
  function renderRecent() {
    const list = store.get("recent", []);
    const ul = $("recent"); ul.replaceChildren();
    for (const c of list) {
      const li = document.createElement("li");
      const name = (c.firstName + " " + c.lastName).trim() || c.company || "Contact";
      const av = document.createElement("div"); av.className = "avatar";
      av.textContent = ((c.firstName || name)[0] || "?").toUpperCase() + ((c.lastName || "")[0] || "").toUpperCase();
      const who = document.createElement("div"); who.className = "who";
      const b = document.createElement("b"); b.textContent = name;
      const s = document.createElement("span"); s.textContent = [c.title, c.firstName || c.lastName ? c.company : ""].filter(Boolean).join(" · ") || (c.emails || [])[0] || "";
      who.append(b, s);
      const btn = document.createElement("button"); btn.type = "button"; btn.textContent = "Add again";
      btn.onclick = () => openVCard(CardParser.toVCard(c), c);
      li.append(av, who, btn); ul.append(li);
    }
    $("recentBox").hidden = !$("start").hidden ? !list.length : true;
  }

  // ---------- wiring ----------
  $("camera").addEventListener("change", (e) => handleFile(e.target.files[0]));
  $("library").addEventListener("change", (e) => handleFile(e.target.files[0]));
  $("addPhone").onclick = () => $("phones").append(phoneRow({ label: "mobile", number: "" }));
  $("cancelBtn").onclick = () => { current = null; show("start"); renderRecent(); };
  $("saveBtn").onclick = () => {
    const c = readForm();
    if (!c.firstName && !c.lastName && !c.company && !c.phones.length && !c.emails.length) {
      $("errorBox").textContent = "Add at least a name, company, phone or email first.";
      $("errorBox").hidden = false; return;
    }
    $("errorBox").hidden = true;
    remember(c);
    $("addedBox").hidden = false;
    $("shareBtn").onclick = () => shareVCard(CardParser.toVCard(c), c);
    openVCard(CardParser.toVCard(c), c);
  };

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  show("start");
  renderRecent();
})();
