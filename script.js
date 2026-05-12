/* =========================================================
   Smart Inbox Coach — script.js
   Deterministic rule engine + optional LLM polish.
   Enterprise SaaS UI/UX Edition
   ========================================================= */

/* -------------------- DOM refs -------------------- */
const $ = (id) => document.getElementById(id);
const emailInput   = $("emailInput");
const analyzeBtn   = $("analyzeBtn");
const clearBtn     = $("clearBtn");
const sampleSelect = $("sampleSelect");
const toneSelect   = $("toneSelect");
const resultsWrap  = $("resultsWrap");

/* ---- Pipeline Refs ---- */
const pipelineWrap       = $("pipelineWrap");
const pipelineStatusText = $("pipelineStatusText");
const pipelineProgress   = $("pipelineProgress");
const nodes = [
  $("node-input"), $("node-intent"), $("node-risk"), $("node-sla"), $("node-draft")
];

/* ---- Result Refs ---- */
const confidenceVal = $("confidenceVal");
const confidenceBar = $("confidenceBar");

const kpiPriority = $("kpiPriority");
const kpiRisk     = $("kpiRisk");
const kpiIntent   = $("kpiIntent");

const slaText       = $("slaText");
const sentimentText = $("sentimentText");
const actionText    = $("actionText");

const replyBadge = $("replyBadge");
const replyBox   = $("replyBox");

const signalsContainer      = $("signalsContainer");
const intentScoresContainer = $("intentScoresContainer");
const urgencyScoreText      = $("urgencyScoreText");
const riskScoreText         = $("riskScoreText");
const emailPreviewBox       = $("emailPreviewBox");

/* -------------------- Toast notifications -------------------- */
function showToast(msg, type = "info") {
  const toast = $("toast");
  toast.textContent = msg;
  toast.className = `toast toast-${type} show`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("show"), 3000);
}

/* -------------------- Settings (Gemini key) -------------------- */
const settingsBtn   = $("settingsBtn");
const settingsModal = $("settingsModal");
const apiKeyInput   = $("apiKeyInput");
const saveSettings  = $("saveSettings");
const closeSettings = $("closeSettings");

settingsBtn.onclick = () => {
  apiKeyInput.value = localStorage.getItem("gemini_key") || "";
  settingsModal.classList.remove("hidden");
};
closeSettings.onclick = () => settingsModal.classList.add("hidden");
saveSettings.onclick  = () => {
  localStorage.setItem("gemini_key", apiKeyInput.value.trim());
  settingsModal.classList.add("hidden");
  showToast("API key saved!", "success");
};

async function loadGeminiKey() {
  try {
    const res = await fetch("/.gemini.env");
    if (res.ok) {
      const text = await res.text();
      const match = text.match(/GEMINI_API_KEY=(.*)/);
      if (match) return match[1].trim();
    }
  } catch (_) { }
  return localStorage.getItem("gemini_key") || null;
}

/* -------------------- Lexicons -------------------- */
const INTENT_LEXICON = {
  support:   [["bug",3],["error",3],["not working",3],["broken",3],["issue",2],["problem",2],["crash",3],["help",1],["stuck",2],["fix",2]],
  sales:     [["pricing",3],["quote",3],["demo",3],["purchase",3],["buy",2],["plan",1],["upgrade",2],["trial",2],["interested in",2]],
  payment:   [["invoice",3],["payment",3],["billing",3],["refund",3],["charge",2],["receipt",2],["overcharged",3],["transaction",2]],
  meeting:   [["schedule",3],["meeting",3],["call",2],["zoom",2],["calendar",2],["availability",3],["reschedule",3],["appointment",2]],
  complaint: [["disappointed",3],["angry",3],["unacceptable",3],["worst",3],["terrible",3],["frustrated",3],["complain",3],["awful",2],["rude",2]],
};

const URGENCY_WORDS = [
  ["asap",4],["urgent",4],["immediately",4],["right away",4],["emergency",5],
  ["today",2],["end of day",2],["eod",2],["by tomorrow",2],["deadline",3],["soon",1],
];

const RISK_WORDS = [
  ["refund",3],["cancel",3],["chargeback",4],["lawyer",5],["legal",4],["lawsuit",5],
  ["sue",5],["consumer court",5],["escalate",3],["never again",2],["formal complaint",4],
  ["report you",3],["press charges",5],
];

const POSITIVE_WORDS = ["thanks","thank you","appreciate","great","love","awesome","glad","kindly","please"];
const NEGATIVE_WORDS = ["disappointed","angry","bad","worst","hate","terrible","awful","frustrated","unacceptable","ridiculous"];

