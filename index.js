const puppeteer = require("puppeteer");
const fs = require("fs");
const { time } = require("console");

const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
const LOGIN_INPUT = "#pc-login-password";
const LOGIN_BUTTON = "#pc-login-btn";
const ALERT_CONTAINER = "#alert-container";
const CONFIRM_YES = "#confirm-yes";
const ADVANCED_BUTTON = "#advanced";
const SMS_BUTTON = '#menuTree li.ml1 a[url="lteSmsInbox.htm"]';
const INBOX_BUTTON = '#menuTree li.ml2 a[url="lteSmsInbox.htm"]';
const INBOX_BODY = "#tableSmsInboxBody";
const EDIT_LAST_SMS_BUTTON =
  "#tableSmsInboxBody tr:first-child .edit-modify-icon";
const PHONE_NUMBER = "#phoneNumber";
const MESSAGE_CONTENT = "#msgContent";
const REPLY_BUTTON = "#reply";
const REPLY_TEXT_INPUT = "#inputContent";
const SEND_BUTTON = "#send";
const LOGOUT_BUTTON = "#topLogout";
const LOGOUT_CONFIRM = "#alert-container button.btn-msg-ok";

function validateConfig(config) {
  const requiredFields = [
    "routerUrl",
    "username",
    "password",
    "providerNumber",
    "providerSmsText",
    "replySmsText",
    "frequency_minutes",
  ];

  for (const field of requiredFields) {
    if (!(field in config)) {
      throw new Error(`Config file is missing required field: ${field}`);
    }
  }

  if (
    typeof config.frequency_minutes !== "number" ||
    config.frequency_minutes <= 0
  ) {
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

      const hasClass = await page.$eval(
        selector,
        (el, targetClass) => el.classList.contains(targetClass),
        targetClass
      );

      if (hasClass) {
        return true; // Class found, operation successful
      } else {
        console.warn(
          `Class "${targetClass}" not found after click. Retrying...`
        );
        retries++;
      }
    } catch (error) {
      console.error(`Error during click or class check: ${error}`);
      retries++;
    }
  }
  return false; // Max retries reached, class not found
}

async function waitForElementOrNull(
  page,
  selector,
  timeout = 20000,
  ignoreErrors = false
) {
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
        console.error(
          `Error waiting for element: ${selector}`,
          waitForSelectorError
        );
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

async function automateSms() {
  const browser = await puppeteer.launch({ headless: true });

  const page = await browser.newPage();

  try {
    // 1. Go to routerUrl
    await page.goto(config.routerUrl);

    // 2. Input password
    await page.type(LOGIN_INPUT, config.password);

    // 3. Click login button
    await page.click(LOGIN_BUTTON);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const alertContainer = await waitForElementOrNull(
      page,
      ALERT_CONTAINER,
      1000,
      true
    );

    if (alertContainer) {
      await clickElement(page, CONFIRM_YES);
    }

    // 4. Click on "Advanced"
    const advanced = await clickAndCheckClass(
      page,
      ADVANCED_BUTTON,
      "selected"
    );

    if (!advanced) {
      console.error("Failed to go to advanced.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 5. Click on "SMS"
    const smsSelected = await clickAndCheckClass(page, SMS_BUTTON, "clicked");
    if (!smsSelected) {
      console.error("Failed to go to select sms");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 6. Click on "Inbox"
    await clickElement(page, INBOX_BUTTON);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 7. Wait for messages to load
    await waitForElementOrNull(page, INBOX_BODY);

    // 8. Click on the first message's edit icon
    const firstRowEditButton = await waitForElementOrNull(
      page,
      EDIT_LAST_SMS_BUTTON
    );

    if (firstRowEditButton) {
      await firstRowEditButton.click();
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // 9. Check number and content
      await waitForElementOrNull(page, PHONE_NUMBER);
      await waitForElementOrNull(page, MESSAGE_CONTENT);
      const phoneNumber = await page.$eval(PHONE_NUMBER, (el) =>
        el.textContent.trim()
      );
      const messageContent = await page.$eval(MESSAGE_CONTENT, (el) =>
        el.textContent.trim()
      );

      if (
        phoneNumber === config.providerNumber &&
        messageContent.includes(config.providerSmsText)
      ) {
        // 10. Click Reply
        await clickElement(page, REPLY_BUTTON);
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // 11. Input reply text
        await waitForElementOrNull(page, REPLY_TEXT_INPUT);
        await page.type(REPLY_TEXT_INPUT, config.replySmsText);

        // 12. Click Send
        await clickElement(page, SEND_BUTTON);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        console.log("SMS successfully sent to provider");
      } else {
        console.log("no need to send SMS to provider");
      }
    } else {
      console.log("No messages in inbox");
    }

    // 13. Logout
    await clickElement(page, LOGOUT_BUTTON);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await clickElement(page, LOGOUT_CONFIRM);

    //14. Wait a few seconds.
    await new Promise((resolve) => setTimeout(resolve, 3000));
  } catch (error) {
    console.error("Automation error:", error);
    try {
      await clickElement(page, LOGOUT_BUTTON);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await clickElement(page, LOGOUT_CONFIRM);
    } catch (logoutError) {
      console.error("Logout failed:", logoutError);
    }
  } finally {
    await browser.close();
  }
}

try {
  const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
  validateConfig(config);

  automateSms();
  setInterval(automateSms, config.frequency_minutes * 60 * 1000);
} catch (error) {
  console.error("Error:", error.message);
}
