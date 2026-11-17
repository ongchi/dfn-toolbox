// End-to-end check of the web app in the local Chrome (headless).
// Start the dev server first (npm run dev), then:
//   node scripts/e2e.mjs [url] [screenshot folder]
// It checks the default forms on the first predefined mesh, runs all steps
// (network, mesh, flow, and the transport at a point clicked on a fracture)
// of the default forms on each predefined mesh, the live run (a
// pressure change, a new user-defined fracture, a release point, "Clear
// points", "Reset"), the choice of a predefined mesh, a bad input, the
// fractures in the view during a run, "Pause" during the mesh, and "Pause"
// with the fractures kept and a new "Run", the run bar (the segments of the
// steps and their settings panels), and the phone layout; it saves
// screenshots.
import { PNG } from "pngjs";
import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? "http://localhost:5173/";
const screenshotDir = process.argv[3] ?? ".";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const RUN_TIMEOUT = 300000;
const TRANSPORT_REPEATS = 5;
// The default roles of the surfaces of the Box shape
const BOX_ROLES = "west: inflow, east: outflow, south: noflow, north: noflow, bottom: noflow, top: noflow";
const FLOAT_BUFFER_EXTENSIONS = ["EXT_color_buffer_float", "EXT_color_buffer_half_float", "EXT_float_blend"];
// Largest minus smallest of red, green and blue (0 to 255)
const COLORED_PIXEL_CONTRAST = 30;
// The highlighted south surface of the Box shape (the face to the camera) fills a part of the view
const MINIMUM_SURFACE_PIXEL_SHARE = 0.05;
// Two pictures of the view are the same with a small noise (the blur of the panels behind them):
// a few pixels which differ by at most this value in each channel (0 to 255)
const MAXIMUM_NOISE = 2;
const MAXIMUM_NOISY_PIXEL_SHARE = 0.0001;
// The end of the status of a run with no release point: the transport runs only with one
const NO_POINT_HINT = "To track particles, click “Pick points” (Transport panel), then click on a fracture.";

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

/** Waits until no step of the live run runs or waits for its delay */
async function waitIdle(page) {
  await page.waitForFunction(() => document.querySelector("#run-button").dataset.state === "idle", { timeout: RUN_TIMEOUT });
}

/** Opens the settings panel of a step (a second click on its segment would close it); `isTap` on a touch screen */
async function openStepPanel(page, name, isTap = false) {
  const selector = `[data-step-panel="${name}"]`;
  if (await page.$eval(selector, (node) => node.getAttribute("aria-expanded") === "true")) {
    return;
  }
  await (isTap ? page.tap(selector) : page.click(selector));
}

/** The state of each segment of the run bar, as "name=state" */
async function segmentStates(page) {
  return page.$$eval("[data-step-panel]", (nodes) => nodes.map((node) => `${node.dataset.stepPanel}=${node.dataset.stepState}`).join(" "));
}

/** Waits until the page has its forms on a predefined mesh and the 3D view */
async function waitForStart(page) {
  await page.waitForFunction(() => document.querySelector("#form").dataset.shape !== undefined, { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector("#viewer-message").hidden, { timeout: 120000 });
}

/** Selects another predefined mesh in the Domain panel (the panel can be hidden); the forms stay */
async function selectShape(page, meshName) {
  await page.$eval("#form", (node) => delete node.dataset.shape);
  await page.select("#domain-form select", meshName);
  await page.waitForFunction((name) => document.querySelector("#form").dataset.shape === name, {}, meshName);
}

/** Opens the page again: the default forms on a predefined mesh, with no result */
async function startOnShape(page, meshName = "Box.vtu") {
  await page.reload();
  await waitForStart(page);
  if ((await page.$eval("#form", (node) => node.dataset.shape)) !== meshName) {
    await selectShape(page, meshName);
  }
}

/** The value of the n_poly field of the DFN panel */
async function nPolyValue(page) {
  return page.evaluate(
    () => [...document.querySelectorAll("#form input[type=number]")].find((node) => node.closest(".field")?.textContent.includes("n_poly")).value,
  );
}

/** Sets the FRAM checkbox of the advanced part of the DFN panel (the default forms have FRAM off) */
async function setFram(page, isOn) {
  await page.evaluate((isFramOn) => {
    const input = [...document.querySelectorAll("#network-advanced-form .field-checkbox")]
      .find((field) => field.querySelector(".field-label")?.textContent === "FRAM on")
      .querySelector("input");
    if (input.checked !== isFramOn) {
      input.click();
    }
  }, isOn);
}

/** Sets the number of fractures (n_poly) of the DFN panel */
async function setFractureCount(page, count) {
  await page.evaluate((value) => {
    const input = [...document.querySelectorAll("input[type=number]")].find((node) =>
      node.closest(".field")?.textContent.includes("n_poly"),
    );
    input.value = String(value);
    input.dispatchEvent(new Event("input"));
  }, count);
}

/** Types a value into the field with a label of a form */
async function setField(page, formSelector, label, value) {
  await page.evaluate(
    (selector, fieldLabel, fieldValue) => {
      const input = [...document.querySelectorAll(`${selector} .field`)]
        .find((field) => field.querySelector(".field-label")?.textContent === fieldLabel)
        .querySelector("input, select");
      input.value = String(fieldValue);
      input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input"));
    },
    formSelector,
    label,
    value,
  );
}

/** The values of the options of "Color by" */
async function colorOptions(page) {
  return page.$$eval("#color-select option", (options) => options.map((option) => option.value));
}

/** The roles of the boundary surfaces in the Domain panel, as "name: role" */
async function domainRoles(page) {
  return page.$$eval("#boundary-surfaces select[data-surface]", (nodes) =>
    nodes.map((node) => `${node.dataset.surface}: ${node.value}`).join(", "),
  );
}

/** The in-flow and then the out-flow surfaces of the Domain panel: the pressure boundaries of the flow */
async function flowSurfaceNames(page) {
  const roles = await page.$$eval("#boundary-surfaces select[data-surface]", (nodes) =>
    nodes.map((node) => [node.dataset.surface, node.value]),
  );
  return ["inflow", "outflow"]
    .flatMap((role) => roles.filter(([, value]) => value === role).map(([name]) => name))
    .join(", ");
}

/** Sets the role of a boundary surface in the Domain panel */
async function setRole(page, surface, role) {
  await openStepPanel(page, "domain");
  await page.select(`#boundary-surfaces select[data-surface="${surface}"]`, role);
}

/** The boundary names of a section of a form (the label up to ":") */
async function boundaryLabels(page, formSelector, sectionTitle) {
  return page.$eval(
    formSelector,
    (form, title) => {
      const section = [...form.querySelectorAll(".form-section")].find((node) => node.querySelector("h3")?.textContent === title);
      const labels = [...(section?.querySelectorAll(".field-label") ?? [])];
      return labels.map((node) => node.textContent.split(":")[0]).join(", ");
    },
    sectionTitle,
  );
}

/** The number of geometries of the view on the graphics card */
async function viewGeometryCount(page) {
  return page.$eval("#viewer-canvas", (node) => Number(node.dataset.geometryCount));
}

/** "Run" until the steps end, then "Pause": a later change of a form runs no step; returns the status text */
async function runAll(page) {
  await page.click("#run-button");
  await waitIdle(page);
  await page.click("#run-button");
  return statusText(page);
}

/** The texts of the status during `action` and the steps which it starts (with the live run on) */
async function statusesDuring(page, action) {
  await page.evaluate(() => {
    window.e2eStatuses = [];
    window.e2eStatusObserver = new MutationObserver(() => {
      const text = document.querySelector("#status").textContent;
      if (window.e2eStatuses.at(-1) !== text) {
        window.e2eStatuses.push(text);
      }
    });
    window.e2eStatusObserver.observe(document.querySelector("#status"), { childList: true, characterData: true, subtree: true });
  });
  await action();
  // The steps start after the delay of the last change
  await page.waitForFunction(() => document.querySelector("#run-button").dataset.state !== "idle", { timeout: 5000 });
  await waitIdle(page);
  return page.evaluate(() => {
    window.e2eStatusObserver.disconnect();
    return window.e2eStatuses;
  });
}

/**
 * The frames of the 3D view during `statusesDuring(page, action)`: for each render, the part of colored pixels
 * (as `coloredPixelShare`, on a small copy) and the "Color by" value. The copy is made in the task of the render,
 * thus the drawing buffer still has the frame.
 */
async function framesDuring(page, action) {
  await page.evaluate((minimumContrast) => {
    const canvas = document.querySelector("#viewer-canvas");
    const copy = new OffscreenCanvas(Math.ceil(canvas.width / 10), Math.ceil(canvas.height / 10)).getContext("2d", {
      willReadFrequently: true,
    });
    window.e2eFrames = [];
    window.e2eFrameObserver = new MutationObserver(() => {
      copy.drawImage(canvas, 0, 0, copy.canvas.width, copy.canvas.height);
      const { data } = copy.getImageData(0, 0, copy.canvas.width, copy.canvas.height);
      let coloredCount = 0;
      for (let start = 0; start < data.length; start += 4) {
        const channels = [data[start], data[start + 1], data[start + 2]];
        if (Math.max(...channels) - Math.min(...channels) > minimumContrast) {
          coloredCount++;
        }
      }
      window.e2eFrames.push({ share: coloredCount / (data.length / 4), color: document.querySelector("#color-select").value });
    });
    window.e2eFrameObserver.observe(canvas, { attributes: true, attributeFilter: ["data-geometry-count"] });
  }, COLORED_PIXEL_CONTRAST);
  const statuses = await statusesDuring(page, action);
  const frames = await page.evaluate(() => {
    window.e2eFrameObserver.disconnect();
    return window.e2eFrames;
  });
  return { statuses, frames };
}

/**
 * With the live run on and the Transport panel open: "Pick points", then clicks on the points of a grid around the
 * middle of the free part of the view until one adds a release point (a click on the boundary surfaces only adds
 * none), then "Stop picking". Returns the statuses of the transport which the point starts.
 */
async function pickReleasePoint(page) {
  await page.click("#pick-points");
  const pointCount = () => page.$$eval("#release-points li", (nodes) => nodes.length);
  const countBefore = await pointCount();
  const statuses = await statusesDuring(page, async () => {
    const { first, last, top, bottom } = await page.evaluate(() => ({
      first: Math.ceil(document.querySelector("#step-panel").getBoundingClientRect().right),
      last: Math.floor(document.querySelector(".layer-rail").getBoundingClientRect().left),
      top: window.innerHeight / 3,
      bottom: (2 * window.innerHeight) / 3,
    }));
    const middle = { x: (first + last) / 2, y: (top + bottom) / 2 };
    for (let ring = 0; ring < 10 && (await pointCount()) === countBefore; ring++) {
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        await page.mouse.click(middle.x + 20 * ring * dx, middle.y + 20 * ring * dy);
        if ((await pointCount()) > countBefore) {
          break;
        }
      }
    }
  });
  await page.mouse.move(0, 0);
  await page.click("#pick-points");
  return statuses;
}

