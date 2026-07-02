# Troubleshooting

Symptoms → causes → fixes, roughly in the order people hit them.

## Discovery: "Nothing on the network"

The scanner sends an SSDP multicast and waits ~4 seconds.

1. **Wake the TV.** A Frame in standby often won't answer SSDP. Turn it on
   (art mode counts), then *Search again*.
2. **Same network, really?** The computer and TV must be on the same
   subnet. Guest Wi-Fi, VLANs, and "AP/client isolation" on mesh routers
   all silently block multicast between devices.
3. **VPN on the computer?** Many VPN clients capture multicast. Pause the
   VPN while scanning.
4. **Still nothing:** enter the IP manually. On the TV:
   Settings → General → Network → Network Status. Consider a DHCP
   reservation in your router so the address never changes.

Found the TV but it isn't flagged as a Frame? Frame detection matches
"LS03" in the model name. Manual entry works regardless.

## Pairing: no prompt appears on the TV

The allow/deny prompt only appears the first time FrameForge connects.

- Make sure the TV is on and you're watching it — the prompt is easy to
  miss and times out.
- If you previously denied it, the TV remembers. On the TV:
  Settings → General → External Device Manager → Device Connection Manager
  → Device List, delete/allow "FrameForge", then retry.
- If pairing worked before and suddenly every request fails, the token may
  be stale (TV was factory-reset, or you switched TVs): click **Forget TV**
  on the TV screen (or delete `<library>/.frameforge_token`) and pair
  again.

## "TV unreachable — showing the last known state"

The On-the-TV panel couldn't reach the TV.

- TV fully powered off (not art mode / standby)? Turn it on.
- TV got a new IP from DHCP? Re-run *Find your TV* from onboarding, or fix
  the address with a DHCP reservation.
- The saved host is in `<library>/settings.json`; the `FRAMEFORGE_TV_HOST`
  env var overrides it — if you set that once in `.env` and the TV moved,
  update or remove it there.

## Art vanished from the TV

- **The cap.** FrameForge keeps at most 80 uploads on the TV (the Frame
  holds ~100; headroom is deliberate). Every push prunes the *oldest*
  uploads past the cap. If you push 30-image themes three times, the first
  batch starts rotating out.
- Deleting art with the TV remote or SmartThings also removes it — the
  On-the-TV panel reflects that on the next refresh.
- Local files are never deleted by any TV operation. Re-upload anytime.

## TV shows an HDMI input instead of art

2024 Frames sometimes fail to return to Art Mode after an HDMI source
turns off. This is a TV firmware quirk; FrameForge ships a double
power-toggle workaround (`force_art_mode`). If the TV is stuck, one press
of the power button on the remote gets you back to art.

## Generation fails / "Error: see Settings" in the status chip

- `XAI_API_KEY not set` — copy `.env.example` to `.env`, add the key,
  restart `frameforged`.
