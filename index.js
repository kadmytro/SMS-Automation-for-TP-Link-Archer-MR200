const puppeteer = require("puppeteer");
const https = require("https");
const fs = require("fs");
const { time } = require("console");

const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
const LOGIN_INPUT = "#pc-login-password";
const LOGIN_BUTTON = "#pc-login-btn";
const ALERT_CONTAINER = "#alert-container";
const CONFIRM_YES = "#confirm-yes";
const ADVANCED_BUTTON = "#advanced";
const SMS_BUTTON = '#menuTree li.ml1 a[url="lteSmsInbox.htm"]';
const NEW_MESSAGE_BUTTON = '#menuTree li.ml2 a[url="lteSmsNewMsg.htm"]';
const PHONE_NUMBER_INPUT = "#toNumber";
const REBOOT_BUTTON = "#topReboot";
const MESSAGE_INPUT = "#inputContent";
const SEND_BUTTON = "#send";
const LOGOUT_BUTTON = "#topLogout";
const ALERT_CONFIRM = "#alert-container button.btn-msg-ok";
const TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 3;
const HEADLESS = true;
const netState = {
  throttled: false,
  smsAttempts: 0,
  locked: false,
};

// ================= HELPER FUNCTIONS =================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getBrowser() {
  //  // for Raspberry Pi (ARM)
  // const browser = await puppeteer.launch({
  //   headless: true,
  //   executablePath: "/usr/bin/chromium",
  // });

  const browser = await puppeteer.launch({ headless: HEADLESS });

  return browser;
}

function validateConfig(config) {
  const requiredFields = [
    "routerUrl",
    "username",
    "password",
    "providerNumber",
    "smsText",
    "frequency_minutes",
    "speed_threshold_MBps",
    "speed_endpoints",
  ];

  for (const field of requiredFields) {
    if (!(field in config)) {
      throw new Error(`Config file is missing required field: ${field}`);
    }
  }

  // frequency
  if (typeof config.frequency_minutes !== "number" || config.frequency_minutes <= 0) {
    throw new Error("frequency_minutes must be a positive number");
  }

  // threshold
  if (typeof config.speed_threshold_MBps !== "number" || config.speed_threshold_MBps <= 0) {
    throw new Error("speed_threshold_MBps must be a positive number");
  }

  // endpoints
  if (!Array.isArray(config.speed_endpoints)) {
    throw new Error("speed_endpoints must be an array");
  }

  if (config.speed_endpoints.length === 0) {
    throw new Error("speed_endpoints must contain at least one endpoint");
  }

  for (const url of config.speed_endpoints) {
    if (typeof url !== "string") {
      throw new Error("All speed_endpoints must be strings");
    }

    if (!url.startsWith("https://")) {
      throw new Error(`Endpoint must use HTTPS: ${url}`);
    }

    try {
      new URL(url);
    } catch {
      throw new Error(`Invalid URL in speed_endpoints: ${url}`);
    }
  }
}

async function clickAndCheckClass(page, selector, targetClass, maxRetries = 3) {
  let retries = 0;
  const element = await waitForElementOrNull(page, selector);

  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }
  while (retries < maxRetries) {
    try {
      await element.click();
      await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for the class to be applied

      const hasClass = await page.$eval(selector, (el, targetClass) => el.classList.contains(targetClass), targetClass);

      if (hasClass) {
        return true; // Class found, operation successful
      } else {
        console.warn(`Class "${targetClass}" not found after click. Retrying...`);
        retries++;
      }
    } catch (error) {
      console.error(`Error during click or class check: ${error}`);
      retries++;
    }
  }
  return false; // Max retries reached, class not found
}

async function waitForElementOrNull(page, selector, timeout = 20000, ignoreErrors = false) {
  try {
    const element = await page.waitForSelector(selector, {
      visible: true,
      enabled: true,
      timeout: timeout,
    });
    return element; // Element found
  } catch (waitForSelectorError) {
    if (waitForSelectorError.message.includes("Waiting failed:")) {
      if (!ignoreErrors) {
        console.warn(`Element not found within timeout: ${selector}`);
      }
      return null; // Element not found within timeout
    } else {
      if (!ignoreErrors) {
        console.error(`Error waiting for element: ${selector}`, waitForSelectorError);
      }
      return null; // Other error during waiting
    }
  }
}

async function clickElement(page, selector) {
  const element = await waitForElementOrNull(page, selector);

  if (element) {
    await element.click();
  } else {
    throw new Error(`Element not found: ${selector}`);
  }
}

// ================= SPEED TEST =================

async function checkInternetUsable() {
  for (const url of config.speed_endpoints) {
    const speed = await singleSpeedTest(url, TIMEOUT_MS);
    console.log(`Endpoint ${url} → ${speed.toFixed(2)} MB/s`);

    if (speed >= config.speed_threshold_MBps) {
      return true; // internet usable
    }

    await sleep(10000);
  }

  return false; // all endpoints slow/unusable
}

