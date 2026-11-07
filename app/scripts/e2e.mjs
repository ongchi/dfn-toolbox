// End-to-end check of the web app in the local Chrome (headless).
// Start the dev server first (npm run dev), then:
//   node scripts/e2e.mjs [url] [screenshot folder]
// It checks the default example, runs all steps (network, mesh, flow,
// transport) of each example, the live run (a pressure change, a new
// user-defined fracture, a release point clicked on a fracture, "Reset"), the
// choice of a predefined mesh, a bad input, the fractures in the view during a
// run, "Pause" during the mesh, and "Pause" with the fractures kept and a new
// "Run", and the phone layout; it saves screenshots.
import { PNG } from "pngjs";
import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? "http://localhost:5173/";
const screenshotDir = process.argv[3] ?? ".";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const RUN_TIMEOUT = 300000;
const TRANSPORT_REPEATS = 5;
// The roles of the surfaces of the Box shape (example box_west_east, and a new shape)
const BOX_ROLES = "west: inflow, east: outflow, south: noflow, north: noflow, bottom: noflow, top: noflow";
const FLOAT_BUFFER_EXTENSIONS = ["EXT_color_buffer_float", "EXT_color_buffer_half_float", "EXT_float_blend"];
// Largest minus smallest of red, green and blue (0 to 255)
const COLORED_PIXEL_CONTRAST = 30;
// The highlighted south surface of the default example (the face to the camera) fills a part of the view
const MINIMUM_SURFACE_PIXEL_SHARE = 0.05;
// Two pictures of the view are the same with a small noise (the blur of the panels behind them):
// a few pixels which differ by at most this value in each channel (0 to 255)
const MAXIMUM_NOISE = 2;
const MAXIMUM_NOISY_PIXEL_SHARE = 0.0001;

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

/**
 * Selects a radio button of the Domain tab ("example" or "shape"); the tab can be hidden.
 * A switch resets the input: it waits until the example or the shape is loaded.
 */
async function selectDomainSource(page, source) {
  const selector = `input[name="domain-source"][value="${source}"]`;
  if (await page.$eval(selector, (node) => node.checked)) {
    return;
  }
  await page.$eval("#form", (node) => {
    delete node.dataset.example;
    delete node.dataset.shape;
  });
  await page.$eval(selector, (node) => node.click());
  const key = source === "example" ? "example" : "shape";
  await page.waitForFunction((datasetKey) => document.querySelector("#form").dataset[datasetKey] !== undefined, {}, key);
}

/** The value of the n_poly field of the DFN tab */
async function nPolyValue(page) {
  return page.evaluate(
    () => [...document.querySelectorAll("#form input[type=number]")].find((node) => node.closest(".field")?.textContent.includes("n_poly")).value,
  );
}

async function selectExample(page, name) {
  await selectDomainSource(page, "example");
  // A select of the same value sends no change event: select none first
  await page.select("#example-select", "");
  await page.$eval("#form", (node) => delete node.dataset.example);
  await page.select("#example-select", name);
  await page.waitForFunction((exampleName) => document.querySelector("#form").dataset.example === exampleName, {}, name);
}

/** Sets the FRAM checkbox of the settings dialog (the examples and the default forms have FRAM off) */
async function setFram(page, isOn) {
  await page.click("#settings-button");
  await page.evaluate((isFramOn) => {
    const input = [...document.querySelectorAll("#settings-dialog .field-checkbox")]
      .find((field) => field.querySelector(".field-label")?.textContent === "FRAM on")
      .querySelector("input");
    if (input.checked !== isFramOn) {
      input.click();
    }
  }, isOn);
  await page.keyboard.press("Escape");
}

/** Sets the number of fractures (n_poly) of the DFN tab */
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

/** The roles of the boundary surfaces in the Domain tab, as "name: role" */
async function domainRoles(page) {
  return page.$$eval("#boundary-surfaces select[data-surface]", (nodes) =>
    nodes.map((node) => `${node.dataset.surface}: ${node.value}`).join(", "),
  );
}

/** The in-flow and then the out-flow surfaces of the Domain tab: the pressure boundaries of the flow */
async function flowSurfaceNames(page) {
  const roles = await page.$$eval("#boundary-surfaces select[data-surface]", (nodes) =>
    nodes.map((node) => [node.dataset.surface, node.value]),
  );
  return ["inflow", "outflow"]
    .flatMap((role) => roles.filter(([, value]) => value === role).map(([name]) => name))
    .join(", ");
}

