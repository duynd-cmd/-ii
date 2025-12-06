import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Document, Page, pdfjs, PDFDocumentProxy, PDFPageProxy, TextItem } from 'react-pdf';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import PacmanLoader from 'react-spinners/PacmanLoader';
import { 
  RefreshCw, 
  ChevronLeft, 
  ChevronRight,
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize2,
  Menu,
  Volume2
} from "lucide-react";
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import Link from 'next/link';
import { cn } from "@/lib/utils";
import { AudioPlayer } from "@/components/scriba/AudioPlayer";

// --- STABILITY FIX: Use CDN Worker ---
// This ensures the worker loads correctly in production (Render/Vercel)
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

// Helper function to convert base64 to buffer
function base64ToBuffer(base64String: string): Uint8Array {
  const base64Data = base64String.replace(/^data:application\/pdf;base64,/, '');
  const binaryString = atob(base64Data);
  const buffer = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    buffer[i] = binaryString.charCodeAt(i);
  }
  return buffer;
}

// FIX: Removed custom interfaces and now rely on types exported by 'react-pdf' (PDFDocumentProxy, PDFPageProxy, TextItem)

interface PdfViewerProps {
  documentId: string;
  currentPage: number;
  onPageChange: (page: number) => void;
}

const MemoizedPage = React.memo(Page);
const MemoizedDocument = React.memo(Document);

