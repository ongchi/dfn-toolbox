// End-to-end check of the web app in the local Chrome (headless).
// Start the dev server first (npm run dev), then:
//   node scripts/e2e.mjs [url] [screenshot folder]
// It checks the default example, runs the full workflow (network, flow,
// transport) of each example, the flow and the transport without their
// input, the choice of a predefined mesh, a new user-defined fracture, a bad
// input and a cancel; it saves screenshots.
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

/** The values of the options of "Color by" */
async function colorOptions(page) {
  return page.$$eval("#color-select option", (options) => options.map((option) => option.value));
}

/** Runs the step of a sidebar tab; returns the status text */
async function runStep(page, tab) {
  await page.click(`[data-sidebar-tab="${tab}"]`);
  await page.click("#run-button");
  await waitIdle(page);
  return statusText(page);
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

  // The page opens the default example
  await page.waitForFunction(() => document.querySelector("#form").dataset.example !== undefined);
  const startExample = await page.$eval("#example-select", (node) => node.value);
  check(startExample === "box_west_east", "default example", startExample);
  const startExampleTitle = await page.$eval("#example-select", (node) => node.selectedOptions[0].textContent);
  check(startExampleTitle === "Box west -> east", "example title", startExampleTitle);
  const startTab = await page.$eval(".sidebar-tabs .is-active", (node) => node.dataset.sidebarTab);
  check(startTab === "domain", "start on the domain tab", startTab);
  await page.screenshot({ path: `${screenshotDir}/e2e_domain.png` });

  // A color chooser for each boundary surface of the domain mesh; a new color changes the 3D view
  const surfaceNames = await page.$$eval("#boundary-surfaces:not([hidden]) .field-label", (nodes) =>
    nodes.map((node) => node.textContent).join(", "),
  );
  const canvasBefore = Buffer.from(await (await page.$("#viewer-canvas")).screenshot());
  await page.$eval("#boundary-surfaces input[type=color]", (node) => {
    node.value = "#000000";
    node.dispatchEvent(new Event("input"));
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const canvasAfter = Buffer.from(await (await page.$("#viewer-canvas")).screenshot());
  check(
    surfaceNames === "west, east" && !canvasBefore.equals(canvasAfter),
    "boundary surface colors",
    `${surfaceNames}; view ${canvasBefore.equals(canvasAfter) ? "unchanged" : "changed"}`,
  );
  await page.screenshot({ path: `${screenshotDir}/e2e_boundary_surfaces.png` });

  // The x, y, z axes in the corner: the checkbox "Axes" hides them
  await page.click("#show-axes");
  await new Promise((resolve) => setTimeout(resolve, 500));
  const canvasWithoutAxes = Buffer.from(await (await page.$("#viewer-canvas")).screenshot());
  await page.click("#show-axes");
  check(!canvasAfter.equals(canvasWithoutAxes), "axes checkbox", canvasAfter.equals(canvasWithoutAxes) ? "unchanged" : "changed");

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
    shapeReset.shape === "Box.vtu" && shapeReset.families === 1 && exampleNPoly === "50" && shapeNPoly === "100",
    "shape resets the input",
    `${shapeReset.shape}, ${shapeReset.families} family, n_poly ${exampleNPoly} → ${shapeNPoly}`,
  );
  await page.screenshot({ path: `${screenshotDir}/e2e_domain_shape.png` });
  await selectDomainSource(page, "example");
  const exampleAgain = await page.$eval("#form", (node) => node.dataset.example);
  const exampleAgainNPoly = await nPolyValue(page);
  check(
    exampleAgain === "box_west_east" && exampleAgainNPoly === "50",
    "example loads again",
    `${exampleAgain}, n_poly ${exampleAgainNPoly}`,
  );

  // The Domain and User fractures tabs have no run button; "Next" goes to the next tab
  const tabWalk = [];
  for (let step = 0; step < 2; step++) {
    const isRunHidden = await page.$eval("#run-button", (node) => node.hidden);
    await page.click("#next-button");
    const tab = await page.$eval(".sidebar-tabs .is-active", (node) => node.dataset.sidebarTab);
    tabWalk.push(`${isRunHidden ? "no run" : "run"} → ${tab}`);
  }
  check(tabWalk.join(", ") === "no run → fractures, no run → network", "next button", tabWalk.join(", "));

  // The full workflow of each example
  const examples = await page.$$eval("#example-select option", (options) =>
    options.map((option) => option.value).filter((value) => value !== ""),
  );
  for (const name of examples) {
    await page.click('[data-sidebar-tab="network"]');
    await selectExample(page, name);
    // "Next" of the DFN tab needs the fracture mesh, "Next" of the Flow tab a solved flow
    const isNextDisabled = () => page.$eval("#next-button", (node) => node.disabled);
    const isNetworkNextDisabled = await isNextDisabled();
    // The results bezel of the 3D view shows only with a result
    const isBezelShown = () => page.$eval("#results-bezel", (node) => !node.hidden);
    const isBezelShownBefore = await isBezelShown();
    const networkStatus = await runStep(page, "network");
    check(
      networkStatus.startsWith("Done") && isNetworkNextDisabled && !(await isNextDisabled()),
      `${name}: network`,
      networkStatus,
    );
    const isBezelShownAfter = await isBezelShown();
    check(!isBezelShownBefore && isBezelShownAfter, `${name}: results bezel`, `${isBezelShownBefore} → ${isBezelShownAfter}`);

    await page.click('[data-sidebar-tab="flow"]');
    const isFlowNextDisabled = await isNextDisabled();
    const flowStatus = await runStep(page, "flow");
    const isFlowNextEnabled = !(await isNextDisabled());
    const hasFlowResults = await page.$eval("#flow-results", (node) => !node.hidden);
    const isPressureShown = await page.$eval("#color-select", (node) => node.value === "point:pressure");
    check(
      flowStatus.startsWith("Done") && hasFlowResults && isPressureShown && isFlowNextDisabled && isFlowNextEnabled,
      `${name}: flow`,
      flowStatus,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.screenshot({ path: `${screenshotDir}/e2e_${name}_flow.png` });
    const hasFlowVelocity = (await colorOptions(page)).includes("cell:flow_velocity");
    check(hasFlowVelocity, `${name}: flow velocity in Color by`, String(hasFlowVelocity));
    await page.select("#color-select", "cell:flow_velocity");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.screenshot({ path: `${screenshotDir}/e2e_${name}_flow_velocity.png` });

    // The velocities of the transport: the checkbox of the Transport tab
    await page.click('[data-sidebar-tab="transport"]');
    await page.evaluate(() => {
      const checkbox = [...document.querySelectorAll("#transport-form input[type=checkbox]")].find(
        (node) => node.closest(".field")?.querySelector(".field-label")?.textContent === "Velocities",
      );
      if (!checkbox.checked) {
        checkbox.click();
      }
    });
    const transportStatus = await runStep(page, "transport");
    const hasTransportResults = await page.$eval("#transport-results", (node) => !node.hidden);
    const areTrajectoriesShown = await page.$eval("#show-trajectories", (node) => node.checked && !node.disabled);
    check(
      transportStatus.startsWith("Done") && hasTransportResults && areTrajectoriesShown,
      `${name}: transport`,
      transportStatus,
    );
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

  // Flow without a mesh and transport without a flow: a new example has no output
  await page.click('[data-sidebar-tab="network"]');
  await selectExample(page, "box_west_east");
  const noMeshStatus = await runStep(page, "flow");
  check(await isStatusError(page), "flow without a mesh", noMeshStatus);
  const noFlowStatus = await runStep(page, "transport");
  check(await isStatusError(page), "transport without a flow", noFlowStatus);

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
    return { limits, isOutsideInvalid: input.classList.contains("is-invalid") };
  });
  check(center.limits === "5 in 0 to 10" && center.isOutsideInvalid, "user fracture center in its region", center.limits);
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
  await runStep(page, "network");
  // The text of the app for the error of the library
  const badInputStatus = await statusText(page);
  check(
    (await isStatusError(page)) &&
      badInputStatus === "Family 1 (DFN tab): the domain has no region west_box. Choose another region.",
    "generate with a bad input",
    badInputStatus,
  );

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
