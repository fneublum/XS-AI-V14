import React from 'react';
import { X, Download } from 'lucide-react';

interface PdfViewerModalProps {
    isOpen: boolean;
    onClose: () => void;
    pdfDataUrl: string;
    fileName: string;
    onDownload?: () => void; // Function to call for download
}

const PdfViewerModal: React.FC<PdfViewerModalProps> = ({ isOpen, onClose, pdfDataUrl, fileName, onDownload }) => {
    if (!isOpen) return null;

    const handleDownload = () => {
        if (onDownload) {
            // Use the provided download function (most reliable)
            onDownload();
        } else {
            // Fallback: Direct data URL download
            try {
                const link = document.createElement('a');
                link.href = pdfDataUrl;
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } catch (error) {
                console.error('Download failed:', error);
                alert('Download failed. Please try again or right-click the PDF above and select "Save As"');
            }
        }
    };

    const handleOverlayClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70"
            onClick={handleOverlayClick}
        >
            <div className="bg-white rounded-lg shadow-2xl w-11/12 h-5/6 max-w-5xl flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
                    <h2 className="text-xl font-bold text-slate-800">Document Preview</h2>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleDownload}
                            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium"
                            type="button"
                        >
                            <Download size={18} />
                            Download
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                            aria-label="Close"
                            type="button"
                        >
                            <X size={24} className="text-slate-600" />
                        </button>
                    </div>
                </div>

                {/* PDF Viewer */}
                <div className="flex-1 overflow-hidden">
                    <iframe
                        src={pdfDataUrl}
                        className="w-full h-full border-0"
                        title="PDF Preview"
                    />
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 text-sm text-slate-600">
                    <p>{fileName}</p>
                </div>
            </div>
        </div>
    );
};

export default PdfViewerModal;
