// Local, rule-based detection. Cheap, deterministic, runs on every chunk.
import { getConfig } from './config.js';

export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];
export const CATEGORIES = ['prompt_injection', 'policy_override', 'secret_exposure', 'data_exfiltration'];
const SENSITIVE = '(credentials?|passwords?|api[ _-]?keys?|secrets?|tokens?|employee (?:records?|data|files?)|salary|salaries|ssn|social security|confidential)';
const EMAIL = '[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+';

const R = (rule, category, severity, confidence, re, explanation, secret = false) => ({ rule, category, severity, confidence, re, explanation, secret });

export const RULES = [
  R('inj.ignore_previous', 'prompt_injection', 'high', 0.9, /ignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|rules?|prompts?|directions?)/i, 'Tells the AI to discard its prior instructions.'),
  R('inj.disregard_system', 'prompt_injection', 'high', 0.9, /disregard\s+(?:the\s+|your\s+|all\s+)?(?:system|previous|above|prior)\b/i, 'Tells the AI to disregard system-level instructions.'),
  R('inj.role_hijack', 'prompt_injection', 'high', 0.85, /you\s+are\s+now\s+(?:in\s+)?(?:a\s+|an\s+)?(?:developer|dan|admin|unrestricted|jailbroken)/i, 'Attempts to reassign the AI to a privileged role.'),
  R('inj.hidden_from_user', 'prompt_injection', 'high', 0.85, /do\s+not\s+(?:tell|inform|mention|reveal)[^.\n]{0,30}\b(?:the\s+)?user/i, 'Instructs the AI to hide actions from the user.'),
  R('inj.addressed_to_ai', 'prompt_injection', 'medium', 0.6, /(?:note|message|instruction)s?\s+(?:to|for)\s+(?:the\s+)?(?:ai|assistant|llm|agent|model)\b/i, 'Content addressed directly to an AI assistant.'),
  R('inj.new_instructions', 'prompt_injection', 'medium', 0.6, /(?:new|updated|revised)\s+(?:system\s+)?instructions?\s*:/i, 'Presents new instructions inside document content.'),
  R('inj.fake_tags', 'prompt_injection', 'medium', 0.7, /<\/?(?:system|instructions?|assistant)>|\[\/?(?:system|inst)\]/i, 'Uses fake system/instruction markup.'),
  R('inj.hidden_chars', 'prompt_injection', 'low', 0.5, /[\u200b-\u200f\u2060\ufeff]/, 'Contains zero-width/invisible characters that can hide instructions.'),
  R('pol.bypass_controls', 'policy_override', 'high', 0.85, /(?:bypass|disable|override|turn\s+off|circumvent)\s+(?:the\s+|all\s+|any\s+)?(?:security|safety|content|policy|policies|guardrails?|restrictions?|filters?|approval)/i, 'Asks to bypass or disable security controls.'),
  R('pol.elevated_access', 'policy_override', 'high', 0.8, /(?:admin|root|elevated|superuser)\s+(?:access|privileges?|permissions?|mode)\s+(?:is\s+|are\s+)?(?:granted|enabled|unlocked|activated)/i, 'Claims elevated privileges inside content.'),
  R('pol.skip_approval', 'policy_override', 'medium', 0.65, /(?:no\s+longer\s+(?:requires?|needs?)|(?:is|are)\s+not\s+required|skip|waive|without)\s+(?:the\s+|any\s+|usual\s+|further\s+)*(?:[\w-]+\s+)?(?:approval|review|authori[sz]ation|verification)|(?:approvals?|reviews?|authori[sz]ations?)\s+(?:is|are)\s+no\s+longer\s+(?:required|needed)/i, 'Suggests skipping an approval or review step.'),
  R('sec.private_key', 'secret_exposure', 'critical', 0.98, /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, 'Private key material in content.', true),
  R('sec.aws_key', 'secret_exposure', 'high', 0.95, /\bAKIA[0-9A-Z]{16}\b/, 'AWS access key ID pattern.', true),
  R('sec.github_token', 'secret_exposure', 'high', 0.95, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, 'GitHub token pattern.', true),
  R('sec.api_key', 'secret_exposure', 'high', 0.9, /\b(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35})\b/, 'API key pattern.', true),
  R('sec.password_assignment', 'secret_exposure', 'high', 0.8, /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?[^\s"']{8,}/i, 'Credential assigned in plain text.', true),
  R('sec.ssn', 'secret_exposure', 'medium', 0.7, /\b\d{3}-\d{2}-\d{4}\b/, 'Social-security-number-shaped value.', true),
  R('exf.send_sensitive', 'data_exfiltration', 'critical', 0.92, new RegExp(`\\b(?:send|email|e-mail|forward|mail|upload|post|transmit|exfiltrate)\\b[^.\\n]{0,120}${SENSITIVE}[^.\\n]{0,120}${EMAIL}|${EMAIL}[^.\\n]{0,120}${SENSITIVE}`, 'i'), 'Instructs sending sensitive data to an email address.'),
  R('exf.send_to_address', 'data_exfiltration', 'medium', 0.55, new RegExp(`\\b(?:send|email|forward|mail)\\b[^.\\n]{0,80}\\bto\\b[^.\\n]{0,20}${EMAIL}`, 'i'), 'Instruction to send content to an email address.'),
  R('exf.markdown_beacon', 'data_exfiltration', 'high', 0.8, /!\[[^\]]*\]\(https?:\/\/[^)\s]*(?:\{|\$\{|%7B|[?&](?:data|d|q|payload)=)[^)]*\)/i, 'Image URL that can leak data in its query string.'),
];

