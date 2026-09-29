# Rosalía, the conversation

One page for whoever works on her next. Ben, 16 Sep 2026: "rebuild something strong, trained, that
can learn, that you and I will test deeply, so that Rosalía feels like a human. This is true for both
customers and hunters."

## Who writes what

Two paths, and only two:

- **The model holds the conversation** for anything conversational. `src/lib/rosalia/decide.ts`
  decides the facts, the phase and the next step; `writeConversationReply` writes the words from the
  facts and the thread. Used for shops and, since the same date, for hunters.
- **The scripts keep what costs money or trust**: an opt-out, a cancellation, a refused access, a
  declined card, an IBAN, the age gate, a hunter code. Those turns are still decided by the scripts,
  then `rephraseScriptedReply` says them in her voice. The script is also the fallback when the model
  is unreachable.

## What is enforced, not asked for

The prompt asks for a lot; these are checked on every reply, in the written and in the rewritten path,
and a reply that breaks one is rewritten (`rewriteProblem`, `inspect`):

- no price that is not in the facts, no invented plan or discount;
- the language of the message (`src/lib/language.ts`), one word from another language is refused;
- the register: vous / usted / vostè with a shop, tu / tú with a hunter;
- at most one question, no question she already asked;
- no promise of a delay, no claim that the shop validates everything;
- no corporate phrase ("n'hésitez pas", "no dude en");
- complete sentences, and a long reply is kept only when the shorter attempt fails.

A rule Ben writes in the rehearsal outranks her style, and the checkable ones (no question in the
first message) are enforced like a price.

## How she learns

- **Immediately**: a rating and a comment on a reply are stored on the draft; `recentCorrections`
  puts Ben's words into the next prompt.
- **Durably**: the same correction twice becomes a rule (`learn-feedback.ts`), kept in
  `rosalia_rules`, read by `correctionsForPrompt`. The same lesson reworded does not create a second
  rule.
- **From the operator's edits**: drafts rewritten before publishing are compared and become rules for
  the review-drafting prompt (`draftRules`).
- The weekly `support_review` job runs the oversight report and both learning passes. It only runs
  because a ticker now claims it (`src/instrumentation.node.ts`): before 16 Sep 2026 it was enqueued
  and never executed.

## How to test her

- In the app: `/admin/rosalia/talk`, three modes (commerçant, démarchage, chasseur), one reserved
  number each. Nothing is sent; everything stays a draft. Rate every reply.
- `/admin/rosalia` shows the turns, the cost, the rules she learned and Ben's last comments.
- From a terminal, on a test database: `scripts/rosalia-eval.ts` (31 scenarios),
  `scripts/rosalia-quality.ts` (long conversations and the numbers), `scripts/check-learning.ts`
  (both halves of the learning), `scripts/check-rehearsal.ts`, `scripts/check-outreach.ts`.
- The pre-launch gate runs the unit tests, the eval, the simulations, the provider-outage check and
  the production build: `./scripts/prelaunch.sh`.

### Proving the production path without messaging anyone

The rehearsals call the pipeline directly, which leaves the HTTP edge untested. A signed webhook can
be posted to `https://app.babyrock.ai/api/webhooks/whatsapp` from inside the app container, where the
app secret and the phone id are already in the environment. Two rules: sign the exact body with
`WHATSAPP_APP_SECRET`, and write **from `34600000001`**, which is in the code's `SKIP_AUTO` list, so
the answer is drafted and never sent. Then watch `provider_events.state` go to `processed` and read
the draft in `inbox_messages`. Delete the thread, the messages, the job and the provider event
afterwards. Done once, 16 Sep 2026: accepted, processed, drafted in French, nothing sent.

## Known limits, on purpose

- **Voice notes and photos are not understood.** She says so and asks for text. Reading them needs a
  transcription API and a budget nobody approved.
- **Two messages in a row get two answers.** Merging them risks swallowing a message; the second
  answer sees the first one in the history.
- **A pending step can be nudged again** in different words, after the identical repeat is removed.
- **The rehearsal numbers are the only threads that keep drafts.** A real shop reads sent messages
  only.
