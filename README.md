# SMS Automation for TP-Link Archer MR200

This Node.js project automates SMS sending on a TP-Link Archer MR200 router using Puppeteer. It's designed to automatically respond to SMS messages from your mobile provider (e.g., O2) to request additional data when you reach your daily limit.

## Prerequisites

- Node.js and npm installed
- TP-Link Archer MR200 router
- O2 (or similar) SIM card with SMS functionality
- Raspberry Pi (optional, for running the script continuously)

## Installation

1.  Clone the repository (or download the ZIP file and extract it).
2.  Navigate to the project directory in your terminal.
3.  Install dependencies:

    ```bash
    npm install
    ```

## Configuration

1.  **Security Note:** The `config.json` file, which contains sensitive information, is intentionally excluded from version control.
2.  Create a `config.json` file in the project root directory by copying `config.json.example` and filling in your router's and provider's details.

    ```bash
    cp config.json.example config.json
    ```

3.  Edit `config.json` and replace the placeholder values with your router's information and your provider's details.

    ```json
    {
      "routerUrl": "Your router url, by default it's http://192.168.1.1",
      "username": "your_router_username",
      "password": "your_router_password",
      "providerNumber": "your provider number",
      "providerSmsText": "text_you're_looking_for",
      "replySmsText": "text you want to send",
      "frequency_minutes": 5
    }
    ```
* `frequency_minutes`: The interval (in minutes) between script executions. Default is 5 (5 minutes).

## Usage

1.  Run the script:

    ```bash
    node index.js
    ```

2.  The script will:
    * Validate the configuration file.
    * Log in to your router's admin page.
    * Check the SMS inbox for messages from your provider.
    * If a matching message is found, it will send the configured reply SMS.
    * Log out of the router.
    * Repeat the process at the configured frequency.

## Running on Raspberry Pi (Optional)

1.  Copy the project files to your Raspberry Pi.
2.  Install Node.js and npm on your Raspberry Pi:

    ```bash
    sudo apt update
    sudo apt install nodejs npm
    ```

3.  Install Chromium and its dependencies:

    ```bash
    sudo apt install chromium-browser chromium-codecs-ffmpeg
    ```

4.  Install Puppeteer:

    ```bash
    npm install puppeteer
    ```

5.  **Modify Puppeteer Launch Options:**

    * In your `index.js` file, modify the Puppeteer launch options as follows:

        ```javascript
        const browser = await puppeteer.launch({
            headless: true,
            executablePath: '/usr/bin/chromium-browser',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        ```

        * This configures Puppeteer to use the system's Chromium browser and disables sandbox restrictions (which are often necessary on Raspberry Pi).

6.  Run the script using Node.js.

7.  **Running as a Service (Recommended):**

    * To ensure the script runs continuously and restarts automatically if it crashes, use a service manager like Systemd (Linux) or PM2 (cross-platform).

    * **Using Systemd (Linux):**

        * Create a systemd service file (e.g., `sms-automation.service`) in `/etc/systemd/system/`:

            ```ini
            [Unit]
            Description=SMS Automation Service
            After=network.target

            [Service]
            Type=simple
            User=your_username
            WorkingDirectory=/path/to/your/sms-automation
            ExecStart=/usr/bin/node index.js
            Restart=always
            Environment="DISPLAY=:0"

            [Install]
            WantedBy=multi-user.target
            ```

            * Replace `your_username` and `/path/to/your/sms-automation` with your actual values.
        * Enable and start the service:

            ```bash
            sudo systemctl enable sms-automation.service
            sudo systemctl start sms-automation.service
            ```

    * **Using PM2 (Cross-Platform):**

        * Install PM2 globally:

            ```bash
            npm install -g pm2
            ```

        * Start the script with PM2:

            ```bash
            pm2 start index.js
            ```

        * To ensure PM2 starts on system boot:

            ```bash
            pm2 startup
            pm2 save
            ```

        * PM2 will automatically restart the script if it crashes.

    * **Note:** Your script already handles the execution frequency internally. Therefore, you do not need to use cron for scheduling.
## Code Structure

- `index.js`: The main script that automates SMS sending.
- `config.json`: Configuration file for router and provider settings.
- `config.json.example`: Example configuration file.
- `.gitignore`: Specifies files and directories to ignore in Git.
- `package.json`: Node.js project dependencies.

## Error Handling and Robustness

- The script includes error handling to prevent crashes.
- It attempts to log out even if an error occurs.
- It handles the alert dialog that appears when another user is logged in.
- Selectors are stored as constants for better maintainability.
- Delays are implemented to account for varying network conditions.

## Contributing

Feel free to contribute to this project by submitting pull requests or reporting issues.

## License

This project is licensed under the MIT License.

## Notes

- This script is designed for specific router and provider configurations. You may need to modify it to suit your needs.
- Use this script at your own risk. The author is not responsible for any issues that may arise from its use.
- Always be mindful of security best practices when handling sensitive information like router passwords.
