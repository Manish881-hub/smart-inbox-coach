# Smart Inbox Coach
**AI-assisted Email Triage System for Small Teams**

> Built for the SA Intellect Solutions 120-minute take-home assignment.

---

## The problem
Small service teams burn hours each week deciding *which email matters*, *why it matters*, and *what to say back*. Smart Inbox Coach reduces that to a single click.

## What it does
Paste any email → get:
- **Priority** (High / Medium / Low)
- **Intent** (support, sales, payment, meeting, complaint, general inquiry)
- **Risk level** (refund / cancellation / legal escalation)
- **Sentiment** (Positive / Neutral / Negative)
- **Confidence score** with a visible breakdown across all intents
- **Reason signals** — every keyword that drove the verdict, with its weight
- **Suggested SLA** based on a priority × risk matrix
- **Suggested next action**
- **Draft reply** in three tones (Professional / Empathetic / Concise)
- *(Optional)* **Refine with AI** — polish the draft using Gemini

---

## Why this design (the decision-making the brief asks about)

The assignment explicitly says *"we care more about your reasoning than model sophistication."* So I made three deliberate choices:

### 1. Deterministic classification, generative polish
I **separated** "business-critical decisions" from "language generation":
- **Classification** (priority, intent, risk) → rule-based, **explainable**, debuggable, zero cost, zero latency.
- **Tone refinement** (the reply) → LLM, because that's where creativity actually helps.

This is the opposite of the "wrap-everything-in-an-LLM" approach most candidates take. It's also how real production triage systems are built.

### 2. Weighted lexicons, not naive keyword counting
The basic version of this idea counts keywords equally. Mine assigns **per-phrase weights** — `"lawsuit" = 5`, `"help" = 1` — because a single legal-threat word should outrank ten generic words. Scores are then **softmax-normalized** across intents so confidence behaves like a probability distribution.

### 3. Explainability as a first-class feature
Every verdict shows:
- which exact phrases fired,
- their weight,
- the normalized score breakdown for *every* intent,
- the urgency and risk sub-scores.

If the system is wrong, the user can see *why* in one glance. That's what makes rule-based AI trustworthy in production.

---

## Architecture

```
          ┌──────────────────────────┐
Email →   │  Tokenizer & normalizer  │
          └──────────────┬───────────┘
                         │
       ┌─────────────────┼─────────────────┐
       ▼                 ▼                 ▼
  Intent engine    Urgency engine     Risk engine
  (weighted)       (weighted)         (weighted)
       │                 │                 │
       └────────┬────────┴────────┬────────┘
                ▼                 ▼
         Softmax normalize   SLA matrix
                │                 │
                ▼                 ▼
         Confidence + reasoning   Next action
                │
                ▼
         Template reply (tone-aware)
                │
                ▼ (optional)
         Gemini polish (LLM)
```

---

## Tech stack
- **HTML + Tailwind (CDN)** — zero build step, runs in any browser.
- **Vanilla JavaScript** — no framework, no `npm install`, no surprises in 120 minutes.
- **Gemini 1.5 Flash** *(optional)* — only called when the user clicks "Refine with AI".

> I considered Vite + React. Rejected it: a build pipeline adds zero user value here and consumes ~30 of the 120 minutes. Vanilla JS keeps the focus on *reasoning*, which is what the brief asks for.

---

## How to run

1. Download/clone the folder.
2. Double-click `index.html`. That's it.
3. *(Optional)* Click **⚙️ AI Settings** and paste a Gemini API key to enable the "Refine with AI" button. The key is stored in your browser's localStorage — never sent anywhere except Google's API.

---

## Demo script (for the interview)

1. Click **"Load sample → Angry customer / refund"**, then **Analyze**.
   - Show: High priority, complaint intent, High risk, escalation action.
   - Open the **"Why this verdict"** card and walk through the firing signals.
2. Switch tone from Professional → Empathetic. Show the reply re-generates instantly.
3. Click **"Refine with AI"** to show the LLM polish layer.
4. Load the **Sales** sample — show how the same engine reaches a completely different verdict.
5. Open the **score breakdown** card to show that the engine considered every category, not just the winner.

---

## Future improvements (and why I didn't build them today)
- **Embeddings + nearest-neighbour retrieval** over a past-reply corpus → would let the system *reuse* good real replies. Skipped: needs a corpus and a vector store; out of scope for 120 minutes.
- **Fine-tuned classifier** (DistilBERT) → higher accuracy on edge cases. Skipped: opaque, slow to debug, overkill for a baseline.
- **Inbox connector** (Gmail/IMAP) → make it a real product. Skipped: auth + OAuth eats the time budget.
- **Analytics dashboard** for response-time trends per intent.

The honest engineering position: ship the rule engine first, measure where it fails, *then* add ML to the specific failure modes. That's the order real teams should follow.

---

## File layout
```
smart-inbox-coach/
├── index.html      # UI shell
├── style.css       # Cards, badges, bars
├── script.js       # Rule engine + LLM polish + history
└── README.md
```

## One-line pitch
> *"I built a focused, explainable email-triage workflow. Classification is deterministic so the team can trust it; the LLM only shows up where creativity actually matters — rewriting the reply."*