/** A value of the Log view */
async function resultValue(page, term) {
  return page.$eval(
    "#log-view",
    (node, name) => [...node.querySelectorAll("dt")].find((item) => item.textContent === name)?.nextElementSibling?.textContent,
    term,
  );
}

/** The controls of the shown view which are too small for a finger, and the width of the page */
async function touchProblems(page) {
  return page.evaluate(() => {
    const isShown = (node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility === "visible";
    };
    const controls = document.querySelectorAll(
      "button, select, input:not([type=checkbox], [type=radio]), label:has(> input[type=checkbox], > input[type=radio])",
    );
    const small = [...controls]
      .filter((node) => isShown(node) && node.getBoundingClientRect().height < 44)
      .map((node) => `${node.id || node.textContent.trim().slice(0, 20)} ${node.getBoundingClientRect().height}`);
    const smallText = [...document.querySelectorAll("select, input[type=number], input[type=text]")]
      .filter((node) => isShown(node) && Number.parseFloat(getComputedStyle(node).fontSize) < 16)
      .map((node) => node.id || node.name);
    const isPageWide = document.documentElement.scrollWidth > window.innerWidth;
    return [...small, ...smallText.map((name) => `text ${name}`), ...(isPageWide ? ["page wider than the screen"] : [])];
  });
}

/** The phone layout: the views, the bottom bar, the gestures and the touch sizes */
async function checkPhone() {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.goto(url);
  await waitForStart(page);

  // The 3D view fills the screen; the settings of a step are a bottom sheet with two heights, which a tap on its
  // handle changes; at the start the sheet is closed
  const sheetState = () =>
    page.evaluate(() => {
      const layout = document.querySelector("#layout");
      const isPanelShown = !document.querySelector("#step-panel").hidden;
      return `${isPanelShown ? layout.dataset.sheet : "closed"}`;
    });
  const canvasSize = () => page.$eval("#viewer-canvas", (node) => `${node.clientWidth} x ${node.clientHeight}`);
  const sizeAtStart = await canvasSize();
  const sheetStates = [await sheetState()];
  await openStepPanel(page, "domain", true);
  sheetStates.push(await sheetState());
  await page.tap("#sheet-size");
  sheetStates.push(await sheetState());
  await page.tap("#sheet-size");
  sheetStates.push(await sheetState());
  await page.tap("#panel-close");
  sheetStates.push(await sheetState());
  await openStepPanel(page, "domain", true);
  sheetStates.push(await sheetState());
  check(sheetStates.join(", ") === "closed, half, full, half, closed, half", "phone: the heights of the sheet", sheetStates.join(", "));
  check(
    (await canvasSize()) === sizeAtStart && sizeAtStart === "390 x 844",
    "phone: the canvas fills the screen and keeps its size",
    `${sizeAtStart} → ${await canvasSize()}`,
  );

  // The part of the view above the sheet
  const freeViewShot = async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const top = await page.$eval("#dock", (node) => node.getBoundingClientRect().top);
    return Buffer.from(await page.screenshot({ clip: { x: 0, y: 0, width: 390, height: top } }));
  };

  // The highlight of a surface stays after a tap in the form, until a second tap
  const viewBeforeTap = await freeViewShot();
  await page.tap("#boundary-surfaces .file-row-header .field-label");
  const viewAfterTap = await freeViewShot();
  await page.tap("#boundary-surfaces .file-row-header .field-label");
  const viewAfterSecondTap = await freeViewShot();
  check(
    !isSameView(viewAfterTap, viewBeforeTap) && isSameView(viewAfterSecondTap, viewBeforeTap),
    "phone: a tap highlights the surface, a second tap removes it",
    `tap ${isSameView(viewAfterTap, viewBeforeTap) ? "unchanged" : "changed"}, second tap ${isSameView(viewAfterSecondTap, viewBeforeTap) ? "same" : "different"}`,
  );

  for (const step of ["domain", "fractures", "network", "flow", "transport"]) {
    await openStepPanel(page, step, true);
    const problems = await touchProblems(page);
    check(problems.length === 0, `phone: touch sizes of the ${step} panel`, problems.join(", ") || "none");
    await page.screenshot({ path: `${screenshotDir}/e2e_phone_${step}.png` });
  }

  // A run lowers the full sheet to half: the view shows the fractures
  await openStepPanel(page, "network", true);
  await page.tap("#sheet-size");
  const sheetBeforeRun = await sheetState();
  await page.tap("#run-button");
  await page.waitForFunction(() => !document.querySelector("#results").hidden, { timeout: RUN_TIMEOUT });
  await waitIdle(page);
  await page.tap("#run-button");
  const sheetAfterRun = await sheetState();
  check(sheetBeforeRun === "full" && sheetAfterRun === "half", "phone: the sheet at a run", `${sheetBeforeRun} → ${sheetAfterRun}`);
  await page.screenshot({ path: `${screenshotDir}/e2e_phone_view.png` });

  // The Log panel opens over the view, above the sheet
  await page.tap("#log-button");
  const logBox = await page.$eval("#log-view", (node) => {
    const { bottom } = node.getBoundingClientRect();
    return { bottom, isShown: !node.hidden, dockTop: document.querySelector("#dock").getBoundingClientRect().top };
  });
  await page.screenshot({ path: `${screenshotDir}/e2e_phone_log.png` });
  await page.tap("#log-button");
  check(
    logBox.isShown && logBox.bottom <= logBox.dockTop && (await page.$eval("#log-view", (node) => node.hidden)),
    "phone: the Log panel",
    JSON.stringify(logBox),
  );

  // The view controls are always on the view; the icons have no label on a touch screen
  const phoneLabels = await page.$$eval(".viewer-toolbar .icon-label", (nodes) =>
    nodes.filter((node) => getComputedStyle(node).display !== "none").length,
  );
  check(phoneLabels === 0, "phone: no labels of the icons", String(phoneLabels));
  const box = await page.$eval("#viewer-canvas", (node) => {
    const { x, y, width, height } = node.getBoundingClientRect();
    return { x, y, width, height };
  });
  const viewShot = async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return Buffer.from(await page.screenshot({ clip: box }));
  };
  const colorOption = await page.$$eval("#color-select option", (nodes) => nodes.at(-1).value);
  const viewBeforeColor = await viewShot();
  await page.select("#color-select", colorOption);
  const viewAfterColor = await viewShot();
  check(!isSameView(viewAfterColor, viewBeforeColor), "phone: a new color changes the view", "changed");
  await page.screenshot({ path: `${screenshotDir}/e2e_phone_color.png` });

  // One finger turns the model, two fingers zoom it
  const client = await page.createCDPSession();
  const touch = (type, touchPoints) => client.send("Input.dispatchTouchEvent", { type, touchPoints });
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 3;
  const viewBeforeDrag = await viewShot();
  await touch("touchStart", [{ x: centerX, y: centerY }]);
  for (let step = 1; step <= 10; step += 1) {
    await touch("touchMove", [{ x: centerX + step * 8, y: centerY + step * 3 }]);
  }
  await touch("touchEnd", []);
  const viewAfterDrag = await viewShot();
  check(!isSameView(viewAfterDrag, viewBeforeDrag), "phone: one finger turns the model", "changed");
  await touch("touchStart", [
    { x: centerX - 30, y: centerY, id: 0 },
    { x: centerX + 30, y: centerY, id: 1 },
  ]);
  for (let step = 1; step <= 10; step += 1) {
    await touch("touchMove", [
      { x: centerX - 30 - step * 6, y: centerY, id: 0 },
      { x: centerX + 30 + step * 6, y: centerY, id: 1 },
    ]);
  }
  await touch("touchEnd", []);
  const viewAfterPinch = await viewShot();
  check(!isSameView(viewAfterPinch, viewAfterDrag), "phone: two fingers zoom", isSameView(viewAfterPinch, viewAfterDrag) ? "unchanged" : "changed");
  await page.screenshot({ path: `${screenshotDir}/e2e_phone_pinch.png` });

  // Landscape: the settings of a step above the run bar at the left of the view, as on a computer
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, isLandscape: true, deviceScaleFactor: 2 });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const landscape = await page.evaluate(() => {
    const panel = document.querySelector("#step-panel").getBoundingClientRect();
    const runBar = document.querySelector("#run-panel").getBoundingClientRect();
    const rail = document.querySelector(".layer-rail").getBoundingClientRect();
    const canvas = document.querySelector("#viewer-canvas");
    return {
      panelWidth: panel.width,
      isPanelAboveRunBar: panel.top >= 0 && panel.bottom <= runBar.top,
      isRailRightOfPanel: rail.left > panel.right,
      isRailInScreen: rail.bottom <= window.innerHeight,
      canvasSize: `${canvas.clientWidth} x ${canvas.clientHeight}`,
    };
  });
  check(
    landscape.panelWidth === 340 &&
      landscape.isPanelAboveRunBar &&
      landscape.isRailRightOfPanel &&
      landscape.isRailInScreen &&
      landscape.canvasSize === "844 x 390",
    "phone: landscape",
    JSON.stringify(landscape),
  );
  await page.screenshot({ path: `${screenshotDir}/e2e_phone_landscape.png` });
  await page.close();
}

