/** Formats an attachment header with a fixed ASCII fallback and a UTF-8 filename. */
export function attachmentDisposition(
  name: string,
  fallback: "document" | "download",
) {
  const encodedName = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (character) => {
      const escapeCode = character.charCodeAt(0).toString(16).toUpperCase();

      return `%${escapeCode}`;
    },
  );

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodedName}`;
}
