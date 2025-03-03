const puppeteer = require("puppeteer");
const fs = require("fs");

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
  while (retries < maxRetries) {
    try {
      await page.click(selector);
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
    const alertContainer = await page.$(ALERT_CONTAINER, { timeout: 20000 });
    if (alertContainer) {
      const confirmButton = await page.$(CONFIRM_YES);
      if (confirmButton) {
        await confirmButton.click();
      } else {
        console.error("Confirm button not found in alert dialog.");
      }
    }

    // 4. Click on "Advanced"
    await page.waitForSelector(ADVANCED_BUTTON, { timeout: 20000 });
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
    await page.waitForSelector(SMS_BUTTON, { timeout: 20000 });
    const smsSelected = await clickAndCheckClass(page, SMS_BUTTON, "clicked");
    if (!smsSelected) {
      console.error("Failed to go to select sms");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 6. Click on "Inbox"
    await page.waitForSelector(INBOX_BUTTON, { timeout: 20000 });
    await page.click(INBOX_BUTTON);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 7. Wait for messages to load
    await page.waitForSelector(INBOX_BODY, { timeout: 20000 });

    // 8. Click on the first message's edit icon
    await page.waitForSelector(EDIT_LAST_SMS_BUTTON, { timeout: 20000 });
    const firstRowEditButton = await page.$(EDIT_LAST_SMS_BUTTON);

    if (firstRowEditButton) {
      await firstRowEditButton.click();
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // 9. Check number and content
      await page.waitForSelector(PHONE_NUMBER, { timeout: 20000 });
      await page.waitForSelector(MESSAGE_CONTENT, { timeout: 20000 });
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
        await page.waitForSelector(REPLY_BUTTON, { timeout: 20000 });
        await page.click(REPLY_BUTTON);
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // 11. Input reply text
        await page.waitForSelector(REPLY_TEXT_INPUT, { timeout: 20000 });
        await page.type(REPLY_TEXT_INPUT, config.replySmsText);

        // 12. Click Send

        await page.waitForSelector(SEND_BUTTON, { timeout: 20000 });
        await page.click(SEND_BUTTON);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        console.log("SMS successfully sent to provider");
      } else {
        console.log("no need to send SMS to provider");
      }
    } else {
      console.log("No messages in inbox");
    }

    // 13. Logout
    await page.waitForSelector(LOGOUT_BUTTON, { timeout: 20000 });
    await page.click(LOGOUT_BUTTON);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await page.waitForSelector(LOGOUT_CONFIRM, { timeout: 20000 });
    await page.click(LOGOUT_CONFIRM);

    //14. Wait a few seconds.
    await new Promise((resolve) => setTimeout(resolve, 3000));
  } catch (error) {
    console.error("Automation error:", error);
    try {
      await page.waitForSelector(LOGOUT_BUTTON, { timeout: 20000 });
      await page.click(LOGOUT_BUTTON);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await page.waitForSelector(LOGOUT_CONFIRM, { timeout: 20000 });
      await page.click(LOGOUT_CONFIRM);
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
