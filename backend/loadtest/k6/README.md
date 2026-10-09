# k6 load tests

[Grafana k6](https://k6.io) versions of the burst tests in `../` (messages, room list, login, image upload, Socket.IO
connect + authenticate). `burst.js` makes `VUS` virtual users each send one request at the same moment.

Run against a **local throwaway backend only** (see `../README.md` for the local Mongo/Redis setup). Raise
`RATE_LIMIT_*_CAPACITY` on the target to measure raw capacity.

```bash
# test data, from backend/
node loadtest/seed.js 500 | tail -1 > users.json
node loadtest/seed-rooms.js users.json | tail -1 > rooms.json
node -e "require('sharp')({create:{width:256,height:256,channels:3,background:'#c33'}}).png().toFile('photo.png')"

k6 run -e SCENARIO=messages -e VUS=500 -e ROOMS=rooms.json loadtest/k6/burst.js
k6 run -e SCENARIO=rooms    -e VUS=500 -e USERS=users.json loadtest/k6/burst.js
k6 run -e SCENARIO=login    -e VUS=100 loadtest/k6/burst.js
k6 run -e SCENARIO=upload   -e VUS=50  -e USERS=users.json -e PNG=photo.png loadtest/k6/burst.js
k6 run -e SCENARIO=socket   -e VUS=500 -e USERS=users.json loadtest/k6/burst.js
```

Add `-e RATE=150 -e DURATION=15s -e VUS=800` to any scenario for a **steady arrival rate** over reusable connections
(recommended for capacity numbers: a one-shot burst of hundreds of new TCP connections can be refused by the OS before
the app sees it). For `socket`, add `-e HOLD=10` to keep each authenticated connection open for 10 seconds.

Paths given to `open()` resolve relative to the script, so use absolute paths for `USERS`, `ROOMS` and `PNG`.
Results: `docs/LOAD-TEST-RESULTS.md`.
