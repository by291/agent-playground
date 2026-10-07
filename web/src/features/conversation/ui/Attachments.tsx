import { useState, type ReactNode } from "react";
import { FileIcon } from "@phosphor-icons/react/dist/csr/File";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { skillFileUrl } from "@shared/skill-files";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { ImageViewer, type AttachmentImage } from "./ImageViewer";

export function isImageAttachment(name: string) {
  return /\.(jpe?g|png|gif|webp)$/i.test(name);
}

function FileAttachment({
  name,
  download,
  actions,
}: {
  name: string;
  download?: string | undefined;
  actions?: ReactNode;
}) {
  return (
    <Attachment size="sm" className="flex-nowrap border-line">
      <AttachmentMedia>
        <FileIcon aria-hidden="true" />
      </AttachmentMedia>
      <AttachmentContent className="max-w-48">
        <AttachmentTitle title={name}>{name}</AttachmentTitle>
      </AttachmentContent>
      {download && (
        <AttachmentTrigger asChild>
          <a href={download} download={name} aria-label={`Download ${name}`} />
        </AttachmentTrigger>
      )}
      {actions}
    </Attachment>
  );
}

function ImageAttachment({
  name,
  thumbnail,
  preview,
  download,
  actions,
  images,
}: {
  name: string;
  thumbnail: string;
  preview: string;
  download?: string;
  actions?: ReactNode;
  images?: AttachmentImage[] | undefined;
}) {
  const [failed, setFailed] = useState(false);
  const gallery = images?.length
    ? images
    : [{ name, alt: name, thumbnail, src: preview, download }];

  if (failed) {
    return <FileAttachment name={name} download={download} actions={actions} />;
  }

  return (
    <Dialog>
      <Attachment className="w-36 flex-col gap-0 overflow-hidden border-line p-0">
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label={`Preview ${name}`}
            className="flex h-24 w-full cursor-zoom-in items-center justify-center bg-muted-surface outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <img
              src={thumbnail}
              alt={name}
              loading="lazy"
              className="size-full object-cover"
              onError={() => setFailed(true)}
            />
          </button>
        </DialogTrigger>
        <div className="flex w-full min-w-0 items-center gap-1 px-2 py-1.5">
          <AttachmentContent>
            <AttachmentTitle title={name} className="text-xs">
              {name}
            </AttachmentTitle>
          </AttachmentContent>
          {download && (
            <AttachmentActions>
              <AttachmentAction asChild>
                <a
                  href={download}
                  download={name}
                  aria-label={`Download ${name}`}
                >
                  <DownloadSimpleIcon aria-hidden="true" />
                </a>
              </AttachmentAction>
            </AttachmentActions>
          )}
          {actions}
        </div>
      </Attachment>
      <ImageViewer
        images={gallery}
        initialIndex={Math.max(
          0,
          gallery.findIndex((image) => image.src === preview),
        )}
      />
    </Dialog>
  );
}

export function UploadedAttachments({
  threadId,
  files,
}: {
  threadId: string;
  files: { id: string; name: string }[];
}) {
  const images: AttachmentImage[] = files
    .filter((file) => isImageAttachment(file.name))
    .map((file) => {
      const download = skillFileUrl({ ...file, threadId });

      return {
        name: file.name,
        alt: file.name,
        download,
        src: `${download}/preview`,
        thumbnail: `${download}/preview?size=thumbnail`,
      };
    });

  return (
    <div
      aria-label="Attached files"
      className="flex max-w-[85%] flex-wrap justify-end gap-2 self-end sm:max-w-[75%]"
    >
      {files.map((file) => {
        const download = skillFileUrl({ ...file, threadId });

        return isImageAttachment(file.name) ? (
          <ImageAttachment
            key={file.id}
            name={file.name}
            download={download}
            thumbnail={`${download}/preview?size=thumbnail`}
            preview={`${download}/preview`}
            images={images}
          />
        ) : (
          <FileAttachment key={file.id} name={file.name} download={download} />
        );
      })}
    </div>
  );
}

export function SelectedAttachment({
  file,
  preview,
  disabled,
  uploading,
  onRemove,
  images,
}: {
  file: File;
  preview?: string | undefined;
  disabled: boolean;
  uploading: boolean;
  onRemove: () => void;
  images?: AttachmentImage[] | undefined;
}) {
  const actions = (
    <AttachmentActions>
      <AttachmentAction
        type="button"
        aria-label={`Remove ${file.name}`}
        disabled={disabled}
        onClick={onRemove}
      >
        <XIcon size={14} aria-hidden="true" />
      </AttachmentAction>
    </AttachmentActions>
  );

  return (
    <div aria-busy={uploading}>
      {preview ? (
        <ImageAttachment
          key={preview}
          name={file.name}
          thumbnail={preview}
          preview={preview}
          actions={actions}
          images={images}
        />
      ) : (
        <FileAttachment name={file.name} actions={actions} />
      )}
    </div>
  );
}
