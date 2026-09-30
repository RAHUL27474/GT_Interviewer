// One Google Form per job: created from the dashboard, kept in step with the job (title, description, open or
// closed), and read every minute for new applications (lib/intake.ts).
import { config } from "./config";
import { googleApi, GoogleError } from "./google";
import { logger } from "./log";
import { JOINING_OPTIONS } from "./scoring";
import type { FormField, GoogleJobForm, Job } from "./types";

const API = "https://forms.googleapis.com/v1/forms";
const log = logger("forms");

interface FieldSpec {
  key: FormField;
  title: string;
  description?: string;
  required: boolean;
  choices?: string[];
}

const RESUME_LINK_FIELD: FieldSpec = {
  key: "resumeUrl",
  title: "Link to your resume",
  description:
    'Upload your resume (PDF or Word) to Google Drive, set sharing to "Anyone with the link", and paste the link here.',
  required: true,
};

/** The application questions, in form order. Email is added only if the form can't collect it itself. */
export const FORM_FIELDS: FieldSpec[] = [
  { key: "fullName", title: "Full name", required: true },
  { key: "phone", title: "Phone number", description: "With country code, e.g. +91 98765 43210", required: true },
  { key: "totalExperience", title: "Total work experience (years)", description: "A number, e.g. 3 or 4.5. Enter 0 if you are a fresher.", required: true },
  { key: "currentLocation", title: "Current city", required: true },
  { key: "currentCTC", title: "Current CTC (₹ lakhs per year)", description: "A number, e.g. 4.5. Enter 0 if you are a fresher.", required: true },
  { key: "expectedCTC", title: "Expected CTC (₹ lakhs per year)", description: "A number, e.g. 6", required: true },
  { key: "joiningCategory", title: "When can you join?", required: true, choices: JOINING_OPTIONS.map((o) => o.label) },
  RESUME_LINK_FIELD,
  { key: "linkedin", title: "LinkedIn profile", required: false },
];

const EMAIL_FIELD: FieldSpec = { key: "email", title: "Email address", description: "Your interview login details will be sent here.", required: true };

export const formEditUrl = (formId: string) => `https://docs.google.com/forms/d/${formId}/edit`;

function formDescription(job: Pick<Job, "location" | "description">) {
  const minutes = config.questionCount * (config.minutesPerQuestion + 1);
  const delay = config.decisionDelayMinutes;
  return [
    job.location ? `Location: ${job.location}` : "",
    job.description,
    "—",
    'Please share your resume as a Google Drive link (sharing: "Anyone with the link").',
    "How it works: you'll get an email confirming your application straight away. " +
      `We then review your resume, and${delay ? ` within about ${delay < 60 ? `${delay} minutes` : `${Math.round(delay / 60)} hour(s)`}` : ""} ` +
      `you'll hear whether you've been shortlisted. Shortlisted applicants get login details for a short AI video interview ` +
      `(about ${minutes} minutes), to be started within ${config.interviewAccessHours} hours. ` +
      "You'll need a laptop or desktop with a webcam and microphone.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function itemRequest(f: FieldSpec, index: number) {
  return {
    createItem: {
      location: { index },
      item: {
        title: f.title,
        description: f.description,
        questionItem: {
          question: {
            required: f.required,
            ...(f.choices
              ? { choiceQuestion: { type: "RADIO", options: f.choices.map((value) => ({ value })) } }
              : { textQuestion: { paragraph: false } }),
          },
        },
      },
    },
  };
}

type BatchReply = { replies?: { createItem?: { questionId?: string[] } }[] };

/** Opens or closes the form for responses. Old forms without publish settings are left as they are. */
export async function setAcceptingResponses(formId: string, accepting: boolean) {
  try {
    await googleApi(`${API}/${formId}:setPublishSettings`, {
      method: "POST",
      body: JSON.stringify({
        publishSettings: { publishState: { isPublished: true, isAcceptingResponses: accepting } },
        updateMask: "publishState",
      }),
    });
  } catch (err) {
    if (err instanceof GoogleError && (err.status === 400 || err.status === 404)) {
      log.warn(`Form ${formId}: publish settings not supported (${err.message}); open or close it in Google Forms.`);
      return;
    }
    throw err;
  }
}

/** Creates the job's application form in the connected Google account. */
export async function createJobForm(job: Job, owner: string): Promise<GoogleJobForm> {
  const created = await googleApi<{ formId: string; responderUri: string }>(API, {
    method: "POST",
    body: JSON.stringify({ info: { title: `${job.title} - ${config.companyName}`, documentTitle: `Application: ${job.title}` } }),
  });
  const { formId } = created;

  // Let Google collect and check the email address itself; fall back to a question if that isn't available.
  let emailFromSettings = true;
  try {
    await googleApi(`${API}/${formId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        requests: [{ updateSettings: { settings: { emailCollectionType: "RESPONDER_INPUT" }, updateMask: "emailCollectionType" } }],
      }),
    });
  } catch (err) {
    log.warn(`Form ${formId}: can't collect emails automatically, adding an email question instead:`, err);
    emailFromSettings = false;
  }

  const fields = emailFromSettings ? FORM_FIELDS : [FORM_FIELDS[0], EMAIL_FIELD, ...FORM_FIELDS.slice(1)];
  const result = await googleApi<BatchReply>(`${API}/${formId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      includeFormInResponse: false,
      requests: [
        { updateFormInfo: { info: { description: formDescription(job) }, updateMask: "description" } },
        ...fields.map(itemRequest),
      ],
    }),
  });
  const questionIds: GoogleJobForm["questionIds"] = {};
  // The first reply is for updateFormInfo; the rest match `fields` in order.
  fields.forEach((f, i) => {
    const id = result.replies?.[i + 1]?.createItem?.questionId?.[0];
    if (id) questionIds[f.key] = id;
  });

  await setAcceptingResponses(formId, job.active);
  log.info(`Created form for "${job.title}": ${created.responderUri}`);
  return {
    formId,
    responderUri: created.responderUri,
    owner,
    createdAt: new Date().toISOString(),
    questionIds,
    emailFromSettings,
    // Only responses from now on.
    syncedUntil: new Date(Date.now() - 60_000).toISOString(),
  };
}

/** Brings the form's title, description and open/closed state in line with the job. */
export async function syncJobForm(job: Job) {
  if (!job.googleForm) return;
  const { formId } = job.googleForm;
  await googleApi(`${API}/${formId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          updateFormInfo: {
            info: { title: `${job.title} - ${config.companyName}`, description: formDescription(job) },
            updateMask: "title,description",
          },
        },
      ],
    }),
  });
  await setAcceptingResponses(formId, job.active);
}