function singleSpeedTest(url, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve) => {
    const start = Date.now();
    let bytes = 0;
    let finished = false;

    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      res.on("data", (chunk) => (bytes += chunk.length));

      res.on("end", () => {
        if (finished) return;
        finished = true;

        const duration = (Date.now() - start) / 1000;
        if (duration <= 0) return resolve(0);

        const speedMBps = bytes / 1024 / 1024 / duration;
        resolve(speedMBps);
      });
    });

    req.on("timeout", () => {
      req.destroy();
      if (!finished) resolve(0);
    });

    req.on("error", () => {
      if (!finished) resolve(0);
    });
  });
}

// ================= LOGIN =================
async function login(page) {
  // 1. Go to routerUrl
  await page.goto(config.routerUrl);

  // 2. Input password
  await page.type(LOGIN_INPUT, config.password);

  // 3. Click login button
  await page.click(LOGIN_BUTTON);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const alertContainer = await waitForElementOrNull(page, ALERT_CONTAINER, 1000, true);

  if (alertContainer) {
    await clickElement(page, CONFIRM_YES);
  }
}

// ================= LOGOUT =================
async function logout(page) {
  await clickElement(page, LOGOUT_BUTTON);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await clickElement(page, ALERT_CONFIRM);

  // Wait a few seconds.
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

// ================= REBOOT FUNCTION =================
async function rebootRouter() {
  const browser = await getBrowser();

  const page = await browser.newPage();
  let errorMessage = null;
  try {
    // 1. Login
    await login(page);

    // 2. Reboot router
    await clickElement(page, REBOOT_BUTTON);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await clickElement(page, ALERT_CONFIRM);

    // 3. Wait some time .
    await new Promise((resolve) => setTimeout(resolve, 120000));

    await logout(page);
  } catch (error) {
    errorMessage = error;
    console.error("Reboot error:", error);
    try {
      await logout(page);
    } catch (logoutError) {
      console.error("Logout failed:", logoutError);
    }
  } finally {
    await browser.close();
    return errorMessage;
  }
}

// ================= MAIN =================

async function daemonLoop() {
  while (true) {
    try {
      await connectionDaemon();
    } catch (err) {
      console.error("Daemon error:", err);
    }

    // wait AFTER completion
    await sleep(config.frequency_minutes * 60 * 1000);
  }
}

async function connectionDaemon() {
  console.log("Running connection check...");

  const usable = await checkInternetUsable();

  // ===========================
  // INTERNET OK
  // ===========================
  if (usable) {
    if (netState.throttled) {
      console.log("Internet restored → resetting state");
    }

    netState.throttled = false;
    netState.smsAttempts = 0;
    netState.locked = false;
    return;
  }

  // ===========================
  // INTERNET UNUSABLE
  // ===========================
  console.log("Internet unusable (likely throttled)");

  // If already locked → do nothing, just monitor
  if (netState.locked) {
    console.log("State locked → monitoring only");
    return;
  }

  netState.throttled = true;

  // Safety limit
  if (netState.smsAttempts >= MAX_ATTEMPTS) {
    console.log("Max SMS attempts reached → locking state until internet returns");
    netState.locked = true;
    return;
  }

  // Try recovery
  console.log("Sending SMS to provider...");
  await sendSmsToProvider();
  netState.smsAttempts++;

  console.log("Waiting for ISP processing...");
  await sleep(90000); // 90s

  // Recheck
  const recovered = await checkInternetUsable();

  if (recovered) {
    console.log("Internet restored by SMS");
    netState.throttled = false;
    netState.smsAttempts = 0;
    netState.locked = false;
    return;
  }

  // Not recovered
  console.log("Still unusable");

  // Optional reboot attempt only if not locked
  if (netState.smsAttempts < 3) {
    console.log("Rebooting router...");
    await rebootRouter();
  }
}

async function sendSmsToProvider() {
  const browser = await getBrowser();

  const page = await browser.newPage();
  let errorMessage = null;

  try {
    // 1. Login
    await login(page);

    // 2. Click on "Advanced"
    const advanced = await clickAndCheckClass(page, ADVANCED_BUTTON, "selected");

    if (!advanced) {
      errorMessage = "Failed to go to advanced.";
      console.error(errorMessage);
      return errorMessage;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 3. Click on "SMS"
    const smsSelected = await clickAndCheckClass(page, SMS_BUTTON, "clicked");
    if (!smsSelected) {
      errorMessage = "Failed to go to select sms";
      console.error(errorMessage);
      return errorMessage;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 4. Click on "New Message"
    await clickElement(page, NEW_MESSAGE_BUTTON);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 5. Input provider number
    await waitForElementOrNull(page, PHONE_NUMBER_INPUT);
    await page.type(PHONE_NUMBER_INPUT, config.providerNumber);

    // 6. Input message text
    await waitForElementOrNull(page, MESSAGE_INPUT);
    await page.type(MESSAGE_INPUT, config.smsText);

    // 7. send the sms
    await clickElement(page, SEND_BUTTON);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log("SMS successfully sent to provider");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 8. Logout
    await logout(page);
  } catch (error) {
    errorMessage = error;
    console.error("Automation error:", error);
    try {
      await logout(page);
    } catch (logoutError) {
      console.error("Logout failed:", logoutError);
    }
  } finally {
    await browser.close();
    return errorMessage;
  }
}

daemonLoop();

module.exports = {
  automateSms: login,
  logout,
  rebootRouter,
  connectionDaemon,
  sendSmsToProvider,
};
