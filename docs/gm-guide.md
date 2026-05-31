# GM Guide: Running a Campaign in 1000 WORDS Card Manager

This guide is for the GM using the deployed app with players. It is lighter than the README and focuses on campaign operation: setup, inviting players, AI character creation, and table review.

## What The App Does

The app is a shared character manager for 1000 WORDS.

- Players build and maintain characters, tiles, stats, vitals, rolls, and journal entries.
- Signed-in players can save characters to the cloud and assign them to a campaign.
- GMs can create campaign rooms, invite players, view campaign characters read-only, review recent rolls, and provide campaign context for the character creation AI.
- The AI helps players talk through backstory scenes. It does not create final canon automatically; players accept summaries, and the table still approves tile choices.

## One-Time Technical Setup

Someone with project/admin access needs to do these once before real play:

- Deploy the project on Vercel.
- Configure Supabase and run `supabase/schema.sql`.
- Enable email magic links in Supabase Auth.
- Add the Vercel environment variables listed in the README.
- Grant your GM account campaign-creator access with the SQL snippet in the README.

After that, day-to-day campaign work happens inside the app.

## Campaign Setup Flow

1. Sign in with your GM email.
2. Create a campaign from the cloud/campaign panel.
3. Copy the invite code shown next to the campaign name.
4. Send the invite code to players.
5. Ask each player to sign in, join the campaign, create or upload their character, and assign that character to the campaign.

Players own their characters. As GM, you can view campaign characters, but the app intentionally keeps them read-only from the GM side.

## Adding Campaign AI Context

In the campaign panel, select the campaign under **Manage members**. If you are a GM for that campaign, the **Campaign AI notes** area appears.

Use these fields to give the character creation AI enough context to stay aligned with your campaign:

- **Scenario seed:** The campaign premise, starting situation, tone, important factions, locations, themes, safety boundaries, and anything all players can know.
- **GM guidance:** What the AI should emphasize or avoid when asking questions. This can include the kind of backstory hooks you want, how hard to push consequences, and what not to reveal.
- **Campaign notes:** Short setting notes, faction briefs, locations, scenario outlines, or `.txt` / `.md` uploads.

Keep notes concise. A few clear pages of text are better than a large lore dump. The AI is best at using direct guidance like:

```text
Ask each character for one personal tie to the city, one faction they distrust, and one mistake they made before the campaign begins.

Do not reveal the true patron behind the Glass Choir. It is fine to hint that the Choir has political backing.
```

The app does not send the entire campaign packet to every AI call. It sends a compact campaign brief, your GM guidance, and a few focused note snippets that look relevant to the current scene. This keeps costs lower and usually gives the AI a clearer starting point. If human testing shows the AI needs more context, expand the scenario seed, add sharper summaries, or add more targeted notes before increasing the amount of context sent per call.

## Player AI Character Creation

Once a player's cloud character is assigned to the campaign, they see the **Character Creation AI** panel.

The player can:

- Start a guided chat scene.
- Answer the AI's questions in their own words.
- Edit one of their earlier responses if they change their mind.
- Cancel a scene without saving it.
- Finalize a scene into a summary.
- Accept the summary into their character journal.

Editing a player response rewinds later AI replies and any pending summary for that scene. This keeps the scene from preserving consequences based on an answer the player no longer wants.

## GM Review Process

Treat AI output as a structured first draft, not automatic canon.

Recommended flow:

1. Players use the AI to draft one scene at a time.
2. Players accept summaries they like into their character journal.
3. You review accepted journal entries and optional tile ideas during session zero or between sessions.
4. If a proposed detail conflicts with your campaign, ask the player to revise the journal entry or run another scene.
5. If tile ideas are useful, the player creates the actual tile manually and you approve its colors, dice, tags, and XP cost.

The AI may suggest possible Skill, Gear, Trait, or Story tiles, but it does not create mechanical tiles automatically. That is intentional: tile mechanics should remain table-approved.

## During Play

Useful GM-side tools:

- **Campaign characters:** View player characters in read-only mode.
- **Recent campaign rolls:** Review non-test cloud rolls, including call colors, called tiles, totals, and haywire status.
- **GM reviewed:** Players can check this on a sheet after table approval to quiet advisory rules-review notes.
- **Test roll:** Players should turn this on for practice, setup checks, or AI/browser testing. Test rolls do not enter campaign roll history.

## Practical Boundaries

- The app is not a virtual tabletop. It manages characters, rolls, notes, and creation support.
- The AI is a facilitator, not a rules authority or replacement GM.
- Campaign AI notes should avoid secrets that would spoil the campaign if surfaced indirectly. Use GM guidance to say what the AI must not reveal.
- PDF/DOCX campaign document extraction is not part of the current MVP. Paste text or upload small `.txt` / `.md` notes.
- Google Docs export is not part of the current MVP. Accepted AI summaries live in Supabase and can be appended to the character journal.

## Troubleshooting

- **A player cannot see AI creation:** Confirm they are signed in, joined to the campaign, and their active cloud character is assigned to that campaign.
- **A GM cannot create campaigns:** Confirm the GM account has been added to `campaign_creators` in Supabase.
- **Campaign AI notes do not appear:** Confirm the selected campaign is one where the account has the GM role.
- **AI gives generic answers:** Add clearer scenario seed, GM guidance, or campaign notes.
- **AI reveals or invents too much:** Add explicit GM guidance about boundaries, secrets, and what must remain unknown.
- **A scene went the wrong direction:** The player can edit their previous response or cancel the scene and start over.
