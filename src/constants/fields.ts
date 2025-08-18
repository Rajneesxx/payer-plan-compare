export const PAYER_PLANS = {
  QLM: 'QLM',
  ALKOOT: 'ALKOOT'
} as const;

export type PayerPlan = keyof typeof PAYER_PLANS;

export const QLM_FIELDS = [
  "Insured", 
  "Policy No",
  "Period of Insurance", 
  "Plan", 
  "For Eligible Medical Expenses at Al Ahli Hospital",
  "Inpatient Deductible", 
  "Deductible per each outpatient consultation",
  "Vaccination of children", 
  "Psychiatric Treatment", 
  "Dental Copayment",
  "Maternity Copayment", 
  "Optical Copayment"
];

export const ALKOOT_FIELDS = [
  "Policy Number", 
  "Category", 
  "Effective Date",
  "Expiry Date", 
  "Provider-specific co-insurance at Al Ahli Hospital",
  "Co-insurance on all inpatient treatment", 
  "Deductible on consultation",
  "Vaccination & Immunization",
  "Psychiatric treatment & Psychotherapy",
  "Pregnancy & Childbirth", 
  "Dental Benefit", 
  "Optical Benefit"
];

export const FIELD_MAPPINGS = {
  [PAYER_PLANS.QLM]: QLM_FIELDS,
  [PAYER_PLANS.ALKOOT]: ALKOOT_FIELDS
};

export interface ExtractedData {
  [key: string]: string | null;
}

export interface ComparisonResult {
  field: string;
  file1Value: string | null;
  file2Value: string | null;
  status: 'same' | 'different' | 'missing';
}
