// End-to-end check of the web app in the local Chrome (headless).
// Start the dev server first (npm run dev), then:
//   node scripts/e2e.mjs [url] [screenshot folder]
// It runs the full workflow (network, flow, transport) of each example, the
// single zip of the output, the save and the open of the workflow file, a bad
// input, a cancel, and the flow and the transport without their input; it
// saves screenshots.
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? "http://localhost:5173/";
const screenshotDir = process.argv[3] ?? ".";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const RUN_TIMEOUT = 300000;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
const failures = [];

function check(isOk, label, detail) {
  console.log(`${isOk ? "ok  " : "FAIL"} ${label}: ${detail.split("\n")[0]}`);
  if (!isOk) {
    failures.push(`${label}: ${detail}`);
  }
}

async function statusText(page) {
  return page.$eval("#status", (node) => (node.hidden ? "" : node.textContent));
}

async function isStatusError(page) {
  return page.$eval("#status", (node) => node.classList.contains("is-error"));
}

async function waitIdle(page) {
  await page.waitForFunction(() => !document.querySelector("#run-button").disabled, { timeout: RUN_TIMEOUT });
}

async function selectExample(page, name) {
  // A select of the same value sends no change event: select none first
  await page.select("#example-select", "");
  await page.$eval("#form", (node) => delete node.dataset.example);
  await page.select("#example-select", name);
  await page.waitForFunction((exampleName) => document.querySelector("#form").dataset.example === exampleName, {}, name);
}

/** Runs the step of a sidebar tab; returns the status text */
async function runStep(page, tab) {
  await page.click(`[data-sidebar-tab="${tab}"]`);
  await page.click("#run-button");
  await waitIdle(page);
  return statusText(page);
}

