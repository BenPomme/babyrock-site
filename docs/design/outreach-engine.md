# The outreach engine, and the loop where Ben's feedback becomes the writer's rules

One page for whoever touches the cold email side next. The engine was built on 17 and 18 September
2026 (`b8d81a9`), the operator's own hand on 18 September (`ed895e2`), and the loop was closed on
21 September after three letters came back wrong. The spec and the tickets live in
`.scratch/outreach-ab/`.

## The pipeline, and where each piece lives

| Step | Code | What it does |
|---|---|---|
| Scout | `src/lib/agents/scout.ts` | Places discovery, one city by category, creates a Lead |
| Inspect | `src/lib/agents/inspect.ts`, `src/lib/outreach/profile.ts` | DataForSEO, 90 day profile: stars, language, answers, latencies |
| Classify | `src/lib/outreach/classify.ts` | Scenario, priority, tier fit, activity floor, trial flag |
| Assign | `src/lib/outreach/experiment.ts` | One controlled variant per lead |
| Compose | `src/lib/agents/carrier.ts` | Fills a frozen template. **No model here** |
| Review | `src/app/admin/lots/page.tsx` | The letters that have not left yet: Ben approves, sends one back to work (`Invalider` means "à retravailler"), asks for a change, or writes the letter himself. Sent and bounced ones move to Prospects |
| Rewrite | `src/lib/outreach/rewrite.ts` | The only model path: one letter, from the note, the fiche and the current text |
| Send | `src/lib/outreach/send-job.ts` | Paced, capped, bounce guarded, never automatic on a new lot |
| Readout | `src/lib/outreach/readout.ts` | Positive rate per arm, edit rate, the writer's own feedback numbers, the WhatsApp taps |
| Short link | `src/app/w/[ref]/route.ts`, `src/lib/outreach/wa-link.ts` | `app.babyrock.ai/w/BRM-XXXX` redirects to WhatsApp with the text pre-filled, and records the tap |

## What Ben can do with one letter, and what is stored

| Action | Button | Stored |
|---|---|---|
| Approve | `Valider` | `outreach_messages.feedback_rating`, status approved |
| Send back to work | `Invalider (à retravailler)` | rating 1 so the arm learns, status `rejected`, and his note is kept. The letter stays in the rework pools: `Retravailler` re-renders it, the one button sweeps it |
| Ask for a change | `Changer` | the note is the training signal: `feedback_comment`, `outreach_note`, status `change_requested` |
| Write it himself | `Modifier` | his words replace the model's on the same row, the machine's copy stays in `composed_body`, `edited_by_founder = true`. A comment typed in the same box is kept as the letter's pending instruction, so `Réécrire` applies it to **his** text |
| Correct the plan | a note that names a plan | `leads.tier_override` (+ actor and date), so the next compose does not undo his call |

The diff between `composed_body` and the approved body is the variant's edit rate. A variant Ben
edits every time is a bad variant even when it gets replies.

## What the writer learns, and when

1. **Immediately, on one letter.** The note is read by the rewrite prompt together with the fiche,
   the current letter and the lines the offer allows. A note that names a plan decides the plan.
2. **Within seconds, across every letter.** A comment is a generic instruction, so the model reads it
   with the letter it judged and decides: a rule for every letter, or a remark about that one shop
   (`generaliseOutreachFeedback`). One comment is enough. The rules live in `rosalia_rules` with
   `kind = outreach_writer`, are deduplicated against the ones already in force, and are read by every
   later rewrite, which is told they outrank its style. The WhatsApp rules are a different kind and
   never cross into an email. `RULE_THRESHOLD = 2` survives only as the deterministic fallback when
   the model is unreachable.
   One click runs the whole pass, in this order: learn the comments, apply each commented letter's own
   note, then sweep the other letters against the rules (`runCommentPass`). A letter that already
   obeys the rules is left exactly as it is, so the pass is safe to repeat.