export interface UploadedFile {
  fileId: string;
  fileName?: string;
  mimeType?: string;
}

export interface FormResponse {
  responseId: string;
  lastSubmittedTime: string;
  respondentEmail?: string;
  answers?: Record<
    string,
    { textAnswers?: { answers?: { value?: string }[] }; fileUploadAnswers?: { answers?: UploadedFile[] } }
  >;
}

/**
 * Makes sure the form asks for a resume link, adding the question at the end if it was deleted (or the form was
 * made while the form asked for uploads instead). Returns the question id.
 */
export async function ensureResumeLinkQuestion(form: GoogleJobForm): Promise<string> {
  const current = await googleApi<{ items?: { questionItem?: { question?: { questionId?: string } } }[] }>(
    `${API}/${form.formId}`,
  );
  const ids = new Set(current.items?.map((i) => i.questionItem?.question?.questionId).filter(Boolean));
  if (form.questionIds.resumeUrl && ids.has(form.questionIds.resumeUrl)) return form.questionIds.resumeUrl;
  const result = await googleApi<BatchReply>(`${API}/${form.formId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests: [itemRequest(RESUME_LINK_FIELD, current.items?.length ?? 0)] }),
  });
  const id = result.replies?.[0]?.createItem?.questionId?.[0];
  if (!id) throw new Error("Google didn't return the new resume question");
  log.info(`Form ${form.formId}: resume link question added`);
  return id;
}

/** The first file uploaded in a response (older forms may have a File upload question). */
export function uploadedFile(r: FormResponse, questionId?: string): UploadedFile | null {
  const answers = r.answers ?? {};
  const fromQuestion = questionId ? answers[questionId]?.fileUploadAnswers?.answers?.[0] : undefined;
  if (fromQuestion) return fromQuestion;
  for (const a of Object.values(answers)) {
    const f = a.fileUploadAnswers?.answers?.[0];
    if (f) return f;
  }
  return null;
}

/** Responses submitted after `since` (all of them when not given), oldest first. */
export async function listResponses(formId: string, since?: string): Promise<FormResponse[]> {
  const all: FormResponse[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams();
    if (since) params.set("filter", `timestamp > ${since}`);
    if (pageToken) params.set("pageToken", pageToken);
    const page = await googleApi<{ responses?: FormResponse[]; nextPageToken?: string }>(
      `${API}/${formId}/responses?${params}`,
    );
    all.push(...(page.responses ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return all.sort((a, b) => a.lastSubmittedTime.localeCompare(b.lastSubmittedTime));
}
