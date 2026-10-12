# Event scheduler

The page lives at `/meet/`. A Cloudflare Worker stores events and responses in
D1. The rest of the Jekyll website and its publishing configuration are unchanged.
Development does not require a Cloudflare account or deployment.

## Run locally

Requires Node.js 22 or newer and npm. Node.js 24 LTS is recommended.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:8788/meet/` and choose **Create profile** to register a new
username and password. You are signed in automatically and start with an empty
event list. Choose **Create new event** to organize your first poll.

The existing local `guiye` profile remains available using the credentials printed
in the terminal. It owns events created before profile registration was added.
On the first run, development generates a local account named `guiye` with a random
password. This development login is kept in ignored `scheduler/.dev.login.json` so
you can recover it. The page is served at
`http://127.0.0.1:8788/meet/`, with the Worker on port 8787. The development command
applies local database migrations and generates `scheduler/.dev.vars` on its first
run. This ignored file contains the organizer username, password salt, and password
hash. Local events are
stored in the ignored `scheduler/.wrangler/` directory and survive server restarts.
Stop both servers with Ctrl+C.

To change the original local bootstrap profile's credentials, run:

```sh
npm run organizer:setup
```

Enter the username, then the password twice. Password input is hidden. The setup
command stores only the password salt and hash and removes the generated demo
password file. Restart `npm run dev` afterward. Changing credentials invalidates
that profile's previous sessions without deleting events or responses. This command
affects only the original bootstrap profile. Registered profiles are stored in D1;
profile editing and password recovery are not part of this version.

The landing page gives organizers entrances to create a profile, create events,
and manage existing events. Guests open the invitation link directly in their
browser. Organizer access stays signed in in the
current tab across navigation and reloads. **Sign out** revokes the current server
session; closing the tab removes its browser session. Server sessions expire after
seven days, at which point you sign in again. Events do not expire. The event list
is private to the signed-in profile. Signup is open: anyone can create a profile,
but each profile can list and manage only its own events. Invitations remain
readable to anyone with the event link, and participants can respond without a
registered profile.

The dashboard shows event titles, candidate-date bounds, cell counts and durations, and saved
response counts. **Copy event link** copies an ordinary participant invitation;
**Manage event** opens organizer controls without placing the organizer credential
in the event URL. **Scheduling home** returns to the dashboard. Newly created events
provide a participation link; use your organizer account to manage them.

**Manage event** also exposes **Delete event** to the owning profile. A confirmation
dialog names the event and explains that its candidate times, participants,
responses, and participant sessions will be permanently removed. **Keep event**
or Escape cancels without deleting anything. Confirming deletion returns to your
event dashboard, and both the short and original invitation links stop working.
The API checks ownership; participants and other organizers cannot delete the
event. There is no undo or trash in this version.

- **Participation link:** share this with your guests.
- Invitations use `/meet/?e=` followed by a stable 12-character event code.
  Existing `/meet/?event=<uuid>` links still work and open the same event. Short
  links preserve participant sessions and organizer access; editing an event does
  not change its code.
- Event editing requires signing in to the owning profile. Older private creation
  and event-admin links no longer grant access by themselves. Existing events are
  assigned to the original bootstrap profile during migration.

Participants enter a name and an optional password, choose **Start / edit
response**, choose **Available**, **Not available**, or **Clear answer**, mark
individual cells, and choose **Save availability**. Returning with the
same name reopens that response. Names are unique within each event and matched
without regard to capitalization or surrounding spaces. There are no participant
editing links. The same browser remembers its session when storage is available.

If a name has no password, anyone entering that name can edit its response. If a
password was set when that name was first created, returning participants must
enter it. Passwords are stored as salted PBKDF2 hashes; they are never returned by
the API or stored in browser storage. Password changes and password recovery are
not part of this version. **Change name** returns to the name/password form.

The page loads no external scripts or analytics. Public responses never contain
credentials or another profile's private event list.

## Editing candidate times

The owning profile's **Manage event** action exposes **Edit candidate times**.
Choose up to 31 dates, adjust the
daily hour window, or toggle individual candidate cells. The summary shows how
many minutes will be kept, added, or removed before saving.

Answers for identical time ranges are preserved. Deleted times and
their answers are removed. New times stay unanswered until each participant
explicitly marks and saves them. Readding a
previously deleted time creates a fresh unanswered slot. No event automatically
expires, and there is no scheduled cleanup.

Times are stored as exact UTC intervals. Each person can choose a
display timezone; changing the display does not move any slot. The event timezone
is chosen at creation and then fixed. Spring-forward gaps are skipped, repeated
fall-back times are distinguished, and nonexistent window boundaries are rejected.

**Time per cell** is an event property chosen by the organizer: 15, 30, or 60
minutes. Every stored cell has that duration, and all participants use the same
cells. Participants can change only their display timezone. Existing events
receive a 15-minute default without changing their cells or saved answers.
Organizers can change the interval in **Edit candidate times**. Smaller cells
inherit the saved answer covering that time. Larger cells inherit an answer only
when their entire range is covered by matching saved answers; conflicts, gaps,
and partly unanswered ranges stay unanswered. This applies to both available
and not available answers. The editor preserves offered times where a whole new
cell fits, and shows kept, added, and removed minutes before saving.
For 15-minute cells, the grid shows time labels every 30 minutes.
Daily windows must fit whole cells; adjust **From** or **Until** if necessary.

