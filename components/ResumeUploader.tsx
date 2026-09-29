"use client";

import { useId, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { config } from "@/lib/config";

interface Props {
  /** Rejected by the form; kept so the browser can focus the right control. */
  invalid?: boolean;
}

const ACCEPT = ".pdf,.docx,.txt";

/** 2400000 -> "2.4 MB". */
function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const mb = bytes / (1024 * 1024);
  return mb < 0.1 ? `${Math.round(bytes / 1024)} KB` : `${mb.toFixed(1)} MB`;
}

function isPdf(name: string) {
  return name.toLowerCase().endsWith(".pdf");
}

/**
 * The resume field: a drop target, a real file input behind a button, and a list
 * of what has been chosen with Replace and Remove.
 *
 * The input itself carries `name="resume"`, so the form still submits a plain
 * `File` to /api/register exactly as before. Everything visible here is chrome
 * around that one input rather than a replacement for it, which is why the
 * uploader can be restyled without the server noticing.
 */
export function ResumeUploader({ invalid }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState("");
  const inputId = useId();
  const listId = useId();

  function accept(next: File | undefined | null) {
    setRejected("");
    if (!next) return;
    const name = next.name.toLowerCase();
    if (!ACCEPT.split(",").some((ext) => name.endsWith(ext))) {
      setRejected("Resume must be a PDF, DOCX or TXT file.");
      setFile(null);
      return;
    }
    if (next.size > config.maxResumeBytes) {
      setRejected("Resume must be under 5 MB.");
      setFile(null);
      return;
    }
    setFile(next);
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    accept(e.target.files?.[0]);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    accept(e.dataTransfer.files?.[0]);
  }

  function clear() {
    setFile(null);
    setRejected("");
    // Reset the native input too, or re-picking the same file fires no change
    // event and the list would stay empty.
    if (inputRef.current) inputRef.current.value = "";
  }

  const describedBy = [rejected ? `${inputId}-error` : "", file ? listId : ""].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      {/* The visible chrome says "Choose File", which is not a label. Without this
          the input has no accessible name, because the drop zone is a div. */}
      <label htmlFor={inputId} className="sr-only">
        Upload your resume
      </label>

      {/* The real input. Hidden, not absent: it is what the form submits. */}
      <input
        ref={inputRef}
        id={inputId}
        name="resume"
        type="file"
        accept={ACCEPT}
        onChange={onPick}
        aria-describedby={describedBy}
        aria-invalid={invalid || rejected ? true : undefined}
        className="sr-only"
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={
          "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition " +
          (over
            ? "border-brand-500 bg-brand-50"
            : invalid || rejected
              ? "border-red-300 bg-red-50/40"
              : "border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-brand-50/40")
        }
      >
        <span
          aria-hidden="true"
          className={
            "grid size-11 place-items-center rounded-full text-lg transition " +
            (over ? "bg-brand-600 text-white" : "bg-brand-100 text-brand-600")
          }
        >
          ↑
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-700">
            Drag your resume here, or{" "}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="cursor-pointer rounded-md bg-brand-600 px-3 py-1.5 font-semibold text-white shadow-sm transition hover:bg-brand-700 focus-visible:ring-3 focus-visible:ring-brand-100 focus-visible:outline-none"
            >
              Choose File
            </button>
          </p>
          <p className="text-micro mt-1.5 text-slate-500 normal-case">PDF, DOCX or TXT · max 5 MB</p>
        </div>
      </div>

      {rejected && (
        <p id={`${inputId}-error`} role="alert" className="text-body mt-2 font-medium text-red-700">
          {rejected}
        </p>
      )}

      {file && (
        <ul id={listId} className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <li className="flex items-center gap-3 px-4 py-3">
            <span
              aria-hidden="true"
              className={
                "grid size-9 shrink-0 place-items-center rounded-md text-[10px] font-bold text-white " +
                (isPdf(file.name) ? "bg-red-600" : "bg-slate-500")
              }
            >
              {isPdf(file.name) ? "PDF" : file.name.split(".").pop()?.toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-body block truncate font-semibold text-slate-900">{file.name}</span>
              <span className="text-micro mt-0.5 block text-slate-500 normal-case">{humanSize(file.size)}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {/* Micro, because these are secondary to the document itself, and
                  padded only enough to stay a comfortable tap target: an inline
                  text link that grows to 44px on hover stops reading as a link. */}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="text-micro cursor-pointer rounded-sm px-1.5 py-1 font-semibold text-brand-700 uppercase transition hover:bg-brand-50 hover:text-brand-800 focus-visible:ring-3 focus-visible:ring-brand-100 focus-visible:outline-none active:scale-95"
              >
                Replace
                <span className="sr-only"> {file.name}</span>
              </button>
              <button
                type="button"
                onClick={clear}
                className="text-micro cursor-pointer rounded-sm px-1.5 py-1 font-semibold text-slate-500 uppercase transition hover:bg-red-50 hover:text-red-700 focus-visible:ring-3 focus-visible:ring-red-100 focus-visible:outline-none active:scale-95"
              >
                Remove
                <span className="sr-only"> {file.name}</span>
              </button>
            </span>
          </li>
        </ul>
      )}
    </div>
  );
}
