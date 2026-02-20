Leaderboard server for WHAT HAPPENED clicker

Run locally:

1. cd leaderboard-server
2. npm install
3. npm start

By default server listens on port 3000. Configure `LEADERBOARD_API_URL` in the game's `main.js` to point to `http://localhost:3000` to enable the online leaderboard.

API:
GET /leaderboard?limit=50  -> returns JSON array of top entries
POST /score { username, count } -> upserts a user's score (one entry per username)

Deployment options
Leaderboard server removed

This folder previously hosted a simple Express leaderboard server. It has
been intentionally disabled and most runtime files replaced with placeholders.
If you want to run a new leaderboard backend, integrate Firebase or your
preferred backend and remove these placeholder files.
	```bash