Your grid uses green **✓ Available**, rose **× Not available**, and striped purple
**? Not answered yet** cells. Unanswered means no saved answer exists for that
time; not available means an explicit negative answer. Choose a marking tool,
then tap, drag, or press Space on a cell to apply it. **Clear answer** restores
that cell to unanswered. Group cells count people available for that time;
selecting one shows available, not available, and unanswered names. A group **?**
means nobody has answered that cell; **0** means answers exist but nobody is
available.

Saving preserves three states: available, not available, and unanswered. Untouched
cells stay unanswered. Cleared cells have no saved answer, and existing explicit
answers remain until changed or cleared. Earlier saved negative answers remain
negative after migration; participants can clear them explicitly. If the organizer changes the event while someone is editing,
the old submission is rejected without changing existing answers. Choose
**Refresh availability**, review the current grid, and save again.

## Verify locally

```sh
npm run typecheck
npm test
git diff --check
```

The API tests start a real local Worker with an isolated temporary D1 database on
port 8797. They do not use the development database, contact a deployed Worker, or
deploy resources. Tests cover open signup, duplicate usernames, password validation,
cross-profile isolation, login, sign-out, expiry, separate login/signup attempt
limits, profile-specific listing and management, optional
passwords, returning by name, permission checks, unchanged and deleted slots,
partial responses, clearing answers, event intervals, splitting and merging answers,
short links and compatibility with old invitations,
owner-only deletion and removal of associated responses and sessions,
stale submissions, concurrent edits, duplicate retries,
conditional refreshes, timezone conversion, and daylight-saving boundaries.

To build the complete existing website with a compatible Ruby/Bundler installation:

```sh
bundle install
bundle exec jekyll build
```

Jekyll emits `meet/index.html` with its standalone layout and copies the local
JavaScript, CSS, and vendored Luxon assets. Backend code, tests, and development
scripts are excluded from the published site.

## Connect Cloudflare when ready

These steps are manual; local development does not execute them.

1. Sign in to a Cloudflare account on the Workers Free plan:

   ```sh
   npx wrangler login
   npx wrangler d1 create guiye-scheduler --config scheduler/wrangler.jsonc
   ```

2. Replace the all-zero `database_id` in `scheduler/wrangler.jsonc` with the ID
   returned by the database creation command. Keep the binding name `DB` and
   database name `guiye-scheduler`.

3. Apply the schema to the remote database:

   ```sh
   npx wrangler d1 migrations apply guiye-scheduler --remote --config scheduler/wrangler.jsonc
   ```

4. For a fresh production database, organizer credentials do not need to be
   configured in advance: create your profile through the website after deploying.
   If you are upgrading a database with events from the earlier single-organizer
   version, configure the original bootstrap profile to retain their ownership:

   ```sh
   npm run organizer:secrets
   npx wrangler secret bulk scheduler/.organizer-secrets.json --config scheduler/wrangler.jsonc
   ```

   This interactive command generates an ignored JSON file containing
   `ORGANIZER_USERNAME`, `ORGANIZER_PASSWORD_SALT`, and `ORGANIZER_PASSWORD_HASH`.
   It never saves the plaintext password. Keep this file private. Choose your
   bootstrap credentials yourself; the generated local account is for development.
   These settings seed only the original profile and do not replace public signup.

5. Deploy the Worker:

   ```sh
   npx wrangler deploy --config scheduler/wrangler.jsonc
   ```

6. Put the deployed HTTPS Worker URL in `meet/config.js` as `API_BASE_URL`, without
   a trailing slash. This URL is public; it is not a secret. Production requests
   use the configured `https://liguiye.github.io` origin. The development origin
   exception is enabled only by `npm run dev`, not by the deployment configuration.
   Localhost always uses the local `/api` proxy, even after this production URL is
   configured.

7. Commit and push the website changes yourself. Open
   `https://liguiye.github.io/meet/`, choose **Create new event** or **Existing
   events**, then sign in or choose **Create profile**. The implementation
   is on the local `codex/event-scheduler` branch; merge it into the site's `main`
   branch when you want GitHub Pages to publish it.

   In the repository's **Settings → Pages**, use **Deploy from a branch**, choose
   **main** and **/(root)**, and save. The scheduler files live in `meet/` and are
   included by Jekyll; the Worker, local database, and secrets are excluded. Wait
   for the Pages deployment to finish, then create a profile and an event at
   `https://liguiye.github.io/meet/`. Open the copied invitation in a private
   browser window and submit a test response to verify the full public flow.

Check the deployed Worker's `/health` URL before publishing the frontend; it should
return `{"ok":true}`. `meet/config.js` must contain the HTTPS Worker root URL, not
the local `/api` address and not a URL ending in `/health`.

Local demo events are not uploaded to production. The production database starts
empty. Export the database when you want a separate backup:

```sh
npx wrangler d1 export guiye-scheduler --remote --config scheduler/wrangler.jsonc --output /path/to/private-backup.sql
```

Cloudflare's Free plan has daily request and database-operation limits. Unchanged
30-second refreshes check only the event revision, and polling stops while the
tab is hidden. Events themselves have no time limit. See the current official
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

Luxon 3.7.2 is vendored under `meet/vendor/` with its MIT license so the scheduler
does not need a CDN or a JavaScript build step for GitHub Pages.