/** Sets the role of a boundary surface in the Domain tab */
async function setRole(page, surface, role) {
  await page.click('[data-sidebar-tab="domain"]');
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
  await page.waitForFunction(() => document.querySelector("#form").dataset.example !== undefined, { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector("#viewer-message").hidden, { timeout: 120000 });

  // The 3D view fills the screen; the settings are a bottom sheet with two heights, which a tap on its handle changes
  const sheetState = () =>
    page.evaluate(() => {
      const layout = document.querySelector("#layout");
      const isPanelShown = getComputedStyle(document.querySelector("#settings-panel")).display !== "none";
      return `${isPanelShown ? layout.dataset.sheet : "closed"}`;
    });
  const canvasSize = () => page.$eval("#viewer-canvas", (node) => `${node.clientWidth} x ${node.clientHeight}`);
  const sizeAtStart = await canvasSize();
  const sheetStates = [await sheetState()];
  await page.tap("#sheet-size");
  sheetStates.push(await sheetState());
  await page.tap("#sheet-size");
  sheetStates.push(await sheetState());
  await page.tap("#panel-close");
  sheetStates.push(await sheetState());
  await page.tap("#panel-open");
  sheetStates.push(await sheetState());
  check(sheetStates.join(", ") === "half, full, half, closed, half", "phone: the heights of the sheet", sheetStates.join(", "));
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

  for (const tab of ["domain", "fractures", "network", "flow", "transport"]) {
    await page.tap(`[data-sidebar-tab="${tab}"]`);
    const problems = await touchProblems(page);
    check(problems.length === 0, `phone: touch sizes of the ${tab} tab`, problems.join(", ") || "none");
    await page.screenshot({ path: `${screenshotDir}/e2e_phone_${tab}.png` });
  }

  // A run lowers the full sheet to half: the view shows the fractures
  await page.tap('[data-sidebar-tab="network"]');
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

  // Landscape: the settings panel at the left of the view, as on a computer
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, isLandscape: true, deviceScaleFactor: 2 });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const landscape = await page.evaluate(() => {
    const panel = document.querySelector("#settings-panel").getBoundingClientRect();
    const rail = document.querySelector(".layer-rail").getBoundingClientRect();
    const canvas = document.querySelector("#viewer-canvas");
    return {
      panelWidth: panel.width,
      isRailRightOfPanel: rail.left > panel.right,
      isRailInScreen: rail.bottom <= window.innerHeight,
      canvasSize: `${canvas.clientWidth} x ${canvas.clientHeight}`,
    };
  });
  check(
    landscape.panelWidth === 340 && landscape.isRailRightOfPanel && landscape.isRailInScreen && landscape.canvasSize === "844 x 390",
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
  await page.waitForFunction(() => document.querySelector("#form").dataset.example !== undefined, { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector("#viewer-message").hidden, { timeout: 120000 });
  await new Promise((resolve) => setTimeout(resolve, 3000));
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
  await page.waitForFunction(() => document.querySelector("#example-select").options.length > 1);
  await page.waitForFunction(() => document.querySelector("#viewer-message").hidden, { timeout: 120000 });

  // The page opens the default example
  await page.waitForFunction(() => document.querySelector("#form").dataset.example !== undefined);
  const startExample = await page.$eval("#example-select", (node) => node.value);
  check(startExample === "box_west_east", "default example", startExample);
  const startExampleTitle = await page.$eval("#example-select", (node) => node.selectedOptions[0].textContent);
  check(startExampleTitle === "Box west -> east", "example title", startExampleTitle);
  const startTab = await page.$eval(".sidebar-tabs .is-active", (node) => node.dataset.sidebarTab);
  check(startTab === "domain", "start on the domain tab", startTab);
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

  // The roles of the boundary surfaces of the example
  const exampleRoles = await domainRoles(page);
  check(exampleRoles === BOX_ROLES, "boundary surface roles", exampleRoles);

  // The pointer over the row of a surface highlights it; the view is the same again after it leaves.
  // The screenshots have the part of the view at the right of the settings panel.
  const viewerScreenshot = async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const clip = await page.$eval("#settings-panel", (node) => {
      const left = Math.ceil(node.getBoundingClientRect().right);
      return { x: left, y: 0, width: window.innerWidth - left, height: window.innerHeight };
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

  // The radio buttons of the Domain tab show the example dropdown or the mesh dropdown
  const domainRows = async () =>
    page.evaluate(
      () => `example ${document.querySelector("#example-row").hidden ? "hidden" : "shown"}, mesh ${document.querySelector("#domain-form").hidden ? "hidden" : "shown"}`,
    );
  const exampleRows = await domainRows();
  const exampleNPoly = await nPolyValue(page);
  await selectDomainSource(page, "shape");
  const shapeRows = await domainRows();
  check(
    exampleRows === "example shown, mesh hidden" && shapeRows === "example hidden, mesh shown",
    "domain source radio buttons",
    `${exampleRows}; ${shapeRows}`,
  );
  // A switch resets the input: the default forms on the first shape, then the example again
  const shapeReset = await page.evaluate(() => ({
    shape: document.querySelector("#form").dataset.shape,
    families: document.querySelectorAll("#form .family-card").length,
  }));
  const shapeNPoly = await nPolyValue(page);
  check(
    shapeReset.shape === "Box.vtu" && shapeReset.families === 1 && exampleNPoly === "10" && shapeNPoly === "100",
    "shape resets the input",
    `${shapeReset.shape}, ${shapeReset.families} family, n_poly ${exampleNPoly} → ${shapeNPoly}`,
  );
  await page.screenshot({ path: `${screenshotDir}/e2e_domain_shape.png` });
  await selectDomainSource(page, "example");
  const exampleAgain = await page.$eval("#form", (node) => node.dataset.example);
  const exampleAgainNPoly = await nPolyValue(page);
  check(
    exampleAgain === "box_west_east" && exampleAgainNPoly === "10",
    "example loads again",
    `${exampleAgain}, n_poly ${exampleAgainNPoly}`,
  );

  // The Domain and User fractures tabs have no run button; "Next" goes to the next tab
  // The fracture shape, FRAM, clusters, mesh, fluid and routing sections are in the settings dialog, not on the
  // DFN, Flow and Transport tabs; the forms have no number of points
  const sectionTitles = (selector) =>
    page.$$eval(`${selector} .form-section > h3`, (nodes) => nodes.map((node) => node.textContent).join(", "));
  const networkSections = await sectionTitles("#form");
  const settingsSections = await sectionTitles("#settings-dialog");
  const pointFields = await page.$$eval(".field-label", (nodes) =>
    nodes.filter((node) => node.textContent === "Number of points").map((node) => node.closest("#settings-dialog, #form, #fractures-form")?.id),
  );
  check(
    networkSections === "General, Generation, Fracture families" &&
      settingsSections === "Orientation of the fractures, Fracture shape, FRAM, Clusters, Triangle mesh for the flow, Fluid, Transport" &&
      pointFields.join(", ") === "settings-dialog",
    "settings sections in the settings dialog",
    `DFN tab: ${networkSections}; settings: ${settingsSections}; number of points in ${pointFields.join(", ")}`,
  );
  // One "Run" button and one "Reset" button for all steps, on each tab
  const runButtons = [];
  for (const tab of ["domain", "fractures", "network", "flow", "transport"]) {
    await page.click(`[data-sidebar-tab="${tab}"]`);
    runButtons.push(
      await page.$$eval(".run-buttons button:not([hidden])", (nodes) => nodes.map((node) => node.textContent).join(" ")),
    );
  }
  check(
    runButtons.every((buttons) => buttons === "Run Reset Log"),
    "run buttons on each tab",
    runButtons.join(" | "),
  );

  // The full workflow of each example
  const examples = await page.$$eval("#example-select option", (options) =>
    options.map((option) => option.value).filter((value) => value !== ""),
  );
  for (const name of examples) {
    await page.click('[data-sidebar-tab="network"]');
    await selectExample(page, name);
    // "Run" runs all steps: the network, its mesh, the flow and the transport
    // The results of the Log view show only with a result
    const hasResults = () => page.$eval("#results", (node) => !node.hidden);
    const hasResultsBefore = await hasResults();
    const runStatus = await runAll(page);
    const shownResults = await page.evaluate(() =>
      ["#results", "#flow-results", "#transport-results"].filter((selector) => !document.querySelector(selector).hidden).length,
    );
    check(
      /^Done in .*particles exited/.test(runStatus) && !(await isStatusError(page)) && shownResults === 3,
      `${name}: run of all steps`,
      `${runStatus}; ${shownResults} result sections`,
    );
    const hasResultsAfter = await hasResults();
    check(!hasResultsBefore && hasResultsAfter, `${name}: results in the log view`, `${hasResultsBefore} → ${hasResultsAfter}`);

    await page.click('[data-sidebar-tab="flow"]');
    // The boundaries of the flow are the in-flow and out-flow surfaces; the Flow tab has no other section (the
    // fluid is in the settings dialog)
    const exampleSurfaces = await flowSurfaceNames(page);
    const flowBoundaries = await boundaryLabels(page, "#flow-form", "Pressure boundaries");
    const flowSections = await sectionTitles("#flow-form");
    check(
      exampleSurfaces !== "" && flowBoundaries === exampleSurfaces && flowSections === "Pressure boundaries",
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
    if (name === "box_west_east") {
      await page.screenshot({ path: `${screenshotDir}/e2e_pressure_boundary_hover.png` });
    }
    await page.mouse.move(0, 0);
    const flowViewAfter = await stableViewerScreenshot();
    check(
      !isSameView(flowViewOnHover, flowViewBefore) && isSameView(flowViewAfter, flowViewBefore),
      `${name}: pressure boundary highlight on hover`,
      `hover ${isSameView(flowViewOnHover, flowViewBefore) ? "unchanged" : "changed"}, after ${isSameView(flowViewAfter, flowViewBefore) ? "same" : "different"}`,
    );
    // A click on the label of a pressure field keeps its surface highlighted, also on the Domain tab (one for the page)
    if (name === "box_west_east") {
      // The pinned rows of one tab (the hidden tabs also have their rows)
      const pinnedTargets = (container) =>
        page.$$eval(`${container} .is-pinned`, (nodes) => nodes.map((node) => node.dataset.highlightSurface).join(", "));
      await page.click('#flow-form [data-highlight-surface="west"] .field-label');
      const isInputFocused = await page.$eval('#flow-form [data-highlight-surface="west"] input', (node) => node === document.activeElement);
      await page.mouse.move(0, 0);
      const flowViewPinned = await viewerScreenshot();
      const pinnedOnFlow = await pinnedTargets("#flow-form");
      await page.click('[data-sidebar-tab="domain"]');
      const pinnedOnDomain = await pinnedTargets("#boundary-surfaces");
      await page.click('[data-sidebar-tab="flow"]');
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
    if (name === "two_families") {
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
    if (name === "two_families") {
      await page.screenshot({ path: `${screenshotDir}/e2e_log_scale.png` });
    }
    await page.select("#color-select", "");
    check(await page.$eval("#log-scale", (node) => node.disabled), `${name}: no log scale with one color`, "disabled");
    await page.select("#color-select", "cell:flow_velocity");
    await page.click("#log-scale");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.screenshot({ path: `${screenshotDir}/e2e_${name}_flow_velocity.png` });

    // The trajectories and the velocities of the transport are always on
    await page.click('[data-sidebar-tab="transport"]');
    // The Domain tab gives the in-flow and out-flow boundaries: the Transport tab has no section for them, and
    // the routing is in the settings dialog
    const hasTransportBoundaries = await page.$$eval("#transport-form .form-section h3", (nodes) =>
      nodes.some((node) => node.textContent === "Boundaries"),
    );
    const hasTransportRouting = await page.$$eval("#transport-form .field-label", (nodes) =>
      nodes.some((node) => node.textContent === "Routing"),
    );
    check(
      !hasTransportBoundaries && !hasTransportRouting,
      `${name}: no transport boundaries and no routing`,
      `boundaries ${hasTransportBoundaries}, routing ${hasTransportRouting}`,
    );
    const areTrajectoriesShown = await page.$eval("#show-trajectories", (node) => node.checked && !node.disabled);
    check(areTrajectoriesShown, `${name}: trajectories shown`, String(areTrajectoriesShown));
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
  await page.click('[data-sidebar-tab="network"]');
  await selectExample(page, "box_west_east");
  await runAll(page);
  await page.click("#run-button");
  await waitIdle(page);
  const isUpToDate = (await statusText(page)) === "All results are up to date.";
  const isDone = (statuses) => /^Done in .*particles exited/.test(statuses.at(-1) ?? "");
  const startsStep = (statuses, text) => statuses.some((status) => status.startsWith(text));
  const acceptedBefore = Number(await resultValue(page, "Accepted fractures"));
  await page.click('[data-sidebar-tab="flow"]');
  const pressureStatuses = await statusesDuring(page, async () => {
    await page.$eval('#flow-form [data-highlight-surface="west"] input', (input) => {
      input.value = String(Number(input.value) + 0.5);
      input.dispatchEvent(new Event("input"));
    });
  });
  check(
    isUpToDate &&
      isDone(pressureStatuses) &&
      startsStep(pressureStatuses, "Solving the flow") &&
      !startsStep(pressureStatuses, "Generating") &&
      !startsStep(pressureStatuses, "Meshing"),
    "live run: a pressure change runs the flow and the transport again",
    pressureStatuses.join(" | "),
  );
  // A new user-defined fracture: the stochastic fractures of the last run stay, without a new generation
  await page.click('[data-sidebar-tab="fractures"]');
  const fractureStatuses = await statusesDuring(page, async () => {
    await page.evaluate(() =>
      [...document.querySelectorAll("#fractures-form button")].find((node) => node.textContent === "Add fracture").click(),
    );
    await page.waitForFunction(() => [...document.querySelectorAll("#fractures-form h4")].some((node) => node.textContent === "Fracture 1"));
    await setField(page, "#fractures-form", "Radius (m)", 4);
  });
  const acceptedAfter = Number(await resultValue(page, "Accepted fractures"));
  check(
    isDone(fractureStatuses) &&
      fractureStatuses[0].startsWith("Making the network of the") &&
      startsStep(fractureStatuses, "Meshing") &&
      acceptedAfter === acceptedBefore + 1,
    "live run: a new user fracture keeps the stochastic fractures",
    `${fractureStatuses.join(" | ")}; accepted ${acceptedBefore} → ${acceptedAfter}`,
  );
  await page.screenshot({ path: `${screenshotDir}/e2e_live_user_fracture.png` });

  // A click on a fracture of the 3D view adds a release point, and the particles start there
  await page.click('[data-sidebar-tab="transport"]');
  const noPointStatuses = await statusesDuring(page, () => setField(page, "#transport-form", "Method", "points"));
  check(
    (await isStatusError(page)) && noPointStatuses.at(-1).startsWith("The seeding has no release point"),
    "live run: points seeding without a point",
    noPointStatuses.at(-1),
  );
  await page.click("#pick-points");
  const isPickingOn = await page.$eval("#pick-points", (node) => node.getAttribute("aria-pressed") === "true");
  const pointCount = () => page.$$eval("#release-points li", (nodes) => nodes.length);
  const pointStatuses = await statusesDuring(page, async () => {
    // A click on the boundary surfaces only (no fracture) adds no point: the points of a grid around the middle of
    // the free part of the view, until one is on a fracture
    const { first, last, top, bottom } = await page.evaluate(() => ({
      first: Math.ceil(document.querySelector("#settings-panel").getBoundingClientRect().right),
      last: Math.floor(document.querySelector(".layer-rail").getBoundingClientRect().left),
      top: window.innerHeight / 3,
      bottom: (2 * window.innerHeight) / 3,
    }));
    const middle = { x: (first + last) / 2, y: (top + bottom) / 2 };
    for (let ring = 0; ring < 10 && (await pointCount()) === 0; ring++) {
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        await page.mouse.click(middle.x + 20 * ring * dx, middle.y + 20 * ring * dy);
        if ((await pointCount()) > 0) {
          break;
        }
      }
    }
  });
  const pointParticles = /of (\d+) particles/.exec(pointStatuses.at(-1) ?? "")?.[1];
  check(
    isPickingOn && (await pointCount()) === 1 && isDone(pointStatuses) && pointParticles === "1",
    "live run: a click on a fracture adds a release point",
    `${await pointCount()} points; ${pointStatuses.join(" | ")}`,
  );
  await page.mouse.move(0, 0);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await page.screenshot({ path: `${screenshotDir}/e2e_release_point.png` });
  await page.click("#pick-points");

  // "Reset" removes all results; the next run starts from the seed
  await page.mouse.move(0, 0);
  const viewBeforeReset = await stableViewerScreenshot();
  await page.click("#reset-button");
  const afterReset = await page.evaluate(() => ({
    hasResults: !document.querySelector("#results").hidden,
    runText: document.querySelector("#run-button").textContent,
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

  // The domain mesh dropdown: in the shape mode, a new shape replaces only the mesh
  await page.click('[data-sidebar-tab="domain"]');
  await selectDomainSource(page, "shape");
  // The description of the shape shows below the dropdown, only in the shape mode
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
  await selectExample(page, "box_west_east");
  await page.click('[data-sidebar-tab="fractures"]');
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

  // Bad input: a family region of the L-shape mesh is not in the Box mesh: an error of the library
  await selectDomainSource(page, "shape");
  await page.select("#domain-form select", "L-shape.vtu");
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
      badInputStatus === "Family 1 (DFN tab): the domain has no region west_box. Choose another region.",
    "generate with a bad input",
    badInputStatus,
  );

  // No cluster connects west and east (Box, default forms with FRAM on, this seed): the network shows, with a warning
  await selectDomainSource(page, "example");
  await selectDomainSource(page, "shape");
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

  // A predefined shape: the first surface is in-flow, the second out-flow
  const shapeRoles = await domainRoles(page);
  check(shapeRoles === BOX_ROLES, "default roles of a shape", shapeRoles);

  // With no out-flow surface, the generation asks for one
  await setRole(page, "east", "noflow");
  const noOutflowStatus = await runAll(page);
  check(
    noOutflowStatus === "Set at least one out-flow surface (Domain tab, Boundary surfaces).",
    "no out-flow surface",
    noOutflowStatus,
  );

  // A large run: the view shows the new fractures during the run; then "Pause". FRAM on: a slow run (with FRAM off
  // the intersections soon need more memory than WebAssembly has)
  await selectExample(page, "box_west_east");
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
  await selectExample(page, "box_west_east");
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
    statusesAfterMeshStop[0] === "Meshing…" && /^Done in .*particles exited/.test(statusesAfterMeshStop.at(-1)),
    "run after a stop during the mesh",
    statusesAfterMeshStop.join(" | "),
  );
  await page.screenshot({ path: `${screenshotDir}/e2e_network.png` });
  await page.$eval(".family-card", (node) => node.scrollIntoView());
  await page.screenshot({ path: `${screenshotDir}/e2e_families.png` });

  // "Pause" after the first checkpoint (5 s) keeps the fractures; "Run" continues: the network is that of a run with
  // no stop. FRAM on and 95 fractures: the generation takes about 16 s on the Mac, longer than the first checkpoint
  await selectExample(page, "box_west_east");
  await setFram(page, true);
  await setFractureCount(page, 95);
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
    /^Done in .*particles exited/.test(continuedStatus) && continuedCount !== undefined && continuedCount === fullRunCount,
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

  // The Log panel stays open during a run, and the settings panel too
  await page.click("#log-button");
  await runAll(page);
  const isPanelShownAfterRun = await page.$eval("#settings-panel", (node) => getComputedStyle(node).display !== "none");
  check(
    (await isLogShown()) && isPanelShownAfterRun,
    "computer: a run keeps the panels",
    `log ${await isLogShown()}, settings ${isPanelShownAfterRun}`,
  );
  await page.click("#log-button");

  // The settings panel closes and opens again; "Reset view" puts the model in the middle of the free part
  // The columns between the settings panel (if shown) and the layer rail
  const freeColumns = () =>
    page.evaluate(() => {
      const panel = document.querySelector("#settings-panel");
      const isPanelShown = getComputedStyle(panel).display !== "none";
      return {
        first: isPanelShown ? Math.ceil(panel.getBoundingClientRect().right) : 0,
        last: Math.floor(document.querySelector(".layer-rail").getBoundingClientRect().left),
      };
    });
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
  await page.click("#panel-open");
  await page.click("#reset-camera");
  await new Promise((resolve) => setTimeout(resolve, 300));
  const panelRight = await page.$eval("#settings-panel", (node) => node.getBoundingClientRect().right);
  const centerWithPanel = await modelCenter();
  const freeCenter = (panelRight + 1400) / 2;
  check(
    centerWithoutPanel !== null &&
      Math.abs(centerWithoutPanel - 700) < 120 &&
      centerWithPanel !== null &&
      Math.abs(centerWithPanel - freeCenter) < Math.abs(centerWithPanel - 700),
    "reset view centers the model in the free part",
    `without panel ${centerWithoutPanel?.toFixed(0)}, with panel ${centerWithPanel?.toFixed(0)} (free center ${freeCenter.toFixed(0)})`,
  );

  // The gear between the layer rail and the GitHub link opens the settings dialog. Its orientation option
  // gives the angle fields of the families and user fractures, with the angles of the same planes.
  const toolbarItems = await page.$$eval("#viewer-toolbar > *", (nodes) =>
    nodes.map((node) => node.id || node.classList[node.classList.length - 1]).join(", "),
  );
  check(toolbarItems === "color-panel, layer-rail, settings-button, repository-link", "the gear before the GitHub link", toolbarItems);
  await selectExample(page, "user_fractures_stochastic");
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
