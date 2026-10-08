# QuizRush ⚡

A Kahoot-style live quiz game for the classroom. **Zero dependencies** — no
internet, no npm install, no accounts. It just runs.

- Students join from their phones on the **school Wi-Fi**
- You control the game from the projector / your laptop
- Live countdown, speed-based scoring, streaks, leaderboard, podium, confetti

---

## Game day: 3 steps

**1. Start the server** (double-click `start.bat`, or in a terminal):

```
npm start
```

You will see something like:

```
Host screen ....... http://10.137.133.44:4000/host
Students join ..... http://10.137.133.44:4000
```

> If Windows shows a firewall popup the first time, click **Allow** (private
> networks). Without it, phones cannot connect.

**2. Open the host screen** on the projector computer:
`http://localhost:4000/host`

**3. Tell the students** to **scan the QR code** on the projector (or type the
address on screen), enter the 6-digit PIN and their name. When they are in,
press **Start game**.

> **Wrong network?** The lobby lists every address this computer has, under
> *"Not working? Pick your network"*. Click the one your students are on and the
> QR code and the address update instantly — useful when the laptop is on a
> Windows hotspot (`192.168.137.x`) while the school Wi-Fi is something else.

---

## Host keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` / `→` | The main action of the moment (start, reveal, next…) |
| `R` | Reveal the answer now (don't wait for the timer) |
| `N` | Skip straight to the next question |
| `F` | Fullscreen (good for the projector) |

---

## How the game flows

```
Lobby → Question (timed) → Reveal (correct answer + vote split)
      → Scoreboard (top 5 + movement arrows) → next question…
      → Final podium 🏆 (confetti + full ranking)
```

The question ends by itself when the timer hits zero **or** as soon as
everybody has answered — exactly like Kahoot. You can always cut it short with
`Space` or `R`.

### Scoring

- Correct answer: **up to 1000 points**, more the faster you answer
  (≈1000 instantly, ≈500 at the last second)
- Wrong answer: **0 points** (and the streak resets)
- Streak bonus: **+100 per correct answer in a row**, up to **+500**

---

## Joining, avatars and sound

### Every player gets an animal

When a student joins they are given an **animal buddy** — 🦊 🐼 🐯 🦁 and 20
more — shown on their phone, in the lobby, on the scoreboard and on the podium.
The server hands out the least-used animal, so a class of 26 spreads across the
whole zoo instead of everyone wearing the same face. Duplicate names get a
number (`Omar`, `Omar 2`) so nobody is confused with anyone else.

### QR code

The lobby shows a QR code that opens the join page **with the PIN already
filled in**, so students only have to type a name. The code is generated in the
browser by `public/js/qr.js` — a small, self-contained encoder — so it works
with **no internet connection and nothing installed**. If the projector is on
but the network flickers, scan it anyway; only the phone needs to reach the
server.

### Music and sound

There is **background music** (relaxed in the lobby, upbeat once the quiz
starts) and musical answer cues, all synthesised live in the browser — no audio
files to lose. The 🔊 button on any screen mutes everything; the choice is
remembered on that device. Browsers block audio until the first tap, so tell
students to **tap once** when they land on the page.

---

## Changing the questions

Everything lives in one file: [`questions.json`](questions.json) — no coding.

```json
{
  "title": "Civics Review - Doors 1 & 2",
  "defaultQuestionTime": 20,
  "questions": [
    {
      "q": "What is the supreme law of the land?",
      "options": ["The Constitution", "The Declaration", "The Bill of Rights", "The Magna Carta"],
      "answer": 0
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `title` | Shown on the host screen and on every phone |
| `defaultQuestionTime` | Seconds per question (5–120) |
| `q` | The question text |
| `options` | 2 to 4 answers, in the order they appear on screen |
| `answer` | **Index of the correct answer — it counts from 0** |
| `time` | *Optional*: a custom number of seconds just for this question |

Answer order maps to the Kahoot colours: `0` red ▲, `1` blue ◆, `2` yellow ●,
`3` green ■.

After editing the file, **no restart is needed**: reload the host page, or the
change is applied automatically if the game is still in the lobby. To check
your work, use **📄 Preview questions** in the lobby — it shows every question
and marks the correct answer in green.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Students can't open the address | Same Wi-Fi? Windows firewall allowed? Then use **"Not working? Pick your network"** in the lobby to switch to another address (`10.x` / `192.168.x`), and re-scan the QR. |
| The QR code doesn't scan | Make sure the projector isn't scaling/blurring it, then use the typed address instead — both are shown together. |
| "No game found with that PIN" | The PIN is the 6 digits on the projector. A new PIN is generated every time the host page starts a fresh game. |
| A student's phone locked / browser closed | Just reopen the address — they rejoin automatically with the same name and score. |
| A student answered by accident | Nothing to undo, but their answer is locked; they cannot answer twice. |
| Wrong player joined | Hover a name in the lobby and press ✕ (or use the API) — or just "Clear players" at the end. |
| Phone sound | Tap anywhere on the page once — browsers block audio until the first tap. |

---

## For the curious: how it works

Pure Node.js, no frameworks.

- `server.js` — the whole game engine: one `game` object, HTTP API + a
  Server-Sent Events stream that pushes state to every screen.
- `public/` — the host dashboard and the phone pages.
- `questions.json` — your content.
- `public/js/qr.js` — a dependency-free QR code generator for the join link.
- `public/js/common.js` — shared helpers: the SSE client, clock sync, the icon
  set, animal avatars, the synthesised sound and the music scheduler.
- `test/e2e.js` — an automated game: 45 checks covering joining, animal
  avatars, locking, scoring, the timer, the podium and replay.

```
npm test        # runs the end-to-end game (server must be running)
```

Realtime is SSE (server → client) + tiny JSON POSTs (client → server) instead
of WebSockets, so there is **nothing to install and nothing to compile**. A
classroom of 26 phones is far below what this handles.