3. **Per shop.** A plan correction sticks to the lead (`tier_override`), because a later inspect
   recomputes `tier_fit` and would otherwise bring the wrong plan back.
4. **At the next template version.** The composer fills frozen templates, so a rule never rewrites
   copy by itself. It changes the model's rewrite today and the template's next revision tomorrow,
   which is the deliberate split: templates keep the volume cheap, the model handles the exceptions.

A comment schedules an `outreach_learn` job the moment it is recorded, so learning does not wait for
the calendar, and the weekly `support_review` job runs the same pass as a safety net (plus the
Rosalía passes and the readout). The readout prints the active rules, the refusals of the week and the
number of shops Ben re-planed, and the rules are listed under the buttons in Lots.

## What is enforced, not asked for

The prompt asks for a lot. These are checked after the model answers, in `rewrite.ts`, and a letter
that breaks one is **not written**:

- **The note is applied, or the rewrite fails.** A non-empty `missing` (the model's own "I could not
  apply this") is a failure, not a footnote. Before 21 September the letter was written back as
  finished, which is how "recommend more than Lite" produced the same letter, marked composed.
- **No invented price.** Every euro figure in the letter has to exist in what the model was allowed
  to read: the fiche, the review it quotes, the approved lines, Ben's note (`priceAndPlanGuard`).
  A rewrite wrote "el plan Lite (19,99 €)" while Lite is 9,99 €.
- **A wrong price in the old letter is not shown to the model.** A figure we do not publish is copied
  straight back, which is what made Sabores fail twice: the current body is withheld and the model
  rebuilds from the facts and the note (`currentLetterForPrompt`).
- **No dearer plan than the approved one.** A Lite letter may not sell Plus or Pro, even when the
  model finds the argument good.
- **A group is proven by a corporate mailbox, never by a consumer one.** Two listings on
  `casafuster.net` are a group; two leads on `gmail.com` are two strangers. Rows of the same shop
  (same Place ID) never count as siblings either.
- **A letter that comes back identical is a failed rewrite**, not a silent success.
- **A letter that already left is never touched.** Approved, sent, rejected and opted out leads are
  skipped before any model call.
- **The rewrite never sends.** It writes a draft at status `composed`, and every send stays behind
  the send rail and Ben's approval.
- **The signature and the number.** The signature is always there, and the WhatsApp number stays in it.
- **A clickable WhatsApp link in every email.** It is the short branded one, `app.babyrock.ai/w/BRM-XXXX`
  (`waShortLink`), never the raw `wa.me` URL with its percent-encoded text and phone number: that one
  looked horrible in the letters (Ben, 21 Sep 2026). It sits on its own line, above the signature.
  `/w/<ref>` looks the lead up by its ref and 302s to WhatsApp with the message pre-filled, so the
  shop's reply lands on the right lead, and it writes an `outreach_events` row of type `wa_click`, which
  the readout counts. An email with no ref (lifecycle, billing, plan changes) carries the generic `/w`.
  A link the model invented is removed (`enforceHouseRules`). The rule holds for the other mail streams
  too, because it is applied at the one send funnel (`withWhatsappLink` in `zoho-mail.ts`). A letter
  written before the short link, so still holding a raw `wa.me` URL, is upgraded there on the way out.

A failed rewrite leaves the letter untouched, puts the lead back in `change_requested` so it stays in
the operator's list, and records why: `outreach_messages.rewrite_failed_at` and
`meta.rewrite_error`. The Lots panel prints the reason under the letter, and the weekly readout
counts the refusals.

## The operator's loop, in four steps

1. In **Lots**, open a letter and click **Demander un changement** with a sentence in your own words.
   Say the plan when the plan is wrong ("le plan est LITE, pas plus").
   You can also write the letter yourself with **Modifier**: your text is the letter, and a comment
   typed in the same box is applied to it by the next rewrite. An edit and a comment are two
   signals, never a contradiction.
2. Click **Appliquer mes commentaires (n commentée(s) + m autre(s))**. One pass, in order: your
   comments become rules, the commented letters get their own note, the other letters are swept
   against the rules. `Retravailler` is the other tool: it re-renders from the template and
   deliberately leaves the letters you wrote yourself alone.
3. Read the job line and the rows: `ok`, `échec`, and the reason for each refusal. Nothing has left.
4. Re-read the rewritten letters and **Valider**, **Invalider** or **Changer** again. The note is
   cleared after a successful rewrite, so a second click does not pay twice for the same letter.

## Scripts and checks

| Command | What it is for |
|---|---|
| `npx tsx --env-file=.env scripts/reclassify-leads.ts` | Re-tag leads whose stored diagnosis predates the current classifier. Dry run, `--apply` to write, no provider call |
| `npx tsx --env-file=.env scripts/rewrite-outreach-leads.ts <leadId>` | Re-run the note-driven rewrite for one letter from the terminal, for a letter written before a fix. `--all-with-notes` for every annotated letter. Never sends |
| `npx tsx --env-file=.env scripts/recompose-outreach-leads.ts <leadId>` | Re-render one letter from its template and the current rules, like the `Retravailler` button. For a letter an older rule left wrong. Never sends |
| `npx tsx --env-file=.env scripts/outreach-learn.ts` | Run the writer's learning pass by hand (dry run, `--apply` to write). For a comment left before the immediate job existed |
| `npx tsx --env-file=.env scripts/check-learning.ts` | Both learning halves: what was captured and what became a rule |
| `npx tsx --env-file=.env scripts/learn-from-feedback.ts` | Run the learning pass by hand |
| `npx tsx --env-file=.env scripts/check-outreach.ts` | The compose path end to end |
| `./scripts/prelaunch.sh` | Unit tests, simulations, money path, production build |

Tests that pin this loop: `src/lib/outreach/rewrite.test.ts` (the note names the plan, the learned
rules travel with the prompt, an invented price or a dearer plan is refused, a negated plan is not a
choice), `src/lib/outreach/reclassify.test.ts` (a stale tier is re-tagged from the stored profile and
Ben's override still wins), `src/lib/outreach/learn.test.ts` (the two-correction threshold and the
edit rate), `src/lib/outreach/readout.test.ts` (the arms and the writer block).

## Known limits

### Email replies are drafted, never sent by Rosalía (21 September 2026)

Ben: "i want to control and check her proposals before send". The switch is
`INBOUND_AUTOREPLY=off` in `/opt/babyrock/.env` (read by `emailAutoReplyGate`, one line, no deploy).
With it off, an inbound email still gets a proposal from Rosalía, stored as a draft on the thread and
visible in `/admin/inbox`, but nothing leaves until Ben presses **Envoyer l'email**. Regenerate with
**Régénérer**. WhatsApp is untouched: only the email channel passes through that gate.

Turn it back on by setting `INBOUND_AUTOREPLY=on` and recreating the app container, or by leaving it
off: nothing in the product depends on Rosalía answering email without a human. Three replies went out
unreviewed on 21 September 2026 before this switch was flipped: Goiko was a polite no that got a
payment link, Healthy Poke was an invoicing autoresponder, Bar El Rancho's autoresponder ended in
"SE RUEGA NO CONTACTAR PARA OFRECER NINGÚN TIPO DE SERVICIO".

- A rule changes copy through the rewrite, and through the next template revision. There is no
  automatic template rewriting.
- A rewrite costs one model call per annotated letter. Ten notes, ten calls.
- If a note is wrong, the letter stays as it was and the reason is on the row: the loop prefers a
  visible refusal to a plausible invention.
- The guard reads euro amounts and plan names. A wrong claim with no number in it (a promise, a
  shortcut in the argument) still needs Ben's eye, which is why every letter stays a draft.
- The classifier is only honest on the day it runs: after a rule change, run `reclassify-leads.ts`.
  It judges each stored profile **as of its own inspection date**, so a bad review that simply aged
  does not downgrade a shop behind Ben's back, and it skips leads the activity floor excludes.