/** Waits for a new file in the download folder; returns its path */
async function waitDownload(downloadDir, name) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const path = join(downloadDir, name);
    if (existsSync(path) && !readdirSync(downloadDir).some((file) => file.endsWith(".crdownload"))) {
      return path;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no download ${name} in ${downloadDir}`);
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
  const downloadDir = mkdtempSync(join(tmpdir(), "dfn-web-e2e-"));
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });

  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("#example-select").options.length > 1);
  await page.waitForFunction(() => document.querySelector("#viewer-message").hidden, { timeout: 120000 });

  // The full workflow of each example
  const examples = await page.$$eval("#example-select option", (options) =>
    options.map((option) => option.value).filter((value) => value !== ""),
  );
  for (const name of examples) {
    await page.click('[data-sidebar-tab="network"]');
    await selectExample(page, name);
    const networkStatus = await runStep(page, "network");
    check(networkStatus.startsWith("Done"), `${name}: network`, networkStatus);

    const flowStatus = await runStep(page, "flow");
    const hasFlowResults = await page.$eval("#flow-results", (node) => !node.hidden);
    const isPressureShown = await page.$eval("#color-select", (node) => node.value === "point:pressure");
    check(flowStatus.startsWith("Done") && hasFlowResults && isPressureShown, `${name}: flow`, flowStatus);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.screenshot({ path: `${screenshotDir}/e2e_${name}_flow.png` });

    const transportStatus = await runStep(page, "transport");
    const hasTransportResults = await page.$eval("#transport-results", (node) => !node.hidden);
    const areTrajectoriesShown = await page.$eval("#show-trajectories", (node) => node.checked && !node.disabled);
    check(
      transportStatus.startsWith("Done") && hasTransportResults && areTrajectoriesShown,
      `${name}: transport`,
      transportStatus,
    );
    // The trajectories in the fractures: colored by fracture, not by the pressure
    await page.select("#color-select", "cell:fracture_id");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.screenshot({ path: `${screenshotDir}/e2e_${name}_transport.png` });
  }

  // One zip of the last example: the workflow file and the three output folders
  const lastExample = examples[examples.length - 1];
  await page.click("#download-all");
  const archive = unzipSync(readFileSync(await waitDownload(downloadDir, `${lastExample}_output.zip`)));
  const entries = Object.keys(archive);
  const hasAllParts =
    entries.includes(`${lastExample}.toml`) &&
    ["network/fractures.vtp", "network/dfn_mesh.vtu", "flow/pressure.vtu", "transport/trajectories.vtp"].every((entry) =>
      entries.includes(entry),
    );
  check(hasAllParts, "download all", `${entries.length} files: ${entries.slice(0, 6).join(", ")}…`);

  // Flow without a mesh and transport without a flow: a new example has no output
  await page.click('[data-sidebar-tab="network"]');
  await selectExample(page, "box_west_east");
  const noMeshStatus = await runStep(page, "flow");
  check(await isStatusError(page), "flow without a mesh", noMeshStatus);
  const noFlowStatus = await runStep(page, "transport");
  check(await isStatusError(page), "transport without a flow", noFlowStatus);

  // The domain mesh dropdown: a predefined mesh replaces the mesh of the example
  await page.click('[data-sidebar-tab="network"]');
  await page.select(".file-row select", "L-shape.vtu");
  // The workflow gets the name when the mesh is loaded
  await page.waitForFunction(() => document.querySelector("#toml-preview").textContent.includes('domain = "L-shape.vtu"'));
  const meshLabel = await page.$eval(".file-row select", (node) => node.selectedOptions[0].textContent);
  check(meshLabel === "L-shape", "choose a predefined mesh", meshLabel);

  // A user-defined fracture: the center is limited to the box of its region (the cube of 10 m)
  await selectExample(page, "box_west_east");
  await page.evaluate(() =>
    [...document.querySelectorAll("#form button")].find((node) => node.textContent === "Add fracture").click(),
  );
  await page.waitForFunction(() => document.querySelector("#toml-preview").textContent.includes("[[network.user_fracture]]"));
  const center = await page.evaluate(() => {
    const input = [...document.querySelectorAll("#form .field")]
      .find((field) => field.querySelector(".field-label")?.textContent === "Center x (m)")
      .querySelector("input");
    const limits = `${input.value} in ${input.min} to ${input.max}`;
    input.value = "20";
    input.dispatchEvent(new Event("input"));
    return { limits, isOutsideInvalid: input.classList.contains("is-invalid") };
  });
  check(center.limits === "5 in 0 to 10" && center.isOutsideInvalid, "user fracture center in its region", center.limits);
  // The 3D view shows the polygon at once: a larger radius for the screenshot
  await page.evaluate(() => {
    const input = [...document.querySelectorAll("#form .field")]
      .find((field) => field.querySelector(".field-label")?.textContent === "Radius (m)")
      .querySelector("input");
    input.value = "4";
    input.dispatchEvent(new Event("input"));
    [...document.querySelectorAll("#form h3")].find((node) => node.textContent === "User-defined fractures").scrollIntoView();
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await page.screenshot({ path: `${screenshotDir}/e2e_user_fracture.png` });

  // Bad input: the family regions of the L-shape example are not in the Box mesh: an error of the library
  await selectExample(page, "l_shape_north_east");
  await page.select(".file-row select", "Box.vtu");
  await page.waitForFunction(() => document.querySelector("#toml-preview").textContent.includes('domain = "Box.vtu"'));
  await page.click("#check-button");
  await waitIdle(page);
  check(await isStatusError(page), "check of a bad input", await statusText(page));

  // Cancel: a large run, cancelled at once
  await selectExample(page, "box_west_east");
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
  check(cancelStatus === "Cancelled.", "cancel", cancelStatus);

  // The new worker runs the next input
  await selectExample(page, "box_west_east");
  const afterCancel = await runStep(page, "network");
  check(afterCancel.startsWith("Done"), "run after cancel", afterCancel);
  await page.screenshot({ path: `${screenshotDir}/e2e_network.png` });
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
