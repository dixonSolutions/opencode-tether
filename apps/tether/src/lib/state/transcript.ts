import type { MessageInfo, MessageWithParts, Part, TetherEvent } from '$lib/api/types';

export function updateTranscript(messages: MessageWithParts[], events: TetherEvent[], sessionID: string | null): MessageWithParts[] {
  if (!sessionID || !events.length) return messages;
  const byID = new Map(messages.map((message) => [message.info.id, message]));
  const pending = new Map<string, Part[]>();
  let changed = false;
  for (const event of events) {
    const props = event.properties ?? {};
    if (event.type === 'message.updated') {
      const info = props.info as MessageInfo | undefined;
      if (!info || info.sessionID !== sessionID) continue;
      const current = byID.get(info.id);
      byID.set(info.id, { info: { ...current?.info, ...info }, parts: current?.parts ?? pending.get(info.id) ?? [] });
      changed = true;
      continue;
    }
    if (props.sessionID !== sessionID && (props.part as Part | undefined)?.sessionID !== sessionID) continue;
    const messageID = (props.messageID ?? (props.part as Part | undefined)?.messageID) as string;
    if (event.type === 'message.removed') {
      byID.delete(messageID);
      changed = true;
      continue;
    }
    const current = byID.get(messageID);
    if (!current) {
      if (event.type === 'message.part.updated' && props.part) {
        const parts = pending.get(messageID) ?? [];
        const part = props.part as Part;
        pending.set(messageID, [...parts.filter((item) => item.id !== part.id), part]);
      }
      continue;
    }
    let parts = current.parts;
    if (event.type === 'message.part.updated') {
      const part = props.part as Part;
      const index = parts.findIndex((item) => item.id === part.id);
      parts = index < 0 ? [...parts, part] : parts.map((item, i) => i === index ? part : item);
    } else if (event.type === 'message.part.removed') {
      parts = parts.filter((part) => part.id !== props.partID);
    } else if (event.type === 'message.part.delta' && props.field === 'text' && typeof props.delta === 'string') {
      parts = parts.map((part) => part.id === props.partID && (part.type === 'text' || part.type === 'reasoning')
        ? { ...part, text: part.text + props.delta } : part);
    } else continue;
    byID.set(messageID, { ...current, parts });
    changed = true;
  }
  return changed ? [...byID.values()].sort((a, b) => a.info.time.created - b.info.time.created || a.info.id.localeCompare(b.info.id)) : messages;
}

export function reconcileTranscript(snapshot: MessageWithParts[], baseline: MessageWithParts[], live: MessageWithParts[]): MessageWithParts[] {
  const before = new Map(baseline.map((message) => [message.info.id, message]));
  const current = new Map(live.map((message) => [message.info.id, message]));
  const merged = new Map(snapshot.map((message) => [message.info.id, message]));
  for (const [id, message] of current) {
    const original = before.get(id);
    if (message === original) continue;
    const fetched = merged.get(id);
    if (!fetched) {
      merged.set(id, message);
      continue;
    }
    const oldParts = new Map(original?.parts.map((part) => [part.id, part]) ?? []);
    const liveParts = new Map(message.parts.map((part) => [part.id, part]));
    const parts = new Map(fetched.parts.map((part) => [part.id, part]));
    for (const [partID, part] of liveParts) {
      if (part === oldParts.get(partID)) continue;
      const fetchedPart = parts.get(partID);
      if (fetchedPart && 'text' in fetchedPart && 'text' in part && fetchedPart.text.startsWith(part.text)) continue;
      parts.set(partID, part);
    }
    for (const partID of oldParts.keys()) if (!liveParts.has(partID)) parts.delete(partID);
    merged.set(id, { info: message.info === original?.info ? fetched.info : message.info, parts: [...parts.values()] });
  }
  for (const id of before.keys()) if (!current.has(id)) merged.delete(id);
  return [...merged.values()].sort((a, b) => a.info.time.created - b.info.time.created || a.info.id.localeCompare(b.info.id));
}
