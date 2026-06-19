# Budgeting App

A private, run-it-yourself budgeting app. It connects to your bank (through a
service called **Plaid**), pulls in your transactions, and gives you clean
spending trends, category breakdowns, merchant history, recurring-bill
detection, refunds tracking, and a net-worth view.

**Your financial data never leaves your computer.** There is no cloud account,
no server, no login. Everything is stored in a single database file on your own
machine (`data/budgeting.db`). When you stop the app, nothing about you is
online.

---

## What you need before you start

1. **A Mac** (these instructions are tailored for Mac).
2. **Node.js version 22 or newer** — this is the engine that runs the app.
   Download the "LTS" version from <https://nodejs.org> and install it like any normal app (just keep clicking "Next").
3. **Git** — this is the tool that downloads updates for you.
   Open your Terminal (press `Cmd+Space`, type "Terminal", press Enter) and type `git --version`. If a popup appears asking you to install "Command Line Tools", click **Install** and wait for it to finish. If it just prints a version number, you're already good to go!
4. **A free Plaid account** — this is the service that securely talks to your bank. We'll get the keys in Step 2.

You do **not** need to know how to code. You'll just copy and paste a few commands into a Terminal window. 
*(To open your Terminal: press `Cmd+Space`, type "Terminal", and press Enter).*

## If you get stuck on any of the steps, you can always reach out to me or your favorite AI assistant for help.
---
## Step 1 — Get the code and run the app
You have two options to download the app. We highly recommend **Path 1** because the app will automatically update itself with new features every time you turn it on. 

### Path 1: Able to get app updates (Recommended)
This path downloads the app to your Desktop and connects it to GitHub so it can update silently.

1. Open your **Terminal**.
2. Copy the entire block of code below, paste it into your Terminal, and press Enter:
   ```bash
   cd ~/Desktop
   git clone https://github.com/bshpringer/spending-app.git
   cd spending-app
   npm run spending
   ```
3. The app will automatically download and install everything it needs. 
4. The terminal will then pause and ask you for your Plaid `client_id` and `secret`. Follow the prompts to create your free Plaid account, paste the keys into the terminal, and hit Enter.
5. The terminal will automatically save your keys and boot the app! Open **http://localhost:3000** in your browser to start spending.

---

### Path 2: Not able to get app updates (Simpler)
If you just want to download the app as a normal ZIP file without using git, use this path. You will not receive any future updates unless you manually download a new ZIP.

1. Click the green **`<> Code`** button at the top of this page, then click **Download ZIP**.
2. Find the downloaded `.zip` in your Downloads folder and double-click it to unzip. Move that folder to your Desktop.
3. Open your **Terminal**.
4. Type `cd ` (the letters c, d, and a space), then **drag the unzipped folder from your desktop onto the terminal window** — it pastes the path for you — and press Enter. 
5. Finally, copy and paste this command and press Enter:
   ```bash
   npm run spending
   ```
6. The app will automatically install everything it needs. 
7. The terminal will then pause and ask you for your Plaid `client_id` and `secret`. Follow the prompts to create your free Plaid account, paste the keys into the terminal, and hit Enter.
8. The terminal will automatically save your keys and boot the app! Open **http://localhost:3000** in your browser to start spending.

---

### Starting the app in the future
No matter which path you chose, anytime you want to use the app in the future:
1. Open Terminal.
2. Type `cd ~/Desktop/spending-app` (if you moved the folder somewhere else, drag and drop the folder into the terminal like in Path 2).
3. Type `npm run spending` and press Enter.
*(If you used Path 1, it will automatically check for updates before starting!)*

### Sandbox vs. production

- By default, the app starts in **Sandbox Mode**. This uses Plaid's *fake* test banks — perfect for trying the app without connecting anything real. When the app asks you to log into a bank, use username **`user_good`** and password **`pass_good`**.
- To switch to **Production** (real banks), you will need to open the `.env.local` file in the app folder using any text editor. 
  1. Change `PLAID_ENV=sandbox` to `PLAID_ENV=production`.
  2. **Important:** Plaid uses a completely different secret for Production! You must delete your sandbox secret from `PLAID_SECRET=` and replace it with your **Production** secret from the Plaid dashboard.

> **Important:** every time you edit `.env.local`, stop the app (`Ctrl+C` in the
> terminal) and run `npm run spending` again. The app only reads those settings when
> it starts up.

---

## Using the app

- **Connect a bank:** go to **Settings → Plaid Import** and click to link a
  bank. After linking, hit **Sync** to pull in transactions, then review and
  commit them.
- **Dashboard:** your spending pace this month and your net worth over time.
- **Trends / Categories / Merchants:** slice your spending however you like.
- **Recurring:** automatically detected subscriptions and bills.
- **Refunds / Duplicates:** pair refunds with their charges, and catch
  accidental double-entries.

The first time you open the app it creates a single **Household** profile and
puts everything there. If you want to split spending (say, personal vs. a shared
household), add more profiles under **Settings → Profiles**.

---

## Your data & privacy

- Everything lives in `data/budgeting.db` on your computer. That file is
  **ignored by git** and never uploaded.
- Your Plaid keys live in `.env.local`, which is also **never uploaded**.
- The app is not deployed anywhere and has no backend of its own.

If you ever want to start fresh, just delete the `data/` folder — the app will
recreate an empty database next time it starts.

---

## For the curious (optional)

- **Tech:** Next.js + React + TypeScript, with a local SQLite database
  (`better-sqlite3`). No cloud services.
- **Tests:** `npm test` runs the test suite.
- **CSV import & cross-source reconciliation** exist in the code but are hidden
  by default (this build is Plaid-first). If you have a Rocket Money CSV export
  you'd like to import, you can re-enable the "Imports" menu item in
  `src/components/SettingsMenu.tsx`.
- **Customizing the default profile/user:** see `src/lib/constants.ts`.
