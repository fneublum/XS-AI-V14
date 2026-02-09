import React, { useEffect, useState } from 'react';
import { X, Download, Mail, FileText, Loader2, AlertCircle } from 'lucide-react';

interface PDFPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    pdfUrl: string | null;
    pdfBlob?: Blob | null;
    title: string;
    fileName: string;
    onEmail?: () => void;
    onDownload?: () => void; // Direct download callback that uses doc.save()
}

const PDFPreviewModal: React.FC<PDFPreviewModalProps> = ({
    isOpen,
    onClose,
    pdfUrl,
    pdfBlob,
    title,
    fileName,
    onEmail,
    onDownload
}) => {
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);

    // Prevent body scroll when modal is open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
            setIsLoading(true);
            setHasError(false);
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [isOpen, pdfUrl]);

    if (!isOpen || !pdfUrl) return null;

    // Handle download - prioritize onDownload callback, then use blob, then fallback
    const handleDownloadClick = async () => {
        setIsDownloading(true);
        const safeName = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;

        try {
            // Priority 1: Use provided onDownload callback (most reliable - uses jsPDF's doc.save())
            if (onDownload) {
                console.log('[PDFPreviewModal] Using onDownload callback');
                onDownload();
                setIsDownloading(false);
                return;
            }

            // Priority 2: Use the blob directly if available
            if (pdfBlob) {
                console.log('[PDFPreviewModal] Using blob for download');
                const url = URL.createObjectURL(pdfBlob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = safeName;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 200);
                setIsDownloading(false);
                return;
            }

            // Priority 3: For blob URLs, create a link directly (don't fetch)
            if (pdfUrl && pdfUrl.startsWith('blob:')) {
                console.log('[PDFPreviewModal] Direct blob URL download');
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = pdfUrl;
                a.download = safeName;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => document.body.removeChild(a), 200);
                setIsDownloading(false);
                return;
            }

            // Priority 4: For regular URLs, fetch and download
            if (pdfUrl) {
                console.log('[PDFPreviewModal] Fetching URL for download');
                const response = await fetch(pdfUrl);
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = safeName;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 200);
            }
        } catch (error) {
            console.error('[PDFPreviewModal] Download failed:', error);
            alert('Download failed. Please try again.');
        } finally {
            setIsDownloading(false);
        }
    };

    // Handle iframe load events
    const handleIframeLoad = () => {
        setIsLoading(false);
        setHasError(false);
    };

    const handleIframeError = () => {
        setIsLoading(false);
        setHasError(true);
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden border border-slate-200">
                {/* Header */}
                <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                            <FileText size={20} />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-800 text-lg">{title}</h3>
                            <p className="text-xs text-slate-500 font-mono">{fileName}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-200 rounded-full text-slate-500 transition-colors"
                        title="Close Preview"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Toolbar */}
                <div className="p-3 bg-white border-b border-slate-100 flex justify-end gap-3 shrink-0">
                    {onEmail && (
                        <button
                            onClick={onEmail}
                            className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors font-bold text-sm"
                        >
                            <Mail size={16} /> Email PDF
                        </button>
                    )}
                    <button
                        onClick={handleDownloadClick}
                        disabled={isDownloading}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-bold text-sm shadow-sm disabled:opacity-50"
                    >
                        {isDownloading ? (
                            <>
                                <Loader2 size={16} className="animate-spin" /> Downloading...
                            </>
                        ) : (
                            <>
                                <Download size={16} /> Download PDF
                            </>
                        )}
                    </button>
                </div>

                {/* PDF Preview Area */}
                <div className="flex-1 bg-slate-100 relative overflow-hidden">
                    {/* Loading State */}
                    {isLoading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100 z-10">
                            <Loader2 size={40} className="animate-spin text-blue-600 mb-3" />
                            <p className="text-slate-600 font-medium">Loading document...</p>
                        </div>
                    )}

                    {/* Error State */}
                    {hasError && !isLoading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100 z-10">
                            <AlertCircle size={40} className="text-amber-500 mb-3" />
                            <p className="text-slate-700 font-medium mb-2">Preview unavailable</p>
                            <p className="text-slate-500 text-sm mb-4">Click Download to get the PDF file</p>
                            <button
                                onClick={handleDownloadClick}
                                disabled={isDownloading}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-bold text-sm"
                            >
                                {isDownloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                                Download PDF
                            </button>
                        </div>
                    )}

                    {/* Use iframe for PDF display - more reliable than embed */}
                    <iframe
                        src={`${pdfUrl}#toolbar=1&navpanes=0&scrollbar=1&view=FitH`}
                        className="w-full h-full border-none"
                        title="PDF Preview"
                        onLoad={handleIframeLoad}
                        onError={handleIframeError}
                    />
                </div>
            </div>
        </div>
    );
};

export default PDFPreviewModal;
