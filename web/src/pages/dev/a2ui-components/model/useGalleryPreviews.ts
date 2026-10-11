import { useEffect, useState, useSyncExternalStore } from "react";
import { catalogExamples } from "@/pages/dev/a2ui-components/model/examples";
import { createGalleryPreviews } from "./gallery-previews";

export function useGalleryPreviews() {
  const [owner] = useState(() => createGalleryPreviews(catalogExamples));
  const previews = useSyncExternalStore(owner.subscribe, owner.getSnapshot);

  useEffect(() => {
    owner.initialize();

    return () => owner.dispose();
  }, [owner]);

  return { previews, updateSource: owner.update, resetSource: owner.reset };
}
