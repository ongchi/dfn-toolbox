// Check of the place of the VTK.wasm bundle in the production build, in the
// local Chrome (headless). Build, start the preview server, then:
//   npm run build && npm run preview & node scripts/e2e-bundle.mjs [url]
// The 3D view loads from the CDN and not from the site; if the CDN fails or
// sends a wrong file, it loads from the site.
import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? "http://localhost:4173/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDN_HOST = "cdn.jsdelivr.net";
const SITE_BUNDLE = "/vtk/vtk-wasm32-emscripten.tar.gz";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
const failures = [];

/** Opens the page with `answerCdn` for the request to the CDN; returns the requests of the bundle */
async function loadPage(answerCdn) {
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setRequestInterception(true);
  const requests = { cdn: 0, site: 0 };
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.hostname === CDN_HOST) {
      requests.cdn += 1;
      void answerCdn(request);
      return;
    }
    if (requestUrl.pathname.endsWith(SITE_BUNDLE)) {
      requests.site += 1;
    }
    void request.continue();
  });
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("#viewer-message").hidden, { timeout: 120000 });
  const message = await page.$eval("#viewer-message", (node) => node.textContent);
  await page.close();
  return { ...requests, message };
}

function check(label, requests, cdn, site) {
  const isOk = requests.cdn === cdn && requests.site === site;
  console.log(`${isOk ? "ok  " : "FAIL"} ${label}: ${JSON.stringify(requests)}`);
  if (!isOk) {
    failures.push(label);
  }
}

try {
  check("the bundle comes from the CDN", await loadPage((request) => request.continue()), 1, 0);
  check("the CDN fails", await loadPage((request) => request.abort("failed")), 1, 1);
  check(
    "the CDN sends a wrong file",
    await loadPage((request) =>
      request.respond({
        status: 200,
        headers: { "Access-Control-Allow-Origin": "*" },
        contentType: "application/gzip",
        body: "not the bundle",
      }),
    ),
    1,
    1,
  );
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} failure(s): ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nAll checks passed.");
