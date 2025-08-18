export const PAYER_PLANS = {
  QLM: 'QLM',
  ALKOOT: 'ALKOOT'
} as const;

export type PayerPlan = keyof typeof PAYER_PLANS;

export const QLM_FIELDS = [
  'Patient Name',
  'Patient ID',
  'Date of Birth',
  'Gender',
  'Insurance Provider',
  'Policy Number',
  'Group Number',
  'Member ID',
  'Primary Care Physician',
  'Specialist',
  'Date of Service',
  'Procedure Code',
  'Diagnosis Code',
  'Treatment Description',
  'Total Amount',
  'Copay Amount',
  'Deductible',
  'Coinsurance',
  'Prior Authorization',
  'Claim Number'
];

export const ALKOOT_FIELDS = [
  'Beneficiary Name',
  'National ID',
  'Civil ID',
  'Date of Birth',
  'Gender',
  'Nationality',
  'Employer',
  'Employment Date',
  'Department',
  'Position',
  'Salary',
  'Benefits Package',
  'Medical Coverage',
  'Family Members',
  'Emergency Contact',
  'Address',
  'Phone Number',
  'Email',
  'Bank Account',
  'Status'
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