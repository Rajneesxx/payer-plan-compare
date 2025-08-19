import { PAYER_PLANS, type PayerPlan, type ExtractedData, type ComparisonResult } from "@/constants/fields";

export async function extractDataApi({
  file,
  payerPlan,
  apiKey,
}: {
  file: File;
  payerPlan: PayerPlan;
  apiKey: string;
}): Promise<ExtractedData> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("payerPlan", payerPlan);
  formData.append("apiKey", apiKey);

  const res = await fetch("/api/extract", {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Failed to extract data");
  }

  const data = await res.json();
  // Expecting backend to return { data: ExtractedData } or the object directly
  return (data?.data ?? data) as ExtractedData;
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
  const formData = new FormData();
  formData.append("file1", file1);
  formData.append("file2", file2);
  formData.append("payerPlan", payerPlan);
  formData.append("apiKey", apiKey);

  const res = await fetch("/api/compare", {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Failed to compare files");
  }

  const data = await res.json();
  return (data?.results ?? data) as ComparisonResult[];
}
