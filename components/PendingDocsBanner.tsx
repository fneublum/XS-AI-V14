/**
 * PendingDocsBanner — Floating review banner for auto-pipeline documents
 *
 * Shows when documents are pending review from the auto-create pipeline.
 * Users can one-click approve or reject extracted documents without
 * navigating away from their current page.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { FileStack, Check, X, ChevronDown, ChevronUp, Eye, Sparkles, AlertTriangle } from 'lucide-react';
import { documentAutoCreateService, PendingDocument } from '../services/documentAutoCreateService';

interface PendingDocsBannerProps {
  companyId: string;
}

const DOC_TYPE_COLORS: Record<string, string> = {
  'BILL OF LADING': 'bg-blue-100 text-blue-700',
  'BOOKING': 'bg-purple-100 text-purple-700',
  'ESTIMATE': 'bg-amber-100 text-amber-700',
  'PROFORMA INVOICE': 'bg-orange-100 text-orange-700',
  'PURCHASE ORDER': 'bg-green-100 text-green-700',
  'INVOICE': 'bg-red-100 text-red-700',
  'PACKING LIST': 'bg-cyan-100 text-cyan-700',
};

const DOC_TYPE_SHORT: Record<string, string> = {
  'BILL OF LADING': 'B/L',
  'BOOKING': 'BKG',
  'ESTIMATE': 'EST',
  'PROFORMA INVOICE': 'PI',
  'PURCHASE ORDER': 'PO',
  'INVOICE': 'INV',
  'PACKING LIST': 'PL',
};

const PendingDocsBanner: React.FC<PendingDocsBannerProps> = ({ companyId }) => {
  const [pendingDocs, setPendingDocs] = useState<PendingDocument[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<PendingDocument | null>(null);

  useEffect(() => {
    setPendingDocs(documentAutoCreateService.getPendingDocs().filter(d => d.status === 'pending_review'));
    const unsub = documentAutoCreateService.subscribe((docs) => {
      setPendingDocs(docs.filter(d => d.status === 'pending_review'));
    });
    return unsub;
  }, []);

  const handleApprove = useCallback(async (docId: string) => {
    setProcessingId(docId);
    try {
      await documentAutoCreateService.approvePending(docId);
    } catch (err) {
      console.error('Approve failed:', err);
    }
    setProcessingId(null);
  }, []);

  const handleReject = useCallback((docId: string) => {
    documentAutoCreateService.rejectPending(docId);
  }, []);

  const handleApproveAll = useCallback(async () => {
    for (const doc of pendingDocs) {
      setProcessingId(doc.id);
      await documentAutoCreateService.approvePending(doc.id);
    }
    setProcessingId(null);
  }, [pendingDocs]);

  if (pendingDocs.length === 0) return null;

  return (
    <>
      {/* Floating banner */}
      <div className="fixed bottom-20 right-6 z-50 w-96 max-w-[calc(100vw-3rem)]">
        <div className="bg-white rounded-xl shadow-2xl border border-indigo-200 overflow-hidden">
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-indigo-500 to-violet-500 text-white cursor-pointer"
            onClick={() => setExpanded(!expanded)}
          >
            <div className="flex items-center gap-2">
              <Sparkles size={16} />
              <span className="font-semibold text-sm">
                {pendingDocs.length} Document{pendingDocs.length > 1 ? 's' : ''} Pending Review
              </span>
            </div>
            <div className="flex items-center gap-2">
              {pendingDocs.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleApproveAll(); }}
                  className="text-xs bg-white/20 hover:bg-white/30 px-2 py-1 rounded-md transition-colors"
                >
                  Approve All
                </button>
              )}
              {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </div>
          </div>

          {/* Document list */}
          {expanded && (
            <div className="max-h-72 overflow-y-auto">
              {pendingDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${DOC_TYPE_COLORS[doc.docType] || 'bg-slate-100 text-slate-600'}`}>
                      {DOC_TYPE_SHORT[doc.docType] || doc.docType}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-800 truncate">
                        {doc.fileName}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {Math.round(doc.confidence * 100)}% confidence
                        {doc.error && <span className="text-amber-500 ml-1">• {doc.error}</span>}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 ml-2">
                    <button
                      onClick={() => setPreviewDoc(doc)}
                      className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
                      title="Preview data"
                    >
                      <Eye size={14} />
                    </button>
                    <button
                      onClick={() => handleApprove(doc.id)}
                      disabled={processingId === doc.id}
                      className="p-1 rounded hover:bg-emerald-100 text-emerald-500 hover:text-emerald-700 transition-colors disabled:opacity-50"
                      title="Approve and save"
                    >
                      {processingId === doc.id ? (
                        <div className="w-3.5 h-3.5 border-2 border-emerald-300 border-t-emerald-600 rounded-full animate-spin" />
                      ) : (
                        <Check size={14} />
                      )}
                    </button>
                    <button
                      onClick={() => handleReject(doc.id)}
                      className="p-1 rounded hover:bg-red-100 text-red-400 hover:text-red-600 transition-colors"
                      title="Reject"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Collapsed summary */}
          {!expanded && (
            <div className="px-4 py-2 flex items-center gap-2 text-xs text-slate-500">
              {pendingDocs.slice(0, 3).map((doc) => (
                <span
                  key={doc.id}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${DOC_TYPE_COLORS[doc.docType] || 'bg-slate-100 text-slate-600'}`}
                >
                  {DOC_TYPE_SHORT[doc.docType]}
                </span>
              ))}
              {pendingDocs.length > 3 && (
                <span className="text-slate-400">+{pendingDocs.length - 3} more</span>
              )}
              <span className="ml-auto text-slate-400">Click to expand</span>
            </div>
          )}
        </div>
      </div>

      {/* Preview Modal */}
      {previewDoc && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setPreviewDoc(null)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">
                  {previewDoc.docType} — Extracted Data
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {previewDoc.fileName} • {Math.round(previewDoc.confidence * 100)}% confidence
                </p>
              </div>
              <button onClick={() => setPreviewDoc(null)} className="p-1 rounded hover:bg-slate-100">
                <X size={16} className="text-slate-400" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto max-h-96">
              <div className="space-y-2">
                {Object.entries(previewDoc.extractedData)
                  .filter(([key, val]) => key !== 'EXTRACTION_CONFIDENCE' && val)
                  .map(([key, val]) => (
                    <div key={key} className="flex gap-3 text-xs">
                      <span className="text-slate-400 font-mono w-40 flex-shrink-0 text-right">
                        {key}
                      </span>
                      <span className="text-slate-800 break-words">
                        {typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
              <button
                onClick={() => { handleReject(previewDoc.id); setPreviewDoc(null); }}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Reject
              </button>
              <button
                onClick={() => { handleApprove(previewDoc.id); setPreviewDoc(null); }}
                className="px-3 py-1.5 text-xs rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 transition-colors flex items-center gap-1"
              >
                <Check size={12} />
                Approve & Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default PendingDocsBanner;