- 401/403 from xAI — key revoked or out of credits; check
  [console.x.ai](https://console.x.ai).
- Rate limits — big batches are generated concurrently with retries; if a
  batch dies partway, regenerate — already-saved images are kept per-file.

## Phone can't reach the server

- The server binds to `127.0.0.1` **by default** — the phone can't see it
  until you set `FRAMEFORGE_BIND_HOST=0.0.0.0` in `.env` and restart.
- Use the computer's LAN IP (`ipconfig getifaddr en0` on macOS), plain
  `http://`, port `8765`.
- macOS will ask to allow incoming connections for Python the first time —
  accept it (System Settings → Network → Firewall if you missed it).
- Phone and computer must be on the same Wi-Fi (again: guest networks and
  client isolation break this).

## 401 "Invalid or missing API token"

The server was started with `FRAMEFORGE_API_TOKEN` set. Open the UI once
as `http://<host>:8765/?token=<the-token>` — it's stored by the browser
after that — or paste it into the prompt the UI shows on a 401. Cleared
your browser storage? Same fix. (`/api/health` is intentionally open and
reports `"auth_required": true` so clients can tell.)

## Uploads are slow

Normal: images are converted to high-quality JPEG and pushed over the
TV's websocket at roughly a second or two each, sequentially — the Frame
does not like parallel uploads. A 30-image push takes about a minute.

## Where state lives (for surgical resets)

| File                              | What                         | Safe to delete?                              |
|-----------------------------------|------------------------------|----------------------------------------------|
| `<library>/settings.json`         | TV host saved by onboarding  | Yes — re-run onboarding                      |
| `<library>/.frameforge_token`     | TV pairing token             | Yes — you'll re-pair on next contact         |
| `<library>/themes.db`             | Which uploads are on the TV  | Yes — the next TV-screen refresh rebuilds what it can; unmatched art shows as "outside FrameForge" |
| `<library>/<slug>/`               | The images + provenance      | It's your art — delete only what you mean to |

`<library>` is `~/Pictures/FrameForge` unless you set `FRAMEFORGE_LIBRARY`.

## `frameforge doctor`

`frameforge doctor` (add `--read-only` to skip the upload/show/delete
steps) runs the full connection lifecycle against a real Frame and prints
one line per step. Findings from validating it against a real 2024 Frame
(`QN43LS03DAFXZA`) on the local network:

- **Discovery is fast and reliable.** `frameforge find` returned the TV
  in well under the 4s default timeout — no changes needed to
  `discover.py`'s SSDP logic or timeout for a 2024 Frame on a normal
  home network.
- **First contact needs a human at the TV.** If
  `<library>/.frameforge_token` doesn't exist yet, the very first
  `connect + status` call makes the TV pop an Allow/Deny prompt on
  screen. Nobody has to click *within FrameForge* — the *TV itself* owns
  a timeout for that dialog. If nobody answers the remote in time, the
  TV closes the channel and sends back a bare
  `{'event': 'ms.channel.timeOut'}`, which surfaces as:

  ```
  ✗ connect + status — {'event': 'ms.channel.timeOut'}
  ```

  This is not a bug in `tv_client.py` — no token file is written, and
  retrying immediately just re-arms the same on-TV prompt (and re-times
  out the same way if nobody's there). **Don't loop `frameforge doctor`
  unattended hoping it'll eventually connect** — it won't, until someone
  is at the TV to accept the prompt once. After that one accept, the
  token is cached in `<library>/.frameforge_token` and every later
  `doctor` run connects with no prompt.
- Because `connect + status` gates every later step (`doctor.py` returns
  early on that failure), an unattended first run can only ever validate
  `resolve host` — `list art`, `fetch thumbnail`, and the mutating
  upload/show/delete steps never execute until pairing has happened at
  least once with a human present.

### Sample transcript — first run, unattended (pairing not yet accepted)

```
$ frameforge doctor --read-only
FrameForge doctor — checking the TV connection lifecycle:
  ✓ resolve host — 192.168.1.253
  ✗ connect + status — {'event': 'ms.channel.timeOut'}

1 step(s) failed.
```

### Sample transcript — after pairing has been accepted once (expected, per the step sequence in `doctor.py`)

```
$ frameforge doctor
FrameForge doctor — checking the TV connection lifecycle:
  ✓ resolve host — 192.168.1.253
  ✓ connect + status — art_mode=on
  ✓ list art — 12 piece(s) on the TV
  ✓ fetch thumbnail — 8421 bytes
  ✓ upload test card — MY_F0123...
  ✓ show test card
  ✓ delete test card

All steps passed.
```

Not yet independently confirmed end-to-end in this environment — validate
this second transcript for real once someone is at the TV to accept the
one-time pairing prompt, then remove this caveat.

## Still stuck?

Run the server in the foreground (`frameforged`) and watch the log while
reproducing; TV-side errors are printed there. The
[WIRING.md](WIRING.md) contract lets you poke any endpoint directly with
`curl` to narrow down UI vs. server vs. TV.
