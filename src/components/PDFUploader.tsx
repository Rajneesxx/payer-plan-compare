import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Upload, FileText, X, GitCompare } from "lucide-react";
import { cn } from "@/lib/utils";

interface PDFUploaderProps {
  mode: 'single' | 'compare';
  onModeChange: (mode: 'single' | 'compare') => void;
  onFilesChange: (files: File[]) => void;
  files: File[];
  isLoading?: boolean;
}

export const PDFUploader = ({ mode, onModeChange, onFilesChange, files, isLoading }: PDFUploaderProps) => {
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const isPdfLike = (file: File) =>
    file.type.toLowerCase().includes('pdf') || /\.pdf$/i.test(file.name);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const droppedFiles = Array.from(e.dataTransfer.files).filter(isPdfLike);

    if (droppedFiles.length > 0) {
      const maxFiles = mode === 'single' ? 1 : 2;
      onFilesChange(droppedFiles.slice(0, maxFiles));
    }
  }, [mode, onFilesChange]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []).filter(isPdfLike);

    if (selectedFiles.length > 0) {
      const maxFiles = mode === 'single' ? 1 : 2;
      onFilesChange(selectedFiles.slice(0, maxFiles));
    }
  }, [mode, onFilesChange]);

  const removeFile = useCallback((index: number) => {
    const newFiles = files.filter((_, i) => i !== index);
    onFilesChange(newFiles);
  }, [files, onFilesChange]);

  const maxFiles = mode === 'single' ? 1 : 2;
  const canAddMore = files.length < maxFiles;

  return (
    <div className="space-y-4">
      {/* Mode Toggle */}
      <div className="flex gap-2">
        <Button
          variant={mode === 'single' ? 'default' : 'secondary'}
          onClick={() => onModeChange('single')}
          className="flex items-center gap-2"
          disabled={isLoading}
        >
          <Upload className="h-4 w-4" />
          Single PDF
        </Button>
        <Button
          variant={mode === 'compare' ? 'default' : 'secondary'}
          onClick={() => onModeChange('compare')}
          className="flex items-center gap-2"
          disabled={isLoading}
        >
          <GitCompare className="h-4 w-4" />
          Compare PDFs
        </Button>
      </div>

      {/* Upload Area */}
      {canAddMore && (
        <Card
          className={cn(
            "border-2 border-dashed border-border bg-card/50 transition-all duration-200",
            dragActive && "border-primary bg-primary-light",
            !isLoading && "hover:border-primary/50 hover:bg-card"
          )}
        >
          <div
            className="relative p-8 text-center"
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input
              type="file"
              accept=".pdf"
              multiple={mode === 'compare'}
              onChange={handleFileInput}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              disabled={isLoading}
            />
            <div className="space-y-3">
              <div className="mx-auto w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                <Upload className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Drop PDF files here or click to browse
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {mode === 'single' ? 'Upload 1 PDF file' : `Upload up to 2 PDF files for comparison`}
                </p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Uploaded Files */}
      {files.length > 0 && (
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">
            Uploaded Files ({files.length}/{maxFiles})
          </Label>
          <div className="space-y-2">
            {files.map((file, index) => (
              <Card key={`${file.name}-${index}`} className="p-3 bg-card shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-primary/10 rounded-md flex items-center justify-center">
                      <FileText className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {file.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {(file.size / 1024 / 1024).toFixed(1)} MB
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => removeFile(index)}
                    disabled={isLoading}
                    className="h-8 w-8 p-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};