import type { Attachment } from "../types";

interface AttachmentChipProps {
  attachment: Attachment;
  /** Download / preview URL (provider.attachmentUrl). Omit for not-yet-uploaded files. */
  url?: string;
  /** Renders inline image preview for image attachments (default true when url given). */
  preview?: boolean;
  onRemove?: () => void;
}

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

/**
 * Attachment chip; images additionally render an inline preview
 * (mockup thread style). Pass onRemove for composer usage.
 */
export default function AttachmentChip({ attachment, url, preview, onRemove }: AttachmentChipProps) {
  const showPreview = (preview ?? true) && attachment.isImage && !!url;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 6, maxWidth: 280 }}>
      {showPreview ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img className="msg__img" src={url} alt={attachment.fileName} loading="lazy" />
        </a>
      ) : null}
      <span className="attch" title={attachment.fileName}>
        <FileIcon />
        {url ? (
          <a className="name" href={url} target="_blank" rel="noreferrer" download={attachment.fileName}>
            {attachment.fileName}
          </a>
        ) : (
          <span className="name">{attachment.fileName}</span>
        )}
        {onRemove ? (
          <button type="button" className="rm" aria-label={`Remove ${attachment.fileName}`} onClick={onRemove}>
            ×
          </button>
        ) : null}
      </span>
    </span>
  );
}
