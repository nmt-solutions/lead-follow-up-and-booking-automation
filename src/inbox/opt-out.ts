/** Deliberately narrow explicit requests. Quoted messages, signatures and model output never classify permission. */
export function explicitEmailOptOut(text: string) {
  const first = text.trim().split(/\r?\n/)[0].trim();
  return /^(?:please\s+)?(?:unsubscribe(?:\s+me)?|stop\s+emailing\s+me|do\s+not\s+(?:email|contact)\s+me|remove\s+me\s+from\s+(?:your|the)\s+(?:mailing\s+)?list)[.!]?$/i.test(
    first,
  );
}
