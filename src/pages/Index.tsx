import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText, Zap, ArrowRight } from "lucide-react";
import { PayerPlanSelector } from "@/components/PayerPlanSelector";
import { PDFUploader } from "@/components/PDFUploader";
import { ExtractedDataTable } from "@/components/ExtractedDataTable";
import { useToast } from "@/hooks/use-toast";
import { PAYER_PLANS, FIELD_MAPPINGS, type PayerPlan, type ExtractedData, type ComparisonResult } from "@/constants/fields";

const Index = () => {
  const [openAiKey, setOpenAiKey] = useState<string>("");
  const [payerPlan, setPayerPlan] = useState<PayerPlan>(PAYER_PLANS.QLM);
  const [uploadMode, setUploadMode] = useState<'single' | 'compare'>('single');
  const [files, setFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [comparisonResults, setComparisonResults] = useState<ComparisonResult[] | null>(null);
  
  const { toast } = useToast();

  const handleExtract = async () => {
    if (files.length === 0) {
      toast({
        title: "No files selected",
        description: "Please upload at least one PDF file to extract data.",
        variant: "destructive",
      });
      return;
    }

    if (uploadMode === 'compare' && files.length < 2) {
      toast({
        title: "Two files required",
        description: "Please upload two PDF files for comparison.",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    
    try {
      toast({
        title: "Processing started",
        description: `Extracting data from ${files.length} file${files.length > 1 ? 's' : ''}...`,
      });

      // Simulate API call - Replace with actual Supabase Edge Function call
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const fields = FIELD_MAPPINGS[payerPlan];
      
      if (uploadMode === 'single') {
        // Mock single file extraction
        const mockData: ExtractedData = {};
        fields.forEach((field, index) => {
          // Simulate some found and some missing fields
          mockData[field] = index % 3 === 0 ? null : `Sample ${field} Value`;
        });
        
        setExtractedData(mockData);
        setComparisonResults(null);
        
        toast({
          title: "Extraction completed",
          description: `Successfully extracted data from ${files[0].name}`,
        });
      } else {
        // Mock comparison results
        const mockComparison: ComparisonResult[] = fields.map((field, index) => {
          const scenarios = ['same', 'different', 'missing'] as const;
          const status = scenarios[index % 3];
          
          return {
            field,
            file1Value: status === 'missing' ? null : `File 1 ${field} Value`,
            file2Value: status === 'missing' ? null : 
                       status === 'different' ? `File 2 Different ${field} Value` : 
                       `File 1 ${field} Value`,
            status
          };
        });
        
        setComparisonResults(mockComparison);
        setExtractedData(null);
        
        toast({
          title: "Comparison completed",
          description: `Successfully compared ${files[0].name} and ${files[1].name}`,
        });
      }
    } catch (error) {
      toast({
        title: "Processing failed",
        description: "An error occurred while processing the PDF files. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const canProcess = files.length > 0 && (uploadMode === 'single' || files.length === 2);

  return (
    <div className="min-h-screen bg-gradient-surface">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2 flex items-center justify-center gap-3">
            <div className="w-10 h-10 bg-gradient-primary rounded-lg flex items-center justify-center">
              <FileText className="h-6 w-6 text-white" />
            </div>
            Rapid Extractor
          </h1>
          <p className="text-lg text-muted-foreground">
            Extract and compare medical data from PDF documents with RapidClaims.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Controls Panel */}
          <div className="lg:col-span-1 space-y-6">
            <Card className="bg-card shadow-md">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Zap className="h-5 w-5 text-primary" />
                  Configuration/Requirements
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="openai-key" className="text-sm font-medium text-foreground">
                    OpenAI API Key
                  </Label>
                  <Input
                    id="openai-key"
                    type="password"
                    placeholder="Enter your OpenAI API key"
                    value={openAiKey}
                    onChange={(e) => setOpenAiKey(e.target.value)}
                    className="w-full bg-card border-border shadow-sm"
                  />
                </div>
                
                <Separator />
                
                <PayerPlanSelector
                  value={payerPlan}
                  onValueChange={setPayerPlan}
                />
                
                <Separator />
                
                <PDFUploader
                  mode={uploadMode}
                  onModeChange={setUploadMode}
                  files={files}
                  onFilesChange={setFiles}
                  isLoading={isProcessing}
                />
                
                <Button
                  onClick={handleExtract}
                  disabled={!canProcess || isProcessing}
                  className="w-full bg-gradient-primary hover:shadow-primary transition-all duration-200"
                  size="lg"
                >
                  {isProcessing ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Processing...
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4" />
                      {uploadMode === 'single' ? 'Extract Data' : 'Compare Files'}
                      <ArrowRight className="h-4 w-4" />
                    </div>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Field Preview */}
            <Card className="bg-card shadow-md">
              <CardHeader>
                <CardTitle className="text-lg">Expected Fields ({FIELD_MAPPINGS[payerPlan].length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {FIELD_MAPPINGS[payerPlan].map((field, index) => (
                    <div key={field} className="text-sm text-muted-foreground py-1 border-b border-border/50 last:border-0">
                      {index + 1}. {field}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Results Panel */}
          <div className="lg:col-span-2">
            {extractedData && (
              <ExtractedDataTable
                mode="single"
                data={extractedData}
                fileName={files[0]?.name}
              />
            )}
            
            {comparisonResults && (
              <ExtractedDataTable
                mode="compare"
                comparisonData={comparisonResults}
                fileNames={[files[0]?.name, files[1]?.name]}
              />
            )}
            
            {!extractedData && !comparisonResults && (
              <Card className="bg-card/50 shadow-md border-dashed border-2 border-border">
                <CardContent className="py-16 text-center">
                  <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                    <FileText className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-medium text-foreground mb-2">
                    No data extracted yet
                  </h3>
                  <p className="text-muted-foreground">
                    Upload PDF files and click "Extract Data" or "Compare Files" to see results here.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
