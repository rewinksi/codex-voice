function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function extractTranscriptText(payload) {
  let text = "";

  if (typeof payload?.text === "string") {
    text = payload.text;
  } else if (typeof payload?.transcript === "string") {
    text = payload.transcript;
  } else if (Array.isArray(payload?.messages)) {
    const userMessages = payload.messages.filter((message) => message?.role === "user");
    const lastUserMessage = userMessages.at(-1);
    text = textFromContent(lastUserMessage?.content);
  }

  const normalized = text.trim();
  if (!normalized) {
    throw new Error("No transcript text found in STT payload");
  }
  return normalized;
}
