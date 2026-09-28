import { useEffect, useState, useSyncExternalStore } from "react";
import { catalogExamples } from "./examples";
import { createGalleryPreviews } from "./galleryPreviews";

export function useGalleryPreviews() {
  const [owner] = useState(() => createGalleryPreviews(catalogExamples));
  const previews = useSyncExternalStore(owner.subscribe, owner.getSnapshot);

  useEffect(() => {
    owner.initialize();

    return () => owner.dispose();
  }, [owner]);

  return { previews, updateSource: owner.update, resetSource: owner.reset };
}
