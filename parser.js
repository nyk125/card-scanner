// Turns the text lines read off a business card into contact fields.
// Each line: { text, height } where height is the text height in pixels
// (bigger font = bigger number), used to spot the person's name.
(function (root) {
  const TITLE_WORDS = new Set(("ceo cto cfo coo cmo cio cso cpo cro vp svp evp avp founder cofounder president " +
    "director manager engineer developer designer consultant partner owner principal chief head lead officer " +
    "executive specialist analyst associate assistant coordinator administrator architect advisor adviser attorney " +
    "lawyer counsel agent broker realtor representative rep producer editor writer scientist researcher professor " +
    "physician nurse therapist accountant recruiter strategist supervisor intern chairman chairwoman chair treasurer " +
    "secretary photographer artist chef pastor trainer coach technician investor planner controller senior managing " +
    "general superintendent dentist surgeon pharmacist paralegal underwriter auditor programmer receptionist foreman " +
    "sales marketing").split(" "));
  const LEGAL = new Set("inc llc ltd limited corp corporation co company gmbh ag sa sas srl bv nv pty plc llp lp pc pllc".split(" "));
  const COMPANY_WORDS = new Set([...LEGAL, ...("group holdings partners associates technologies technology tech solutions " +
    "systems studio studios labs lab agency consulting consultants enterprises industries international bank university " +
    "college institute foundation ventures capital media services realty properties clinic hospital software networks " +
    "logistics construction insurance financial law firm restaurant cafe hotel academy school church center centre " +
    "global worldwide digital creative productions pharma health dental").split(" ")]);
  const NOT_NAME = new Set("street st avenue ave road rd suite ste floor building blvd drive lane ln box www com the and of for your our we".split(" "));
  const GENERIC_MAIL = new Set("gmail googlemail yahoo hotmail outlook live msn icloud me mac aol proton protonmail gmx mail yandex zoho comcast verizon att".split(" "));
  const LABEL_WORDS = new Set("tel telephone phone ph fax mobile mob cell email e mail web website www t f m p o c w direct office main toll free x ext url site address addr".split(" "));
  const STREET_WORDS = /\b(street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct|place|pl|suite|ste|floor|fl|unit|parkway|pkwy|highway|hwy|plaza|square|sq|circle|cir|terrace|po box|p\.o\. box)\b\.?/i;
  const CITY_STATE_ZIP = /^([A-Za-z .'-]+),?\s+([A-Z]{2}|[A-Za-z]{4,})\.?,?\s+(\d{5}(?:-\d{4})?|[A-Z]\d[A-Z] ?\d[A-Z]\d)\b/;
  const POSTCODE_UK = /\b([A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})\b/;
  const COUNTRIES = /\b(usa|u\.s\.a\.|united states|canada|united kingdom|uk|australia|germany|france|ireland|new zealand|india|singapore|mexico|spain|italy|netherlands)\b\.?/i;

  const words = (t) => t.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  const hasAny = (t, set) => words(t).some((w) => set.has(w));
  const clean = (t) => t.replace(/^[\s,;:|•·\-–—/\\()[\]]+|[\s,;:|•·\-–—/\\()[\]]+$/g, "");
  const letters = (t) => (t.match(/\p{L}/gu) || []).length;

  // Common OCR slips inside emails and web addresses.
  function fixAddressish(t) {
    return t.replace(/\s*@\s*/g, "@").replace(/(\w)\s*\.\s*(com|org|net|io|co|us|uk|ca|de|biz|info)\b/gi, "$1.$2");
  }

  function domainStem(value) {
    if (!value) return null;
    let host = value.toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
    const parts = host.split(".").filter(Boolean);
    if (parts[0] === "www") parts.shift();
    if (parts.length < 2) return null;
    const second = new Set(["co", "com", "org", "net", "ac", "gov"]);
    const i = parts.length >= 3 && second.has(parts[parts.length - 2]) ? parts.length - 3 : parts.length - 2;
    const stem = parts[i].replace(/[^a-z]/g, "");
    return stem.length >= 2 ? stem : null;
  }

  function phoneLabel(context, line) {
    let w = words(context);
    if (!w.length) w = words(line);
    if (w.some((x) => ["fax", "f", "facsimile"].includes(x))) return "fax";
    if (w.some((x) => ["mobile", "mob", "cell", "cellular", "m", "c", "handy", "mobil", "cel", "iphone"].includes(x))) return "mobile";
    return "work";
  }

  function looksLikeName(text) {
    const main = text.split(",")[0].trim();
    const parts = main.split(/\s+/);
    if (parts.length < 2 || parts.length > 4) return false;
    if (/\d|@/.test(main)) return false;
    for (const p of parts) {
      if (!/^[\p{L}.'’-]+$/u.test(p)) return false;
      if (!/^\p{Lu}/u.test(p)) return false;
    }
    const w = new Set(words(main));
    for (const x of w) {
      if (TITLE_WORDS.has(x) || NOT_NAME.has(x)) return false;
      if (x !== "co" && COMPANY_WORDS.has(x)) return false;
    }
    return true;
  }

  function titleCase(s) {
    return s.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  }

  function splitName(raw, out) {
    const parts = raw.split(",").map((s) => s.trim());
    let main = parts.shift();
    if (main === main.toUpperCase()) main = titleCase(main);
    const creds = [];
    for (const p of parts) {
      if (!p) continue;
      if (hasAny(p, TITLE_WORDS) && !out.title) out.title = p;
      else creds.push(p);
    }
    let w = main.split(/\s+/);
    const prefixes = ["dr", "dr.", "mr", "mr.", "mrs", "mrs.", "ms", "ms.", "prof", "prof."];
    if (w.length > 2 && prefixes.includes(w[0].toLowerCase())) { out.prefix = w.shift(); }
    const suffixes = ["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"];
    if (w.length > 2 && suffixes.includes(w[w.length - 1].toLowerCase())) creds.unshift(w.pop());
    out.firstName = w[0] || "";
    out.lastName = w.length > 1 ? w[w.length - 1] : "";
    out.middleName = w.length > 2 ? w.slice(1, -1).join(" ") : "";
    out.suffix = creds.join(", ");
  }

  function parse(rawLines) {
    const out = {
      prefix: "", firstName: "", middleName: "", lastName: "", suffix: "",
      title: "", company: "", phones: [], emails: [], website: "",
      street: "", city: "", state: "", zip: "", country: "",
    };
    const lines = rawLines.map((l) => ({ text: (l.text || "").replace(/\s+/g, " ").trim(), height: l.height || 0 }))
      .filter((l) => l.text);
    if (!lines.length) return out;
    const rem = lines.map((l) => fixAddressish(l.text));
    const touched = lines.map(() => false);

    // Emails
    const emailRe = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;
    rem.forEach((t, i) => {
      const found = t.match(emailRe) || [];
      for (const e of found) {
        const v = e.toLowerCase().replace(/[.,;]+$/, "");
        if (!out.emails.includes(v)) out.emails.push(v);
        rem[i] = rem[i].replace(e, " "); touched[i] = true;
      }
    });

    // Websites
    const urlRe = /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|co|us|uk|ca|de|biz|info|ai|app|dev|me|tv|edu|gov|au|nz|ie|fr|es|it|nl|in|design|studio|agency|tech|law)(?:\.[a-z]{2})?(?:\/[^\s]*)?)/gi;
    rem.forEach((t, i) => {
      const found = t.match(urlRe) || [];
      for (const u of found) {
        if (letters(u) < 4) continue;
        if (!out.website) out.website = u.toLowerCase();
        rem[i] = rem[i].replace(u, " "); touched[i] = true;
      }
    });

    // Phones: runs of digits with common separators, 7-15 digits.
    const phoneRe = /(\+?\(?\d[\d\s().\-\/]{6,}\d)(\s*(?:x|ext\.?|extension)\s*\d{1,5})?/gi;
    rem.forEach((t, i) => {
      let cursor = 0; let m; const found = [];
      phoneRe.lastIndex = 0;
      while ((m = phoneRe.exec(t))) {
        const context = t.slice(cursor, m.index);
        cursor = m.index + m[0].length;
        const digits = m[1].replace(/\D/g, "");
        if (digits.length < 7 || digits.length > 15) continue;
        // Skip things that look like a street number + zip on an address line.
        if (/^\d{5}(-\d{4})?$/.test(m[1].trim())) continue;
        found.push(m[0]);
        if (!out.phones.some((p) => p.number.replace(/\D/g, "") === digits)) {
          out.phones.push({ label: phoneLabel(context, lines[i].text), number: m[0].trim().replace(/\s{2,}/g, " ") });
        }
      }
      for (const f of found) { rem[i] = rem[i].replace(f, " "); touched[i] = true; }
    });

    // Address: a line with "City, ST 12345" (or a postcode), plus the street line above it.
    for (let i = 0; i < rem.length; i++) {
      const t = clean(rem[i]);
      let m = t.match(CITY_STATE_ZIP);
      let streetPart = "";
      if (m) {
        const before = t.slice(0, m.index).trim();
        // "123 Main St, Springfield, IL 62701" on one line
        const cityChunk = m[1].trim();
        const commaIdx = cityChunk.lastIndexOf(",");
        let city = cityChunk;
        if (STREET_WORDS.test(cityChunk) || /^\d/.test(cityChunk)) {
          const segs = cityChunk.split(",").map((s) => s.trim()).filter(Boolean);
          city = segs.pop() || "";
          // street words may run straight into the city without a comma: take the last word as city
          if (!segs.length) {
            const ws = cityChunk.split(/\s+/);
            city = ws.pop();
            segs.push(ws.join(" "));
          }
          streetPart = segs.join(", ");
        }
        void commaIdx; void before;
        out.city = city.replace(/,$/, "");
        out.state = m[2];
        out.zip = m[3];
        const after = t.slice(m.index + m[0].length);
        const c = after.match(COUNTRIES);
        if (c) out.country = c[0].replace(/\.$/, "");
        rem[i] = " "; touched[i] = true;
      } else if (POSTCODE_UK.test(t) && (i > 0 && STREET_WORDS.test(rem[i - 1]) || /,/.test(t))) {
        const pm = t.match(POSTCODE_UK);
        out.zip = pm[1];
        const segs = t.replace(pm[1], "").split(",").map((s) => clean(s)).filter(Boolean);
        const c = segs.findIndex((s) => COUNTRIES.test(s));
        if (c >= 0) out.country = segs.splice(c, 1)[0];
        out.city = segs.pop() || "";
        streetPart = segs.join(", ");
        rem[i] = " "; touched[i] = true;
        m = pm;
      }
      if (m) {
        const streets = [];
        if (streetPart) streets.push(streetPart);
        // Up to two lines above that look like a street / suite.
        for (let j = i - 1; j >= Math.max(0, i - 2); j--) {
          const s = clean(rem[j]);
          if (s && (STREET_WORDS.test(s) || /^\d+\s+\p{L}/u.test(s)) && !looksLikeName(s)) {
            streets.unshift(s); rem[j] = " "; touched[j] = true;
          } else break;
        }
        out.street = streets.join(", ");
        if (!out.country) {
          for (let j = i + 1; j < Math.min(rem.length, i + 2); j++) {
            const s = clean(rem[j]);
            if (COUNTRIES.test(s) && s.split(/\s+/).length <= 3) { out.country = s; rem[j] = " "; touched[j] = true; }
          }
        }
        break;
      }
    }
    // A street line without a city line still counts.
    if (!out.street) {
      for (let i = 0; i < rem.length; i++) {
        const s = clean(rem[i]);
        if (/^\d+\s+\p{L}/u.test(s) && STREET_WORDS.test(s)) { out.street = s; rem[i] = " "; touched[i] = true; break; }
      }
    }

    const locals = out.emails.map((e) => e.split("@")[0]);
    const stems = new Set([...out.emails.map((e) => domainStem(e.split("@")[1])), domainStem(out.website)]
      .filter((s) => s && !GENERIC_MAIL.has(s)));

    // Leftover segments
    let segs = [];
    lines.forEach((l, i) => {
      let t = rem[i];
      if (touched[i]) {
        t = t.split(/\s+/).filter((w) => {
          const core = w.toLowerCase().replace(/[^\p{L}]/gu, "");
          return core && !LABEL_WORDS.has(core);
        }).join(" ");
      }
      t.replace(/\s[-–—]\s/g, "|").split(/[|•·]/).forEach((p) => {
        const c = clean(p);
        if (letters(c) >= 2) segs.push({ text: c, height: l.height, order: segs.length, used: false });
      });
    });

    // 1. Company by legal suffix or industry word
    let s = segs.find((x) => !x.used && !looksLikeName(x.text) &&
      (hasAny(x.text, LEGAL) || (hasAny(x.text, COMPANY_WORDS) && !hasAny(x.text, TITLE_WORDS))));
    if (s) {
      out.company = s.text; s.used = true;
      // "Bluebird" (logo) above "Design Studio": join them when the domain says so.
      const prev = segs[s.order - 1];
      if (prev && !prev.used && !/\d/.test(prev.text) && prev.text.split(/\s+/).length <= 2) {
        const pl = prev.text.toLowerCase().replace(/[^a-z]/g, "");
        if (pl.length >= 3 && [...stems].some((st) => st.includes(pl))) {
          out.company = prev.text + " " + s.text; prev.used = true;
        }
      }
    }

    // 2. Job title
    s = segs.find((x) => !x.used && hasAny(x.text, TITLE_WORDS) && !looksLikeName(x.text));
    if (s) { out.title = s.text; s.used = true; }

    // 3. Company by matching the email / website domain
    if (!out.company && stems.size) {
      s = segs.find((x) => {
        if (x.used) return false;
        const l = x.text.toLowerCase().replace(/[^a-z]/g, "");
        if (l.length < 3) return false;
        const dom = [...stems].some((st) => st.includes(l) || l.includes(st));
        const person = locals.some((loc) => words(x.text).some((w) => w.length >= 3 && loc.includes(w)));
        return dom && !person;
      });
      if (s) { out.company = s.text; s.used = true; }
    }

    // 4. Name
    const maxH = Math.max(...segs.map((x) => x.height), 1);
    const score = (x) => {
      let sc = (x.height / maxH) * 2 + (1 - x.order / Math.max(segs.length, 1)) * 0.5;
      const w = words(x.text).filter((y) => y.length >= 2);
      for (const loc of locals) {
        const hits = w.filter((y) => loc.includes(y)).length;
        if (hits) sc += 2 + hits;
        if (w.length >= 2 && (loc === w[0][0] + w[w.length - 1] || loc === w[0][0] + "." + w[w.length - 1])) sc += 3;
      }
      return sc;
    };
    const cands = segs.filter((x) => !x.used && looksLikeName(x.text));
    if (cands.length) {
      const best = cands.reduce((a, b) => (score(b) > score(a) ? b : a));
      splitName(best.text, out); best.used = true;
    } else if (locals[0]) {
      const p = locals[0].split(/[._-]/);
      if (p.length === 2 && p.every((x) => /^[a-z]{2,}$/.test(x))) {
        out.firstName = titleCase(p[0]); out.lastName = titleCase(p[1]);
      }
    }

    // 5. Company fallback: largest leftover text without digits, else the domain
    if (!out.company) {
      const left = segs.filter((x) => !x.used && !/\d/.test(x.text) && x.text.split(/\s+/).length <= 5);
      if (left.length) {
        const big = left.reduce((a, b) => (b.height > a.height ? b : a));
        out.company = big.text; big.used = true;
      } else if (stems.size) {
        const st = [...stems][0];
        const person = words(out.firstName + " " + out.lastName);
        if (!person.some((w) => w.length >= 3 && st.includes(w))) out.company = titleCase(st);
      }
    }
    return out;
  }

  // vCard 3.0 text for the parsed / edited contact.
  function toVCard(c) {
    const esc = (v) => String(v || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
    const L = ["BEGIN:VCARD", "VERSION:3.0"];
    const full = [c.prefix, c.firstName, c.middleName, c.lastName].filter(Boolean).join(" ") + (c.suffix ? ", " + c.suffix : "");
    L.push(`N:${esc(c.lastName)};${esc(c.firstName)};${esc(c.middleName)};${esc(c.prefix)};${esc(c.suffix)}`);
    L.push(`FN:${esc(full || c.company || "New Contact")}`);
    if (c.company) L.push(`ORG:${esc(c.company)}`);
    if (c.title) L.push(`TITLE:${esc(c.title)}`);
    const typeFor = { mobile: "CELL,VOICE", work: "WORK,VOICE", fax: "WORK,FAX" };
    for (const p of c.phones || []) if (p.number) L.push(`TEL;TYPE=${typeFor[p.label] || "WORK,VOICE"}:${p.number}`);
    for (const e of c.emails || []) if (e) L.push(`EMAIL;TYPE=INTERNET,WORK:${e}`);
    if (c.website) L.push(`URL;TYPE=WORK:${/^https?:/.test(c.website) ? c.website : "https://" + c.website}`);
    if (c.street || c.city || c.state || c.zip || c.country) {
      L.push(`ADR;TYPE=WORK:;;${esc(c.street)};${esc(c.city)};${esc(c.state)};${esc(c.zip)};${esc(c.country)}`);
    }
    if (!c.firstName && !c.lastName && c.company) L.push("X-ABShowAs:COMPANY");
    if (c.photo) L.push(`PHOTO;ENCODING=b;TYPE=JPEG:${c.photo}`);
    L.push("END:VCARD");
    return L.join("\r\n") + "\r\n";
  }

  const api = { parse, toVCard, looksLikeName };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CardParser = api;
})(typeof window !== "undefined" ? window : globalThis);
