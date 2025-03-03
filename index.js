const puppeteer = require("puppeteer");
const fs = require("fs");

const config = JSON.parse(fs.readFileSync("config.json", "utf8"));

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

async function automateSms() {
  const browser = await puppeteer.launch({ headless: false });

  const page = await browser.newPage();

  try {
    // 1. Go to 192.168.1.1
    await page.goto(config.routerUrl);

    // 2. Input password
    await page.type("#pc-login-password", config.password);

    // 3. Click login button
    await page.click("#pc-login-btn");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const alertContainer = await page.$("#alert-container");
    if (alertContainer) {
      const confirmButton = await page.$("#confirm-yes");
      if (confirmButton) {
        await confirmButton.click();
        await page.waitForSelector("#ul-nav", { timeout: 10000 });
      } else {
        console.error("Confirm button not found in alert dialog.");
      }
    } else {
      await page.waitForSelector("#ul-nav", { timeout: 10000 });
    }

    // 4. Click on "Advanced"
    await page.click("#advanced .T_adv.text");

    // 5. Wait a few seconds
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 6. Click on "Inbox"
    await page.click('#menuTree li.ml1 a[url="lteSmsInbox.htm"]');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await page.click('#menuTree li.ml2 a[url="lteSmsInbox.htm"]');
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 7. Wait for messages to load
    await page.waitForSelector("#tableSmsInboxBody");

    // 8. Click on the first message's edit icon
    const firstRowEditButton = await page.$(
      "#tableSmsInboxBody tr:first-child .edit-modify-icon"
    );

    if (firstRowEditButton) {
      await firstRowEditButton.click();
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // 9. Check number and content
      const phoneNumber = await page.$eval("#phoneNumber", (el) =>
        el.textContent.trim()
      );
      const messageContent = await page.$eval("#msgContent", (el) =>
        el.textContent.trim()
      );

      if (
        phoneNumber === config.providerNumber &&
        messageContent.includes(config.providerSmsText)
      ) {
        // 10. Click Reply
        await page.click("#reply");
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // 11. Input reply text
        await page.type("#inputContent", config.replySmsText);

        // 12. Click Send
        await page.click("#send");
        await new Promise((resolve) => setTimeout(resolve, 3000));
        console.log("SMS successfully sent to provider");
      } else {
        console.log("no need to send SMS to provider");
      }
    } else {
      console.log("No messages in inbox");
    }

    // 13. Logout
    await page.click("#topLogout");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await page.click("#alert-container button.btn-msg-ok");

    //14. Wait a few seconds.
    await new Promise((resolve) => setTimeout(resolve, 3000));
  } catch (error) {
    console.error("Automation error:", error);
    try {
      await page.click("#topLogout");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await page.click(".btn-msg-ok");
      await new Promise((resolve) => setTimeout(resolve, 3000));
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
