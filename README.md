# FACEIT CS2 Stats Tracker & Penalty Predictor

A premium, interactive, client-side dashboard designed to help CS2 players track their FACEIT matchmaking statistics, log their queue/game infractions, and predict their next cooldown duration.

This repository is pre-configured with a **GitHub Actions workflow** to automatically deploy the website to **GitHub Pages** and securely inject your FACEIT API key using **GitHub Secrets**!

---

## 🚀 Deployment Guide (GitHub Pages & Secrets)

To host your own copy of the stats tracker, follow these steps:

### Step 1: Create the Repository
1. Create a new repository on GitHub (it can be Public or Private).
2. Push or upload these files to your repository.

### Step 2: Configure the API Key Secret
Your API key is kept secure and hidden from the repository source code using GitHub Secrets:
1. In your GitHub repository, click on the **Settings** tab.
2. In the left sidebar, expand **Secrets and variables** and click **Actions**.
3. Click the green **New repository secret** button.
4. Set the **Name** to: `FACEIT_API_KEY`
5. Set the **Value** to your FACEIT API key (see instructions below on how to generate one).
6. Click **Add secret**.

### Step 3: Enable GitHub Pages Deployments
By default, GitHub Pages needs permission to be built from GitHub Actions:
1. Go to repository **Settings** -> **Pages**.
2. Under **Build and deployment** -> **Source**, select **GitHub Actions** from the dropdown menu.

### Step 4: Deploy the Site
Now, trigger the deployment:
1. Go to the **Actions** tab of your repository.
2. Click on the **Deploy to GitHub Pages** workflow on the left side.
3. Click the **Run workflow** dropdown and click the green **Run workflow** button.
4. Once completed, your public site URL will be displayed in the logs (e.g. `https://yourusername.github.io/your-repo-name/`) and will be fully automated!

---

## 🛠️ Features
* **100% Automatic**: Visitors simply type their FACEIT nickname, and the site fetches their stats. There are no logins or API keys requested in the browser.
* **Level Badges**: Displays high-fidelity level badges matching FACEIT's official colors (from Level 1 grey up to Level 10 red).
* **Penalty Predictor**: The tool dynamically calculates the duration of your next queue ban based on your rolling 30-day infraction history.
* **Ban Countdown Timer**: Ticking real-time countdown (`HH:MM:SS`) to track when your active queue bans expire.
* **Data Portability**: Export your infraction logs as a JSON file or import them back to transfer data between devices.

---

## 📖 Official FACEIT Penalty Rules Reference

### Infraction Types
* **Leaver**: Triggered if you are disconnected from a live server for a cumulative total of **more than 5 minutes** during a match. Even if you reconnect and finish the game, the penalty is applied at the end of the match.
* **noShow**: Triggered if you fail to connect to your assigned match server during the designated warm-up window (3 minutes for standard matchmaking, 10 minutes for structured platform tournaments).
* **AFK / Declined**: Triggered if you fail to click the "Accept" button when a match queue pops.

### ⚠️ The Severe Elo Penalty for Leavers
When you are flagged as a "Leaver" during a match, your Elo adjustments are heavily penalized:
* **If your team loses**: You receive **double the standard Elo deduction** (typically losing ~50 Elo instead of ~25 Elo).
* **If your team wins**: You only receive **50% of the calculated Elo gain** (typically receiving ~12 Elo instead of ~25 Elo).
* Matches where you receive a leaver penalty are also hidden from your public match history.

---

## 🔑 How to get a free FACEIT API Key
1. Go to the [FACEIT Developer Portal](https://developers.faceit.com/) and sign in with your FACEIT credentials.
2. Click **App Studio** in the top navigation bar.
3. Click **Create an App**. Set any Name (e.g. `MyStatsTracker`) and Description.
4. Go to the **API Keys** tab.
5. Generate a **Client API Key** or **Server API Key**.
6. Copy the key and use it as the value for the `FACEIT_API_KEY` secret in your GitHub repository settings.
