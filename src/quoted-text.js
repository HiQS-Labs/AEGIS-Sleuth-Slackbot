'use strict';

// Text inside double quotation marks is not the sender's own commitment, so reminder detection
// ignores it. Only balanced "straight", “curly” and «guillemet» spans count. Apostrophes, inch
// marks (12") and a stray unbalanced quote are left alone.
const STRAIGHT_QUOTED_SPAN = /(?<![\p{L}\p{N}])"(?=\S)[^"]*?(?<=\S)"(?![\p{L}\p{N}])/gu;
const CURLY_QUOTED_SPAN = /“[^“”]*”/g;
const GUILLEMET_QUOTED_SPAN = /«[^«»]*»/g;

/**
 * Kill switch: REMINDER_IGNORE_QUOTED_TEXT=off|false|0|no|disabled turns this off. Default on.
 * @returns {boolean}
 */
function IsQuotedTextIgnoreEnabled() {
  const Raw = String(process.env.REMINDER_IGNORE_QUOTED_TEXT || '').trim().toLowerCase();
  return !['off', 'false', '0', 'no', 'disabled'].includes(Raw);
}

/**
 * Remove balanced double-quoted spans (quotes included).
 * @param {string} ArgText
 * @returns {string}
 */
function StripQuotedText(ArgText) {
  const Text = typeof ArgText === 'string' ? ArgText : '';
  if(!/["\u201C\u00AB]/.test(Text)) return Text;
  return Text
    .replace(STRAIGHT_QUOTED_SPAN, ' ')
    .replace(CURLY_QUOTED_SPAN, ' ')
    .replace(GUILLEMET_QUOTED_SPAN, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim();
}

/**
 * Strip quoted spans unless the kill switch is off.
 * @param {string} ArgText
 * @returns {string}
 */
function IgnoreQuotedText(ArgText) {
  return IsQuotedTextIgnoreEnabled() ? StripQuotedText(ArgText) : (typeof ArgText === 'string' ? ArgText : '');
}

module.exports = { StripQuotedText, IgnoreQuotedText, IsQuotedTextIgnoreEnabled };