export default function PdfViewer({ documentId, currentPage, onPageChange }: PdfViewerProps) {
  const touchRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    lastScale: 1,
    lastRotation: 0
  });
  const contentRef = useRef<HTMLDivElement>(null);
   
  const [viewState, setViewState] = useState({
    numPages: 0,
    scale: 1,
    rotation: 0,
    position: { x: 0, y: 0 },
    pageNumber: currentPage || 1
  });
  const [uiState, setUiState] = useState({
    error: null as string | null,
    loading: true,
    showMobileMenu: false,
    isFullscreen: false
  });
  const [documentData, setDocumentData] = useState({
    pdfData: null as string | null,
    title: ''
  });

  // --- Scriba / Audio Player State ---
  const [showPlayer, setShowPlayer] = useState(false);
  const [pdfText, setPdfText] = useState("");
  const [isExtractingText, setIsExtractingText] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const [isPageLoading, setIsPageLoading] = useState(false);
  const pdfDimensionsRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  // --- CRITICAL FIX: Extract Text in Browser ---
  const onDocumentLoadSuccess = useCallback(async (pdf: PDFDocumentProxy) => {
    setViewState(prev => ({ ...prev, numPages: pdf.numPages }));
    setUiState(prev => ({ ...prev, error: null }));

    // Start extraction immediately
    setIsExtractingText(true);
    setStatusMessage("Reading document...");
    
    try {
      let fullText = "";
      const numPages = pdf.numPages;
      
      // Loop through all pages
      for (let i = 1; i <= numPages; i++) {
        try {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          
          // FIX: Filter items to only include TextItems that have the 'str' property
          const pageText = textContent.items
            .filter((item: any): item is TextItem => !!item && typeof item === 'object' && 'str' in item)
            .map((item: TextItem) => item.str)
            .join(' ');
            
          fullText += pageText + "\n\n";
        } catch (err) {
          console.warn(`Could not read page ${i}`, err);
        }
      }

      if (!fullText.trim()) {
        fullText = "I couldn't find any readable text. This might be a scanned image.";
      }

      setPdfText(fullText);
      console.log("PDF Text Extracted on Frontend:", fullText.substring(0, 100) + "...");
    } catch (e) {
      console.error("Text extraction failed:", e);
      setPdfText("Error reading document.");
    } finally {
      setIsExtractingText(false);
      setStatusMessage("");
    }
  }, []);
  // ---------------------------------------------

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchRef.current.isDragging = true;
      touchRef.current.startX = e.touches[0].clientX - viewState.position.x;
      touchRef.current.startY = e.touches[0].clientY - viewState.position.y;
    } else if (e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      touchRef.current.lastScale = Math.hypot(
        touch1.clientX - touch2.clientX,
        touch1.clientY - touch2.clientY
      );
    }
  }, [viewState.position]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1 && touchRef.current.isDragging) {
      setViewState(prev => ({
        ...prev,
        position: {
          x: e.touches[0].clientX - touchRef.current.startX,
          y: e.touches[0].clientY - touchRef.current.startY
        }
      }));
    } else if (e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const currentDistance = Math.hypot(
        touch1.clientX - touch2.clientX,
        touch1.clientY - touch2.clientY
      );
      const scaleDiff = (currentDistance - touchRef.current.lastScale) * 0.01;
      setViewState(prev => ({
        ...prev,
        scale: Math.max(0.5, Math.min(2, prev.scale + scaleDiff))
      }));
      touchRef.current.lastScale = currentDistance;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    touchRef.current.isDragging = false;
  }, []);

  const fetchPdf = useCallback(async () => {
    if (!documentId) {
      setUiState(prev => ({ ...prev, error: 'No document ID specified' }));
      return;
    }

    try {
      setUiState(prev => ({ ...prev, loading: true }));
      const response = await fetch(`/api/pdf/${documentId}`);
      if (!response.ok) throw new Error('Failed to fetch PDF');
      
      const data = await response.json();
      if (!data.data) throw new Error('No PDF data received from server');
      if (!data.data.startsWith('data:application/pdf;base64,')) {
        throw new Error('Invalid PDF data format');
      }

      setDocumentData({ pdfData: data.data, title: data.title });
      setUiState(prev => ({ ...prev, error: null }));
    } catch (err) {
      console.error('Error fetching PDF:', err);
      setUiState(prev => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to load PDF file.'
      }));
    } finally {
      setUiState(prev => ({ ...prev, loading: false }));
    }
  }, [documentId]);

  const handlePageChange = useCallback((offset: number) => {
    const newPage = viewState.pageNumber + offset;
    if (newPage >= 1 && newPage <= viewState.numPages) {
      setViewState(prev => ({ ...prev, pageNumber: newPage }));
      onPageChange(newPage);
    }
  }, [viewState.pageNumber, viewState.numPages, onPageChange]);

  const handleZoom = useCallback((delta: number) => {
    setViewState(prev => ({
      ...prev,
      scale: Math.max(0.5, Math.min(2, prev.scale + delta))
    }));
  }, []);

  const handleRotate = useCallback(() => {
    setViewState(prev => ({
      ...prev,
      rotation: (prev.rotation + 90) % 360
    }));
  }, []);

  const toggleFullscreen = useCallback(() => {
    setUiState(prev => ({
      ...prev,
      isFullscreen: !prev.isFullscreen
    }));
    setViewState(prev => ({ ...prev, scale: 1 }));
  }, []);

  useEffect(() => {
    fetchPdf();
  }, [fetchPdf]);

  useEffect(() => {
    if (currentPage && currentPage !== viewState.pageNumber) {
      setViewState(prev => ({ ...prev, pageNumber: currentPage }));
    }
  }, [currentPage, viewState.pageNumber]);

  useEffect(() => {
    const adjustScale = () => {
      setViewState(prev => ({
        ...prev,
        scale: window.innerWidth < 768 ? 0.8 : 1
      }));
    };
    adjustScale();
    window.addEventListener('resize', adjustScale);
    return () => window.removeEventListener('resize', adjustScale);
  }, []);

  const pageOptions = useMemo(() => ({
    pageNumber: viewState.pageNumber || 1,
    scale: viewState.scale,
    rotate: viewState.rotation,
    renderTextLayer: true,
    renderAnnotationLayer: true,
    className: "touch-none select-none",
    loading: null,
    onLoadStart: () => setIsPageLoading(true),
    onLoadSuccess: (page: { width: number; height: number }) => {
      pdfDimensionsRef.current = {
        width: page.width * viewState.scale,
        height: page.height * viewState.scale
      };
      setIsPageLoading(false);
    },
  }), [viewState.pageNumber, viewState.scale, viewState.rotation]);

  const documentOptions = useMemo(() => ({
    file: documentData.pdfData ? { data: base64ToBuffer(documentData.pdfData) } : null,
    loading: null, 
  }), [documentData.pdfData]);

  return (
    <div className={cn(
      "flex flex-col border-2 border-black rounded-lg overflow-hidden relative bg-background",
      uiState.isFullscreen ? "fixed inset-0 z-50" : "w-full h-full"
    )}>
      {/* Mobile Header */}
      <div className="flex items-center justify-between p-2 border-b border-black bg-muted/40">
        <div className="flex items-center gap-2">
          <Link href="/pdf" className="hover:opacity-80">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Back</span>
            </Button>
          </Link>
          <h2 className="text-sm font-medium truncate max-w-[200px] sm:max-w-[300px]">
            {documentData.title}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowPlayer(true)}
            className="lg:hidden"
            title="Read Aloud"
            disabled={isExtractingText}
          >
            <Volume2 className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setUiState(prev => ({ ...prev, showMobileMenu: !prev.showMobileMenu }))}
            className="lg:hidden"
          >
            <Menu className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleFullscreen}
            className="hidden lg:flex gap-2"
          >
            <Maximize2 className="h-4 w-4" />
            <span className="hidden sm:inline">
              {uiState.isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            </span>
          </Button>
        </div>
      </div>

      {/* Mobile Controls Menu */}
      <div className={cn(
        "lg:hidden flex flex-col gap-4 p-4 bg-muted/40 border-b border-black transition-all duration-300",
        uiState.showMobileMenu ? "block" : "hidden"
      )}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => handlePageChange(-1)}
              disabled={viewState.pageNumber <= 1 || uiState.error !== null}
              className="h-10 w-10"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <span className="text-sm font-medium min-w-[80px] text-center">
              {uiState.error ? 'Error' : `${viewState.pageNumber} / ${viewState.numPages}`}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => handlePageChange(1)}
              disabled={viewState.pageNumber >= viewState.numPages || uiState.error !== null}
              className="h-10 w-10"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
          <span className="text-sm font-medium px-3 py-2 bg-background rounded-md border">
            {Math.round(viewState.scale * 100)}%
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={() => handleZoom(-0.1)}
            className="flex items-center justify-center gap-2 h-12"
          >
            <ZoomOut className="h-5 w-5" />
            <span>Zoom Out</span>
          </Button>
          <Button
            variant="outline"
            onClick={() => handleZoom(0.1)}
            className="flex items-center justify-center gap-2 h-12"
          >
            <ZoomIn className="h-5 w-5" />
            <span>Zoom In</span>
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={handleRotate}
            className="flex items-center justify-center gap-2 h-12"
          >
            <RotateCw className="h-5 w-5" />
            <span>Rotate</span>
          </Button>
          <Button
            variant="outline"
            onClick={toggleFullscreen}
            className="flex items-center justify-center gap-2 h-12"
          >
            <Maximize2 className="h-5 w-5" />
            <span>{uiState.isFullscreen ? 'Exit Full' : 'Fullscreen'}</span>
          </Button>
        </div>

        {/* EXPLICIT READ BUTTON FOR MOBILE MENU */}
        <Button
            onClick={() => {
              setShowPlayer(true);
              setUiState(prev => ({ ...prev, showMobileMenu: false }));
            }}
            disabled={isExtractingText}
            className="w-full flex items-center justify-center gap-2 h-12 mt-2 bg-[#c1ff72] text-black border-2 border-black hover:bg-[#b0ef63] font-semibold"
        >
            <Volume2 className="h-5 w-5" />
            <span>{isExtractingText ? statusMessage || 'Loading...' : 'Read PDF Aloud'}</span>
        </Button>
      </div>

      {/* Desktop Controls */}
      <div className="hidden lg:flex items-center justify-between p-2 border-b border-black bg-muted/40">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handlePageChange(-1)}
            disabled={viewState.pageNumber <= 1 || uiState.error !== null}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <span className="text-sm font-medium px-2">
            {uiState.error ? 'Error' : `${viewState.pageNumber} / ${viewState.numPages}`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handlePageChange(1)}
            disabled={viewState.pageNumber >= viewState.numPages || uiState.error !== null}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleZoom(-0.1)}
              title="Zoom Out"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[60px] text-center">
              {Math.round(viewState.scale * 100)}%
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleZoom(0.1)}
              title="Zoom In"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRotate}
            title="Rotate"
          >
            <RotateCw className="h-4 w-4" />
          </Button>

          {/* Read PDF Button (Desktop) */}
          <div className="border-l border-black pl-2 ml-2">
             <Button
              onClick={() => setShowPlayer(true)}
              size="sm"
              disabled={isExtractingText}
              className="bg-[#c1ff72] text-black border-2 border-black hover:bg-[#b0ef63] font-semibold gap-2 min-w-[120px]"
            >
              <Volume2 className="h-4 w-4" />
              {isExtractingText ? 'Processing...' : 'Read PDF'}
            </Button>
          </div>
        </div>
      </div>

      {/* PDF Content */}
      <ScrollArea className="flex-1 w-full relative">
        <div 
          ref={contentRef}
          className="flex flex-col items-center justify-start p-4 touch-none"
          onClick={() => setUiState(prev => ({ ...prev, showMobileMenu: false }))}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            transform: `translate(${viewState.position.x}px, ${viewState.position.y}px)`,
            transition: touchRef.current.isDragging ? 'none' : 'transform 0.2s ease-out',
            minHeight: pdfDimensionsRef.current.height ? `${pdfDimensionsRef.current.height + 32}px` : '100vh'
          }}
        >
          {uiState.error ? (
            <div className="text-center p-4">
              <div className="text-destructive mb-4">{uiState.error}</div>
              <Button 
                onClick={fetchPdf}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Retry
              </Button>
            </div>
          ) : uiState.loading ? (
            <div className="fixed inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-50">
              <PacmanLoader color="#538B81" />
            </div>
          ) : (
            <div 
              className="relative flex justify-center"
              style={{
                width: pdfDimensionsRef.current.width || '100%',
                minHeight: pdfDimensionsRef.current.height || 'auto',
              }}
            >
              <MemoizedDocument
                {...documentOptions}
                onLoadSuccess={onDocumentLoadSuccess}
                onLoadError={(err) => {
                  console.error('PDF load error:', err);
                  setUiState(prev => ({ ...prev, error: 'Failed to load PDF file.' }));
                }}
              >
                <div className="relative">
                  <div 
                    style={{
                      width: pdfDimensionsRef.current.width || '100%',
                      height: pdfDimensionsRef.current.height || 'auto',
                      position: 'relative'
                    }}
                  >
                    <MemoizedPage {...pageOptions} />
                    {isPageLoading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm">
                        <PacmanLoader color="#538B81" />
                      </div>
                    )}
                  </div>
                </div>
              </MemoizedDocument>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* FAIL-SAFE FLOATING BUTTON */}
      <Button
        onClick={() => setShowPlayer(true)}
        disabled={isExtractingText}
        className="fixed bottom-20 right-6 z-40 shadow-xl bg-[#c1ff72] text-black border-2 border-black hover:bg-[#b0ef63] h-12 w-12 rounded-full flex items-center justify-center lg:hidden"
        title="Read PDF"
      >
        <Volume2 className="h-6 w-6" />
      </Button>

      {/* Audio Player Component */}
      {showPlayer && (
        <AudioPlayer 
          text={pdfText} 
          onClose={() => setShowPlayer(false)} 
        />
      )}
    </div>
  );
}
