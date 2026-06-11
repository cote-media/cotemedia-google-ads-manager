# THE ESSENCE OF LORAMER — read this every session, before anything else

This is not a spec. It is the reason the product exists, distilled 2026-06-11.
Every Claude working on LoraMer must internalize it before touching anything.

## The claim we are building toward
LoraMer must be the best, most honest, best-structured AI analysis and
recommendation platform in the world. Russ does not want to hide behind
"AI can make mistakes." The product has to earn the right not to need it.

## The two layers — and their different ceilings
LoraMer says two kinds of things, and they have different ceilings:

1. FACTS — what was spent, what converted, what changed, what is running.
   This layer CAN be engineered to essentially-always-right: deterministic
   queries over a governed schema, provenance on every figure, coverage
   checks so absence never masquerades as zero, and context fields that
   mean what the model thinks they mean. "Your numbers are right, and we
   can prove every one of them" is a claim we make flatly.

2. JUDGMENT — what to DO to grow the business. Nobody, human or machine,
   can guarantee the future. An AI that claims certainty about outcomes
   isn't the most honest platform in the world — it's the most confident.
   The honest ceiling here is calibration: near-certain vs. strong bet vs.
   worth testing, always stated.

## The promise (and the ad copy it produces)
The winning claim is not "LoraMer is always right." It is:

   "LoraMer never tells you something it can't show and PROVE to you."

   "AI chatbots can answer from vibes. LoraMer answers from your books,
    with receipts."

Every number traceable. Every recommendation with its reasoning and
evidence attached. Confidence stated honestly. This is STRONGER than
claiming infallibility, because it is checkable. Required legal language
should be framed confidently ("recommendations are grounded in your data;
decisions remain yours"), never as an apology.

## The canonical example — why structure beats vibes (2026-06-11)
Lora told Russ a real client had "$523.50/day in live budgets" against
$0 spend and urged a billing investigation. It was wrong. Root cause: the
Google fetch pulled only the on/off status toggle. Google keeps ended
campaigns toggled ENABLED forever — "Ended" is derived from end_date,
which the code never requested. Four finished campaigns entered Lora's
context labeled "active," and Lora, reasoning correctly over wrong
context, raised a confident false alarm.

THE LESSON: when Lora is confidently wrong, the model is rarely the
suspect — the CONTEXT is. AI accuracy is a structure problem. Fix the
field, kill the error class forever.

(The same day added a second lesson: the first fix attempt silently broke
the Google fetch, and Lora reported the platform as "not connected." A
swallowed error presented as a different fact is itself a lie. Failures
must be LOUD, and any adapter change must be machine-verified against the
real API before a human ever sees it.)

## The operating discipline this imposes on every Claude
- Every number Lora states must be traceable to a query and a date window.
- Absence of data is NEVER presented as zero.
- Every field fed to Lora must mean what the model will assume it means —
  audit adapter semantics (status toggles, effective vs. raw statuses,
  sampling flags) the way the Google end_date bug was found.
- Russ's question — "where is it getting this number?" — is the eval
  method. Welcome it. When a number can't be defended, that is a bug.
- Calibrated honesty in Lora's voice: state what is certain, what is
  likely, what is a test worth running. Never let Lora bluff.

If a change makes Lora more confident but not more provable, it is wrong.