/* -------------------- Samples -------------------- */
const SAMPLES = {
  complaint: `Subject: Refund still not processed — extremely disappointed\n\nHi team,\n\nI am extremely disappointed with your service. I requested a refund last week and still have not received any update. This is unacceptable. Please resolve this immediately or I will escalate to my bank for a chargeback.\n\n— Priya`,
  support:   `Subject: Dashboard crashes when exporting CSV\n\nHi,\n\nEvery time I try to export a CSV from the analytics dashboard the page crashes and I get a 500 error. This started yesterday. Could you please help fix this soon? It's blocking my team.\n\nThanks,\nRahul`,
  sales:     `Subject: Pricing for 50-seat plan\n\nHello,\n\nWe're evaluating your product for our 50-person ops team. Could you share pricing, a demo slot this week, and whether annual billing has a discount? Looking to decide by Friday.\n\nBest,\nAnita (Head of Ops)`,
  meeting:   `Subject: Quick call tomorrow?\n\nHi,\n\nCan we schedule a 20-minute Zoom tomorrow to align on the onboarding flow? I'm flexible after 3pm IST. Please share a calendar invite.\n\nThanks,\nKevin`,
  payment:   `Subject: Invoice INV-2034 — double charge?\n\nHi finance team,\n\nIt looks like invoice INV-2034 was charged twice on my card this month. Could you please check and refund the duplicate transaction? Receipt attached.\n\nRegards,\nMeera`,
  legal:     `Subject: Formal notice\n\nThis email serves as a formal complaint. If the refund is not processed within 48 hours, I will be forced to involve my lawyer and file a case in consumer court. Consider this your final warning.\n\n— A. Sharma`,
};

sampleSelect.onchange = () => {
  if (SAMPLES[sampleSelect.value]) {
    emailInput.value = SAMPLES[sampleSelect.value];
    showToast("Sample email loaded.", "info");
  }
  sampleSelect.value = "";
};
clearBtn.onclick = () => {
  emailInput.value = "";
  resultsWrap.classList.add("hidden");
  pipelineWrap.classList.add("hidden");
};

/* -------------------- Core engine -------------------- */

function countMatches(text, phrase) {
  const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re  = new RegExp(`(^|\\b|\\s)${esc}(\\b|\\s|$)`, "gi");
  return (text.match(re) || []).length;
}

function scoreCategory(text, lexicon) {
  let score = 0;
  const hits = [];
  for (const [phrase, weight] of lexicon) {
    const n = countMatches(text, phrase);
    if (n > 0) {
      score += n * weight;
      hits.push({ phrase, weight, count: n });
    }
  }
  return { score, hits };
}

function normalize(scores) {
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const out = {};
  for (const k in scores) out[k] = scores[k] / total;
  return out;
}

function analyze(rawText) {
  const text = (rawText || "").toLowerCase();

  const perCategory = {};
  const perCategoryHits = {};
  for (const intent in INTENT_LEXICON) {
    const { score, hits } = scoreCategory(text, INTENT_LEXICON[intent]);
    perCategory[intent] = score;
    perCategoryHits[intent] = hits;
  }

  const norm = normalize(perCategory);
  let topIntent = "general inquiry";
  let confidence = 35; 
  if (norm) {
    topIntent = Object.entries(norm).sort((a,b)=>b[1]-a[1])[0][0];
    confidence = Math.min(97, Math.round(60 + norm[topIntent] * 40));
    if (perCategory[topIntent] < 2) confidence = Math.max(45, confidence - 15);
  }

  const urgency = scoreCategory(text, URGENCY_WORDS);
  let priority = "Low";
  if (urgency.score >= 4) priority = "High";
  else if (urgency.score >= 2) priority = "Medium";

  const risk = scoreCategory(text, RISK_WORDS);
  let riskLevel = "Low";
  if (risk.score >= 5) riskLevel = "High";
  else if (risk.score >= 2) riskLevel = "Medium";

  let pos = 0, neg = 0;
  for (const w of POSITIVE_WORDS) pos += countMatches(text, w);
  for (const w of NEGATIVE_WORDS) neg += countMatches(text, w);
  const sentiment = neg > pos + 1 ? "Negative" : pos > neg + 1 ? "Positive" : "Neutral";

  if (sentiment === "Negative" && topIntent === "general inquiry") {
    topIntent = "complaint";
    confidence = Math.max(confidence, 65);
  }

  const sla = recommendSLA(priority, riskLevel);
  const nextAction = recommendAction(topIntent, priority, riskLevel);

  const signals = [];
  (perCategoryHits[topIntent] || []).forEach(h => signals.push({ ...h, kind: "intent" }));
  urgency.hits.forEach(h => signals.push({ ...h, kind: "urgency" }));
  risk.hits.forEach(h => signals.push({ ...h, kind: "risk" }));
  signals.sort((a,b) => b.weight - a.weight);

  const allMatchedPhrases = new Set();
  signals.forEach(s => allMatchedPhrases.add(s.phrase.toLowerCase()));

  return {
    text: rawText,
    topIntent, confidence,
    priority, riskLevel, sentiment,
    sla, nextAction,
    signals,
    matchedPhrases: [...allMatchedPhrases],
    scores: { intentScores: perCategory, normalized: norm || {}, urgency: urgency.score, risk: risk.score },
  };
}