/** The two PNG pictures differ only by noise: few pixels, each by at most MAXIMUM_NOISE in each channel */
function isSameView(firstImage, secondImage) {
  if (firstImage.equals(secondImage)) {
    return true;
  }
  const first = PNG.sync.read(firstImage);
  const second = PNG.sync.read(secondImage);
  if (first.width !== second.width || first.height !== second.height) {
    return false;
  }
  let noisyPixelCount = 0;
  for (let start = 0; start < first.data.length; start += 4) {
    let difference = 0;
    for (let channel = start; channel < start + 4; channel++) {
      difference = Math.max(difference, Math.abs(first.data[channel] - second.data[channel]));
    }
    if (difference > MAXIMUM_NOISE) {
      return false;
    }
    if (difference > 0) {
      noisyPixelCount++;
    }
  }
  return noisyPixelCount <= MAXIMUM_NOISY_PIXEL_SHARE * first.width * first.height;
}

/** The part of the pixels of a PNG image with a color (not white, gray or black) */
async function coloredPixelShare(page, pngImage) {
  return page.evaluate(async (base64Image, minimumContrast) => {
    const response = await fetch(`data:image/png;base64,${base64Image}`);
    const bitmap = await createImageBitmap(await response.blob());
    const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    let coloredCount = 0;
    for (let start = 0; start < data.length; start += 4) {
      const channels = [data[start], data[start + 1], data[start + 2]];
      if (Math.max(...channels) - Math.min(...channels) > minimumContrast) {
        coloredCount++;
      }
    }
    return coloredCount / (bitmap.width * bitmap.height);
  }, Buffer.from(pngImage).toString("base64"), COLORED_PIXEL_CONTRAST);
}

/** A device without float color buffers in WebGL (iOS) shows the translucent boundary surfaces: the highlighted one has a color */
async function checkTranslucentShapesWithoutFloatBuffers() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.evaluateOnNewDocument((hiddenExtensions) => {
    const prototype = WebGL2RenderingContext.prototype;
    const { getExtension, getSupportedExtensions } = prototype;
    prototype.getExtension = function (name) {
      return hiddenExtensions.includes(name) ? null : getExtension.call(this, name);
    };
    prototype.getSupportedExtensions = function () {
      return getSupportedExtensions.call(this).filter((name) => !hiddenExtensions.includes(name));
    };
  }, FLOAT_BUFFER_EXTENSIONS);
  await page.goto(url);
  await waitForStart(page);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await openStepPanel(page, "domain");
  await (await page.evaluateHandle(() => document.querySelector('#boundary-surfaces select[data-surface="south"]').closest("label"))).hover();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const canvas = await page.$("#viewer-canvas");
  const share = await coloredPixelShare(page, await canvas.screenshot());
  check(share > MINIMUM_SURFACE_PIXEL_SHARE, "translucent shapes without float color buffers", share.toFixed(3));
  await page.close();
}

