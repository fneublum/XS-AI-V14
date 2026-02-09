import React, { useState, useRef, useEffect, useMemo } from 'react';
import { SalesOrder, Booking, BillOfLading, Invoice, Customer, User } from '../types';
import { ClipboardList, Ship, FileText, Receipt, LayoutDashboard, Calendar, ArrowRight, Download, Eye, Anchor, Sparkles, Send, Loader2, Mic, StopCircle, X, ArrowLeft, Volume2, VolumeX, Link2 } from 'lucide-react';
import { getCustomerPortalAgentResponse } from '../services/geminiService';
import { getSupabaseClient } from '../services/supabase';
import TalkingAvatar from '../components/TalkingAvatar';

interface CustomerPortalProps {
    customerName: string;
    currentUser: User;
    salesOrders: SalesOrder[];
    bookings: Booking[];
    billOfLadings: BillOfLading[];
    allBillOfLadings?: BillOfLading[]; // All BLs for ETA lookup
    invoices: Invoice[];
    opportunities: any[];
    estimates: any[];
    proformas: any[];
}

const CustomerPortal: React.FC<CustomerPortalProps> = ({
    customerName,
    currentUser,
    salesOrders,
    bookings,
    billOfLadings,
    allBillOfLadings,
    invoices,
    opportunities,
    estimates,
    proformas
}) => {
    // Use allBillOfLadings for ETA lookup if provided, otherwise fall back to billOfLadings
    const blsForLookup = allBillOfLadings || billOfLadings;
    const [activeView, setActiveView] = useState<'DASHBOARD' | 'ORDERS' | 'BOOKINGS' | 'BL' | 'INVOICES'>('DASHBOARD');

    // Chat State
    const [chatInput, setChatInput] = useState('');
    const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'model', text: string }[]>([
        { role: 'model', text: "Hello! I can help you check the status of your orders, shipments, or invoices. What would you like to know?" }
    ]);
    const [isThinking, setIsThinking] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [language, setLanguage] = useState<'en' | 'pt' | 'es' | 'zh'>('en');

    const chatEndRef = useRef<HTMLDivElement>(null);
    const recognitionRef = useRef<any>(null);

    // MAX Avatar State
    const [lastAIResponse, setLastAIResponse] = useState<string>('');
    const [lastInputWasVoice, setLastInputWasVoice] = useState<boolean>(false);
    const [isMuted, setIsMuted] = useState<boolean>(false);

    // Document Viewer State
    const [viewingDoc, setViewingDoc] = useState<{ url: string; title: string; isBlob: boolean } | null>(null);

    // Sales Order View State
    const [viewingOrder, setViewingOrder] = useState<SalesOrder | null>(null);

    // Link BL Dropdown State
    const [openLinkDropdown, setOpenLinkDropdown] = useState<string | null>(null);

    const handleLinkBL = async (invoiceId: string, blNumber: string) => {
        try {
            const client = getSupabaseClient();
            if (client) {
                const { error } = await client.from('invoices').update({ transportRef: blNumber }).eq('id', invoiceId);
                if (error) throw error;
                // Simple reload for MVP persistence verification
                window.location.reload();
            }
        } catch (e) {
            console.error("Link Error", e);
            alert("Failed to link BL.");
        }
    };



    // Counts for Dashboard
    const activeOrdersCount = salesOrders.filter(o => o.status !== 'REJECTED' && o.status !== 'FULFILLED').length;
    const activeBookingsCount = bookings.filter(b => b.status !== 'CANCELLED' && b.status !== 'SHIPPED').length;
    const pendingInvoicesCount = invoices.length;

    // --- Aggregation Logic for Customer Resume ---
    // --- Helper: Resolve Sales Order for Invoice (Shared Logic) ---
    const resolveSOForInvoice = (inv: Invoice): string => {
        const normalizeSO = (so: string) => (so || '').trim().toUpperCase();
        let soNum = normalizeSO(inv.soNumber);

        // Transitive Lookup via Booking
        if (!soNum) {
            const potentialRef = (inv.transportRef || '').trim().toUpperCase();
            if (potentialRef) {
                // Path 1: transportRef is a Booking Number
                const linkedBooking = bookings.find(b =>
                    (b.bookingNumber || '').trim().toUpperCase() === potentialRef
                );

                if (linkedBooking && linkedBooking.salesOrderId) {
                    const orderFromBooking = salesOrders.find(s =>
                        s.id === linkedBooking.salesOrderId || s.orderNumber === linkedBooking.salesOrderId
                    );
                    if (orderFromBooking) {
                        soNum = normalizeSO(orderFromBooking.orderNumber);
                    } else {
                        soNum = normalizeSO(linkedBooking.salesOrderId);
                    }
                }

                // Path 2: transportRef is a Bill of Lading Number → Find Booking via BL → Get SO
                if (!soNum) {
                    const linkedBL = billOfLadings.find(bl =>
                        (bl.blNumber || '').trim().toUpperCase() === potentialRef
                    );
                    if (linkedBL) {
                        // Find booking linked to this BL
                        const bookingWithBL = bookings.find(b =>
                            (b.blNumber || '').trim().toUpperCase() === linkedBL.blNumber.toUpperCase()
                        );
                        if (bookingWithBL && bookingWithBL.salesOrderId) {
                            const order = salesOrders.find(s =>
                                s.id === bookingWithBL.salesOrderId || s.orderNumber === bookingWithBL.salesOrderId
                            );
                            if (order) {
                                soNum = normalizeSO(order.orderNumber);
                            }
                        }
                    }
                }
            }
        }

        // Path 3: Try customerPo field as potential SO reference
        if (!soNum && inv.customerPo) {
            const poRef = normalizeSO(inv.customerPo);
            // Check if customerPo matches any SO orderNumber
            const matchedOrder = salesOrders.find(s =>
                normalizeSO(s.orderNumber) === poRef
            );
            if (matchedOrder) {
                soNum = normalizeSO(matchedOrder.orderNumber);
            }
        }

        return soNum;
    };

    // --- Aggregation Logic for Customer Resume ---
    const calculateCustomerResume = () => {
        // Map: SO Number -> { Product Name -> { ordered, shipped } }
        const resumeMap: Record<string, Record<string, { ordered: number; shipped: number; productName: string }>> = {};

        const normalizeSO = (so: string) => (so || '').trim().toUpperCase();

        // DEBUG LOGGING
        console.group("Customer Resume Debug");
        console.log("Total Sales Orders:", salesOrders.length);
        console.log("Total Invoices:", invoices.length);
        console.log("Total Bookings:", bookings.length);

        // 1. Initialize with Sales Orders (Ordered Qty)
        salesOrders.forEach(order => {
            if (order.status !== 'REJECTED') {
                const soNum = normalizeSO(order.orderNumber);
                if (!resumeMap[soNum]) {
                    resumeMap[soNum] = {};
                    // console.log(`Created Entry for SO: ${soNum}`);
                }

                order.items.forEach(item => {
                    const normalizeName = (item.productName || 'Unknown').trim().toUpperCase();
                    if (!resumeMap[soNum][normalizeName]) {
                        resumeMap[soNum][normalizeName] = { ordered: 0, shipped: 0, productName: normalizeName };
                    }
                    resumeMap[soNum][normalizeName].ordered += (Number(item.quantity) || 0);
                });
            }
        });

        console.log("Resume Map Keys (SO Numbers):", Object.keys(resumeMap));

        // 2. Add Shipped Quantities from Invoices
        invoices.forEach(inv => {
            let soNum = resolveSOForInvoice(inv);
            const originalSoNum = inv.soNumber; // for logging

            if (soNum) {
                // console.log(`[Resume Logic] Linked Invoice ${inv.invoiceNumber} -> SO ${soNum}`);
            } else {
                console.log(`[Resume Logic] Failed to link Invoice ${inv.invoiceNumber}`);
            }

            if (soNum && resumeMap[soNum]) {
                try {
                    if (inv.items) {
                        const parsedItems = JSON.parse(inv.items);
                        // console.log(`Processing Items for Invoice ${inv.invoiceNumber}`, parsedItems);
                        if (Array.isArray(parsedItems)) {
                            parsedItems.forEach((item: any) => {
                                const normalizeName = (item.description || item.productName || 'Unknown').trim().toUpperCase();

                                // 1. Try Exact Match
                                if (resumeMap[soNum][normalizeName]) {
                                    resumeMap[soNum][normalizeName].shipped += (Number(item.quantity) || 0);
                                    console.log(`  -> Matched Item (Exact): ${normalizeName}, Qty: ${Number(item.quantity)}`);
                                } else {
                                    // 2. Try Fuzzy Match (Substring)
                                    const soProductNames = Object.keys(resumeMap[soNum]);
                                    const fuzzyMatch = soProductNames.find(soName =>
                                        normalizeName.includes(soName) || soName.includes(normalizeName)
                                    );

                                    if (fuzzyMatch) {
                                        resumeMap[soNum][fuzzyMatch].shipped += (Number(item.quantity) || 0);
                                        console.log(`  -> Matched Item (Fuzzy): '${normalizeName}' mapped to '${fuzzyMatch}', Qty: ${Number(item.quantity)}`);
                                    } else {
                                        // 3. Fallback: Single Product SO
                                        if (soProductNames.length === 1) {
                                            resumeMap[soNum][soProductNames[0]].shipped += (Number(item.quantity) || 0);
                                            console.log(`  -> Matched Item (Single Product Fallback): '${normalizeName}' mapped to '${soProductNames[0]}'`);
                                        } else {
                                            console.warn(`  -> Mismatch Item: ${normalizeName} in SO ${soNum}. Available: ${soProductNames.join(', ')}`);
                                        }
                                    }
                                }
                            });
                            // Create a new entry for this "Shipped but not strictly Ordered" item (e.g. generic Charge?)
                            // resumeMap[soNum][normalizeName] = { ordered: 0, shipped: Number(item.quantity) || 0, productName: normalizeName };
                        }
                    }

                } catch (e) {
                    console.warn("Failed to parse invoice items for resume", e);
                }
            }
        });

        // Flatten to array
        const result: { soNumber: string; productName: string; ordered: number; shipped: number; balance: number }[] = [];

        Object.entries(resumeMap).forEach(([soNum, products]) => {
            Object.values(products).forEach(p => {
                // Convert LBS to KGS (1 KG = 2.20462 LBS)
                result.push({
                    soNumber: soNum,
                    productName: p.productName,
                    ordered: p.ordered / 2.20462,
                    shipped: p.shipped / 2.20462,
                    balance: (p.ordered - p.shipped) / 2.20462
                });
            });
        });

        // Sort by SO Number descending (newest first)
        return result.sort((a, b) => b.soNumber.localeCompare(a.soNumber));
    };

    const customerResumeData = calculateCustomerResume();

    // --- Prepare Shipped View Data (Grouped by SO) ---
    const getShippedViewData = () => {
        // 1. Enrich Invoices with SO Number and calculated KG Total
        const enrichedInvoices = invoices.map(inv => {
            const soNum = resolveSOForInvoice(inv) || 'Unassigned';

            // Calculate total Qty for this invoice (summing items)
            // Note: Resume logic divides ordered by 2.20462. Assuming items are LBS.
            let totalLbs = 0;
            try {
                if (inv.items) {
                    const items = JSON.parse(inv.items);
                    if (Array.isArray(items)) {
                        totalLbs = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
                    }
                }
            } catch (e) { }

            // Resolve Bill of Lading using transportRef (which contains the BL number)
            let linkedBL: BillOfLading | undefined;
            const blRef = (inv.transportRef || '').trim();

            if (blRef) {
                // Direct match by BL number (case-insensitive) - use all BLs for lookup
                linkedBL = blsForLookup.find(bl =>
                    (bl.blNumber || '').trim().toUpperCase() === blRef.toUpperCase()
                );

                // Fallback: try via booking if transportRef is a booking number
                if (!linkedBL) {
                    const linkedBooking = bookings.find(b =>
                        (b.bookingNumber || '').trim().toUpperCase() === blRef.toUpperCase()
                    );
                    if (linkedBooking && linkedBooking.blNumber) {
                        linkedBL = blsForLookup.find(bl => bl.blNumber === linkedBooking.blNumber);
                    }
                }
            }

            // Parse netWeight from invoice (stored as string in LBS)
            let netWeightKgs = 0;
            if (inv.netWeight) {
                const cleanNet = String(inv.netWeight).replace(/,/g, '').replace(/[^0-9.]/g, '');
                netWeightKgs = (parseFloat(cleanNet) || 0) / 2.20462;
            }

            // Parse grossWeight from invoice (stored as string in LBS)
            // User requested to pull from GROSS column, not calculate from items
            let grossWeightKgs = 0;
            if (inv.grossWeight) {
                const cleanGross = String(inv.grossWeight).replace(/,/g, '').replace(/[^0-9.]/g, '');
                grossWeightKgs = (parseFloat(cleanGross) || 0) / 2.20462;
            } else {
                // Fallback to calculated if column is empty, or keep 0
                grossWeightKgs = totalLbs / 2.20462;
            }

            return {
                ...inv,
                resolvedSO: soNum,
                totalKgs: grossWeightKgs, // Now mapping actual Gross Weight column
                netWeightKgs: netWeightKgs,
                resolvedBL: linkedBL
            };
        });

        // 2. Group by SO
        const groups: Record<string, typeof enrichedInvoices> = {};
        enrichedInvoices.forEach(inv => {
            if (!groups[inv.resolvedSO]) groups[inv.resolvedSO] = [];
            groups[inv.resolvedSO].push(inv);
        });

        // 3. Sort Groups (SO Descending) and Invoices within (Date Ascending)
        const sortedGroups = Object.keys(groups).sort((a, b) => {
            if (a === 'Unassigned') return 1;
            if (b === 'Unassigned') return -1;
            return b.localeCompare(a); // Newest SO first
        });

        // 4. Calculate Grand Total
        const grandTotalKgs = enrichedInvoices.reduce((sum, inv) => sum + inv.totalKgs, 0);

        return { groups, sortedGroups, grandTotalKgs };
    };

    const shippedData = getShippedViewData();

    // Fix for Zero BL Count: Merge explicit Customer BLs + BLs found via Invoices
    const mergedBLs = useMemo(() => {
        // 1. Start with prop BLs (matched by Consignee in App.tsx)
        const combined = [...billOfLadings];
        const seenIds = new Set(combined.map(b => b.id));

        // 2. Add BLs found via Invoices (which are definitely for this customer)
        Object.values(shippedData.groups).flat().forEach(inv => {
            if (inv.resolvedBL && !seenIds.has(inv.resolvedBL.id)) {
                combined.push(inv.resolvedBL);
                seenIds.add(inv.resolvedBL.id);
            }
        });
        return combined;
    }, [billOfLadings, shippedData]);

    // Helper function to render the Shipped Table Body
    const renderShippedTableRows = () => {
        if (shippedData.sortedGroups.length === 0) {
            return <tr><td colSpan={7} className="p-8 text-center text-slate-400 italic">No shipped invoices found.</td></tr>;
        }

        const rows: React.ReactNode[] = [];

        // Calculate Unlinked BLs (Available for linking)
        const linkedBLSet = new Set(Object.values(shippedData.groups).flat().map(i => i.resolvedBL?.blNumber).filter(Boolean));
        const availableBLs = billOfLadings.filter(bl => !linkedBLSet.has(bl.blNumber));

        shippedData.sortedGroups.forEach(soNum => {
            const groupInvoices = shippedData.groups[soNum].sort((a, b) => new Date(a.invoiceDate).getTime() - new Date(b.invoiceDate).getTime());

            // Calculate SO Subtotal
            const soTotalKgs = groupInvoices.reduce((sum, inv) => sum + inv.totalKgs, 0);

            // Render Invoices
            groupInvoices.forEach(inv => {
                rows.push(
                    <tr key={inv.id} className="hover:bg-emerald-50/30 transition-colors border-b border-slate-50 last:border-0">
                        <td className="p-3 font-medium text-slate-700">{inv.invoiceNumber}</td>
                        <td className="p-3 text-slate-600 font-mono text-xs">{inv.resolvedSO}</td>
                        {/* BL Column Removed */}
                        <td className="p-3 text-slate-500">{formatDateDDMMMYYYY(inv.invoiceDate)}</td>
                        <td className="p-3 text-right font-mono text-slate-700">
                            {inv.totalKgs.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </td>
                        <td className="p-3 text-center text-slate-500">
                            {(() => {
                                const eta = inv.resolvedBL?.eta || inv.arrivalDate;
                                return eta ? formatDateDDMMMYYYY(eta) : '-';
                            })()}
                        </td>
                        <td className="p-3 text-right font-medium text-emerald-600">
                            {formatCurrency(inv.totalAmount, inv.currency)}
                        </td>
                        <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                                {/* BL Action: View or Link */}
                                {inv.resolvedBL ? (
                                    <div className="flex items-center gap-2">
                                        {inv.resolvedBL.originalDocument && (
                                            <button onClick={() => openDocument(inv.resolvedBL!.originalDocument, inv.resolvedBL!.blNumber)} className="text-blue-600 hover:text-blue-800 p-1 hover:bg-blue-50 rounded transition-colors" title={`View Bill of Lading: ${inv.resolvedBL.blNumber}`}>
                                                <Eye size={16} />
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <div className="relative">
                                        <button onClick={() => setOpenLinkDropdown(openLinkDropdown === inv.id ? null : inv.id)} className="text-slate-400 hover:text-blue-600 p-1 hover:bg-blue-50 rounded transition-colors" title="Link Bill of Lading">
                                            <Link2 size={16} />
                                        </button>
                                        {openLinkDropdown === inv.id && (
                                            <div className="absolute top-full right-0 mt-2 w-56 bg-white border border-slate-200 shadow-xl rounded-lg z-50 max-h-60 overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
                                                <div className="p-2 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase bg-slate-50 sticky top-0">Select Bill of Lading</div>
                                                {availableBLs.length === 0 ? (
                                                    <div className="p-3 text-center text-slate-400 italic text-xs">No unlinked BLs found.</div>
                                                ) : (
                                                    availableBLs.map(bl => (
                                                        <button key={bl.id} onClick={() => handleLinkBL(inv.id, bl.blNumber)} className="w-full text-left p-2 hover:bg-emerald-50 hover:text-emerald-700 text-xs text-slate-600 block truncate border-b border-slate-50 last:border-0 transition-colors">
                                                            <span className="font-mono font-bold mr-2">{bl.blNumber}</span>
                                                            <span className="text-[10px] text-slate-400">{bl.container ? `(${formatContainer(bl.container)})` : ''}</span>
                                                        </button>
                                                    ))
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Invoice View Action */}
                                {inv.originalDocument && (
                                    <button onClick={() => openDocument(inv.originalDocument, inv.invoiceNumber)} className="text-emerald-600 hover:text-emerald-800 p-1 hover:bg-emerald-50 rounded transition-colors" title={`View Invoice: ${inv.invoiceNumber}`}>
                                        <FileText size={16} />
                                    </button>
                                )}
                            </div>
                        </td>
                    </tr>
                );
            });

            // Render Subtotal Row
            rows.push(
                <tr key={`subtotal-${soNum}`} className="bg-slate-50 font-semibold text-slate-700 border-t-2 border-slate-200">
                    <td colSpan={3} className="p-3 text-right uppercase text-xs tracking-wider text-slate-500">Total {soNum === 'Unassigned' ? 'Unassigned' : soNum}</td>
                    <td className="p-3 text-right font-bold text-slate-800 border-t border-slate-300">
                        {soTotalKgs.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </td>
                    <td colSpan={4}></td>
                </tr>
            );

            // Spacer row
            rows.push(<tr key={`spacer-${soNum}`}><td colSpan={8} className="h-4 bg-transparent"></td></tr>);
        });

        // Render Grand Total Row
        rows.push(
            <tr key="grand-total" className="bg-emerald-600 text-white font-bold text-lg">
                <td colSpan={3} className="p-4 text-right uppercase tracking-widest">Grand Total</td>
                <td className="p-4 text-right">
                    {shippedData.grandTotalKgs.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} KG
                </td>
                <td colSpan={4}></td>
            </tr>
        );

        return rows;
    };



    // Helper to format currency
    const formatCurrency = (amount: number, currency: string = 'USD') => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency }).format(amount);
    };

    // Auto-scroll chat
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages]);

    const changeLanguage = (lang: 'en' | 'pt' | 'es' | 'zh') => {
        setLanguage(lang);
        let welcomeText = '';
        if (lang === 'pt') welcomeText = "Olá! Posso ajudar você a verificar o status de seus pedidos, embarques ou faturas. O que você gostaria de saber?";
        else if (lang === 'es') welcomeText = "¡Hola! Puedo ayudarte a verificar el estado de tus pedidos, envíos o facturas. ¿Qué te gustaría saber?";
        else if (lang === 'zh') welcomeText = "你好！我可以帮助您查看订单、发货或发票的状态。您想了解什么？";
        else welcomeText = "Hello! I can help you check the status of your orders, shipments, or invoices. What would you like to know?";

        setChatMessages(prev => [...prev, { role: 'model', text: welcomeText }]);
        // Speak the welcome message if not muted
        if (!isMuted) {
            setLastAIResponse(welcomeText);
        }
    };

    const openDocument = (docUrl?: string, title: string = 'Document') => {
        if (!docUrl) {
            alert("No document available for this item.");
            return;
        }
        try {
            if (docUrl.startsWith('data:')) {
                // Safe way to open base64 PDF
                const arr = docUrl.split(',');
                const mime = arr[0].match(/:(.*?);/)?.[1] || 'application/pdf';
                const bstr = atob(arr[1]);
                let n = bstr.length;
                const u8arr = new Uint8Array(n);
                while (n--) {
                    u8arr[n] = bstr.charCodeAt(n);
                }
                const blob = new Blob([u8arr], { type: mime });
                const blobUrl = URL.createObjectURL(blob);
                setViewingDoc({ url: blobUrl, title, isBlob: true });
            } else {
                // Regular URL - Use popup modal for consistency with base64 documents
                setViewingDoc({ url: docUrl, title, isBlob: false });
            }
        } catch (e) {
            console.error("Error preparing document", e);
            alert("Could not load document.");
        }
    };

    const closeDocument = () => {
        if (viewingDoc && viewingDoc.isBlob) {
            URL.revokeObjectURL(viewingDoc.url);
        }
        setViewingDoc(null);
    };

    const handleSendMessage = async (isVoice: boolean = false) => {
        if (!chatInput.trim()) return;
        const userText = chatInput;
        setChatInput('');
        setLastInputWasVoice(isVoice); // Track if input was voice
        setChatMessages(prev => [...prev, { role: 'user', text: userText }]);
        setIsThinking(true);

        try {
            const response = await getCustomerPortalAgentResponse(userText, chatMessages, {
                salesOrders,
                bookings,
                billOfLadings,
                invoices,
                opportunities,
                estimates,
                proformas,
                language
            });
            setChatMessages(prev => [...prev, { role: 'model', text: response }]);
            // Trigger MAX speech for voice input (if not muted)
            if (isVoice && !isMuted) {
                setLastAIResponse(response);
            }
        } catch (e) {
            const errorMsg = language === 'pt' ? "Desculpe, ocorreu um erro. Tente novamente."
                : language === 'es' ? "Lo siento, ocurrió un error. Inténtalo de nuevo."
                    : language === 'zh' ? "抱歉，发生错误。请重试。"
                        : "Sorry, I encountered an error. Please try again.";
            setChatMessages(prev => [...prev, { role: 'model', text: errorMsg }]);
        } finally {
            setIsThinking(false);
        }
    };

    // Voice message handler - takes transcript directly to avoid async state issues
    const sendVoiceMessage = async (transcript: string) => {
        if (!transcript.trim()) return;
        setChatInput(''); // Clear any existing input
        setLastInputWasVoice(true);
        setChatMessages(prev => [...prev, { role: 'user', text: transcript }]);
        setIsThinking(true);

        try {
            const response = await getCustomerPortalAgentResponse(transcript, chatMessages, {
                salesOrders,
                bookings,
                billOfLadings,
                invoices,
                opportunities,
                estimates,
                proformas,
                language
            });
            setChatMessages(prev => [...prev, { role: 'model', text: response }]);
            // Always trigger MAX speech for voice input (if not muted)
            if (!isMuted) {
                setLastAIResponse(response);
            }
        } catch (e) {
            const errorMsg = language === 'pt' ? "Desculpe, ocorreu um erro. Tente novamente."
                : language === 'es' ? "Lo siento, ocurrió un error. Inténtalo de nuevo."
                    : language === 'zh' ? "抱歉，发生错误。请重试。"
                        : "Sorry, I encountered an error. Please try again.";
            setChatMessages(prev => [...prev, { role: 'model', text: errorMsg }]);
            if (!isMuted) {
                setLastAIResponse(errorMsg);
            }
        } finally {
            setIsThinking(false);
        }
    };

    const handleVoiceInput = () => {
        if (isListening) {
            if (recognitionRef.current) {
                recognitionRef.current.stop();
            }
            setIsListening(false);
            return;
        }

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert("Voice input is not supported in this browser.");
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = language === 'pt' ? 'pt-BR' : language === 'es' ? 'es-ES' : language === 'zh' ? 'zh-CN' : 'en-US';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => setIsListening(true);
        recognition.onend = () => setIsListening(false);
        recognition.onerror = (event: any) => {
            console.error("Speech error", event.error);
            setIsListening(false);
        };

        recognition.onresult = (event: any) => {
            const transcript = event.results[0][0].transcript;
            if (transcript) {
                setChatInput(transcript); // Show what was said in input
                // Send voice message directly (no delay, no async state issues)
                sendVoiceMessage(transcript);
            }
        };

        recognitionRef.current = recognition;
        recognition.start();
    };

    const formatPortRoute = (portString?: string): string => {
        if (!portString) return 'N/A';
        const s = portString.trim();

        // 1. Handle "Code - City, Country" format (Standard)
        const standardMatch = s.match(/^([A-Z0-9]{3,})\s*[-–—]\s*([^,]+)/i);

        if (standardMatch) {
            let code = standardMatch[1].trim();
            let city = standardMatch[2].trim();

            if (code.length === 5 && /^[A-Z]{2}/.test(code)) {
                code = code.substring(2);
            }

            return `${code} - ${city}`;
        }

        // 2. Handle "City (Code)" format
        const parenMatch = s.match(/^(.*?)\s*\(([^)]+)\)$/);
        if (parenMatch) {
            let city = parenMatch[1].trim();
            let code = parenMatch[2].trim();

            if (code.length === 5 && /^[A-Z]{2}/.test(code)) {
                code = code.substring(2);
            }
            return `${code} - ${city}`;
        }

        // 3. Fallback/Passthrough
        return s;
    };

    const formatContainer = (containerString?: string): string => {
        if (!containerString) return 'N/A';
        let raw = containerString;

        if (raw.trim().startsWith('[') && raw.trim().endsWith(']')) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    raw = parsed.join(',');
                }
            } catch { }
        }

        return raw.split(/[,;]/).map(c => c.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()).filter(c => c.length > 0).join(', ');
    };

    const formatDateDDMMMYYYY = (dateString?: string): string => {
        if (!dateString) return '';
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return '';

            const day = date.getUTCDate().toString().padStart(2, '0');
            const month = date.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }).toUpperCase();
            const year = date.getUTCFullYear();

            return `${day}-${month}-${year}`;
        } catch (e) {
            return '';
        }
    };

    // Sort Bookings by ETD (Oldest First) as requested
    const sortedBookings = [...bookings].sort((a, b) => new Date(a.etd || '9999-12-31').getTime() - new Date(b.etd || '9999-12-31').getTime());

    // Helper to render the Dashboard Shipped Rows (Compact & Grouped)
    const renderDashboardShippedRows = () => {
        if (shippedData.sortedGroups.length === 0) {
            return <tr><td colSpan={8} className="p-4 text-center text-slate-400 italic text-xs">No shipped invoices found.</td></tr>;
        }

        const rows: React.ReactNode[] = [];
        // Limit to top 5 recent SOs for Dashboard View
        const recentGroups = shippedData.sortedGroups.slice(0, 5);

        recentGroups.forEach(soNum => {
            const groupInvoices = shippedData.groups[soNum].sort((a, b) => new Date(a.invoiceDate).getTime() - new Date(b.invoiceDate).getTime());

            // Calculate SO Subtotal
            const soTotalKgs = groupInvoices.reduce((sum, inv) => sum + inv.totalKgs, 0);

            // Render Invoices
            groupInvoices.forEach(inv => {
                rows.push(
                    <tr key={inv.id} className="hover:bg-emerald-50/30 transition-colors border-b border-slate-50 last:border-0 text-[10px]">
                        <td className="py-px px-1 font-medium text-slate-700">{inv.invoiceNumber}</td>
                        <td className="py-px px-1 text-slate-600 font-mono">{inv.resolvedSO}</td>
                        {/* BL Column Removed */}
                        <td className="py-px px-1 text-slate-500 uppercase">{new Date(inv.invoiceDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-')}</td>
                        <td className="py-px px-1 text-right font-mono text-slate-600">{inv.netWeightKgs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                        <td className="py-px px-1 text-right font-mono text-slate-600">{inv.totalKgs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                        <td className="py-px px-1 text-center text-slate-500 font-medium">
                            {inv.arrivalDate ? formatDateDDMMMYYYY(inv.arrivalDate) : (inv.soNumber ? (() => {
                                const matchBk = bookings.find(b => b.salesOrderId === inv.soNumber || (b.bookingNumber && inv.soNumber && b.bookingNumber.includes(inv.soNumber)));
                                const matchBl = inv.resolvedBL;
                                const eta = matchBl?.eta || matchBk?.eta;
                                return eta ? new Date(eta).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-') : '-';
                            })() : '-')}
                        </td>
                        <td className="py-px px-1 text-right font-medium text-emerald-600">
                            {formatCurrency(inv.totalAmount, inv.currency)}
                        </td>
                        <td className="py-px px-1 text-right">
                            <div className="flex items-center justify-end gap-1">
                                {/* BL Action - Always Enabled */}
                                <button
                                    onClick={() => openDocument(inv.resolvedBL?.originalDocument, `BL: ${inv.resolvedBL?.blNumber || inv.invoiceNumber}`)}
                                    className="p-0.5 rounded transition-colors text-blue-600 hover:text-blue-800 hover:bg-blue-50 cursor-pointer"
                                    title={inv.resolvedBL?.blNumber ? `View BL: ${inv.resolvedBL.blNumber}` : 'View Bill of Lading'}
                                >
                                    <Eye size={12} />
                                </button>
                                {/* Invoice Action - Always Enabled */}
                                <button
                                    onClick={() => openDocument(inv.originalDocument, `Invoice: ${inv.invoiceNumber}`)}
                                    className="p-0.5 rounded transition-colors text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 cursor-pointer"
                                    title={`View Invoice: ${inv.invoiceNumber}`}
                                >
                                    <FileText size={12} />
                                </button>
                            </div>
                        </td>
                    </tr>
                );
            });

            // Render Subtotal Row
            rows.push(
                <tr key={`dashboard-subtotal-${soNum}`} className="bg-slate-50 font-semibold text-slate-700 border-t border-slate-200 text-[10px]">
                    <td colSpan={3} className="p-1 text-right uppercase tracking-wider text-slate-500">Total {soNum === 'Unassigned' ? '' : soNum}</td>
                    <td className="p-1 text-right font-bold text-slate-800 border-t border-slate-300">
                        {groupInvoices.reduce((sum, inv) => sum + inv.netWeightKgs, 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                    </td>
                    <td className="p-1 text-right font-bold text-slate-800 border-t border-slate-300">
                        {soTotalKgs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                    </td>
                    <td colSpan={3}></td>
                </tr>
            );

            // Spacer row
            rows.push(<tr key={`dashboard-spacer-${soNum}`}><td colSpan={8} className="h-2 bg-transparent"></td></tr>);
        });

        // Render Grand Total Row
        rows.push(
            <tr key="dashboard-grand-total" className="bg-emerald-600 text-white font-bold text-xs">
                <td colSpan={3} className="p-2 text-right uppercase tracking-widest">Grand Total</td>
                <td className="p-2 text-right">
                    {Object.values(shippedData.groups).flat().reduce((sum, inv) => sum + inv.netWeightKgs, 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KG
                </td>
                <td className="p-2 text-right">
                    {shippedData.grandTotalKgs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KG
                </td>
                <td colSpan={3}></td>
            </tr>
        );

        return rows;
    };

    return (
        <div className="h-full overflow-y-auto custom-scrollbar space-y-6 pb-12 pr-2">
            <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                <div className="w-full">
                    <h2 className="text-2xl font-bold text-slate-800 mb-4">{customerName}</h2>
                    <div className="mt-2 bg-blue-600 text-white px-6 py-6 rounded-2xl shadow-lg shadow-blue-900/20 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-10">
                            <Sparkles size={120} />
                        </div>
                        <h1 className="text-3xl font-bold relative z-10">Hello {currentUser.name.split(' ')[0]}, how can i serve you today ?</h1>
                    </div>
                </div>
            </div>

            {activeView === 'DASHBOARD' && (
                <div className="animate-in fade-in slide-in-from-bottom-4 flex flex-col xl:flex-row gap-6 items-start">

                    {/* LEFT COLUMN: Main Dashboard Content */}
                    <div className="flex-1 w-full space-y-8">
                        {/* Quick Stats / Navigation Cards - COMPACT */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <button onClick={() => setActiveView('ORDERS')} className="bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-400 transition-all text-left group flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="p-1 bg-blue-50 text-blue-600 rounded">
                                        <ClipboardList size={14} />
                                    </div>
                                    <div className="text-sm font-bold text-slate-700">Orders</div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-slate-800">{activeOrdersCount}</span>
                                    <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 rounded-full">Active</span>
                                </div>
                            </button>

                            <button onClick={() => setActiveView('BOOKINGS')} className="bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-sm hover:shadow-md hover:border-teal-400 transition-all text-left group flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="p-1 bg-teal-50 text-teal-600 rounded">
                                        <Ship size={14} />
                                    </div>
                                    <div className="text-sm font-bold text-slate-700">Bookings</div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-slate-800">{activeBookingsCount}</span>
                                    <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 rounded-full">Live</span>
                                </div>
                            </button>

                            <button onClick={() => setActiveView('BL')} className="bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-400 transition-all text-left group flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="p-1 bg-indigo-50 text-indigo-600 rounded">
                                        <FileText size={14} />
                                    </div>
                                    <div className="text-sm font-bold text-slate-700">BILL OF LADINGS</div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-slate-800">{mergedBLs.length}</span>
                                </div>
                            </button>

                            <button onClick={() => setActiveView('INVOICES')} className="bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-sm hover:shadow-md hover:border-emerald-400 transition-all text-left group flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="p-1 bg-emerald-50 text-emerald-600 rounded">
                                        <Receipt size={14} />
                                    </div>
                                    <div className="text-sm font-bold text-slate-700">Invoices</div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-slate-800">{pendingInvoicesCount}</span>
                                    <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 rounded-full">Total</span>
                                </div>
                            </button>
                        </div>



                        {/* 3. Operational Windows: TOP SHIP & SHIPPED */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                            {/* TO SHIP */}
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-[500px]">
                                <div className="p-3 border-b border-slate-100 bg-gradient-to-r from-amber-50 to-white flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="p-1.5 bg-white rounded-md border border-amber-100 text-amber-600 shadow-sm">
                                            <Ship size={16} />
                                        </div>
                                        <h3 className="font-bold text-amber-900 text-sm">TO SHIP</h3>
                                    </div>
                                </div>
                                <div className="flex-1 overflow-x-auto">
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
                                            <tr>
                                                <th className="p-3 whitespace-nowrap">BOOKING #</th>
                                                <th className="p-3 whitespace-nowrap">ETD</th>
                                                <th className="p-3 whitespace-nowrap">ETA</th>
                                                <th className="p-3 whitespace-nowrap text-center">EQP. QTY</th>
                                                <th className="p-3 whitespace-nowrap text-right">STATUS</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {/* Fix: Show all ACTIVE/REQUESTED bookings. Relax filter if needed, but user says Bookings tab shows all. */}
                                            {/* Let's try to show just Non-SHIPPED/Non-CANCELLED to be safe if status names vary */}
                                            {bookings.filter(b => b.status !== 'SHIPPED' && b.status !== 'CANCELLED').length === 0 ? (
                                                <tr><td colSpan={5} className="p-8 text-center text-slate-400 italic">Everything is shipped! No pending bookings.</td></tr>
                                            ) : (
                                                bookings.filter(b => b.status !== 'SHIPPED' && b.status !== 'CANCELLED')
                                                    .sort((a, b) => new Date(a.etd).getTime() - new Date(b.etd).getTime()) // Sort by ETD usually for shipping
                                                    .map(bk => (
                                                        <tr key={bk.id} className="hover:bg-amber-50/30 transition-colors">
                                                            <td className="py-px px-1 font-medium text-slate-700">{bk.bookingNumber}</td>
                                                            <td className="py-px px-1 text-slate-500">{new Date(bk.etd).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                                                            <td className="py-px px-1 text-slate-500">{new Date(bk.eta).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                                                            <td className="py-px px-1 text-slate-500 text-center font-mono">
                                                                {/* Extract container count from equipment (e.g., "2x40") or default to 1 */}
                                                                {bk.equipment ? (bk.equipment.match(/^(\d+)\s*[xX]/)?.[1] || '1') : '1'}
                                                            </td>
                                                            <td className="py-px px-1 text-right">
                                                                <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-[10px] font-bold border border-amber-200">
                                                                    {bk.status}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* SHIPPED (Shipped Invoices) */}
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-[500px]">
                                <div className="p-3 border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-white flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="p-1.5 bg-white rounded-md border border-emerald-100 text-emerald-600 shadow-sm">
                                            <Receipt size={16} />
                                        </div>
                                        <h3 className="font-bold text-emerald-900 text-sm">SHIPPED</h3>
                                    </div>
                                </div>
                                <div className="flex-1 overflow-x-auto">
                                    <table className="w-full text-left text-[10px]">
                                        <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
                                            <tr>
                                                <th className="p-2 whitespace-nowrap">INVOICE #</th>
                                                <th className="p-2 whitespace-nowrap">SALES ORDER</th>
                                                {/* BL Header Removed */}
                                                <th className="p-2 whitespace-nowrap">DATE</th>
                                                <th className="p-2 whitespace-nowrap text-right">NET Kgs</th>
                                                <th className="p-2 whitespace-nowrap text-right">GROSS Kgs</th>
                                                <th className="p-2 whitespace-nowrap text-center">ETA</th>
                                                <th className="p-2 whitespace-nowrap text-right">AMOUNT</th>
                                                <th className="p-2 whitespace-nowrap text-right">ACTIONS</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50 leading-tight">
                                            {renderDashboardShippedRows()}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>


                        {/* 4. Customer Resume (Moved to Bottom) */}
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                                <div className="p-1.5 bg-white border border-slate-200 rounded-md text-slate-600">
                                    <LayoutDashboard size={14} />
                                </div>
                                <h3 className="font-bold text-slate-800 text-sm tracking-wide">CUSTOMER RESUME</h3>
                            </div>
                            <div className="overflow-x-auto p-4">
                                <table className="w-full text-left text-xs">
                                    <thead className="text-slate-500 font-semibold border-b border-slate-100">
                                        <tr>
                                            <th className="pb-3 pl-2">SALES ORDER</th>
                                            <th className="pb-3 text-left">PRODUCT</th>
                                            <th className="pb-3 text-right">TOTAL ORDERS (KG)</th>
                                            <th className="pb-3 text-right">TOTAL INVOICED (KG)</th>
                                            <th className="pb-3 text-right pr-2">BALANCE TO SHIP (KG)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {customerResumeData.length === 0 ? (
                                            <tr><td colSpan={5} className="py-4 text-center text-slate-400 italic">No activity data found.</td></tr>
                                        ) : (
                                            customerResumeData.map((item, idx) => (
                                                <tr key={idx} className="group hover:bg-slate-50 transition-colors">
                                                    <td className="py-0.5 pl-2 font-bold text-slate-700 font-mono text-xs">{item.soNumber}</td>
                                                    <td className="py-0.5 text-left font-medium text-slate-700 text-xs">{item.productName}</td>
                                                    <td className="py-0.5 text-right font-mono text-slate-600">{Math.round(item.ordered).toLocaleString()} <span className="text-[10px] text-slate-400">KG</span></td>
                                                    <td className="py-0.5 text-right font-mono text-slate-600">{Math.round(item.shipped).toLocaleString()} <span className="text-[10px] text-slate-400">KG</span></td>
                                                    <td className="py-0.5 text-right pr-2">
                                                        <div className={`inline-flex items-center px-2 py-0.5 rounded-md font-mono font-bold ${item.balance > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                                            {Math.round(item.balance).toLocaleString()} <span className="text-[10px] ml-1 opacity-70">KG</span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                    <tfoot className="border-t border-slate-200 bg-slate-50/50">
                                        <tr>
                                            <td colSpan={2} className="py-3 pl-2 font-bold text-slate-800">TOTALS</td>
                                            <td className="py-3 text-right font-bold text-slate-800 font-mono">
                                                {Math.round(customerResumeData.reduce((sum, i) => sum + i.ordered, 0)).toLocaleString()} <span className="text-[10px] font-normal text-slate-500">KG</span>
                                            </td>
                                            <td className="py-3 text-right font-bold text-slate-800 font-mono">
                                                {Math.round(customerResumeData.reduce((sum, i) => sum + i.shipped, 0)).toLocaleString()} <span className="text-[10px] font-normal text-slate-500">KG</span>
                                            </td>
                                            <td className="py-3 text-right pr-2 font-bold text-slate-800 font-mono">
                                                {Math.round(customerResumeData.reduce((sum, i) => sum + i.balance, 0)).toLocaleString()} <span className="text-[10px] font-normal text-slate-500">KG</span>
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* RIGHT COLUMN: MAX AI Chat Area */}
                    <div className="w-full xl:w-[380px] shrink-0">
                        <div className="bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden flex flex-col h-[800px] sticky top-6">
                            {/* MAX Avatar Section at Top - Light pink background */}
                            <div className="p-4 border-b border-rose-100 bg-gradient-to-b from-rose-50 to-pink-50">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        <h3 className="font-bold text-sm tracking-wide text-rose-700">MAX</h3>
                                        {/* Mute Button */}
                                        <button
                                            onClick={() => setIsMuted(!isMuted)}
                                            className={`p-1 rounded-full transition-colors ${isMuted ? 'bg-rose-200 text-rose-600' : 'bg-rose-100 text-rose-400 hover:bg-rose-200'}`}
                                            title={isMuted ? 'Unmute MAX' : 'Mute MAX'}
                                        >
                                            {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            onClick={() => changeLanguage('en')}
                                            className={`text-lg transition-transform hover:scale-110 ${language === 'en' ? 'opacity-100 scale-110' : 'opacity-50 grayscale hover:grayscale-0'}`}
                                            title="English"
                                        >
                                            🇺🇸
                                        </button>
                                        <button
                                            onClick={() => changeLanguage('pt')}
                                            className={`text-lg transition-transform hover:scale-110 ${language === 'pt' ? 'opacity-100 scale-110' : 'opacity-50 grayscale hover:grayscale-0'}`}
                                            title="Português"
                                        >
                                            🇧🇷
                                        </button>
                                        <button
                                            onClick={() => changeLanguage('es')}
                                            className={`text-lg transition-transform hover:scale-110 ${language === 'es' ? 'opacity-100 scale-110' : 'opacity-50 grayscale hover:grayscale-0'}`}
                                            title="Español"
                                        >
                                            🇪🇸
                                        </button>
                                        <button
                                            onClick={() => changeLanguage('zh')}
                                            className={`text-lg transition-transform hover:scale-110 ${language === 'zh' ? 'opacity-100 scale-110' : 'opacity-50 grayscale hover:grayscale-0'}`}
                                            title="中文"
                                        >
                                            🇨🇳
                                        </button>
                                    </div>
                                </div>
                                <div className="flex justify-center">
                                    <TalkingAvatar
                                        text={lastAIResponse}
                                        autoSpeak={lastInputWasVoice && !isMuted}
                                        size="xl"
                                        variant="max"
                                        lang={language}
                                        showControls={false}
                                        onSpeakStart={() => setIsListening(false)}
                                    />
                                </div>
                            </div>

                            {/* Chat Messages - Dialog at Bottom */}
                            <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50 custom-scrollbar">
                                {chatMessages.map((msg, idx) => (
                                    <div key={idx} className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                                        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white text-[10px] font-bold ${msg.role === 'user' ? 'bg-slate-800' : 'bg-rose-400'
                                            }`}>
                                            {msg.role === 'user' ? 'You' : 'M'}
                                        </div>
                                        <div className={`px-3 py-2 rounded-xl text-xs max-w-[85%] ${msg.role === 'user'
                                            ? 'bg-white text-slate-800 border border-slate-200 rounded-tr-none'
                                            : 'bg-rose-400 text-white rounded-tl-none shadow-sm'
                                            }`}>
                                            {msg.text}
                                        </div>
                                    </div>
                                ))}
                                {isThinking && (
                                    <div className="flex gap-2">
                                        <div className="w-7 h-7 rounded-full bg-rose-400 flex items-center justify-center shrink-0 text-white text-[10px] font-bold">M</div>
                                        <div className="bg-rose-400 px-3 py-2 rounded-xl rounded-tl-none flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce"></span>
                                            <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce delay-75"></span>
                                            <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce delay-150"></span>
                                        </div>
                                    </div>
                                )}
                                <div ref={chatEndRef} />
                            </div>

                            {/* Input Area */}
                            <div className="p-3 bg-white border-t border-slate-200">
                                <div className="relative flex items-center gap-2">
                                    <input
                                        className="w-full pl-3 pr-20 py-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-400 outline-none text-xs transition-all"
                                        placeholder={language === 'pt' ? "Pergunte sobre seus pedidos..." : language === 'es' ? "Pregunte sobre sus pedidos..." : language === 'zh' ? "询问您的订单..." : "Ask about your orders..."}
                                        value={chatInput}
                                        onChange={(e) => setChatInput(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSendMessage(false)}
                                        disabled={isThinking}
                                    />
                                    <div className="absolute right-1 flex items-center gap-1">
                                        <button
                                            onClick={handleVoiceInput}
                                            className={`p-1.5 rounded-md transition-colors ${isListening ? 'text-red-500 bg-red-50 animate-pulse' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                                        >
                                            {isListening ? <StopCircle size={14} /> : <Mic size={14} />}
                                        </button>
                                        <button
                                            onClick={() => handleSendMessage(false)}
                                            disabled={!chatInput.trim() || isThinking}
                                            className="p-1.5 bg-rose-400 text-white rounded-md hover:bg-rose-500 transition-colors disabled:opacity-50"
                                        >
                                            {isThinking ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )
            }

            {
                activeView === 'ORDERS' && (
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in">
                        <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                            <ClipboardList size={18} className="text-blue-600" /> <h3 className="font-bold text-slate-800">Your Sales Orders</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                                    <tr>
                                        <th className="p-4">Order #</th>
                                        <th className="p-4">Date</th>
                                        <th className="p-4">Products</th>
                                        <th className="p-4">Total Amount</th>
                                        <th className="p-4">POD</th>
                                        <th className="p-4">Status</th>
                                        <th className="p-4 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {salesOrders.map(order => (
                                        <tr key={order.id} className="hover:bg-slate-50">
                                            <td className="p-4 font-bold text-slate-700">{order.orderNumber}</td>
                                            <td className="p-4 text-slate-600">{order.orderDate}</td>
                                            <td className="p-4">
                                                <div className="flex flex-col gap-1">
                                                    {order.items.map((item, idx) => (
                                                        <div key={idx} className="text-xs">
                                                            <span className="font-bold text-slate-700">{item.productName}</span>
                                                            <div className="text-slate-500">
                                                                {item.quantity.toLocaleString()} lbs
                                                                <span className="text-slate-400 mx-1">/</span>
                                                                {(item.quantity * 0.453592).toLocaleString(undefined, { maximumFractionDigits: 0 })} kg
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </td>
                                            <td className="p-4 text-slate-800 font-mono">{order.currency} {order.totalAmount.toLocaleString()}</td>
                                            <td className="p-4 text-slate-600 text-xs font-bold">
                                                {formatPortRoute(order.pod).split(' - ')[0]}
                                            </td>
                                            <td className="p-4">
                                                <span className={`px-2 py-1 rounded-full text-xs font-bold ${order.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{order.status}</span>
                                            </td>
                                            <td className="p-4 text-right">
                                                <button onClick={() => setViewingOrder(order)} className="text-blue-600 hover:text-blue-800 text-xs font-bold flex items-center gap-1 justify-end ml-auto">
                                                    <Eye size={14} /> View
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {salesOrders.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-400">No orders found.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
            }

            {
                activeView === 'BOOKINGS' && (
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in">
                        <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Ship size={18} className="text-teal-600" /> <h3 className="font-bold text-slate-800">Booking Confirmations</h3>
                            </div>
                            {/* Auto Filter / Sorting Indicator */}
                            <div className="text-xs text-slate-500 font-medium bg-white px-2 py-1 rounded border border-slate-200 shadow-sm">
                                Sorted by ETD (Oldest First)
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                                    <tr>
                                        <th className="p-4">Booking #</th>
                                        <th className="p-4">Vessel / Voyage</th>
                                        <th className="p-4">Route</th>
                                        <th className="p-4">ETD</th>
                                        <th className="p-4">ETA</th>
                                        <th className="p-4 text-center">Containers</th>
                                        <th className="p-4 text-center">Status</th>
                                        <th className="p-4 text-right">Document</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {sortedBookings.map(bk => (
                                        <tr key={bk.id} className="hover:bg-slate-50 transition-colors group">
                                            <td className="p-4 font-bold text-slate-700">{bk.bookingNumber}</td>
                                            <td className="p-4 text-slate-600">{bk.vesselVoyage}</td>
                                            <td className="p-4 text-slate-600 text-xs font-mono">
                                                <div className="flex items-center gap-1">
                                                    <span className="text-slate-500">{formatPortRoute(bk.pol).split(' - ')[0]}</span>
                                                    <ArrowRight size={10} className="text-slate-300" />
                                                    <span className="font-bold text-slate-700">{formatPortRoute(bk.pod).split(' - ')[0]}</span>
                                                </div>
                                            </td>
                                            <td className="p-4 text-slate-600 text-xs">
                                                <span className="text-slate-700 font-medium">{formatDateDDMMMYYYY(bk.etd)}</span>
                                            </td>
                                            <td className="p-4 text-slate-600 text-xs">
                                                <span className="text-teal-700 font-bold">{formatDateDDMMMYYYY(bk.eta)}</span>
                                            </td>
                                            <td className="p-4 text-slate-600 text-xs font-mono text-center">
                                                {bk.equipment ? <span className="bg-slate-100 px-2 py-1 rounded text-slate-600">{bk.equipment.split(/x/i)[0].trim()}</span> : '-'}
                                            </td>
                                            <td className="p-4 text-center">
                                                <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase border ${bk.status === 'SHIPPED' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                                                    bk.status === 'ACTIVE' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                                                        'bg-slate-50 text-slate-500 border-slate-100'
                                                    }`}>
                                                    {bk.status}
                                                </span>
                                            </td>
                                            <td className="p-4 text-right">
                                                {bk.originalDocument && (
                                                    <button onClick={() => openDocument(bk.originalDocument, bk.bookingNumber)} className="text-blue-600 hover:text-blue-800 flex items-center gap-1 justify-end ml-auto text-xs font-bold bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors">
                                                        <Eye size={14} /> View
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {bookings.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-400">No bookings found.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
            }

            {
                activeView === 'BL' && (
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in">
                        <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                            <FileText size={18} className="text-indigo-600" /> <h3 className="font-bold text-slate-800">Bill of Ladings</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                                    <tr>
                                        <th className="p-4">BL Number</th>
                                        <th className="p-4">Route</th>
                                        <th className="p-4">Dates (ETD / ETA)</th>
                                        <th className="p-4">Container</th>
                                        <th className="p-4 text-right">Document</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {mergedBLs.map(bl => {
                                        const formattedDate = formatDateDDMMMYYYY(bl.shippedDate);
                                        return (
                                            <tr key={bl.id} className="hover:bg-slate-50">
                                                <td className="p-4 font-bold text-slate-700">{bl.blNumber}</td>
                                                <td className="p-4 text-slate-600 text-xs font-mono">{formatPortRoute(bl.portLoading)} <ArrowRight size={10} className="inline" /> {formatPortRoute(bl.portDischarge)}</td>
                                                <td className="p-4 text-slate-600 text-xs">{formattedDate} / {bl.eta ? formatDateDDMMMYYYY(bl.eta) : '-'}</td>
                                                <td className="p-4 text-slate-600 font-mono text-xs">{formatContainer(bl.container)}</td>
                                                <td className="p-4 text-right">
                                                    {bl.originalDocument && (
                                                        <button onClick={() => openDocument(bl.originalDocument, bl.blNumber)} className="text-blue-600 hover:text-blue-800 flex items-center gap-1 justify-end ml-auto text-xs font-bold">
                                                            <Eye size={14} /> View
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                    {mergedBLs.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-slate-400">No Bill of Ladings found.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
            }

            {
                activeView === 'INVOICES' && (
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in">
                        <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                            <Receipt size={18} className="text-emerald-600" /> <h3 className="font-bold text-slate-800">Commercial Invoices</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                                    <tr>
                                        <th className="p-4">Invoice #</th>
                                        <th className="p-4">SO #</th>
                                        {/* BL Column Removed */}
                                        <th className="p-4">Date</th>
                                        <th className="p-4 text-right">Qty (KGS)</th>
                                        <th className="p-4 text-center">ETA</th>
                                        <th className="p-4 text-right">Amount</th>
                                        <th className="p-4 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {renderShippedTableRows()}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
            }

            {
                activeView !== 'DASHBOARD' && (
                    <div className="flex justify-end mt-4">
                        <button
                            onClick={() => setActiveView('DASHBOARD')}
                            className="bg-white border border-slate-200 text-slate-600 hover:text-slate-800 hover:bg-slate-50 px-4 py-2 rounded-lg font-bold transition-all shadow-sm flex items-center gap-2"
                        >
                            <ArrowLeft size={18} /> Back to Dashboard
                        </button>
                    </div>
                )
            }

            {
                viewingDoc && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in">
                        <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col animate-in zoom-in-95">
                            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                    <FileText size={20} className="text-blue-600" />
                                    {viewingDoc.title}
                                </h3>
                                <button onClick={closeDocument} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-200 rounded-full transition-all">
                                    <X size={24} />
                                </button>
                            </div>
                            <div className="flex-1 bg-slate-100 p-2 overflow-hidden relative">
                                <iframe
                                    src={viewingDoc.url}
                                    className="w-full h-full rounded border border-slate-300 bg-white"
                                    title="Document Preview"
                                />
                            </div>
                        </div>
                    </div>
                )
            }

            {
                viewingOrder && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
                        <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden animate-in zoom-in-95 max-h-[90vh] flex flex-col">
                            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                                <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                                    <ClipboardList size={20} className="text-blue-600" /> Sales Order #{viewingOrder.orderNumber}
                                </h3>
                                <button onClick={() => setViewingOrder(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                            </div>
                            <div className="p-6 overflow-y-auto custom-scrollbar">
                                {/* Header Grid */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 text-sm">
                                    <div>
                                        <p className="text-xs text-slate-500 uppercase font-bold">Date</p>
                                        <p className="text-slate-700">{viewingOrder.orderDate}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 uppercase font-bold">Status</p>
                                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${viewingOrder.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{viewingOrder.status}</span>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 uppercase font-bold">Total Amount</p>
                                        <p className="text-slate-700 font-mono font-bold">{viewingOrder.currency} {viewingOrder.totalAmount.toLocaleString()}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 uppercase font-bold">Payment Terms</p>
                                        <p className="text-slate-700">{viewingOrder.paymentTerms}</p>
                                    </div>
                                </div>

                                {/* Logistics Info */}
                                <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 mb-6 text-sm">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">Delivery Information</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <p className="text-xs text-slate-400">Method</p>
                                            <p className="font-medium text-slate-700">{viewingOrder.deliveryMethod || '-'}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-slate-400">Incoterm</p>
                                            <p className="font-medium text-slate-700">{viewingOrder.incoterm || '-'}</p>
                                        </div>
                                        {viewingOrder.pod && (
                                            <div>
                                                <p className="text-xs text-slate-400">Port of Discharge</p>
                                                <p className="font-medium text-slate-700">{viewingOrder.pod}</p>
                                            </div>
                                        )}
                                        {viewingOrder.deliveryAddress && (
                                            <div className="col-span-2">
                                                <p className="text-xs text-slate-400">Delivery Address</p>
                                                <p className="font-medium text-slate-700">{viewingOrder.deliveryAddress}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Line Items */}
                                <div className="border border-slate-200 rounded-lg overflow-hidden">
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-slate-100 text-xs text-slate-500 uppercase">
                                            <tr>
                                                <th className="p-3">Product</th>
                                                <th className="p-3 text-right">Quantity</th>
                                                <th className="p-3 text-right">Unit Price</th>
                                                <th className="p-3 text-right">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {viewingOrder.items.map((item, i) => (
                                                <tr key={i}>
                                                    <td className="p-3">
                                                        <div className="font-medium text-slate-700">{item.productName}</div>
                                                        <div className="text-xs text-slate-500">{item.customerDescription}</div>
                                                    </td>
                                                    <td className="p-3 text-right">
                                                        <div>{item.quantity.toLocaleString()} lbs</div>
                                                        <div className="text-xs text-slate-400">{(item.quantity * 0.453592).toLocaleString(undefined, { maximumFractionDigits: 0 })} kg</div>
                                                    </td>
                                                    <td className="p-3 text-right">
                                                        <div>${item.unitPrice.toFixed(4)} /lb</div>
                                                        <div className="text-xs text-slate-400">${(item.unitPrice * 2.20462).toFixed(4)} /kg</div>
                                                    </td>
                                                    <td className="p-3 text-right font-bold">${item.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot className="bg-slate-50 font-bold text-slate-700">
                                            <tr>
                                                <td colSpan={3} className="p-3 text-right">Total</td>
                                                <td className="p-3 text-right">{viewingOrder.currency} {viewingOrder.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>
                            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
                                <button onClick={() => setViewingOrder(null)} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-bold hover:bg-slate-50 transition-colors">Close</button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default CustomerPortal;