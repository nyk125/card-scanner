// Spreadsheet features: Excel export and the optional Google Sheet copy.
(function (root) {
  const COLUMNS = ["Name", "Phone", "Company", "Email", "Address", "Job Title", "Website", "Date Scanned"];
  const LABELS = { mobile: "Mobile", work: "Work", fax: "Fax" };

  function row(c) {
    const name = [c.prefix, c.firstName, c.middleName, c.lastName].filter(Boolean).join(" ") + (c.suffix ? ", " + c.suffix : "");
    const phone = (c.phones || []).map((p) => `${LABELS[p.label] || "Phone"}: ${p.number}`).join("; ");
    const cityLine = [c.city, [c.state, c.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const address = [c.street, cityLine, c.country].filter(Boolean).join(", ");
    const d = new Date(c.savedAt || Date.now());
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return {
      id: c.id || "", name, phone, company: c.company || "", email: (c.emails || []).join("; "),
      address, title: c.title || "", website: c.website || "", date,
    };
  }

  // Builds a real .xlsx file (SheetJS, loaded only when needed).
  async function excelFile(contacts) {
    if (!root.XLSX) {
      await new Promise((ok, fail) => {
        const s = document.createElement("script");
        s.src = "vendor/xlsx.mini.min.js"; s.onload = ok; s.onerror = () => fail(new Error("xlsx-load"));
        document.head.append(s);
      });
    }
    const rows = contacts.map(row).map((r) => [r.name, r.phone, r.company, r.email, r.address, r.title, r.website, r.date]);
    const ws = XLSX.utils.aoa_to_sheet([COLUMNS, ...rows]);
    ws["!cols"] = [28, 34, 26, 32, 44, 24, 26, 13].map((wch) => ({ wch }));
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: COLUMNS.length - 1 } }) };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Contacts");
    const data = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const d = new Date();
    const name = `Business Cards ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.xlsx`;
    return new File([data], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  // Opens the iPhone share sheet (Save to Files, Excel, Google Sheets, Mail…), or downloads.
  async function shareFile(file) {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: file.name }); return "shared"; }
      catch (e) { if (e && e.name === "AbortError") return "cancelled"; }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file); a.download = file.name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    return "downloaded";
  }

  // Sends rows to the user's Apps Script web app. The script skips IDs it already has.
  async function sendToSheet(url, contacts, { beacon = false } = {}) {
    const body = JSON.stringify(contacts.map(row));
    // A beacon still goes out if the page is leaving (Add to Contacts opens the contact screen).
    if (beacon && navigator.sendBeacon &&
        navigator.sendBeacon(url, new Blob([body], { type: "text/plain;charset=utf-8" }))) return;
    await fetch(url, {
      method: "POST", mode: "no-cors", redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body,
    });
  }

  function validSheetUrl(u) {
    return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec\/?$/.test(u.trim()) ||
      /^https:\/\/script\.google\.com\/a\/[^/]+\/macros\/s\/[\w-]+\/exec\/?$/.test(u.trim());
  }

  const SCRIPT = `// Card Scanner → Google Sheet
// Adds one row per scanned business card. Paste into Extensions → Apps Script.
const HEADERS = ["Name", "Phone", "Company", "Email", "Address",
                 "Job Title", "Website", "Date Scanned", "ID"];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    if (sheet.getLastRow() === 0) {
      sheet.getRange("A:I").setNumberFormat("@");   // keep phone numbers as text
      sheet.appendRow(HEADERS);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
      sheet.setFrozenRows(1);
    }
    const data = JSON.parse(e.postData.contents);
    const rows = Array.isArray(data) ? data : [data];
    const last = sheet.getLastRow();
    const ids = last > 1
      ? sheet.getRange(2, HEADERS.length, last - 1, 1).getValues().map(r => String(r[0]))
      : [];
    let added = 0;
    rows.forEach(r => {
      if (r.id && ids.indexOf(String(r.id)) !== -1) return;   // already in the sheet
      sheet.appendRow([r.name, r.phone, r.company, r.email, r.address,
                       r.title, r.website, r.date, r.id]);
      ids.push(String(r.id));
      added++;
    });
    return ContentService.createTextOutput(JSON.stringify({ ok: true, added }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
`;

  root.Sheets = { row, excelFile, shareFile, sendToSheet, validSheetUrl, SCRIPT, COLUMNS };
})(window);