// Content framed as an example / training is demoted rather than ignored.
const EDU = /\b(?:for\s+(?:training|awareness|educational)\s+purposes|security\s+awareness|awareness\s+training|training\s+(?:module|material|exercise)|example\s+of|examples?\s+include|e\.g\.|red\s+flags?|attackers?\s+(?:may|can|often|might)|what\s+to\s+look\s+for)\b/i;

export function redactSecrets(s) {
  return String(s)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[REDACTED_KEY]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA[REDACTED]')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, 'gh_[REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35})\b/g, '[REDACTED_API_KEY]')
    .replace(/\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?token)(\s*[:=]\s*["']?)[^\s"']{4,}/gi, '$1$2[REDACTED]')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_SSN]');
}

const downgrade = (sev) => SEVERITIES[Math.max(1, SEVERITIES.indexOf(sev) - 2)];

/** Run all rules on one chunk. Returns findings (one per rule, first match). */
export function detectChunk(text) {
  const out = [];
  const educational = EDU.test(text);
  for (const r of RULES) {
    const m = r.re.exec(text);
    if (!m) continue;
    let { severity, confidence } = r;
    let explanation = r.explanation;
    if (educational && !r.secret) {
      severity = downgrade(severity);
      confidence = +(confidence * 0.4).toFixed(2);
      explanation += ' (Framed as an example/training material, so severity was reduced.)';
    }
    const raw = m[0].replace(/\s+/g, ' ').slice(0, 160);
    out.push({
      rule: r.rule, category: r.category, severity, confidence, explanation, educational,
      evidence: r.secret ? redactSecrets(raw) : raw, source: 'local',
    });
  }
  return out;
}

export const isConfirmed = (f, threshold = getConfig().confirmThreshold) =>
  !f.educational && f.confidence >= threshold && (f.severity === 'high' || f.severity === 'critical');

const W = { info: 0, low: 1, medium: 3, high: 6, critical: 9 };
export const suspicionScore = (findings) => findings.reduce((s, f) => s + W[f.severity] * f.confidence, 0);
export const severityRank = (s) => SEVERITIES.indexOf(s);