try {
  await checkTranslucentShapesWithoutFloatBuffers();

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  // The moving particles stay off: they change each screenshot
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  page.on("pageerror", (error) => failures.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      console.log(`[console.error] ${message.text()}`);
    }
  });

  await page.goto(url);
  await waitForStart(page);

  // The page opens the default forms on the first predefined mesh; the Domain panel has only the mesh dropdown
  const start = await page.evaluate(() => ({
    shape: document.querySelector("#form").dataset.shape,
    meshLabel: document.querySelector("#domain-form select").selectedOptions[0].textContent,
    families: document.querySelectorAll("#form .family-card").length,
    selects: document.querySelectorAll('[data-step-group="domain"] select:not([data-surface])').length,
  }));
  const startNPoly = await nPolyValue(page);
  check(
    start.shape === "Box.vtu" && start.meshLabel === "Box" && start.families === 1 && startNPoly === "100" && start.selects === 1,
    "default forms on the first shape",
    `${start.shape} (${start.meshLabel}), ${start.families} family, n_poly ${startNPoly}, ${start.selects} domain dropdowns`,
  );
  // The settings of the steps are hidden at the start; a click on a segment of the run bar opens the panel of its
  // step, and a second click, the close button or Escape closes it
  const isStepPanelShown = () => page.$eval("#step-panel", (node) => !node.hidden);
  const openSegments = () =>
    page.$$eval("[data-step-panel]", (nodes) => nodes.filter((node) => node.getAttribute("aria-expanded") === "true").map((node) => node.dataset.stepPanel).join(", "));
  const panelStates = [`${await isStepPanelShown()} (${await openSegments()})`];
  await page.click('[data-step-panel="flow"]');
  panelStates.push(`${await isStepPanelShown()} (${await openSegments()}: ${await page.$eval("#step-panel-title", (node) => node.textContent)})`);
  await page.click('[data-step-panel="flow"]');
  panelStates.push(`${await isStepPanelShown()} (${await openSegments()})`);
  await page.click('[data-step-panel="flow"]');
  await page.click("#panel-close");
  panelStates.push(`${await isStepPanelShown()} (${await openSegments()})`);
  await page.click('[data-step-panel="flow"]');
  await page.keyboard.press("Escape");
  panelStates.push(`${await isStepPanelShown()} (${await openSegments()})`);
  check(
    panelStates.join(" | ") === "false () | true (flow: Flow) | false () | false () | false ()",
    "step panels: hidden at the start, a segment opens one",
    panelStates.join(" | "),
  );
  await page.screenshot({ path: `${screenshotDir}/e2e_start.png` });
  const statesBeforeRun = await segmentStates(page);
  check(
    statesBeforeRun === "domain=done fractures=stale network=stale flow=stale transport=stale",
    "segment states before a run",
    statesBeforeRun,
  );
  await openStepPanel(page, "domain");
  await page.screenshot({ path: `${screenshotDir}/e2e_domain.png` });

  // The link to the repository is the last item of the view controls: below the layer rail, as wide as it
  const repositoryLink = await page.$eval(".repository-link", (node) => {
    const link = node.getBoundingClientRect();
    const rail = document.querySelector(".layer-rail").getBoundingClientRect();
    return {
      href: node.href,
      isLastInToolbar: node.parentElement.id === "viewer-toolbar" && node.parentElement.lastElementChild === node,
      isBelowRail: link.top >= rail.bottom && link.right === rail.right && link.width === rail.width,
    };
  });
  check(
    repositoryLink.href === "https://github.com/ongchi/dfn-toolbox" && repositoryLink.isLastInToolbar && repositoryLink.isBelowRail,
    "repository link",
    JSON.stringify(repositoryLink),
  );

  // The Log panel is closed at the start; with no run, it tells that it has no results
  const isLogShown = () => page.$eval("#log-view", (node) => !node.hidden);
  const isLogShownAtStart = await isLogShown();
  await page.click("#log-button");
  const startLogText = await page.$eval("#log-view", (node) => node.innerText.trim());
  await page.click("#log-button");
  const isLogShownAfterReturn = await isLogShown();
  check(
    !isLogShownAtStart && startLogText === "No results yet." && !isLogShownAfterReturn,
    "log view without results",
    `${isLogShownAtStart} → "${startLogText}" → ${isLogShownAfterReturn}`,
  );

  // A row for each boundary surface of the domain mesh, with no color chooser
  const surfaceNames = await page.$$eval("#boundary-surfaces:not([hidden]) .field-label", (nodes) =>
    nodes.map((node) => node.textContent).join(", "),
  );
  const colorInputCount = await page.$$eval("input[type=color]", (nodes) => nodes.length);
  check(
    surfaceNames === "west, east, south, north, bottom, top" && colorInputCount === 0,
    "boundary surface rows",
    `${surfaceNames}; ${colorInputCount} color choosers`,
  );
  await page.screenshot({ path: `${screenshotDir}/e2e_boundary_surfaces.png` });

  // The default roles of the boundary surfaces: the first surface is in-flow, the second out-flow
  const startRoles = await domainRoles(page);
  check(startRoles === BOX_ROLES, "default roles of a shape", startRoles);

  // The pointer over the row of a surface highlights it; the view is the same again after it leaves.
  // The screenshots have the part of the view at the right of the settings of a step (if shown) and above the run bar.
  const viewerScreenshot = async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const clip = await page.$eval("#step-panel", (node) => {
      const left = node.hidden ? 0 : Math.ceil(node.getBoundingClientRect().right);
      const bottom = Math.floor(document.querySelector("#run-panel").getBoundingClientRect().top);
      return { x: left, y: 0, width: window.innerWidth - left, height: bottom };
    });
    return Buffer.from(await page.screenshot({ clip }));
  };
  // The panels blur the view behind them: after the clicks on the Log button, wait until it does not change
  const stableViewerScreenshot = async () => {
    let previous = await viewerScreenshot();
    for (let attempt = 0; attempt < 10; attempt++) {
      const next = await viewerScreenshot();
      if (isSameView(next, previous)) {
        return next;
      }
      previous = next;
    }
    return previous;
  };
  await page.mouse.move(0, 0);
  const viewBeforeHover = await stableViewerScreenshot();
  const surfaceRow = await page.evaluateHandle(() =>
    document.querySelector('#boundary-surfaces select[data-surface="south"]').closest("label"),
  );
  await surfaceRow.hover();
  const viewOnHover = await viewerScreenshot();
  await page.screenshot({ path: `${screenshotDir}/e2e_boundary_surface_hover.png` });
  await page.mouse.move(0, 0);
  const viewAfterHover = await viewerScreenshot();
  check(
    !isSameView(viewOnHover, viewBeforeHover) && isSameView(viewAfterHover, viewBeforeHover),
    "boundary surface highlight on hover",
    `hover ${isSameView(viewOnHover, viewBeforeHover) ? "unchanged" : "changed"}, after ${isSameView(viewAfterHover, viewBeforeHover) ? "same" : "different"}`,
  );

  // A click on a row keeps its surface highlighted: the pointer over another row shows that surface, then
  // the kept one again; a second click removes it. A click in the dropdown does not change it.
  const pinnedTargets = () => page.$$eval(".is-pinned", (nodes) => nodes.map((node) => node.dataset.highlightSurface).join(", "));
  await page.click('[data-highlight-surface="south"] .field-label');
  await page.mouse.move(0, 0);
  const viewPinned = await viewerScreenshot();
  const pinnedAfterClick = await pinnedTargets();
  await page.screenshot({ path: `${screenshotDir}/e2e_boundary_surface_pinned.png` });
  await page.hover('[data-highlight-surface="north"] .field-label');
  const viewOtherHover = await viewerScreenshot();
  await page.mouse.move(0, 0);
  const viewAfterOtherHover = await viewerScreenshot();
  await page.click('[data-highlight-surface="north"] select');
  await page.keyboard.press("Escape");
  await page.mouse.move(0, 0);
  const pinnedAfterSelect = await pinnedTargets();
  await page.click('[data-highlight-surface="south"] .field-label');
  await page.mouse.move(0, 0);
  const viewUnpinned = await viewerScreenshot();
  const pinnedAfterSecondClick = await pinnedTargets();
  check(
    isSameView(viewPinned, viewOnHover) &&
      pinnedAfterClick === "south" &&
      !isSameView(viewOtherHover, viewPinned) &&
      isSameView(viewAfterOtherHover, viewPinned) &&
      pinnedAfterSelect === "south" &&
      isSameView(viewUnpinned, viewBeforeHover) &&
      pinnedAfterSecondClick === "",
    "a click keeps the surface highlighted",
    `kept ${isSameView(viewPinned, viewOnHover) ? "same as hover" : "different"} (${pinnedAfterClick}), other hover ${isSameView(viewOtherHover, viewPinned) ? "unchanged" : "changed"}, back ${isSameView(viewAfterOtherHover, viewPinned) ? "kept" : "different"}, dropdown "${pinnedAfterSelect}", second click ${isSameView(viewUnpinned, viewBeforeHover) ? "removed" : "different"} (${pinnedAfterSecondClick})`,
  );

  // FRAM, clusters and mesh are in the closed advanced part of the DFN panel, the fluid in the Flow panel and the
  // routing in the Transport panel; the settings dialog has the orientation and the fracture shape. The forms
  // have no number of points.
  const sectionTitles = (selector) =>
    page.$$eval(`${selector} .form-section > h3`, (nodes) => nodes.map((node) => node.textContent).join(", "));
  const networkSections = await sectionTitles("#form");
  const advancedSections = await sectionTitles("#network-advanced-form");
  const isAdvancedOpen = await page.$eval(".advanced-settings", (node) => node.open);
  const settingsSections = await sectionTitles("#settings-dialog");
  const stepSettings = `${await sectionTitles("#flow-settings-form")}; ${await sectionTitles("#transport-settings-form")}`;
  const pointFields = await page.$$eval(".field-label", (nodes) =>
    nodes.filter((node) => node.textContent === "Number of points").map((node) => node.closest("#settings-dialog, #form, #fractures-form")?.id),
  );
  check(
    networkSections === "General, Generation, Fracture families" &&
      advancedSections === "FRAM, Clusters, Triangle mesh for the flow" &&
      !isAdvancedOpen &&
      settingsSections === "Orientation of the fractures, Fracture shape" &&
      stepSettings === "Fluid; Intersections" &&
      pointFields.join(", ") === "settings-dialog",
    "the places of the settings sections",
    `DFN panel: ${networkSections}; advanced (open ${isAdvancedOpen}): ${advancedSections}; settings: ${settingsSections}; flow and transport: ${stepSettings}; number of points in ${pointFields.join(", ")}`,
  );
  // The run bar has one "Run" button, one "Reset" button and the Log button, with each panel
  const runButtons = [];
  for (const step of ["domain", "fractures", "network", "flow", "transport"]) {
    await openStepPanel(page, step);
    runButtons.push(
      await page.$$eval(".player > button", (nodes) => nodes.map((node) => node.getAttribute("aria-label")).join(" ")),
    );
  }
  check(
    runButtons.every((buttons) => buttons === "Run Reset Log"),
    "run buttons with each panel",
    runButtons.join(" | "),
  );

  // The full workflow of the default forms on each predefined mesh
  const meshNames = await page.$$eval("#domain-form select option", (options) =>
    options.map((option) => option.value).filter((value) => value !== ""),
  );
  for (const meshName of meshNames) {
    const name = meshName.replace(/\.vtu$/, "");
    await startOnShape(page, meshName);
    await openStepPanel(page, "network");
    // "Run" runs the network, its mesh and the flow; the default forms have no release point, thus no transport
    // The results of the Log view show only with a result
    const hasResults = () => page.$eval("#results", (node) => !node.hidden);
    const hasResultsBefore = await hasResults();
    const runStatus = await runAll(page);
    const shownResults = await page.evaluate(() =>
      ["#results", "#flow-results", "#transport-results"].filter((selector) => !document.querySelector(selector).hidden).length,
    );
    check(
      /^Done in .*Newton iterations\.\n/.test(runStatus) && runStatus.endsWith(NO_POINT_HINT) && !(await isStatusError(page)) && shownResults === 2,
      `${name}: run of all steps`,
      `${runStatus}; ${shownResults} result sections`,
    );
    const hasResultsAfter = await hasResults();
    check(!hasResultsBefore && hasResultsAfter, `${name}: results in the log view`, `${hasResultsBefore} → ${hasResultsAfter}`);
    const statesAfterRun = await segmentStates(page);
    check(
      statesAfterRun === "domain=done fractures=done network=done flow=done transport=done",
      `${name}: segment states after the run`,
      statesAfterRun,
    );

    await openStepPanel(page, "flow");
    // The boundaries of the flow are the in-flow and out-flow surfaces; the flow form has no other section (the
    // fluid follows it)
    const shapeSurfaces = await flowSurfaceNames(page);
    const flowBoundaries = await boundaryLabels(page, "#flow-form", "Pressure boundaries");
    const flowSections = await sectionTitles("#flow-form");
    check(
      shapeSurfaces !== "" && flowBoundaries === shapeSurfaces && flowSections === "Pressure boundaries",
      `${name}: flow boundaries`,
      `${flowBoundaries}; sections: ${flowSections}`,
    );
    // The pointer over a pressure field highlights its surface
    await page.mouse.move(0, 0);
    const flowViewBefore = await stableViewerScreenshot();
    const pressureField = await page.evaluateHandle(() =>
      [...document.querySelectorAll("#flow-form .form-section")]
        .find((node) => node.querySelector("h3")?.textContent === "Pressure boundaries")
        .querySelector(".field"),
    );
    await pressureField.hover();
    const flowViewOnHover = await viewerScreenshot();
    if (name === "Box") {
      await page.screenshot({ path: `${screenshotDir}/e2e_pressure_boundary_hover.png` });
    }
    await page.mouse.move(0, 0);
    const flowViewAfter = await stableViewerScreenshot();
    check(
      !isSameView(flowViewOnHover, flowViewBefore) && isSameView(flowViewAfter, flowViewBefore),
      `${name}: pressure boundary highlight on hover`,
      `hover ${isSameView(flowViewOnHover, flowViewBefore) ? "unchanged" : "changed"}, after ${isSameView(flowViewAfter, flowViewBefore) ? "same" : "different"}`,
    );
    // A click on the label of a pressure field keeps its surface highlighted, also on the Domain panel (one for the page)
    if (name === "Box") {
      // The pinned rows of one panel (the hidden panels also have their rows)
      const pinnedTargets = (container) =>
        page.$$eval(`${container} .is-pinned`, (nodes) => nodes.map((node) => node.dataset.highlightSurface).join(", "));
      await page.click('#flow-form [data-highlight-surface="west"] .field-label');
      const isInputFocused = await page.$eval('#flow-form [data-highlight-surface="west"] input', (node) => node === document.activeElement);
      await page.mouse.move(0, 0);
      const flowViewPinned = await viewerScreenshot();
      const pinnedOnFlow = await pinnedTargets("#flow-form");
      await openStepPanel(page, "domain");
      const pinnedOnDomain = await pinnedTargets("#boundary-surfaces");
      await openStepPanel(page, "flow");
      await page.click('#flow-form [data-highlight-surface="west"] .field-label');
      await page.mouse.move(0, 0);
      const flowViewUnpinned = await stableViewerScreenshot();
      check(
        !isSameView(flowViewPinned, flowViewBefore) &&
          !isInputFocused &&
          pinnedOnFlow === "west" &&
          pinnedOnDomain === "west" &&
          isSameView(flowViewUnpinned, flowViewBefore) &&
          (await pinnedTargets("#layout")) === "",
        `${name}: a click on a pressure field keeps its surface highlighted`,
        `${isSameView(flowViewPinned, flowViewBefore) ? "unchanged" : "kept"}, input focus ${isInputFocused}, flow "${pinnedOnFlow}", domain "${pinnedOnDomain}", second click ${isSameView(flowViewUnpinned, flowViewBefore) ? "removed" : "different"}`,
      );
    }
    // The moving particles change the view between two frames
    await page.click("#show-particles");
    const particleFrame = await viewerScreenshot();
    await new Promise((resolve) => setTimeout(resolve, 300));
    check(!isSameView(particleFrame, await viewerScreenshot()), `${name}: moving particles`, "view changed");
    if (name === "L-shape") {
      await page.screenshot({ path: `${screenshotDir}/e2e_particles.png` });
    }
    await page.click("#show-particles");
    const colorAfterRun = await page.$eval("#color-select", (node) => node.value);
    check(colorAfterRun === "point:pressure", `${name}: pressure colors after the flow`, colorAfterRun);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.screenshot({ path: `${screenshotDir}/e2e_${name}_flow.png` });
    const hasFlowVelocity = (await colorOptions(page)).includes("cell:flow_velocity");
    check(hasFlowVelocity, `${name}: flow velocity in Color by`, String(hasFlowVelocity));
    await page.select("#color-select", "cell:flow_velocity");
    // The log scale changes the colors and the labels of the scalar bar;
    await page.mouse.move(0, 0);
    const scalarBarLabels = () => page.$eval(".scalar-bar-labels", (node) => node.textContent);
    const linearLabels = await scalarBarLabels();
    const linearView = await viewerScreenshot();
    await page.click("#log-scale");
    const logLabels = await scalarBarLabels();
    const logView = await viewerScreenshot();
    check(logLabels !== linearLabels && !isSameView(logView, linearView), `${name}: log scale`, `${linearLabels} → ${logLabels}`);
    if (name === "L-shape") {
      await page.screenshot({ path: `${screenshotDir}/e2e_log_scale.png` });
    }
    await page.select("#color-select", "");
    check(await page.$eval("#log-scale", (node) => node.disabled), `${name}: no log scale with one color`, "disabled");
    await page.select("#color-select", "cell:flow_velocity");
    await page.click("#log-scale");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.screenshot({ path: `${screenshotDir}/e2e_${name}_flow_velocity.png` });

    // A click on a fracture runs the transport; the trajectories and the velocities of the transport are always on
    await openStepPanel(page, "transport");
    await page.click("#run-button");
    await waitIdle(page);
    const transportStatuses = await pickReleasePoint(page);
    await page.click("#run-button");
    check(
      /^Done in .*of 1 particles/.test(transportStatuses.at(-1)) && !(await page.$eval("#transport-results", (node) => node.hidden)),
      `${name}: transport at a clicked point`,
      transportStatuses.join(" | "),
    );
    // The Domain panel gives the in-flow and out-flow boundaries: the Transport panel has no section for them, and
    // the routing follows the transport form
    const hasTransportBoundaries = await page.$$eval("#transport-form .form-section h3", (nodes) =>
      nodes.some((node) => node.textContent === "Boundaries"),
    );
    const hasTransportRouting = await page.$$eval("#transport-form .field-label", (nodes) =>
      nodes.some((node) => node.textContent === "Routing"),
    );
    check(
      !hasTransportBoundaries && !hasTransportRouting,
      `${name}: no transport boundaries, and the routing after the transport form`,
      `boundaries ${hasTransportBoundaries}, routing ${hasTransportRouting}`,
    );
    // The path of each particle shows, also of a particle which does not exit
    const areTrajectoriesShown = await page.$eval("#show-trajectories", (node) => node.checked && !node.disabled);
    check(areTrajectoriesShown, `${name}: trajectories shown`, transportStatuses.at(-1));
    const hasTransportVelocity = (await colorOptions(page)).includes("point:transport_velocity");
    check(hasTransportVelocity, `${name}: transport velocity in Color by`, String(hasTransportVelocity));
    await page.select("#color-select", "point:transport_velocity");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.screenshot({ path: `${screenshotDir}/e2e_${name}_transport_velocity.png` });
    // The trajectories in the fractures: colored by fracture, not by the pressure
    await page.select("#color-select", "cell:fracture_id");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.screenshot({ path: `${screenshotDir}/e2e_${name}_transport.png` });
  }

  // More runs of the transport free the shapes of the old views: with the live run on, each new seed runs it again
  await page.click("#run-button");
  await waitIdle(page);
  const geometriesBefore = await viewGeometryCount(page);
  for (let run = 0; run < TRANSPORT_REPEATS; run += 1) {
    await statusesDuring(page, () => setField(page, "#transport-form", "Seed", 100 + run));
  }
  await page.click("#run-button");
  const geometriesAfter = await viewGeometryCount(page);
  check(geometriesBefore > 0 && geometriesAfter === geometriesBefore, "view memory of repeated transports", `${geometriesBefore} → ${geometriesAfter} geometries`);

  // The Log panel has the three sections and does not change the 3D view
  await page.mouse.move(0, 0);
  const viewBeforeLog = await stableViewerScreenshot();
  const canvasSize = () => page.$eval("#viewer-canvas", (node) => `${node.clientWidth} x ${node.clientHeight}`);
  const canvasSizeBeforeLog = await canvasSize();
  await page.click("#log-button");
  const canvasSizeOnLog = await canvasSize();
  check(canvasSizeOnLog === canvasSizeBeforeLog, "canvas size with the Log panel", `${canvasSizeBeforeLog} → ${canvasSizeOnLog}`);
  const logSections = await page.$$eval(".log-view .results-section:not([hidden]) summary", (nodes) =>
    nodes.map((node) => node.textContent).join(", "),
  );
  const logValueCount = await page.$$eval("#log-view dd", (nodes) => nodes.filter((node) => node.textContent !== "").length);
  const isLogEmptyTextHidden = await page.$eval("#log-empty", (node) => node.hidden);
  check(
    logSections === "Fractures, Flow, Transport" && logValueCount > 0 && isLogEmptyTextHidden,
    "log view with results",
    `${logSections}; ${logValueCount} values`,
  );
  await page.screenshot({ path: `${screenshotDir}/e2e_log.png` });

  // The accordion of each result section: a click on the title of the flow
  // closes only the flow, a second click opens it again
  const openSections = () =>
    page.$$eval(".results-section", (nodes) => nodes.map((node) => (node.open ? node.id : "")).join(" "));
  const sectionStates = [await openSections()];
  await page.click("#flow-results summary");
  sectionStates.push(await openSections());
  await page.click("#flow-results summary");
  sectionStates.push(await openSections());
  check(
    sectionStates.join(" | ") ===
      "results flow-results transport-results | results  transport-results | results flow-results transport-results",
    "results sections accordion",
    sectionStates.join(" | "),
  );

  await page.click("#log-button");
  await page.mouse.move(0, 0);
  const viewAfterLog = await stableViewerScreenshot();
  check(isSameView(viewAfterLog, viewBeforeLog), "3D view after the Log panel", isSameView(viewAfterLog, viewBeforeLog) ? "same" : "different");

  // The live run: a change of a setting runs again the steps which it affects; the results before them stay
  await startOnShape(page);
  await openStepPanel(page, "network");
  await runAll(page);
  await page.click("#run-button");
  await waitIdle(page);
  const isUpToDate = (await statusText(page)) === "All results are up to date.";
  const isDone = (statuses) => /^Done in .*particles exited/.test(statuses.at(-1) ?? "");
  // No release point: the run ends after the flow
  const isFlowDone = (statuses) => (statuses.at(-1) ?? "").endsWith(NO_POINT_HINT);
  const startsStep = (statuses, text) => statuses.some((status) => status.startsWith(text));
  const acceptedBefore = Number(await resultValue(page, "Accepted fractures"));
  await openStepPanel(page, "flow");
  const pressureStatuses = await statusesDuring(page, async () => {
    await page.$eval('#flow-form [data-highlight-surface="west"] input', (input) => {
      input.value = String(Number(input.value) + 0.5);
      input.dispatchEvent(new Event("input"));
    });
  });
  check(
    isUpToDate &&
      isFlowDone(pressureStatuses) &&
      startsStep(pressureStatuses, "Solving the flow") &&
      !startsStep(pressureStatuses, "Tracking") &&
      !startsStep(pressureStatuses, "Generating") &&
      !startsStep(pressureStatuses, "Meshing"),
    "live run: a pressure change runs the flow again, and no transport without a release point",
    pressureStatuses.join(" | "),
  );
  // A new user-defined fracture: the stochastic fractures of the last run stay, without a new generation
  await openStepPanel(page, "fractures");
  const { statuses: fractureStatuses, frames: fractureFrames } = await framesDuring(page, async () => {
    await page.evaluate(() =>
      [...document.querySelectorAll("#fractures-form button")].find((node) => node.textContent === "Add fracture").click(),
    );
    await page.waitForFunction(() => [...document.querySelectorAll("#fractures-form h4")].some((node) => node.textContent === "Fracture 1"));
    await setField(page, "#fractures-form", "Radius (m)", 4);
  });
  // The view keeps the old mesh with its pressure colors until the new flow: no empty frame, no other colors
  const shares = fractureFrames.map((frame) => frame.share);
  const otherColors = [...new Set(fractureFrames.map((frame) => frame.color))].filter((color) => color !== "point:pressure");
  check(
    fractureFrames.length > 0 && Math.min(...shares) >= 0.5 * shares[0] && otherColors.length === 0,
    "live run: the view keeps the mesh and its pressure colors during the steps of a new user fracture",
    `${fractureFrames.length} frames, colored part ${Math.min(...shares).toFixed(3)} to ${Math.max(...shares).toFixed(3)} (first ${shares[0]?.toFixed(3)}), other colors [${otherColors.join(", ")}]`,
  );
  const acceptedAfter = Number(await resultValue(page, "Accepted fractures"));
  check(
    isFlowDone(fractureStatuses) &&
      fractureStatuses[0].startsWith("Making the network of the") &&
      startsStep(fractureStatuses, "Meshing") &&
      acceptedAfter === acceptedBefore + 1,
    "live run: a new user fracture keeps the stochastic fractures",
    `${fractureStatuses.join(" | ")}; accepted ${acceptedBefore} → ${acceptedAfter}`,
  );
  await page.screenshot({ path: `${screenshotDir}/e2e_live_user_fracture.png` });

  // A click on a fracture of the 3D view adds a release point, and the particles start there
  await openStepPanel(page, "transport");
  const pointStatuses = await pickReleasePoint(page);
  const pointCount = await page.$$eval("#release-points li", (nodes) => nodes.length);
  const pointParticles = /of (\d+) particles/.exec(pointStatuses.at(-1) ?? "")?.[1];
  check(
    pointCount === 1 && isDone(pointStatuses) && pointParticles === "1",
    "live run: a click on a fracture adds a release point",
    `${pointCount} points; ${pointStatuses.join(" | ")}`,
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  await page.screenshot({ path: `${screenshotDir}/e2e_release_point.png` });
  // "Clear points" removes the trajectories
  const clearStatuses = await statusesDuring(page, () =>
    page.evaluate(() => [...document.querySelectorAll("#transport-form button")].find((node) => node.textContent === "Clear points").click()),
  );
  const hasTransportAfterClear = await page.$eval("#transport-results", (node) => !node.hidden);
  check(
    isFlowDone(clearStatuses) && !hasTransportAfterClear,
    "live run: clear points removes the transport",
    `${clearStatuses.join(" | ")}; transport ${hasTransportAfterClear ? "shown" : "removed"}`,
  );
  await pickReleasePoint(page);

  // "Reset" removes all results; the next run starts from the seed
  await page.mouse.move(0, 0);
  const viewBeforeReset = await stableViewerScreenshot();
  await page.click("#reset-button");
  const afterReset = await page.evaluate(() => ({
    hasResults: !document.querySelector("#results").hidden,
    runText: document.querySelector("#run-button").getAttribute("aria-label"),
  }));
  await page.mouse.move(0, 0);
  const resetView = await stableViewerScreenshot();
  const resetStatuses = await statusesDuring(page, () => page.click("#run-button"));
  await page.click("#run-button");
  check(
    !afterReset.hasResults && afterReset.runText === "Run" && resetStatuses[0] === "Generating…" && isDone(resetStatuses),
    "reset, then a run from the seed",
    `results ${afterReset.hasResults}, button ${afterReset.runText}; ${resetStatuses.join(" | ")}`,
  );
  check(!isSameView(resetView, viewBeforeReset), "the view after reset has no network", "changed");

  // The domain mesh dropdown: a new shape replaces only the mesh
  await openStepPanel(page, "domain");
  // The description of the shape shows below the dropdown
  const shapeDescription = () =>
    page.$eval("#shape-description", (node) => (node.hidden ? "(hidden)" : node.textContent));
  const boxDescription = await shapeDescription();
  await page.select("#domain-form select", "L-shape.vtu");
  // The form shows the regions of the mesh when it is loaded
  await page.waitForFunction(() => [...document.querySelectorAll("#form option")].some((node) => node.value === "west_box"));
  const meshLabel = await page.$eval("#domain-form select", (node) => node.selectedOptions[0].textContent);
  check(meshLabel === "L-shape", "choose a predefined mesh", meshLabel);
  const lShapeDescription = await shapeDescription();
  check(
    boxDescription.startsWith("A cube of 10 m") && lShapeDescription.startsWith("An L shape"),
    "shape description",
    `${boxDescription.slice(0, 20)}… → ${lShapeDescription.slice(0, 20)}…`,
  );
  await page.screenshot({ path: `${screenshotDir}/e2e_shape_description.png` });

  // A user-defined fracture: the center is limited to the box of its region (the cube of 10 m)
  await startOnShape(page);
  await openStepPanel(page, "fractures");
  await page.evaluate(() =>
    [...document.querySelectorAll("#fractures-form button")].find((node) => node.textContent === "Add fracture").click(),
  );
  await page.waitForFunction(() => [...document.querySelectorAll("#fractures-form h4")].some((node) => node.textContent === "Fracture 1"));
  const center = await page.evaluate(() => {
    const input = [...document.querySelectorAll("#fractures-form .field")]
      .find((field) => field.querySelector(".field-label")?.textContent === "Center x (m)")
      .querySelector("input");
    const limits = `${input.value} in ${input.min} to ${input.max}`;
    input.value = "20";
    input.dispatchEvent(new Event("input"));
    return { limits, valueAboveMax: input.closest(".field").querySelector(".slider-value").textContent };
  });
  check(
    center.limits === "5 in 0 to 10" && center.valueAboveMax === "10",
    "user fracture center in its region",
    `${center.limits}; 20 → ${center.valueAboveMax}`,
  );
  // The 3D view shows the polygon at once: a larger radius for the screenshot
  await page.evaluate(() => {
    const input = [...document.querySelectorAll("#fractures-form .field")]
      .find((field) => field.querySelector(".field-label")?.textContent === "Radius (m)")
      .querySelector("input");
    input.value = "4";
    input.dispatchEvent(new Event("input"));
    [...document.querySelectorAll("#fractures-form h3")].find((node) => node.textContent === "User-defined fractures").scrollIntoView();
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await page.screenshot({ path: `${screenshotDir}/e2e_user_fracture.png` });
  // The network shows the user fracture in the domain (half of it is outside), without the polygon of the
  // change; a new change shows that polygon again, until the next network
  await runAll(page);
  await page.mouse.move(0, 0);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await page.screenshot({ path: `${screenshotDir}/e2e_user_fracture_network.png` });
  const networkGeometries = await viewGeometryCount(page);
  await setField(page, "#fractures-form", "Radius (m)", 3);
  await page.waitForFunction((count) => Number(document.querySelector("#viewer-canvas").dataset.geometryCount) !== count, {}, networkGeometries);
  const previewGeometries = await viewGeometryCount(page);
  await runAll(page);
  const nextNetworkGeometries = await viewGeometryCount(page);
  check(
    previewGeometries > networkGeometries && nextNetworkGeometries === networkGeometries,
    "the polygon of a changed user fracture shows until the next network",
    `network ${networkGeometries}, change ${previewGeometries}, next network ${nextNetworkGeometries} geometries`,
  );

  // Bad input: a family region of the L-shape mesh is not in the Box mesh: an error of the library
  await startOnShape(page, "L-shape.vtu");
  await page.waitForFunction(() => [...document.querySelectorAll("#form option")].some((node) => node.value === "west_box"));
  await page.evaluate(() => {
    const select = [...document.querySelectorAll("#form select")].find((node) =>
      [...node.options].some((option) => option.value === "west_box"),
    );
    select.value = "west_box";
    select.dispatchEvent(new Event("change"));
  });
  await page.select("#domain-form select", "Box.vtu");
  // The family region is not in the new mesh
  await page.waitForFunction(() =>
    [...document.querySelectorAll("#form option")].some((node) => node.textContent.endsWith("(not in the mesh)")),
  );
  await runAll(page);
  // The text of the app for the error of the library
  const badInputStatus = await statusText(page);
  check(
    (await isStatusError(page)) &&
      badInputStatus === "Family 1 (DFN panel): the domain has no region west_box. Choose another region.",
    "generate with a bad input",
    badInputStatus,
  );
  // The status is in the Log panel, not in the run bar; a red dot on the Log button tells of the error, and the
  // dot does not show while the Log panel is open
  const logDot = () =>
    page.$eval("#log-button", (node) => {
      const dot = getComputedStyle(node, "::after");
      return `${node.dataset.message ?? "none"} ${dot.display === "none" || dot.content === "none" ? "hidden" : "shown"}`;
    });
  const statusPlace = await page.$eval("#status", (node) => node.parentElement.id);
  const dotOnError = await logDot();
  await page.click("#log-button");
  const dotWithLog = await logDot();
  await page.click("#log-button");
  check(
    statusPlace === "log-view" && dotOnError === "error shown" && dotWithLog === "error hidden",
    "the status in the Log panel, and the dot of the Log button",
    `status in #${statusPlace}; dot ${dotOnError}, with the Log panel ${dotWithLog}`,
  );
  const statesAfterError = await segmentStates(page);
  check(
    statesAfterError === "domain=done fractures=stale network=failed flow=stale transport=stale",
    "segment states after an error",
    statesAfterError,
  );

  // No cluster connects west and east (Box, default forms with FRAM on, this seed): the network shows, with a warning
  await startOnShape(page);
  await setFram(page, true);
  await page.evaluate(() => {
    const input = [...document.querySelectorAll("#form input")].find(
      (node) => node.closest(".field")?.querySelector(".field-label")?.textContent === "Seed",
    );
    input.value = "1837757520";
    input.dispatchEvent(new Event("input"));
  });
  const noClusterStatus = await runAll(page);
  const isStatusWarning = await page.$eval("#status", (node) => node.classList.contains("is-warning"));
  const hasNetwork = await page.$eval("#results", (node) => !node.hidden);
  // The mesh needs a cluster which connects an in-flow and an out-flow surface: the steps stop after the network
  const hasFlow = await page.$eval("#flow-results", (node) => !node.hidden);
  check(
    isStatusWarning &&
      hasNetwork &&
      !hasFlow &&
      noClusterStatus.includes("No cluster connects an in-flow and an out-flow surface"),
    "no connecting cluster",
    `${noClusterStatus}; flow ${hasFlow ? "shown" : "none"}`,
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  await page.screenshot({ path: `${screenshotDir}/e2e_no_connecting_cluster.png` });

  // With no out-flow surface, the generation asks for one
  await setRole(page, "east", "noflow");
  const noOutflowStatus = await runAll(page);
  check(
    noOutflowStatus === "Set at least one out-flow surface (Domain panel, Boundary surfaces).",
    "no out-flow surface",
    noOutflowStatus,
  );

  // A large run: the view shows the new fractures during the run; then "Pause". FRAM on: a slow run (with FRAM off
  // the intersections soon need more memory than WebAssembly has)
  await startOnShape(page);
  await setFram(page, true);
  await setFractureCount(page, 100000);
  await page.click("#run-button");
  await page.waitForFunction(() => document.querySelector("#status").textContent.includes("fractures accepted"), {
    timeout: RUN_TIMEOUT,
  });
  // The view is drawn again at most each 200 ms
  const viewDuringRun = async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return Buffer.from(await (await page.$("#viewer-canvas")).screenshot());
  };
  const acceptedCount = () =>
    page.$eval("#status", (node) => Number(/(\d+) fractures accepted/.exec(node.textContent)?.[1] ?? 0));
  const firstView = await viewDuringRun();
  // The insertion can be slow: the second view comes after 10 more fractures
  await page.waitForFunction(
    (count) => Number(/(\d+) fractures accepted/.exec(document.querySelector("#status").textContent)?.[1] ?? 0) >= count,
    { timeout: RUN_TIMEOUT },
    (await acceptedCount()) + 10,
  );
  const secondView = await viewDuringRun();
  check(
    !isSameView(firstView, secondView),
    "fractures in the view during the run",
    `view ${isSameView(firstView, secondView) ? "unchanged" : "changed"}`,
  );
  await page.screenshot({ path: `${screenshotDir}/e2e_generation_live.png` });
  await page.click("#run-button");
  await waitIdle(page);
  // Before the first checkpoint (5 s) no fracture stays
  const largeStopStatus = await statusText(page);
  check(
    largeStopStatus === "Paused." || /^Done in .*until the pause/s.test(largeStopStatus),
    "stop of a large run",
    largeStopStatus.replace("\n", " "),
  );

  // The new worker runs the next input; "Pause" during the mesh keeps the network, and "Run" makes the mesh again
  await startOnShape(page);
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      if (document.querySelector("#status").textContent === "Meshing…") {
        observer.disconnect();
        document.querySelector("#run-button").click();
      }
    });
    observer.observe(document.querySelector("#status"), { childList: true, characterData: true, subtree: true });
  });
  await page.click("#run-button");
  await waitIdle(page);
  const meshStopStatus = await statusText(page);
  const hasNetworkAfterStop = await page.$eval("#results", (node) => !node.hidden);
  check(meshStopStatus === "Paused." && hasNetworkAfterStop, "stop during the mesh", meshStopStatus);
  const statusesAfterMeshStop = await statusesDuring(page, () => page.click("#run-button"));
  await page.click("#run-button");
  check(
    statusesAfterMeshStop[0] === "Meshing…" && statusesAfterMeshStop.at(-1).endsWith(NO_POINT_HINT),
    "run after a stop during the mesh",
    statusesAfterMeshStop.join(" | "),
  );
  await page.screenshot({ path: `${screenshotDir}/e2e_network.png` });
  await page.$eval(".family-card", (node) => node.scrollIntoView());
  await page.screenshot({ path: `${screenshotDir}/e2e_families.png` });

  // "Pause" after the first checkpoint (5 s) keeps the fractures; "Run" continues: the network is that of a run with
  // no stop. Default forms, FRAM on and 1400 fractures: the generation takes about 25 s (WebAssembly in node on
  // fungihouse; 1200: 8 s), longer than the first checkpoint and the pause at 9 s
  await startOnShape(page);
  await setFram(page, true);
  await setFractureCount(page, 1400);
  await runAll(page);
  const fullRunCount = await resultValue(page, "Final fractures");
  await page.click("#reset-button");
  await page.click("#run-button");
  await new Promise((resolve) => setTimeout(resolve, 9000));
  await page.click("#run-button");
  await waitIdle(page);
  const stoppedStatus = await statusText(page);
  check(/^Done in .*until the pause/s.test(stoppedStatus), "stop keeps the fractures", stoppedStatus.replace("\n", " "));
  await page.screenshot({ path: `${screenshotDir}/e2e_stopped.png` });
  const continuedStatus = await runAll(page);
  const continuedCount = await resultValue(page, "Final fractures");
  check(
    continuedStatus.endsWith(NO_POINT_HINT) && continuedCount !== undefined && continuedCount === fullRunCount,
    "run after the stop gives the network of a run with no stop",
    `${continuedCount} final fractures, with no stop ${fullRunCount}; ${continuedStatus}`,
  );


  // The icons of the 3D view, the color bar first: each has a name, and a computer shows its label only at the pointer
  await page.mouse.move(0, 0);
  const iconControls = await page.$$eval(".viewer-toolbar .icon-toggle", (nodes) =>
    nodes.map((node) => ({
      name: node.querySelector("input")?.getAttribute("aria-label") ?? node.getAttribute("aria-label"),
      hasTitle: node.title !== "",
      isLabelShown: getComputedStyle(node.querySelector(".icon-label")).opacity !== "0",
    })),
  );
  check(
    iconControls.length === 8 &&
      iconControls[0].name === "Color bar" &&
      iconControls.every(({ name, hasTitle, isLabelShown }) => name && hasTitle && !isLabelShown),
    "icons of the 3D view",
    iconControls.map(({ name }) => name).join(", "),
  );
  // One button shows the removed fractures (the network of the last run has some) and the rejected ones
  const removedCount = await page.$eval("#results-stats", (node) => {
    const values = Object.fromEntries([...node.querySelectorAll("dt")].map((term) => [term.textContent, Number(term.nextElementSibling?.textContent)]));
    return values["Accepted fractures"] - values["Final fractures"];
  });
  await page.mouse.move(0, 0);
  const viewWithoutDiscarded = await viewerScreenshot();
  await page.click("#show-discarded");
  await page.mouse.move(0, 0);
  const viewWithDiscarded = await viewerScreenshot();
  await page.click("#show-discarded");
  await page.mouse.move(0, 0);
  const viewAfterDiscarded = await viewerScreenshot();
  check(
    removedCount > 0 && !isSameView(viewWithDiscarded, viewWithoutDiscarded) && isSameView(viewAfterDiscarded, viewWithoutDiscarded),
    "the button of the removed and rejected fractures",
    `${removedCount} removed; view ${isSameView(viewWithDiscarded, viewWithoutDiscarded) ? "unchanged" : "changed"}, after ${isSameView(viewAfterDiscarded, viewWithoutDiscarded) ? "same" : "different"}`,
  );
  // The label of that button: the rejected fractures only after a network with FRAM on (the last run); the
  // checkbox changes it only at the next run
  const discardedLabel = () =>
    page.$eval("#show-discarded", (node) => {
      const toggle = node.closest("label");
      const isCrossShown = getComputedStyle(toggle.querySelector(".icon-reject")).display !== "none";
      return `${toggle.querySelector(".icon-label").textContent} (${toggle.title}, ${node.getAttribute("aria-label")}, cross ${isCrossShown})`;
    });
  const labelWithFram = await discardedLabel();
  await setFram(page, false);
  const labelBeforeRun = await discardedLabel();
  await setFractureCount(page, 10);
  await runAll(page);
  const labelWithoutFram = await discardedLabel();
  check(
    labelWithFram === "Removed and rejected (Removed and rejected, Removed and rejected, cross true)" &&
      labelBeforeRun === labelWithFram &&
      labelWithoutFram === "Removed (Removed, Removed, cross false)",
    "the label of the removed fractures button",
    `FRAM on: ${labelWithFram}; FRAM off, before the run: ${labelBeforeRun}; after: ${labelWithoutFram}`,
  );
  await page.hover("#reset-camera");
  const hoverStart = Date.now();
  // The transition of the label (0.15 s)
  await page
    .waitForFunction(() => getComputedStyle(document.querySelector("#reset-camera .icon-label")).opacity === "1", { timeout: 3000 })
    .catch(() => {});
  const hoverLabel = await page.$eval("#reset-camera .icon-label", (node) => getComputedStyle(node).opacity);
  check(hoverLabel === "1", "icon label at the pointer", `${hoverLabel} after ${Date.now() - hoverStart} ms`);
  await page.screenshot({ path: `${screenshotDir}/e2e_icons.png` });

  // The color bar goes off and comes back; the choice stays through a new color
  await page.mouse.move(0, 0);
  const viewWithColorBar = await viewerScreenshot();
  await page.click("#show-color-bar");
  const viewWithoutColorBar = await viewerScreenshot();
  await page.select("#color-select", "cell:area");
  const viewWithoutColorBarNewColor = await viewerScreenshot();
  await page.click("#show-color-bar");
  const viewNewColor = await viewerScreenshot();
  await page.click("#show-color-bar");
  const viewAgainWithoutColorBar = await viewerScreenshot();
  await page.click("#show-color-bar");
  check(
    !isSameView(viewWithoutColorBar, viewWithColorBar) &&
      !isSameView(viewNewColor, viewWithoutColorBarNewColor) &&
      isSameView(viewAgainWithoutColorBar, viewWithoutColorBarNewColor),
    "color bar toggle",
    "changed",
  );

  // The Log panel stays open during a run, and the settings of a step too
  await openStepPanel(page, "network");
  await page.click("#log-button");
  await runAll(page);
  const isPanelShownAfterRun = await isStepPanelShown();
  check(
    (await isLogShown()) && isPanelShownAfterRun,
    "computer: a run keeps the panels",
    `log ${await isLogShown()}, settings ${isPanelShownAfterRun}`,
  );
  await page.click("#log-button");

  // "Reset view" puts the model in the middle of the part of the view at the left of the layer rail; the settings of
  // a step cover the view and do not move it
  const freeColumns = () =>
    page.evaluate(() => ({ first: 0, last: Math.floor(document.querySelector(".layer-rail").getBoundingClientRect().left) }));
  const modelCenter = async () => {
    const image = await page.screenshot({ encoding: "base64" });
    return page.evaluate(async (base64Image, { first, last }) => {
      const response = await fetch(`data:image/png;base64,${base64Image}`);
      const bitmap = await createImageBitmap(await response.blob());
      const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d");
      context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      // The columns of the pixels which are not the background, in the middle third of the height
      let sum = 0;
      let count = 0;
      for (let row = Math.floor(bitmap.height / 3); row < (2 * bitmap.height) / 3; row++) {
        for (let column = first; column < last; column++) {
          const start = 4 * (row * bitmap.width + column);
          if (Math.abs(data[start] - 0x15) + Math.abs(data[start + 1] - 0x18) + Math.abs(data[start + 2] - 0x1d) > 30) {
            sum += column;
            count++;
          }
        }
      }
      return count === 0 ? null : sum / count;
    }, image, await freeColumns());
  };
  await page.click("#panel-close");
  await page.click("#reset-camera");
  await page.mouse.move(700, 450);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const centerWithoutPanel = await modelCenter();
  await page.screenshot({ path: `${screenshotDir}/e2e_panel_closed.png` });
  // The part of the view at the right of the panel and its shadow, above the run bar
  await openStepPanel(page, "network");
  const clipRightOfPanel = await page.$eval("#step-panel", (node) => {
    const left = Math.ceil(node.getBoundingClientRect().right) + 24;
    const bottom = Math.floor(document.querySelector("#run-panel").getBoundingClientRect().top);
    return { x: left, y: 0, width: window.innerWidth - left, height: bottom };
  });
  const viewRightOfPanel = async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return Buffer.from(await page.screenshot({ clip: clipRightOfPanel }));
  };
  const viewWithPanel = await viewRightOfPanel();
  await page.click("#panel-close");
  await page.mouse.move(700, 450);
  const isViewKept = isSameView(viewWithPanel, await viewRightOfPanel());
  check(
    centerWithoutPanel !== null && Math.abs(centerWithoutPanel - 700) < 120 && isViewKept,
    "reset view centers the model; the settings of a step do not move the view",
    `center ${centerWithoutPanel?.toFixed(0)}; view with the panel ${isViewKept ? "same" : "different"}`,
  );

  // The gear between the layer rail and the GitHub link opens the settings dialog. Its orientation option
  // gives the angle fields of the families and user fractures, with the angles of the same planes.
  const toolbarItems = await page.$$eval("#viewer-toolbar > *", (nodes) =>
    nodes.map((node) => node.id || node.classList[node.classList.length - 1]).join(", "),
  );
  check(toolbarItems === "color-panel, layer-rail, settings-button, repository-link", "the gear before the GitHub link", toolbarItems);
  // A user-defined fracture with a normal along y
  await startOnShape(page);
  await page.evaluate(() =>
    [...document.querySelectorAll("#fractures-form button")].find((node) => node.textContent === "Add fracture").click(),
  );
  await page.waitForFunction(() => [...document.querySelectorAll("#fractures-form h4")].some((node) => node.textContent === "Fracture 1"));
  await setField(page, "#fractures-form", "Theta (°)", 90);
  await setField(page, "#fractures-form", "Phi (°)", 90);
  // "Theta (°): 90" for each angle field of a form
  const angles = (form) =>
    page.$$eval(`${form} .field`, (fields) =>
      fields
        .map((field) => [field.querySelector(".field-label")?.textContent ?? "", field.querySelector("input")?.value])
        .filter(([label]) => /^(Theta|Phi|Trend|Plunge|Dip|Strike) \(°\)$/.test(label))
        .map(([label, value]) => `${label.split(" ")[0]} ${value}`)
        .join(", "),
    );
  const orientationSelects = await page.$$eval("#form .field-label, #fractures-form .field-label", (nodes) =>
    nodes.filter((node) => node.textContent === "Orientation").length,
  );
  const anglesBefore = `${await angles("#form")} | ${await angles("#fractures-form")}`;
  await page.click("#settings-button");
  const isDialogOpen = () => page.$eval("#settings-dialog", (node) => node.open);
  const isOpenAfterClick = await isDialogOpen();
  const optionAtOpen = await page.$eval("#orientation-option", (node) => node.value);
  await page.screenshot({ path: `${screenshotDir}/e2e_settings.png` });
  await page.select("#orientation-option", "dip_strike");
  const anglesDipStrike = `${await angles("#form")} | ${await angles("#fractures-form")}`;
  await page.keyboard.press("Escape");
  const isOpenAfterEscape = await isDialogOpen();
  await page.click("#settings-button");
  await page.select("#orientation-option", "theta_phi");
  const anglesBack = `${await angles("#form")} | ${await angles("#fractures-form")}`;
  // A click on the backdrop, outside the content
  await page.mouse.click(5, 5);
  const isOpenAfterBackdrop = await isDialogOpen();
  check(
    orientationSelects === 0 &&
      isOpenAfterClick &&
      optionAtOpen === "theta_phi" &&
      anglesBefore === "Theta 0, Phi 0 | Theta 90, Phi 90" &&
      anglesDipStrike === "Dip 0, Strike 0 | Dip 90, Strike 270" &&
      anglesBack === anglesBefore &&
      !isOpenAfterEscape &&
      !isOpenAfterBackdrop,
    "the orientation option of the settings dialog",
    `${orientationSelects} selects; open ${isOpenAfterClick} (${optionAtOpen}); ${anglesBefore} → ${anglesDipStrike} → ${anglesBack}; closed by Escape ${!isOpenAfterEscape}, by backdrop ${!isOpenAfterBackdrop}`,
  );

  await checkPhone();
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} failure(s):\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("\nAll checks passed.");