function recommendSLA(priority, risk) {
  if (priority === "High" || risk === "High") return "Within 1–2 hours";
  if (priority === "Medium" || risk === "Medium") return "Within same business day";
  return "Within 24 hours";
}

function recommendAction(intent, priority, risk) {
  if (risk === "High") return "🚨 Escalate to a senior agent and acknowledge within 1 hour.";
  if (intent === "complaint") return "Acknowledge empathetically, then investigate and follow up.";
  if (intent === "payment")   return "Route to Finance with the invoice/transaction reference.";
  if (intent === "sales")     return "Send pricing + book a demo slot.";
  if (intent === "support")   return "Open a ticket, reproduce the issue, share an ETA.";
  if (intent === "meeting")   return "Share 2–3 calendar slots that fit the requester's window.";
  if (priority === "High")    return "Respond within 1–2 hours with a clear next step.";
  return "Respond normally with a confirmation and timeline.";
}

function generateReply(result) {
  const tone = toneSelect.value;
  const intent = result.topIntent;

  const openings = {
    professional: "Thank you for reaching out.",
    empathetic:   "Thank you for taking the time to write in — I truly understand how frustrating this must feel.",
    concise:      "Thanks for the note.",
  };

  const intentBody = {
    support:   "We've logged the issue and our engineering team is looking into it. I'll keep you updated as soon as we have a fix or an ETA.",
    sales:     "I'd be glad to share pricing details and walk you through a quick demo. Could you share a couple of time slots that work this week?",
    payment:   "I've forwarded this to our finance team. They will verify the transaction and revert with confirmation shortly.",
    meeting:   "Happy to set up a call. Could you share two or three time windows that work for you? I'll send a calendar invite right away.",
    complaint: "I'm sorry about the experience you've had — this isn't the standard we aim for. I'm personally looking into it and will get back to you with a concrete update.",
    "general inquiry": "We've received your message and will get back to you with the right next step shortly.",
  };

  const slaLine = `Expected response time: ${result.sla}.`;
  const closings = {
    professional: "Best regards,\nSupport Team",
    empathetic:   "Thank you for your patience and for giving us the chance to make this right.\n\nWarm regards,\nSupport Team",
    concise:      "— Support",
  };

  return [
    openings[tone],
    intentBody[intent] || intentBody["general inquiry"],
    result.priority === "High" ? slaLine : null,
    closings[tone],
  ].filter(Boolean).join("\n\n");
}

function highlightMatches(rawText, phrases) {
  if (!phrases || !phrases.length) return escapeHtml(rawText);
  const sorted = [...phrases].sort((a, b) => b.length - a.length);
  const escaped = sorted.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  return escapeHtml(rawText).replace(re, `<mark class="hl">$1</mark>`);
}

