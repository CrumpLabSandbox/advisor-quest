# 🎓 Advisor Quest

**One semester. Eight advisees. Infinite emails.**

Advisor Quest is a cozy strategy game about being an academic advisor at Quill & Ivy University. You get 12 weeks to guide eight very different students through crises, major changes, registration, and homesickness, and you have to keep your own energy up while you do it.

▶️ **Play:** `https://crumplabsandbox.github.io/advisor-quest/` (once GitHub Pages is enabled, see below)

## How it plays

- **Weekly events:** each week opens with a campus event. It might be a crashed portal, a helicopter parent (FERPA!), therapy dogs, or the Dean wanting data in a specific font.
- **Office hours:** students request appointments, but you only have a few slots. Anyone you can't see loses trust and gets more stressed.
- **Meetings:** your choices change each student's **Stress**, **Trust**, **Degree Progress**, and **GPA**. Open questions and warm referrals usually beat quick fixes. 🎲 Risky options work more often when trust is high.
- **🚨 Crises:** a student whose stress reaches 90 shows up in crisis. If you don't answer, they may withdraw.
- **Character arcs:** every advisee has their own multi-week story. Maya questions pre-med, Devon picks a major (no lighthouses), Marcus is missing a lab science, Sofia learns the hidden curriculum, and the others have theirs.
- **Minigames:**
  - **📬 Inbox Avalanche:** a timed game where you send each email to the right place: reply yourself, Counseling, Financial Aid, the Registrar, or the archive.
  - **🧩 Course Planner:** build a valid schedule around prerequisites, time conflicts, full sections, credit limits, and real-life constraints like practice, work shifts, and school pickup.
- **Perks:** spend 🎖️ kudos on things like the Espresso Machine, Campus Referral Network, Degree Audit Pro, and the Bottomless Candy Bowl.
- **The ending:** an annual performance review, a "where are they now?" epilogue for each student, 11 achievements, and three difficulty levels.

Progress saves automatically in your browser (localStorage). Keyboard: number keys `1`–`5` pick choices and inbox actions, and `Esc` closes dialogs.

## Publish it on GitHub Pages

The game is plain HTML/CSS/JavaScript, so there's no build step. Pick **one** of these:

**Option A: deploy from a branch (simplest)**
1. Merge this code into `main`.
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**, then choose `main` and `/ (root)`, and click **Save**.
4. After a minute the game is live at `https://<your-username-or-org>.github.io/advisor-quest/`.

**Option B: GitHub Actions** (the workflow is already in `.github/workflows/pages.yml`)
1. Go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Push or merge to `main`. The workflow deploys the site automatically.

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Project layout

```
index.html        page shell
css/style.css     all styling (light + dark mode, responsive)
js/data.js        students, scenes, events, emails, courses, perks, epilogues
js/game.js        game engine & rendering
```

Want to add a student or a scenario? Everything lives in `js/data.js`. Effect keys are `s` stress, `t` trust, `g` GPA, `p` progress, `e` energy, `r` reputation, `k` kudos, and `{n}` is replaced with the student's first name.
