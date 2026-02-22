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
const HEADLESS = true;

let testInterval = null;
let intervalPaused = false;

function pauseInterval() {
  if (testInterval) {
    clearInterval(testInterval);
    testInterval = null;
    intervalPaused = true;
  }
}

function resumeInterval() {
  if (!testInterval && intervalPaused) {
    testInterval = setInterval(connectionDaemon, config.frequency_minutes * 60 * 1000);
    intervalPaused = false;
  }
}

// ================= HELPER FUNCTIONS =================

function validateConfig(config) {
  const requiredFields = [
    "routerUrl",
    "username",
    "password",
    "providerNumber",
    "smsText",
    "frequency_minutes",
    "speed_threshold_MBps",
    "speed_test_url",
  ];

  for (const field of requiredFields) {
    if (!(field in config)) {
      throw new Error(`Config file is missing required field: ${field}`);
    }
  }

  if (typeof config.frequency_minutes !== "number" || config.frequency_minutes <= 0) {
    throw new Error("Frequency must be a positive number.");
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
function testSpeed() {
  return new Promise((resolve) => {
    const start = Date.now();
    let bytes = 0;

    https
      .get(config.speed_test_url, { timeout: TIMEOUT_MS }, (res) => {
        res.on("data", (chunk) => (bytes += chunk.length));
        res.on("end", () => {
          const duration = (Date.now() - start) / 1000;
          const speedMBps = bytes / 1024 / 1024 / duration;
          resolve(speedMBps);
        });
      })
      .on("error", () => resolve(0));
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
  const browser = await puppeteer.launch({ headless: HEADLESS });

  const page = await browser.newPage();
  let errorMessage = null;
  try {
    // 1. Login
    await login(page);

    // 2. Reboot router
    await clickElement(page, REBOOT_BUTTON);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await clickElement(page, ALERT_CONFIRM);

    // 3. Wait a minute .
    await new Promise((resolve) => setTimeout(resolve, 90_000));

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
async function connectionDaemon() {
  console.log("Running connection check...");

  // 1) Test speed
  const speed = await testSpeed();
  console.log(`Speed: ${speed.toFixed(2)} MB/s`);

  if (speed >= config.speed_threshold_MBps) {
    console.log("Connection OK\n");
    return;
  }

  console.log("Throttling detected");

  // 2) Send sms to provbider
  await sendSmsToProvider();

  console.log("Waiting for ISP processing...");
  await new Promise((resolve) => setTimeout(resolve, 90_000));

  // 4) Re-test speed
  const newSpeed = await testSpeed();
  console.log(`New speed: ${newSpeed.toFixed(2)} MB/s`);

  // 4) Reboot if needed
  if (newSpeed < config.speed_threshold_MBps) {
    console.log("Still throttled → rebooting router");
    await rebootRouter();
  } else {
    console.log("Connection restored by SMS");
  }
}

async function sendSmsToProvider() {
  const browser = await puppeteer.launch({ headless: HEADLESS });

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
    await page.type(MESSAGE_INPUT, config.replySmsText);

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

async function start() {
  try {
    const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
    validateConfig(config);

    if (require.main === module) {
      validateConfig(config);
      await connectionDaemon();
      testInterval = setInterval(connectionDaemon, config.frequency_minutes * 60 * 1000);
    }
  } catch (error) {
    console.error("Error:", error.message);
  }
}

start();

module.exports = {
  automateSms: login,
  logout,
  rebootRouter,
  connectionDaemon,
  sendSmsToProvider,
  pauseInterval,
  resumeInterval,
};