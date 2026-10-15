// tools/diag.mjs — headless frame diagnostics: load the preview harness, seek, dump geometry, screenshot.
// usage: node tools/diag.mjs <url> <out.png>
import { chromium } from "playwright";

const url = process.argv[2];
const out = process.argv[3] || "/tmp/diag.png";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
page.on("console", (m) => console.log("[console]", m.type(), m.text().slice(0, 200)));
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
page.on("requestfailed", (r) => console.log("[reqfail]", r.url(), r.failure()?.errorText));
await page.goto(url, { waitUntil: "load", timeout: 30000 });
await page.waitForFunction(() => window.__previewReady === true, { timeout: 20000 }).catch(() => console.log("PREVIEW TIMEOUT"));
const d = await page.evaluate(() => {
  const pick = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      id: el.id, tag: el.tagName,
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      op: cs.opacity, disp: cs.display, vis: cs.visibility,
      tf: cs.transform === "none" ? null : cs.transform,
    };
  };
  return {
    title: document.title,
    imgs: [...document.querySelectorAll("img")].map((i) => ({ src: i.getAttribute("src"), natural: [i.naturalWidth, i.naturalHeight], complete: i.complete, ...pick(i) })),
    ids: [...document.querySelectorAll("#mount [id]")].map(pick).slice(0, 60),
  };
});
console.log(JSON.stringify(d, null, 1));
await page.screenshot({ path: out });
console.log("screenshot:", out);
await browser.close();
