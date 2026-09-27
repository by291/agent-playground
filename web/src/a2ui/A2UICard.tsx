import { A2uiSurface, basicCatalog } from "@a2ui/react/v0_9";
import { MessageProcessor } from "@a2ui/web_core/v0_9";
import { useState } from "react";
import type { A2UICard as CardData } from "./card";

export function A2UICard({ card }: { card: CardData }) {
  const [surface] = useState(() => {
    const processor = new MessageProcessor([basicCatalog]);
    try {
      processor.processMessages(card.messages);
      const creation = card.messages.find(
        (message) => "createSurface" in message,
      );
      return creation
        ? processor.model.getSurface(creation.createSurface.surfaceId)
        : undefined;
    } catch (error) {
      console.error("Could not render A2UI card", error);
      return undefined;
    }
  });

  if (!surface) return null;

  return (
    <div className="a2ui-card ml-11 rounded-2xl border border-accent-line bg-accent-soft/40 p-3 sm:ml-12">
      <A2uiSurface surface={surface} />
    </div>
  );
}
