# Pond Dash

A duck race name picker for classrooms, parties and events, with a Wheel of Names
that shares the same list. It runs entirely in the browser and is served from a
small Docker container. There are no accounts and no server-side data.

Enter a list of names, press start, and watch the ducks race down the river. The
winner is drawn at random before the race begins, so every name has the same
chance; the surges, fades and hazards only decide how the race looks.

## Features

- **Duck race** with 2 to 200 entrants, by name or by number
- **Wheel of Names** using the same list as the race
- **Race times** of 1, 2 or 3 minutes, or a custom time from 5 to 600 seconds
- **Pause, Continue and Clear** during a race
- **Full-screen race view** as soon as the race starts, sized for an iPad or projector
- **Race caller** banner that calls lead changes, runs from the back and the winner
- **Final stretch** mode, **photo finishes** in about one race in four, and a **podium**
- **Distance markers**, a **leader spotlight** and a live top-five leaderboard
- **River hazards and boosts** (optional): whirlpools, lily pads and fast currents
- **Saved name lists**, kept in the browser

## Requirements

- [Docker](https://docs.docker.com/get-docker/) with Docker Compose (included in Docker Desktop)

That is all you need to run the game. Node.js is only needed if you want to
change the code (see [Development](#development)).

## Installation

1. Get the code:

   ```bash
   git clone <repository-url>
   cd <repository-folder>
   ```

2. Build and start the container:

   ```bash
   docker compose up -d --build
   ```

3. Open <http://localhost:8080> in a browser.

To stop the game:

```bash
docker compose down
```

After pulling new code, run the `docker compose up -d --build` command again to
rebuild.

### Changing the port

The game is published on port 8080. To use another port, edit the left-hand
number in `docker-compose.yml`:

```yaml
ports:
  - "8080:80" # change 8080 to the port you want
```

### Running on an iPad or another device

The device must be on the same network as the computer running Docker.

1. Find the computer's network address. On a Mac:

   ```bash
   ipconfig getifaddr en0
   ```

2. On the iPad, open `http://<that-address>:8080` in Safari, for example
   `http://192.168.1.20:8080`.
3. Optional: tap **Share → Add to Home Screen**. Opening the game from the home
   screen icon hides the browser bars.

## Using the app

### 1. Set up the entrants

In the **Entrants** panel choose one of:

- **Names**: type or paste one name per line. Up to 200 are used.
- **Numbers**: enter how many ducks you want (2 to 200) and they are numbered for you.

The duck race and the wheel always use this same list.

To keep a list for later, type a name in **List name** and press **Save**. Saved
lists appear as buttons under the box: press one to load it, or the ✕ beside it
to delete it. Lists are stored in the browser you are using, so they do not
follow you to another device.

### 2. Choose the race time

Press **1 min**, **2 min** or **3 min**, or type a number of seconds in
**Custom (seconds)**. The time is how long it takes the winner to reach the
finish line.

Tick **River hazards and boosts** to add whirlpools, lily pads and fast currents
to the river.

### 3. Run the race

Press **Start race**. The race takes over the whole screen and counts down from
three.

| Control | What it does |
| --- | --- |
| **Pause** / **Continue** | Freezes and resumes the race and the clock. |
| **Clear** | Stops the race and returns to the setup page. All names are kept. |
| 🔊 | Turns sound on or off. |
| ⛶ | Switches the browser's own full-screen mode on or off. |

During the race:

- The clock counts down to the moment the winner crosses the line.
- The leaderboard shows the top five, with arrows for ducks moving up or down.
- The leader has a gold ring on the water and a gold name bubble.
- The banner along the bottom calls the race.
- Signs on the bank mark **¾ to go**, **halfway** and **¼ to go**.
- For the last 15 seconds the clock turns red and surges come more often.

### 4. Results

When the winner crosses the line the results card shows the winner, a podium
for first, second and third, and the full finishing order.

- **Race again** starts a new race with the same names.
- **Clear** returns to the setup page with the names kept.
- **Edit list** returns to the setup page and puts the cursor in the list.

The winner is never removed from the list. Edit the list yourself if you want to
take a name out.

### Wheel of Names

Press **Wheel of Names** at the top of the setup page. Press **Spin the wheel**,
or click the wheel itself. It spins for a few seconds and stops with the winner
under the pointer. Slice labels are hidden when there are more than 60 entrants;
the winner is still shown on the results card.

## Fairness

The finishing order is shuffled with the browser's cryptographic random source
before the race starts. Each duck's run is then shaped so that it reaches the
line in that order. Position in the list has no effect on the result.

In a simulation of 100,000 races with 25 entrants, every list position won
between 3.88% and 4.12% of the time, against a fair share of 4%. Short runs are
naturally streaky: over 50 races it is normal for one name to win five or six
times and for two or three names not to win at all.

## Development

Requires Node.js 22 or later.

```bash
npm install
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts a local development server with live reload. |
| `npm test` | Runs the race engine tests, including the fairness checks. |
| `npm run build` | Type-checks and builds the production files into `dist/`. |

### Project layout

| Path | Contents |
| --- | --- |
| `src/raceEngine.ts` | Draws the result and builds each duck's run. No drawing code. |
| `src/scene.ts` | Canvas drawing for the river, ducks, hazards and the wheel. |
| `src/commentary.ts` | The race caller. |
| `src/main.ts` | Page wiring, race flow, pause and clear, results. |
| `src/store.ts` | Settings and saved lists (browser local storage). |
| `src/audio.ts` | Synthesised sound effects. |
| `tests/` | Engine tests. |
| `Dockerfile`, `nginx.conf`, `docker-compose.yml` | Container build and web server. |
