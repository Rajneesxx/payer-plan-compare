import { FIELD_MAPPINGS, type PayerPlan, type ExtractedData, type ComparisonResult } from "@/constants/fields";
import * as pdfjsLib from "pdfjs-dist";

// Configure PDF.js worker via CDN to avoid bundler issues
// https://mozilla.github.io/pdf.js/getting_started/#download
// @ts-ignore - pdfjs types may not include GlobalWorkerOptions shape in ESM
(pdfjsLib as any).GlobalWorkerOptions = (pdfjsLib as any).GlobalWorkerOptions || {};
// @ts-ignore
(pdfjsLib as any).GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

async function pdfToText(file: File, maxPages = 10): Promise<string> {
  const buffer = await file.arrayBuffer();
  const loadingTask = (pdfjsLib as any).getDocument({ data: buffer });
  const pdf = await loadingTask.promise;
  const pages = Math.min(pdf.numPages, maxPages);
  let text = "";
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = (content.items || [])
      .map((it: any) => (typeof it?.str === "string" ? it.str : ""))
      .join(" ");
    text += `\n\n--- Page ${i} ---\n${strings}`;
  }
  return text;
}

function buildMessages(fields: string[], pdfText: string) {
  const fieldList = fields.map((f) => `- ${f}`).join("\n");
  const trimmed = pdfText.slice(0, 50000);
  const system = `You are a precise information extraction engine.\n\nTask: Extract the following fields from the provided PDF text.\nRules:\n- Return JSON only (no prose).\n- Use EXACT keys from the field list.\n- If a field is not clearly present, set its value to null.\n- Prefer the most explicit value near labels and tables.\n- Do not invent data.\n- Normalize whitespace.\n- Keep units and punctuation from the source where applicable.`;
  const user = `Fields to extract (keys must match exactly):\n${fieldList}\n\nPDF Text (may be truncated):\n${trimmed}`;
  const messages: { role: "system" | "user"; content: string }[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  return messages;
}

async function callOpenAIJson({
  apiKey,
  messages,
}: {
  apiKey: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
}): Promise<Record<string, unknown>> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || "OpenAI request failed");
  }

  const data = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content);
  } catch {
    // Fallback: attempt to extract JSON block
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // ignore
      }
    }
    return {} as Record<string, unknown>;
  }
}

export async function extractDataApi({
  file,
  payerPlan,
  apiKey,
}: {
  file: File;
  payerPlan: PayerPlan;
  apiKey: string;
}): Promise<ExtractedData> {
  // 1) Extract raw text from PDF in-browser
  const pdfText = await pdfToText(file, 12);

  // 2) Build a structured extraction prompt using our field mapping
  const fields = FIELD_MAPPINGS[payerPlan];
  const messages = buildMessages(fields, pdfText);

  // 3) Call OpenAI to get a strict JSON object back
  const raw = await callOpenAIJson({ apiKey, messages });

  // 4) Normalize to our ExtractedData shape with all expected keys
  const result: ExtractedData = {};
  for (const key of fields) {
    const val = (raw as any)[key];
    result[key] = val == null || val === "" ? null : String(val);
  }
  return result;
}

export async function compareDataApi({
  file1,
  file2,
  payerPlan,
  apiKey,
}: {
  file1: File;
  file2: File;
  payerPlan: PayerPlan;
  apiKey: string;
}): Promise<ComparisonResult[]> {
  // Run two extractions in parallel for efficiency
  const [data1, data2] = await Promise.all([
    extractDataApi({ file: file1, payerPlan, apiKey }),
    extractDataApi({ file: file2, payerPlan, apiKey }),
  ]);

  const fields = FIELD_MAPPINGS[payerPlan];
  const results: ComparisonResult[] = fields.map((field) => {
    const v1 = data1[field];
    const v2 = data2[field];

    let status: ComparisonResult["status"] = "different";
    if (v1 == null || v2 == null) status = "missing";
    else if (String(v1).trim() === String(v2).trim()) status = "same";

    return {
      field,
      file1Value: v1,
      file2Value: v2,
      status,
    };
  });

  return results;
}
