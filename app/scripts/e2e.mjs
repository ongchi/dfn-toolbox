// End-to-end check of the web app in the local Chrome (headless).
// Start the dev server first (npm run dev), then:
//   node scripts/e2e.mjs [url] [screenshot folder]
// It runs each example, a bad input, and a cancel, and saves screenshots.
import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? "http://localhost:5173/";
const screenshotDir = process.argv[3] ?? ".";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const dfngenDir = new URL("../../../dfngen-rs", import.meta.url).pathname.replace(/\/$/, "");

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
const failures = [];

async function statusText(page) {
  return page.$eval("#status", (node) => (node.hidden ? "" : node.textContent));
}

async function waitIdle(page) {
  await page.waitForFunction(() => !document.querySelector("#run-button").disabled, { timeout: 120000 });
}

async function selectExample(page, name) {
  // A select of the same value sends no change event: select none first
  await page.select("#example-select", "");
  await page.$eval("#form", (node) => delete node.dataset.example);
  await page.select("#example-select", name);
  await page.waitForFunction((caseName) => document.querySelector("#form").dataset.example === caseName, {}, name);
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  page.on("pageerror", (error) => failures.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      console.log(`[console.error] ${message.text()}`);
    }
  });
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("#example-select").options.length > 1);
  await page.waitForFunction(() => document.querySelector("#viewer-message").hidden, { timeout: 120000 });

  const examples = await page.$$eval("#example-select option", (options) =>
    options.map((option) => option.value).filter((value) => value !== ""),
  );
  for (const name of examples) {
    await selectExample(page, name);
    await page.click("#run-button");
    await waitIdle(page);
    const status = await statusText(page);
    const isDone = status.startsWith("Done");
    console.log(`${isDone ? "ok  " : "FAIL"} ${name}: ${status.split("\n")[0]}`);
    if (!isDone) {
      failures.push(`${name}: ${status}`);
    }
    if (name === "mesh_domain" || name === "fram_rejections") {
      await page.screenshot({ path: `${screenshotDir}/e2e_${name}.png` });
    }
    if (name === "fram_rejections") {
      await page.click("#show-rejected");
      await page.click("#show-removed");
      await page.select("#color-select", "");
      await new Promise((resolve) => setTimeout(resolve, 500));
      await page.screenshot({ path: `${screenshotDir}/e2e_${name}_layers.png` });
      await page.click("#show-rejected");
      await page.click("#show-removed");
    }
  }

  // Bad input: a fracture file as the domain mesh gives an error of the library
  await selectExample(page, "base");
  const [meshInput] = await page.$$(".file-row input[type=file]");
  await meshInput.uploadFile(`${dfngenDir}/tests/data/user_fractures/user_fractures.vtp`);
  await page.waitForFunction(() => document.querySelector(".file-status").textContent.startsWith("user_fractures.vtp"));
  await page.click("#check-button");
  await waitIdle(page);
  const checkStatus = await statusText(page);
  const isErrorShown = await page.$eval("#status", (node) => node.classList.contains("is-error"));
  console.log(`${isErrorShown ? "ok  " : "FAIL"} check of a bad input: ${checkStatus}`);
  if (!isErrorShown) {
    failures.push(`check of a bad input: ${checkStatus}`);
  }

  // Cancel: a large run, cancelled at once
  await selectExample(page, "base");
  await page.evaluate(() => {
    const input = [...document.querySelectorAll("input[type=number]")].find((node) =>
      node.closest(".field")?.textContent.includes("n_poly"),
    );
    input.value = "100000";
    input.dispatchEvent(new Event("input"));
  });
  await page.click("#run-button");
  await new Promise((resolve) => setTimeout(resolve, 500));
  await page.click("#cancel-button");
  await waitIdle(page);
  const cancelStatus = await statusText(page);
  console.log(`${cancelStatus === "Cancelled." ? "ok  " : "FAIL"} cancel: ${cancelStatus}`);
  if (cancelStatus !== "Cancelled.") {
    failures.push(`cancel: ${cancelStatus}`);
  }
  // The new worker runs the next input
  await selectExample(page, "base");
  await page.click("#run-button");
  await waitIdle(page);
  const afterCancel = await statusText(page);
  console.log(`${afterCancel.startsWith("Done") ? "ok  " : "FAIL"} run after cancel: ${afterCancel}`);
  if (!afterCancel.startsWith("Done")) {
    failures.push(`run after cancel: ${afterCancel}`);
  }
  await page.screenshot({ path: `${screenshotDir}/e2e_base.png` });
  await page.$eval(".family-card", (node) => node.scrollIntoView());
  await page.screenshot({ path: `${screenshotDir}/e2e_families.png` });
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} failure(s):\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("\nAll checks passed.");
