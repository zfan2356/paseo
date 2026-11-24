# desktop

Electron desktop app for Paseo.

## macOS menu bar

The desktop app shows a Paseo icon in the menu bar. Click it for a translucent
task board anchored to the icon; right-click for task shortcuts, **Show Paseo**
and **Quit Paseo**.

### Account quotas

The board shows account quotas below tasks. Accounts shared by several hosts appear once, using the latest valid reading. It reads `magpie.snapshot` through
each connected host's existing Paseo client; it does not access a local Magpie
endpoint or copy provider credentials. Hosts are queried independently every
minute, including while the final window is hidden. One failed host does not
block others. A disconnected host clears its balances until it reconnects.

Each account shows its lowest remaining quota window, with expandable window
details and reset times. Values at or below 20% are highlighted. Account names
are masked. Missing plugins, unavailable quotas and unbounded quotas have
distinct labels. Readings older than five minutes (or without a timestamp) and
reports older than two minutes are marked cached. Automatic reads use the
plugin's cache; **刷新额度** requests a fresh upstream reading. Failures retry
after ten seconds and include a reason rather than an undifferentiated unavailable label.

Account source and speed controls live in the composer toolbar alongside the
model, thinking and permission controls, not in the menu-bar board.
They follow the selected host and model: **个人优先**, **个人账号**, **ichat**,
and **默认速度 / Ultra fast**. The existing lightning control still toggles
the provider's Fast feature independently.
Ultra fast is disabled for unsupported models, ichat-only routes or an unavailable
speed middleware. Enabling it may consume personal quota faster. These settings
affect only requests routed through that host's Magpie, not arbitrary provider
connections. **登录 / 更换个人账号** opens the selected host's Magpie surface.

Composer actions invoke the remote plugin over the existing connection and update
the query cache from the reply. Changes require an explicit click; opening a menu
never changes routing. Pending, success and failure appear inside the menu.
The menu-bar board keeps only quota readings and refresh actions.

Settings → Appearance → Menu bar quota selects the account and whether the icon shows its remaining percentage, used percentage, or no quota number. Automatic selection prefers Codex. Cached readings have a `~` prefix; missing readings show `—%`.

The icon summarizes unarchived tasks across local and remote hosts:

- `▶ 2`: two tasks are running or initializing.
- `! 1`: a task needs approval or has failed; the menu gives the breakdown.
- `✓ 3`: three completed tasks have not been viewed yet.
- `?`: a host is offline or syncing, or status reports have stopped.
- `—`: no hosts are configured.
- Icon only: no active tasks or unread completions on connected hosts.

The board groups tasks into running (including approvals), completed and failed.
Each row shows its title, provider/project context or actual error, host and last
activity time. Completed means an unread completion reported by Paseo, not every
idle session. No model requests or extra host connections are used for summaries.
Click a task to open it, a count to scroll to its group, or **打开 Paseo** for the
full app. Escape or clicking outside dismisses the board. It follows system light
and dark appearance and uses macOS vibrancy with a translucent surface.

Right-click to open a task directly. The menu shows up to 12 tasks, prioritizing
approvals and errors, followed by running tasks and unread completions. Counts
include all tasks, not only the displayed rows. The board reserves up to 12 rows
per state so busy groups cannot crowd out completions and errors. **Hosts** lists connection status.
Completion reflects Paseo's task state, not verification of external jobs.

Closing the final window hides it so its existing host connections keep updating
the menu bar. Closing additional windows still closes them. Clicking the menu bar
opens the board; its **打开 Paseo** button or the Dock icon restores the window.
**Quit Paseo** and Cmd+Q follow the existing
daemon retention setting and remove the icon. Windows and Linux are unchanged.

Reports expire after 45 seconds without a renderer heartbeat. Navigation, renderer
failure and system sleep clear reports instead of showing stale success. Multiple
windows do not multiply counts. Menu titles are drawn from tasks, so task names
and error summaries are visible to anyone who can open the board or menu.