function escapeHtml(s){return (s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}

function getValClass(level) {
  if (level === "High") return "val-high";
  if (level === "Medium") return "val-medium";
  return "val-low";
}

/* -------------------- Rendering -------------------- */

function render(result) {
  resultsWrap.classList.remove("hidden");
  
  // Confidence
  confidenceVal.textContent = `${result.confidence}%`;
  confidenceBar.style.width = `${result.confidence}%`;

  // KPIs
  kpiPriority.className = `value mt-1 ${getValClass(result.priority)}`;
  kpiPriority.textContent = result.priority;
  kpiRisk.className = `value mt-1 ${getValClass(result.riskLevel)}`;
  kpiRisk.textContent = result.riskLevel;
  kpiIntent.textContent = result.topIntent;

  // Middle
  slaText.textContent = result.sla;
  sentimentText.textContent = `Sentiment: ${result.sentiment}`;
  actionText.textContent = result.nextAction;

  // Draft
  replyBadge.className = "badge deterministic-badge";
  replyBadge.textContent = "Standard Template";
  replyBox.innerHTML = escapeHtml(generateReply(result));
  $("refineStatus").textContent = "";

  // Explainability
  signalsContainer.innerHTML = result.signals.length
    ? result.signals.map(s => `<span class="signal">${escapeHtml(s.phrase)} <span>·${s.weight}</span></span>`).join(" ")
    : `<span class="text-xs text-zinc-500">No strong signals — defaulting.</span>`;

  intentScoresContainer.innerHTML = Object.entries(result.scores.intentScores)
    .sort((a,b)=>b[1]-a[1])
    .map(([k,v]) => {
      const pct = result.scores.normalized[k] ? Math.round(result.scores.normalized[k]*100) : 0;
      return `
        <div class="flex items-center gap-2 mb-1">
          <span class="w-16 text-xs capitalize text-zinc-400">${k}</span>
          <div class="bar-wrap flex-1"><div class="bar-fill" style="width:${pct}%"></div></div>
          <span class="w-6 text-[10px] text-right text-zinc-500">${v}</span>
        </div>`;
    }).join("");

  urgencyScoreText.textContent = result.scores.urgency;
  riskScoreText.textContent = result.scores.risk;

  emailPreviewBox.innerHTML = highlightMatches(result.text, result.matchedPhrases);

  // Bind Refine
  $("copyReplyBtn").onclick = () => {
    navigator.clipboard.writeText(replyBox.innerText)
      .then(() => showToast("Reply copied to clipboard!", "success"))
      .catch(() => showToast("Copy failed.", "error"));
  };
  $("refineBtn").onclick = () => refineWithAI(result);
}

/* -------------------- LLM Polish -------------------- */
async function refineWithAI(result) {
  const status = $("refineStatus");
  const btn = $("refineBtn");
  const wrap = $("refineProgressWrap");
  const bar = $("refineProgress");

  const key = await loadGeminiKey();
  if (!key) {
    showToast("No Gemini key found. Please configure in settings.", "error");
    return;
  }

  btn.disabled = true;
  wrap.classList.remove("hidden");
  bar.style.width = "0%";
  
  let pct = 0;
  const iv = setInterval(() => { pct = Math.min(85, pct + Math.random()*10); bar.style.width = `${pct}%`; }, 200);

  const draft = result._lastDraft || replyBox.innerText;
  const prompt = `Rewrite this draft reply to sound natural, professional, and concise. Do NOT invent facts.\n\nOriginal email:\n${result.text}\n\nDraft:\n${draft}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${encodeURIComponent(key)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) }
    );
    const data = await res.json();
    const improved = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (improved) {
      replyBox.innerText = improved;
      replyBadge.className = "badge ai-badge";
      replyBadge.textContent = "AI-Enhanced Reply";
      status.textContent = "✨ Refined with Gemini 1.5 Flash";
      showToast("Reply refined with AI!", "success");
    }
  } catch (e) {
    showToast("Refinement failed. Using deterministic draft.", "error");
  } finally {
    clearInterval(iv);
    bar.style.width = "100%";
    setTimeout(() => wrap.classList.add("hidden"), 500);
    btn.disabled = false;
  }
}

/* -------------------- Simulated Pipeline Animation -------------------- */
async function runSimulatedPipeline(text) {
  resultsWrap.classList.add("hidden");
  pipelineWrap.classList.remove("hidden");
  
  const steps = [
    { text: "Reading input...", width: "0%" },
    { text: "Detecting semantic intent...", width: "25%" },
    { text: "Scanning for legal/escalation risks...", width: "50%" },
    { text: "Applying routing & SLA rules...", width: "75%" },
    { text: "Formatting draft response...", width: "100%" }
  ];

  nodes.forEach(n => { n.classList.remove("active", "done"); });
  
  for (let i = 0; i < steps.length; i++) {
    pipelineStatusText.textContent = steps[i].text;
    pipelineStatusText.classList.add("animate-pulse-glow");
    pipelineProgress.style.width = steps[i].width;
    
    if (i > 0) nodes[i-1].classList.replace("active", "done");
    nodes[i].classList.add("active");
    
    // Simulate processing time
    await new Promise(r => setTimeout(r, 450)); 
  }
  
  pipelineStatusText.classList.remove("animate-pulse-glow");
  pipelineStatusText.textContent = "Analysis Complete";
  nodes[4].classList.replace("active", "done");
  
  await new Promise(r => setTimeout(r, 300));
  pipelineWrap.classList.add("hidden");
  
  const result = analyze(text);
  render(result);
}

/* -------------------- Bindings -------------------- */
analyzeBtn.onclick = () => {
  const text = emailInput.value.trim();
  if (!text) {
    emailInput.focus();
    showToast("Please paste an email first.", "error");
    return;
  }
  runSimulatedPipeline(text);
};

toneSelect.onchange = () => {
  if (!resultsWrap.classList.contains("hidden")) {
    const text = emailInput.value.trim();
    if (text) render(analyze(text));
  }
};
