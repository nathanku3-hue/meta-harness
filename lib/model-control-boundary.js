"use strict";

const MODEL_CONTROL_PATTERNS = Object.freeze([
  {
    code: "DECISION_LABEL",
    pattern: /^(?:(?:[-*+]\s+)|(?:\d+[.)]\s+))?(?:\*\*)?(?:Decision needed|Need input|Need you|Owner action required)(?:\*\*)?\s*(?::|—|-)/iu,
  },
  {
    code: "GO_HANDSHAKE",
    pattern: /\b(?:reply|respond|say|send)\s+(?:with\s+)?[`'"]?(?:GO|approve|approved)\b/iu,
  },
  {
    code: "GO_REQUIREMENT",
    pattern: /\b(?:need|needs|require|requires|required)\b[^\n.]{0,60}\b(?:new\s+|explicit\s+|separate\s+)+(?:owner\s+)?GO\b|\b(?:new\s+|explicit\s+|separate\s+)+(?:owner\s+)?GO\b[^\n.]{0,40}\b(?:is\s+)?required\b/iu,
  },
  {
    code: "CONDITIONAL_EXECUTION_CONSENT",
    pattern: /\b(?:if|whether)\s+you\s+(?:want|would like)\s+me\s+to\s+(?:execute|continue|proceed|start|run|implement|apply|make|do)\b|\bdo\s+you\s+want\s+me\s+to\s+(?:execute|continue|proceed|start|run|implement|apply|make|do)\b/iu,
  },
  {
    code: "MODEL_SELF_AUTHORIZATION",
    pattern: /\b(?:i|we)(?:['’]m|['’]re|['’]ll|\s+am|\s+are|\s+will|\s+would|\s+can)?\s+treat(?:ing)?\b[^\n.]{0,100}\bas\s+(?:(?:an?|the)\s+)?(?:(?:new|bounded|explicit)\s+){0,3}(?:authorization|approval|permission|go-ahead|go)\b/iu,
  },
  {
    code: "MODEL_GRANTS_AUTHORITY",
    pattern: /\b(?:i|we)\s+(?:would|will|can)\s+authorize\b/iu,
  },
  {
    code: "OWNER_APPROVAL_REQUEST",
    pattern: /\b(?:ask|request|seek)\s+(?:the\s+)?(?:owner(?:['’]s)?\s+|your\s+)(?:for\s+)?(?:approval|authorization|permission|go-ahead|go)\b/iu,
  },
  {
    code: "OWNER_APPROVAL_REQUIREMENT",
    pattern: /\b(?:need|needs|require|requires|required)\s+(?:a\s+|an\s+|the\s+)?(?:(?:new|explicit|separate)\s+){0,3}(?:owner(?:['’]s)?\s+|your\s+)(?:approval|authorization|permission|go-ahead|go)\b/iu,
  },
  {
    code: "OWNER_MUST_AUTHORIZE",
    pattern: /\b(?:you|the owner|owner)\s+(?:must|need(?:s)?\s+to|should)\s+(?:explicitly\s+)?(?:authorize|approve|permit|say\s+go)\b/iu,
  },
  {
    code: "OWNER_DECISION_REQUIREMENT",
    pattern: /\b(?:the\s+owner|owner)\s+(?:must|need(?:s)?\s+to|should)\s+(?:decide|choose|select)\b/iu,
  },
  {
    code: "HUMAN_WAIT_GATE",
    pattern: /\bwait(?:ing)?\s+(?:for|on)\s+(?:the\s+)?(?:owner|approval|authorization|permission|go-ahead|go)\b/iu,
  },
  {
    code: "HUMAN_AUTHORIZATION_QUESTION",
    pattern: /\b(?:do|would|will|can|could|should)\s+you\b[^\n.?]{0,60}\b(?:authorize|approve|permit|say\s+go)\b/iu,
  },
  {
    code: "CONSENT_OBJECT_AUTHORIZATION",
    pattern: /\b(?:authorize|approve|permit)\b[^\n.]{0,80}\b(?:slice|round|phase|packet|run|experiment|implementation|continuation|next\s+step)\b/iu,
  },
  {
    code: "METHODOLOGY_AUTHORIZATION",
    pattern: /\bauthorize\b[^\n.]{0,80}\b(?:bounded\s+)?(?:acquisition|sampling|holdout|preregistration|pre-registration|validation|review)\b/iu,
  },
  {
    code: "METHODOLOGY_AS_AUTHORITY",
    pattern: /\b(?:sampling|acquisition|research|validation|review|holdout|preregistration|pre-registration)\s+authority\b/iu,
  },
  {
    code: "ZH_CONSENT_STALL",
    pattern: /(?:如果|若)你(?:要|希望|想要)我(?:繼續|继续|執行|执行|開始|开始|做|進行|进行)|你(?:給|给|回覆|回复|下達|下达)\s*(?:GO|approve)\b/iu,
  },
  {
    code: "ZH_MODEL_SELF_AUTHORIZATION",
    pattern: /我(?:會|会|將|将)?(?:把|將|将)?[^。！？\n]{0,60}(?:視為|视为|當作|当作)[^。！？\n]{0,20}(?:(?:授權|授权|批准|許可|许可)(?=$|[\s。！？,，;；:：])|GO\b)/iu,
  },
  {
    code: "ZH_HUMAN_APPROVAL_REQUIREMENT",
    pattern: /(?:你|owner)[^。！？\n]{0,20}(?:需要|必須|必须)[^。！？\n]{0,20}(?:批准|授權|授权|許可|许可|給\s*GO|给\s*GO)|(?<!不)(?<!無)(?<!无)需要(?:(?:新的|明確的|明确的|explicit)\s*){0,3}(?:owner\s*)?GO\b/iu,
  },
]);

const NEGATED_REQUEST = /\b(?:do\s+not|don't|never|no\s+need\s+to|does\s+not\s+require|doesn't\s+require|is\s+not\s+required|not\s+necessary\s+to|without\s+needing)\b[^\n.;]{0,100}\b(?:ask|request|seek|authorize|approve|approval|authorization|permission|go-ahead|go)\b/giu;

function policyLines(text) {
  const lines = String(text || "").split(/\r?\n/u);
  const result = [];
  let fenced = false;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (/^```/u.test(trimmed)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || /^>/u.test(trimmed) || trimmed === "") continue;
    result.push(trimmed);
  }
  return result;
}

function modelControlViolations(text) {
  const violations = [];
  for (const line of policyLines(text)) {
    const controlText = line.replace(NEGATED_REQUEST, "").trim();
    if (!controlText) continue;
    for (const entry of MODEL_CONTROL_PATTERNS) {
      if (entry.pattern.test(controlText)) {
        violations.push(Object.freeze({ code: entry.code, line }));
      }
    }
  }
  return Object.freeze(violations);
}

module.exports = {
  MODEL_CONTROL_PATTERNS,
  modelControlViolations,
};
