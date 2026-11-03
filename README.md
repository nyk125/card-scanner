# Card Scanner

A web app for iPhone that scans a business card and adds it to Contacts.
No Mac or App Store needed: open the page in Safari and add it to your Home Screen.

- **Scan a card** opens the camera. **Choose from Photos** works with cards you already photographed.
- The text is read on the phone with Tesseract (open-source OCR). The photo never leaves the phone.
- The name, company, job title, phone numbers, email, website and address are filled in for you to check.
- **Add to Contacts** opens the iPhone's contact screen. Tap **Create New Contact**, then **Done**.
- After the first scan it also works offline.

## Install on iPhone

1. Open the site link in **Safari**.
2. Tap the **Share** button, then **Add to Home Screen**, then **Add**.
3. Open **Card Scanner** from your Home Screen.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The screen and its styles |
| `app.js` | Camera/photo input, text reading, the review form, saving |
| `parser.js` | Works out which text is the name, company, title, phone, etc. |
| `sw.js` | Offline support, and serves the contact file to the iPhone |
| `ocr/` | Tesseract.js 5.1.1 and English language data (Apache 2.0) |
