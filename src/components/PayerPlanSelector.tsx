import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { PAYER_PLANS, type PayerPlan } from "@/constants/fields";

interface PayerPlanSelectorProps {
  value: PayerPlan;
  onValueChange: (value: PayerPlan) => void;
}

export const PayerPlanSelector = ({ value, onValueChange }: PayerPlanSelectorProps) => {
  return (
    <div className="space-y-2">
      <Label htmlFor="payer-plan" className="text-sm font-medium text-foreground">
        Payer Plan
      </Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id="payer-plan" className="w-full bg-card border-border shadow-sm">
          <SelectValue placeholder="Select payer plan" />
        </SelectTrigger>
        <SelectContent className="bg-popover border-border shadow-lg">
          {Object.values(PAYER_PLANS).map((plan) => (
            <SelectItem key={plan} value={plan} className="hover:bg-accent hover:text-accent-foreground">
              {plan}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};